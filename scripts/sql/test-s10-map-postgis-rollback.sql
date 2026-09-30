-- S10 synthetic PostGIS regression; temporary objects only; no persisted data.
ROLLBACK;
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
CREATE TEMP TABLE profiles(id uuid PRIMARY KEY,nombre text NOT NULL,is_hidden boolean NOT NULL DEFAULT false);
CREATE TEMP TABLE categories(id uuid PRIMARY KEY,slug text UNIQUE);
CREATE TEMP TABLE user_blocks(blocker_id uuid,blocked_id uuid);
CREATE TEMP TABLE products_services(id uuid PRIMARY KEY,creador_id uuid REFERENCES profiles(id),titulo text,slug text,descripcion text,precio numeric,modo_precio text DEFAULT 'fijo',tipo text DEFAULT 'producto',categoria text DEFAULT 'comida',imagen_principal text,created_at timestamptz DEFAULT now(),estatus text DEFAULT 'disponible',is_hidden boolean DEFAULT false,ubicacion_geo geography(POINT,4326),ubicacion text DEFAULT 'PRIVATE TEST ADDRESS');
CREATE TEMP TABLE product_categories(product_id uuid,categoria_id uuid,is_primary boolean);
CREATE TEMP TABLE s10_results(check_name text,result text);
SET LOCAL search_path=pg_temp,public;
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon,authenticated',(SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema())); END $$;
GRANT SELECT(id,titulo,creador_id) ON pg_temp.products_services TO anon,authenticated;
CREATE FUNCTION pg_temp.s10_check(n text,ok boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_temp,public AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'S10 FAIL: %',n; END IF; INSERT INTO pg_temp.s10_results VALUES(n,'PASS'); END $$;
INSERT INTO pg_temp.profiles VALUES('00000000-0000-4000-8000-000000000001','Ángela',false),('00000000-0000-4000-8000-000000000002','Bruno',false),('00000000-0000-4000-8000-000000000003','Visitante',false);
INSERT INTO pg_temp.categories VALUES('00000000-0000-4000-8000-000000000001','comida'),('00000000-0000-4000-8000-000000000002','belleza');
INSERT INTO pg_temp.products_services(id,creador_id,titulo,slug,descripcion,precio,ubicacion_geo) VALUES
('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Café recién hecho','cafe','Postre artesanal',30,ST_SetSRID(ST_MakePoint(-98.20631,19.04149),4326)),
('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Pan','pan','',20,ST_SetSRID(ST_MakePoint(-98.20641,19.04159),4326)),
('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','Uñas','unas','',100,ST_SetSRID(ST_MakePoint(-98.15,19.08),4326));
INSERT INTO pg_temp.product_categories VALUES('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',true),('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',true),('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',true);
-- S10 / ADR 2026-09-30: public_lat/public_lng are derived ~1 km cells,
-- never products_services.ubicacion_geo. Existing column grants stay intact.
-- Generated geometry updates atomically with the private point; no client
-- can write it or publish a more precise point. Generic geometry is safe here:
-- the generated expression can produce only a POINT with SRID 4326.
ALTER TABLE pg_temp.products_services ADD COLUMN ubicacion_mapa geometry
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(
      round(ST_X(ubicacion_geo::geometry)::numeric, 2)::double precision,
      round(ST_Y(ubicacion_geo::geometry)::numeric, 2)::double precision
    ), 4326)
  ) STORED;
COMMENT ON COLUMN pg_temp.products_services.ubicacion_mapa IS
  'S10 projection v1: stable two-decimal public cell; no direct client SELECT. Exact point remains private.';
CREATE INDEX idx_products_services_mapa ON pg_temp.products_services USING gist (ubicacion_mapa)
  WHERE ubicacion_mapa IS NOT NULL AND estatus = 'disponible' AND is_hidden = false;

CREATE FUNCTION pg_temp.search_map_publications_v1(p_query jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public SET statement_timeout = '4s'
AS $map$
DECLARE
  v_viewer uuid := auth.uid();
  v_w double precision; v_s double precision; v_e double precision; v_n double precision;
  v_center_lat double precision; v_center_lng double precision;
  v_radius integer; v_stride integer; v_mode text; v_tipo text;
  v_min numeric; v_max numeric; v_term text; v_categories text[];
  v_cell text; v_cursor jsonb; v_key text; v_time timestamptz; v_id uuid;
  v_normalized jsonb; v_result jsonb;
BEGIN
  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' OR octet_length(p_query::text) > 8192
     OR p_query - ARRAY['bounds','q','categories','tipo','price_min','price_max','mode','center','radius_meters','cell_id','cursor'] <> '{}'::jsonb
     OR jsonb_typeof(p_query->'bounds') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid map query' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_query->'bounds') e
    WHERE e.key NOT IN ('west','south','east','north') OR jsonb_typeof(e.value) <> 'number')
    OR (SELECT count(*) FROM jsonb_object_keys(p_query->'bounds')) <> 4 THEN
    RAISE EXCEPTION 'Invalid map bounds' USING ERRCODE='22023';
  END IF;
  v_w := (p_query->'bounds'->>'west')::double precision;
  v_s := (p_query->'bounds'->>'south')::double precision;
  v_e := (p_query->'bounds'->>'east')::double precision;
  v_n := (p_query->'bounds'->>'north')::double precision;
  IF NOT (v_w >= -118.5 AND v_e <= -86.5 AND v_s >= 14.5 AND v_n <= 32.8 AND v_w < v_e AND v_s < v_n) THEN
    RAISE EXCEPTION 'Invalid map bounds' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_query) e WHERE
    (e.key IN ('q','mode') AND jsonb_typeof(e.value) <> 'string') OR
    (e.key IN ('tipo','cell_id') AND jsonb_typeof(e.value) NOT IN ('string','null')) OR
    (e.key IN ('price_min','price_max') AND jsonb_typeof(e.value) NOT IN ('number','null')) OR
    (e.key = 'radius_meters' AND jsonb_typeof(e.value) <> 'number') OR
    (e.key = 'categories' AND jsonb_typeof(e.value) <> 'array') OR
    (e.key IN ('center','cursor') AND jsonb_typeof(e.value) NOT IN ('object','null'))) THEN
    RAISE EXCEPTION 'Invalid map filters' USING ERRCODE='22023';
  END IF;
  v_mode := coalesce(p_query->>'mode','zone');
  v_tipo := p_query->>'tipo'; v_cell := p_query->>'cell_id';
  v_min := (p_query->>'price_min')::numeric; v_max := (p_query->>'price_max')::numeric;
  v_radius := coalesce((p_query->>'radius_meters')::numeric,10000)::integer;
  v_term := trim(coalesce(p_query->>'q',''));
  IF v_mode NOT IN ('zone','nearby') OR (v_tipo IS NOT NULL AND v_tipo NOT IN ('producto','servicio'))
    OR length(v_term)>120 OR v_radius<1000 OR v_radius>50000
    OR (p_query ? 'radius_meters' AND (p_query->>'radius_meters')::numeric <> v_radius)
    OR (v_min IS NOT NULL AND (v_min<0 OR v_min>99999999))
    OR (v_max IS NOT NULL AND (v_max<0 OR v_max>99999999)) OR v_min>v_max
    OR (v_cell IS NOT NULL AND (length(v_cell)>70 OR v_cell !~ '^cell:[1-9][0-9]*:-?[0-9]+:-?[0-9]+$')) THEN
    RAISE EXCEPTION 'Invalid map filters' USING ERRCODE='22023';
  END IF;
  IF p_query->'center' IS NOT NULL AND p_query->'center' <> 'null'::jsonb THEN
    IF (p_query->'center') - ARRAY['lat','lng'] <> '{}'::jsonb
      OR jsonb_typeof(p_query->'center'->'lat') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_query->'center'->'lng') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Invalid map center' USING ERRCODE='22023';
    END IF;
    v_center_lat := (p_query->'center'->>'lat')::double precision;
    v_center_lng := (p_query->'center'->>'lng')::double precision;
    IF NOT (v_center_lat BETWEEN -90 AND 90 AND v_center_lng BETWEEN -180 AND 180) THEN
      RAISE EXCEPTION 'Invalid map center' USING ERRCODE='22023';
    END IF;
  END IF;
  IF v_mode='nearby' AND (v_center_lat IS NULL OR v_center_lng IS NULL) THEN
    RAISE EXCEPTION 'Missing map center' USING ERRCODE='22023';
  END IF;
  IF v_mode='zone' THEN v_center_lat:=NULL; v_center_lng:=NULL; END IF;
  IF jsonb_array_length(coalesce(p_query->'categories','[]'::jsonb))>10
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_query->'categories','[]'::jsonb)) a WHERE jsonb_typeof(a)<>'string') THEN
    RAISE EXCEPTION 'Invalid map categories' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT value ORDER BY value),'{}'::text[]) INTO v_categories
    FROM jsonb_array_elements_text(coalesce(p_query->'categories','[]'::jsonb));
  IF EXISTS (SELECT 1 FROM unnest(v_categories) s WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.slug=s)) THEN
    RAISE EXCEPTION 'Invalid map categories' USING ERRCODE='22023';
  END IF;
  v_normalized := jsonb_build_object('bounds',p_query->'bounds','q',v_term,'categories',v_categories,
    'tipo',v_tipo,'price_min',v_min,'price_max',v_max,'mode',v_mode,'radius_meters',v_radius,
    'center_lat',v_center_lat,'center_lng',v_center_lng,'cell_id',v_cell);
  v_key := md5(v_normalized::text || coalesce(v_viewer::text,'guest'));
  v_cursor := p_query->'cursor';
  IF v_cursor IS NOT NULL AND v_cursor<>'null'::jsonb THEN
    IF jsonb_typeof(v_cursor)<>'object' OR v_cursor - ARRAY['key','created_at','id'] <> '{}'::jsonb
      OR v_cursor->>'key' IS DISTINCT FROM v_key
      OR jsonb_typeof(v_cursor->'id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(v_cursor->'created_at') NOT IN ('string','null')
      OR NOT (v_cursor ? 'created_at') THEN
      RAISE EXCEPTION 'Stale map cursor' USING ERRCODE='22023';
    END IF;
    v_time := (v_cursor->>'created_at')::timestamptz; v_id := (v_cursor->>'id')::uuid;
  END IF;
  v_stride := greatest(1,ceil(greatest(v_e-v_w,v_n-v_s)*100/14)::integer);
  v_term := translate(lower(v_term),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc');
  WITH eligible AS MATERIALIZED (
    SELECT ps.id,ps.creador_id,ps.titulo,ps.slug,ps.precio,ps.modo_precio::text,ps.tipo::text,
      ps.imagen_principal,ps.created_at,pr.nombre AS vendedor_nombre,
      coalesce((SELECT c.slug FROM product_categories pc JOIN categories c ON c.id=pc.categoria_id
        WHERE pc.product_id=ps.id ORDER BY pc.is_primary DESC,c.slug LIMIT 1),ps.categoria) AS categoria,
      ST_X(ps.ubicacion_mapa) AS public_lng, ST_Y(ps.ubicacion_mapa) AS public_lat,
      'cell:'||v_stride||':'||floor(round(ST_X(ps.ubicacion_mapa)::numeric*100)/v_stride)::text
        ||':'||floor(round(ST_Y(ps.ubicacion_mapa)::numeric*100)/v_stride)::text AS cell_id,
      count(*) OVER (PARTITION BY ps.creador_id,ST_X(ps.ubicacion_mapa),ST_Y(ps.ubicacion_mapa)) AS seller_listing_count
    FROM products_services ps JOIN profiles pr ON pr.id=ps.creador_id
    WHERE ps.estatus='disponible' AND ps.is_hidden=false AND pr.is_hidden=false
      AND ps.ubicacion_mapa IS NOT NULL
      AND ps.ubicacion_mapa && ST_MakeEnvelope(v_w,v_s,v_e,v_n,4326)
      AND dentro_de_cobertura(ST_Y(ps.ubicacion_mapa),ST_X(ps.ubicacion_mapa))
      AND (v_viewer IS NULL OR NOT EXISTS (SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_id=v_viewer AND ub.blocked_id=ps.creador_id)
           OR (ub.blocked_id=v_viewer AND ub.blocker_id=ps.creador_id)))
      AND (v_mode='zone' OR ST_DWithin(ps.ubicacion_mapa::geography,
        ST_SetSRID(ST_MakePoint(v_center_lng,v_center_lat),4326)::geography,v_radius))
      AND (v_tipo IS NULL OR ps.tipo::text=v_tipo)
      AND (v_min IS NULL OR ps.precio>=v_min) AND (v_max IS NULL OR ps.precio<=v_max)
      AND (cardinality(v_categories)=0 OR EXISTS (SELECT 1 FROM product_categories pc
        JOIN categories c ON c.id=pc.categoria_id WHERE pc.product_id=ps.id AND c.slug=ANY(v_categories)))
      AND (v_term='' OR strpos(translate(lower(ps.titulo),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0
        OR strpos(translate(lower(coalesce(ps.descripcion,'')),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0
        OR strpos(translate(lower(pr.nombre),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0)
  ), cells AS (
    SELECT cell_id AS id, avg(public_lat) AS public_lat,avg(public_lng) AS public_lng,
      count(*) AS count,count(DISTINCT creador_id) AS seller_count,
      jsonb_build_object('west',min(public_lng),'south',min(public_lat),'east',max(public_lng),'north',max(public_lat)) AS bounds
    FROM eligible GROUP BY cell_id
  ), focused AS MATERIALIZED (
    SELECT * FROM eligible WHERE v_cell IS NULL OR cell_id=v_cell
  ), batch AS MATERIALIZED (
    SELECT * FROM focused WHERE v_id IS NULL OR
      (v_time IS NULL AND created_at IS NULL AND id<v_id) OR
      (v_time IS NOT NULL AND (created_at<v_time OR (created_at=v_time AND id<v_id) OR created_at IS NULL))
    ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 31
  ), page AS MATERIALIZED (
    SELECT * FROM batch ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 30
  )
  SELECT jsonb_build_object('query_key',v_key,'projection_version',1,'as_of',statement_timestamp(),
    'features',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM cells c),'[]'::jsonb),
    'total',(SELECT count(*) FROM eligible),'seller_total',(SELECT count(DISTINCT creador_id) FROM eligible),
    'list_total',(SELECT count(*) FROM focused),
    'listings',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'creador_id',p.creador_id,
      'titulo',p.titulo,'slug',p.slug,'precio',p.precio,'modo_precio',p.modo_precio,'tipo',p.tipo,
      'imagen_principal',p.imagen_principal,'created_at',p.created_at,'vendedor_nombre',p.vendedor_nombre,
      'categoria',p.categoria,'cell_id',p.cell_id,'seller_listing_count',p.seller_listing_count)
      ORDER BY p.created_at DESC NULLS LAST,p.id DESC) FROM page p),'[]'::jsonb),
    'next_cursor',CASE WHEN (SELECT count(*) FROM batch)>30 THEN
      (SELECT jsonb_build_object('key',v_key,'created_at',p.created_at,'id',p.id)
        FROM page p ORDER BY p.created_at ASC NULLS FIRST,p.id ASC LIMIT 1) ELSE NULL END)
  INTO v_result;
  RETURN v_result;
END;
$map$;
REVOKE ALL ON FUNCTION pg_temp.search_map_publications_v1(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.search_map_publications_v1(jsonb) TO anon,authenticated;
COMMENT ON FUNCTION pg_temp.search_map_publications_v1(jsonb) IS
  'S10 read-only bounded map: only generated two-decimal public points. Same snapshot for cells/counts/cards; bilateral blocks and visibility. Does not return private coordinates or address.';

SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE anon;
SELECT pg_temp.s10_check('01 anon RPC and totals',(pg_temp.search_map_publications_v1('{"bounds":{"west":-98.4,"south":18.9,"east":-98,"north":19.2}}')->>'total')::int=3);
SELECT pg_temp.s10_check('02 exact and derived columns remain private',NOT has_column_privilege('anon','pg_temp.products_services','ubicacion_geo','SELECT') AND NOT has_column_privilege('anon','pg_temp.products_services','ubicacion_mapa','SELECT'));
RESET ROLE;
DO $test$
DECLARE q jsonb:='{"bounds":{"west":-98.4,"south":18.9,"east":-98,"north":19.2}}';r jsonb;f jsonb;c jsonb;seen uuid[]:='{}';p jsonb;started timestamptz;elapsed numeric;
BEGIN
r:=pg_temp.search_map_publications_v1(q);
PERFORM pg_temp.s10_check('03 generated POINT/SRID/rounding',(SELECT ST_X(ubicacion_mapa)=-98.21 AND ST_Y(ubicacion_mapa)=19.04 AND ST_SRID(ubicacion_mapa)=4326 AND ST_GeometryType(ubicacion_mapa)='ST_Point' FROM pg_temp.products_services WHERE titulo LIKE 'Café%'));
PERFORM pg_temp.s10_check('04 actual GiST index created',to_regclass('pg_temp.idx_products_services_mapa') IS NOT NULL);
PERFORM pg_temp.s10_check('05 output excludes private point and address',strpos(r::text,'-98.20631')=0 AND strpos(r::text,'PRIVATE TEST ADDRESS')=0 AND strpos(r::text,'ubicacion_geo')=0);
PERFORM pg_temp.s10_check('06 sellers and co-located counts',(r->>'seller_total')::int=2 AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'listings') listing_row WHERE (listing_row->>'seller_listing_count')::int=2));
PERFORM pg_temp.s10_check('07 bounds use rounded public point',(pg_temp.search_map_publications_v1('{"bounds":{"west":-98.208,"south":19.03,"east":-98.2,"north":19.05}}')->>'total')::int=0);
PERFORM pg_temp.s10_check('08 real geography 1 km radius',(pg_temp.search_map_publications_v1(q||'{"mode":"nearby","center":{"lat":19.04,"lng":-98.21},"radius_meters":1000}')->>'total')::int=2);
PERFORM pg_temp.s10_check('09 accents and literal search',(pg_temp.search_map_publications_v1(q||'{"q":"cafe"}')->>'total')::int=1 AND (pg_temp.search_map_publications_v1(q||'{"q":"%"}')->>'total')::int=0);
PERFORM pg_temp.s10_check('10 category and price filters',(pg_temp.search_map_publications_v1(q||'{"categories":["belleza"]}')->>'total')::int=1 AND (pg_temp.search_map_publications_v1(q||'{"price_min":25,"price_max":35}')->>'total')::int=1);
INSERT INTO pg_temp.user_blocks VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001');PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
PERFORM pg_temp.s10_check('11 buyer blocks seller',(pg_temp.search_map_publications_v1(q)->>'total')::int=1);
DELETE FROM pg_temp.user_blocks;INSERT INTO pg_temp.user_blocks VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003');
PERFORM pg_temp.s10_check('12 seller blocks buyer',(pg_temp.search_map_publications_v1(q)->>'total')::int=1);
DELETE FROM pg_temp.user_blocks;PERFORM set_config('request.jwt.claim.sub','',true);
UPDATE pg_temp.profiles SET is_hidden=true WHERE id='00000000-0000-4000-8000-000000000001';
PERFORM pg_temp.s10_check('13 hidden seller omitted',(pg_temp.search_map_publications_v1(q)->>'total')::int=1);
UPDATE pg_temp.profiles SET is_hidden=false;UPDATE pg_temp.products_services SET is_hidden=true WHERE titulo LIKE 'Café%';UPDATE pg_temp.products_services SET estatus='vendido' WHERE titulo='Pan';
PERFORM pg_temp.s10_check('14 hidden and unavailable listings omitted',(pg_temp.search_map_publications_v1(q)->>'total')::int=1);
UPDATE pg_temp.products_services SET is_hidden=false,estatus='disponible';
BEGIN PERFORM pg_temp.search_map_publications_v1(q||'{"radius_meters":1.5}');RAISE EXCEPTION 'accepted invalid radius';EXCEPTION WHEN invalid_parameter_value THEN PERFORM pg_temp.s10_check('15 direct invalid RPC rejected',true);END;
INSERT INTO pg_temp.products_services(id,creador_id,titulo,slug,descripcion,precio,ubicacion_geo,created_at)
SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000001','Producto '||n,'p'||n,'',1,ST_SetSRID(ST_MakePoint(-98.30+(n%20)*0.01,19+(n%10)*0.01),4326),CASE WHEN n%3=0 THEN NULL ELSE '2026-09-30'::timestamptz END FROM generate_series(10,1009) n;
started:=clock_timestamp();r:=pg_temp.search_map_publications_v1(q);elapsed:=extract(epoch FROM clock_timestamp()-started)*1000;
PERFORM pg_temp.s10_check('16 1003 listings bounded markers and exact totals',(r->>'total')::int=1003 AND jsonb_array_length(r->'features')<=300 AND (SELECT sum((feature_row->>'count')::int) FROM jsonb_array_elements(r->'features') feature_row)=1003);
INSERT INTO pg_temp.s10_results VALUES('17 elapsed first 1003-listing query',round(elapsed,2)||' ms (single synthetic measurement)');
c:=NULL;
LOOP r:=pg_temp.search_map_publications_v1(q||jsonb_build_object('cursor',c));FOR p IN SELECT value FROM jsonb_array_elements(r->'listings') LOOP IF (p->>'id')::uuid=ANY(seen) THEN RAISE EXCEPTION 'duplicate cursor row';END IF;seen:=array_append(seen,(p->>'id')::uuid);END LOOP;c:=r->'next_cursor';EXIT WHEN c='null'::jsonb;END LOOP;
PERFORM pg_temp.s10_check('18 cursor pagination handles ties and null dates',cardinality(seen)=1003);
r:=pg_temp.search_map_publications_v1(q);c:=r->'next_cursor';
BEGIN PERFORM pg_temp.search_map_publications_v1(q||jsonb_build_object('q','Pan','cursor',c));RAISE EXCEPTION 'accepted stale cursor';EXCEPTION WHEN invalid_parameter_value THEN PERFORM pg_temp.s10_check('19 cursor bound to filters',true);END;
f:=r->'features'->0;r:=pg_temp.search_map_publications_v1(q||jsonb_build_object('cell_id',f->>'id'));
PERFORM pg_temp.s10_check('20 selected group preserves area total',(r->>'total')::int=1003 AND (r->>'list_total')::int=(f->>'count')::int);
END;
$test$;
SELECT check_name,result FROM pg_temp.s10_results ORDER BY check_name;
ROLLBACK;
