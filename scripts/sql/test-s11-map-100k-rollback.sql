-- S11 100,000-row matrix: prepare only; execute manually in the SQL Editor.
-- Requires PostGIS, anon/authenticated roles, auth.uid and deployed dentro_de_cobertura.
-- Functions below are the unchanged temporary copies from test-s11-map-postgis-rollback.sql.
-- statement_timeout=90s bounds each outer statement/DO; inner function SET 4s is not proof of per-call cancellation.
-- Safety revision: automatic review rejected clearing temporary seeds and
-- confirming execution without RLS. This version starts with empty TEMP
-- tables, explicitly enables their RLS and inserts only the needed dataset.
-- Production tables, policies and functions are not changed.
-- S11 synthetic PostGIS regression; temporary objects only; no persisted data.
ROLLBACK;
BEGIN;
SET LOCAL statement_timeout='90s';
SET LOCAL lock_timeout='2s';
CREATE TEMP TABLE profiles(id uuid PRIMARY KEY,nombre text NOT NULL,is_hidden boolean NOT NULL DEFAULT false);
CREATE TEMP TABLE categories(id uuid PRIMARY KEY,slug text UNIQUE);
CREATE TEMP TABLE user_blocks(blocker_id uuid,blocked_id uuid);
CREATE TEMP TABLE products_services(id uuid PRIMARY KEY,creador_id uuid REFERENCES profiles(id),titulo text,slug text,descripcion text,precio numeric,modo_precio text DEFAULT 'fijo',tipo text DEFAULT 'producto',categoria text DEFAULT 'comida',imagen_principal text,created_at timestamptz DEFAULT now(),estatus text DEFAULT 'disponible',is_hidden boolean DEFAULT false,ubicacion_geo geography(POINT,4326),ubicacion text DEFAULT 'PRIVATE TEST ADDRESS');
CREATE TEMP TABLE product_categories(product_id uuid,categoria_id uuid,is_primary boolean);
CREATE TEMP TABLE s11_results(check_name text,result text);
ALTER TABLE pg_temp.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pg_temp.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE pg_temp.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pg_temp.products_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE pg_temp.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE pg_temp.s11_results ENABLE ROW LEVEL SECURITY;
SET LOCAL search_path=pg_temp,public;
DO $$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon,authenticated',(SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema())); END $$;
GRANT SELECT(id,titulo,creador_id) ON pg_temp.products_services TO anon,authenticated;
CREATE FUNCTION pg_temp.s11_check(n text,ok boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_temp,public AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'S11 FAIL: %',n; END IF; INSERT INTO pg_temp.s11_results VALUES(n,'PASS'); END $$;
INSERT INTO pg_temp.categories VALUES('00000000-0000-4000-8000-000000000001','comida'),('00000000-0000-4000-8000-000000000002','belleza');
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
  -- At most 16 x 16 nonempty buckets, including boundary buckets. No cap
  -- on candidates: every eligible publication contributes to its bucket.
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
-- S11: additive read-only coverage contract. Projection v1 remains ~1 km.
-- Revision hashes all eligible IDs and public fields in the same SQL snapshot.
-- It is a coherence token, not permission; auth/visibility is checked every time.
CREATE FUNCTION pg_temp.search_map_publications_v2(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public SET statement_timeout = '4s'
AS $map$
DECLARE
  p_query jsonb; v_viewer uuid := auth.uid();
  v_w float8;v_s float8;v_e float8;v_n float8;
  v_center_lat float8;v_center_lng float8;v_coverage_lat float8;v_coverage_lng float8;
  v_radius integer;v_stride integer:=1;v_overview_stride integer:=1;v_mode text;v_tipo text;
  v_min numeric;v_max numeric;v_term text;v_categories text[];
  v_cell text;v_cursor jsonb;v_key text;v_time timestamptz;v_id uuid;
  v_normalized jsonb;v_result jsonb;v_action text;v_revision text;
  v_after_x integer;v_after_y integer;v_node_stride integer;v_node_x integer;v_node_y integer;
BEGIN
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::text)>8192
    OR p_request-ARRAY['action','query','coverage_center','revision','cell_cursor']<>'{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid coverage request' USING ERRCODE='22023';
  END IF;
  v_action:=p_request->>'action';v_revision:=p_request->>'revision';p_query:=p_request->'query';
  IF v_action IS NULL OR v_action NOT IN ('overview','cells','listings','check')
    OR (p_request?'revision' AND jsonb_typeof(p_request->'revision') NOT IN ('string','null'))
    OR (v_revision IS NOT NULL AND v_revision!~'^[a-f0-9]{32}$') THEN
    RAISE EXCEPTION 'Invalid coverage request' USING ERRCODE='22023';
  END IF;
  IF p_request->'coverage_center' IS NOT NULL AND p_request->'coverage_center'<>'null'::jsonb THEN
    IF jsonb_typeof(p_request->'coverage_center')<>'object'
      OR (p_request->'coverage_center')-ARRAY['lat','lng']<>'{}'::jsonb
      OR jsonb_typeof(p_request->'coverage_center'->'lat') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_request->'coverage_center'->'lng') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Invalid coverage center' USING ERRCODE='22023';
    END IF;
    v_coverage_lat:=(p_request->'coverage_center'->>'lat')::float8;v_coverage_lng:=(p_request->'coverage_center'->>'lng')::float8;
    IF NOT(v_coverage_lat BETWEEN 14.5 AND 32.8 AND v_coverage_lng BETWEEN -118.5 AND -86.5) THEN
      RAISE EXCEPTION 'Invalid coverage center' USING ERRCODE='22023';
    END IF;
  END IF;
  IF v_action='cells' AND v_coverage_lat IS NULL THEN RAISE EXCEPTION 'Choose a local area' USING ERRCODE='22023';END IF;
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
    'center_lat',v_center_lat,'center_lng',v_center_lng,'coverage_center',p_request->'coverage_center');
  v_key := md5(v_normalized::text || coalesce(v_viewer::text,'guest'));

  WHILE v_overview_stride<8192 AND (ceil((v_e-v_w)*100/v_overview_stride)+2)*(ceil((v_n-v_s)*100/v_overview_stride)+2)>300 LOOP
    v_overview_stride:=v_overview_stride*2;
  END LOOP;
  IF v_cell IS NOT NULL THEN
    IF split_part(v_cell,':',2)::numeric>8192 OR split_part(v_cell,':',3)::numeric NOT BETWEEN -11850 AND -1 OR split_part(v_cell,':',4)::numeric NOT BETWEEN 0 AND 3280 THEN RAISE EXCEPTION 'Invalid group' USING ERRCODE='22023';END IF;
    v_node_stride:=split_part(v_cell,':',2)::integer;v_node_x:=split_part(v_cell,':',3)::integer;v_node_y:=split_part(v_cell,':',4)::integer;
    IF v_node_stride>8192 OR (v_node_stride & (v_node_stride-1))<>0 THEN RAISE EXCEPTION 'Invalid group' USING ERRCODE='22023';END IF;
  END IF;
  v_cursor:=p_query->'cursor';
  IF v_cursor IS NOT NULL AND v_cursor<>'null'::jsonb THEN
    IF jsonb_typeof(v_cursor)<>'object' OR v_cursor-ARRAY['key','created_at','id']<>'{}'::jsonb
      OR jsonb_typeof(v_cursor->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(v_cursor->'created_at') NOT IN ('string','null')
      OR NOT(v_cursor?'created_at') THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023';END IF;
    v_time:=(v_cursor->>'created_at')::timestamptz;v_id:=(v_cursor->>'id')::uuid;
  END IF;
  IF p_request->'cell_cursor' IS NOT NULL AND p_request->'cell_cursor'<>'null'::jsonb THEN
    IF jsonb_typeof(p_request->'cell_cursor')<>'object' OR (p_request->'cell_cursor')-ARRAY['x','y']<>'{}'::jsonb
      OR jsonb_typeof(p_request->'cell_cursor'->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(p_request->'cell_cursor'->'y') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
    IF (p_request->'cell_cursor'->>'x')::numeric NOT BETWEEN -11850 AND -8650 OR (p_request->'cell_cursor'->>'y')::numeric NOT BETWEEN 1450 AND 3280 THEN RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
    IF trunc((p_request->'cell_cursor'->>'x')::numeric)<>(p_request->'cell_cursor'->>'x')::numeric OR trunc((p_request->'cell_cursor'->>'y')::numeric)<>(p_request->'cell_cursor'->>'y')::numeric THEN RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
    v_after_x:=(p_request->'cell_cursor'->>'x')::integer;v_after_y:=(p_request->'cell_cursor'->>'y')::integer;
    IF (p_request->'cell_cursor'->>'x')::numeric<>v_after_x OR (p_request->'cell_cursor'->>'y')::numeric<>v_after_y THEN
      RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
  END IF;
  v_term:=translate(lower(v_term),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc');
  WITH eligible AS MATERIALIZED (
    SELECT ps.id,ps.creador_id,ps.titulo,ps.slug,ps.precio,ps.modo_precio::text,ps.tipo::text,
      ps.imagen_principal,ps.created_at,pr.nombre AS vendedor_nombre,
      coalesce((SELECT c.slug FROM product_categories pc JOIN categories c ON c.id=pc.categoria_id
        WHERE pc.product_id=ps.id ORDER BY pc.is_primary DESC,c.slug LIMIT 1),ps.categoria) AS categoria,
      round(ST_X(ps.ubicacion_mapa)::numeric*100)::integer AS x, round(ST_Y(ps.ubicacion_mapa)::numeric*100)::integer AS y,
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
      AND (v_coverage_lat IS NULL OR ST_DWithin(ps.ubicacion_mapa::geography, ST_SetSRID(ST_MakePoint(v_coverage_lng,v_coverage_lat),4326)::geography,50000))
      AND (v_mode='zone' OR ST_DWithin(ps.ubicacion_mapa::geography,
        ST_SetSRID(ST_MakePoint(v_center_lng,v_center_lat),4326)::geography,v_radius))
      AND (v_tipo IS NULL OR ps.tipo::text=v_tipo)
      AND (v_min IS NULL OR ps.precio>=v_min) AND (v_max IS NULL OR ps.precio<=v_max)
      AND (cardinality(v_categories)=0 OR EXISTS (SELECT 1 FROM product_categories pc
        JOIN categories c ON c.id=pc.categoria_id WHERE pc.product_id=ps.id AND c.slug=ANY(v_categories)))
      AND (v_term='' OR strpos(translate(lower(ps.titulo),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0
        OR strpos(translate(lower(coalesce(ps.descripcion,'')),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0
        OR strpos(translate(lower(pr.nombre),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0)

  ), stamp AS (
    SELECT md5(v_key||coalesce(string_agg(md5(jsonb_build_array(id,creador_id,titulo,slug,precio,modo_precio,tipo,imagen_principal,created_at,vendedor_nombre,categoria,public_lat,public_lng)::text),'' ORDER BY id),'')) AS revision FROM eligible
  ), cells AS MATERIALIZED (
    SELECT x,y,count(*) AS count,count(DISTINCT creador_id) AS seller_count FROM eligible GROUP BY x,y
  ), overview AS (
    SELECT 'cell:'||v_overview_stride||':'||floor(x::numeric/v_overview_stride)::text||':'||floor(y::numeric/v_overview_stride)::text AS id,
      avg(public_lat) AS public_lat,avg(public_lng) AS public_lng,count(*) AS count,count(DISTINCT creador_id) AS seller_count,
      jsonb_build_object('west',min(public_lng),'south',min(public_lat),'east',max(public_lng),'north',max(public_lat)) AS bounds
    FROM eligible GROUP BY floor(x::numeric/v_overview_stride),floor(y::numeric/v_overview_stride)
  ), cell_batch AS MATERIALIZED (
    SELECT * FROM cells WHERE v_action='cells' AND (v_after_x IS NULL OR (x,y)>(v_after_x,v_after_y)) ORDER BY x,y LIMIT 301
  ), cell_page AS MATERIALIZED (SELECT * FROM cell_batch ORDER BY x,y LIMIT 300),
  focused AS MATERIALIZED (
    SELECT * FROM eligible WHERE v_action='listings' AND (v_cell IS NULL OR (floor(x::numeric/v_node_stride)=v_node_x AND floor(y::numeric/v_node_stride)=v_node_y))
  ), batch AS MATERIALIZED (
    SELECT * FROM focused WHERE v_id IS NULL OR (v_time IS NULL AND created_at IS NULL AND id<v_id)
      OR (v_time IS NOT NULL AND (created_at<v_time OR(created_at=v_time AND id<v_id) OR created_at IS NULL))
    ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 31
  ), page AS MATERIALIZED (SELECT * FROM batch ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 30)
  SELECT jsonb_build_object('query_key',md5(v_key||coalesce(v_cell,'all')||stamp.revision),'projection_version',1,'revision',stamp.revision,'as_of',statement_timestamp(),
    'features',CASE WHEN v_action IN('overview','check') THEN coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM overview o),'[]'::jsonb) ELSE '[]'::jsonb END,
    'cells',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY x,y) FROM cell_page c),'[]'::jsonb),
    'next_cell_cursor',CASE WHEN(SELECT count(*) FROM cell_batch)>300 THEN (SELECT jsonb_build_object('x',x,'y',y) FROM cell_page ORDER BY x DESC,y DESC LIMIT 1) ELSE NULL END,
    'complete',v_action='cells' AND (SELECT count(*) FROM cell_batch)<=300,
    'total',(SELECT count(*) FROM eligible),'seller_total',(SELECT count(DISTINCT creador_id) FROM eligible),'list_total',(SELECT count(*) FROM focused),'list_seller_total',(SELECT count(DISTINCT creador_id) FROM focused),
    'listings',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'creador_id',p.creador_id,'titulo',p.titulo,'slug',p.slug,'precio',p.precio,
      'modo_precio',p.modo_precio,'tipo',p.tipo,'imagen_principal',p.imagen_principal,'created_at',p.created_at,'vendedor_nombre',p.vendedor_nombre,
      'categoria',p.categoria,'cell_id',coalesce(v_cell,p.cell_id),'seller_listing_count',p.seller_listing_count) ORDER BY p.created_at DESC NULLS LAST,p.id DESC) FROM page p),'[]'::jsonb),
    'next_cursor',CASE WHEN(SELECT count(*) FROM batch)>30 THEN(SELECT jsonb_build_object('key',md5(v_key||coalesce(v_cell,'all')||stamp.revision),'created_at',created_at,'id',id)
      FROM page ORDER BY created_at ASC NULLS FIRST,id ASC LIMIT 1) ELSE NULL END) INTO v_result FROM stamp;
  IF v_action<>'check' AND v_revision IS NOT NULL AND v_revision<>v_result->>'revision' THEN RAISE EXCEPTION 'Stale coverage revision' USING ERRCODE='22023';END IF;
  IF v_id IS NOT NULL AND v_cursor->>'key' IS DISTINCT FROM v_result->>'query_key' THEN RAISE EXCEPTION 'Stale listing cursor' USING ERRCODE='22023';END IF;
  RETURN v_result;
END;
$map$;
REVOKE ALL ON FUNCTION pg_temp.search_map_publications_v2(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.search_map_publications_v2(jsonb) TO anon,authenticated;
COMMENT ON FUNCTION pg_temp.search_map_publications_v2(jsonb) IS 'S11 read-only: complete overview, paged public cells within 50 km, stable groups and fresh details. Same approximate projection v1; no private point grants. Revisions belong to eligible public results and viewer.';

-- Insert the complete synthetic dataset into initially empty temporary tables.
-- Distribution: 70,000 listings / 100 sellers / 2,025 public cells near Puebla;
-- 30,000 listings / another 100 sellers / 625 cells near Villahermosa.
-- All regional public cells are under 50 km from (19.04, -98.21).
-- Preconditions intentionally use the deployed coverage predicate. A failed
-- preflight or eligibility assertion aborts the benchmark rather than silently
-- measuring fewer than 100,000 eligible listings.
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.s11_check('01 deployed coverage accepts both fixture centers',
  dentro_de_cobertura(19.04, -98.21)
  AND dentro_de_cobertura(17.99, -92.95));

CREATE INDEX s11_100k_category_product_idx
  ON pg_temp.product_categories(product_id, categoria_id);
CREATE TEMP TABLE s11_100k_timings (
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  scope text NOT NULL,
  action text NOT NULL,
  elapsed_ms numeric NOT NULL,
  total bigint NOT NULL,
  seller_total bigint NOT NULL,
  marker_count integer NOT NULL,
  cell_count integer NOT NULL,
  listing_count integer NOT NULL
);
CREATE TEMP TABLE s11_100k_seen (
  x integer,
  y integer,
  count integer NOT NULL,
  seller_count integer NOT NULL,
  PRIMARY KEY(x, y)
);
ALTER TABLE pg_temp.s11_100k_timings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pg_temp.s11_100k_seen ENABLE ROW LEVEL SECURITY;

DO $seed$
DECLARE started timestamptz := clock_timestamp();
BEGIN
  INSERT INTO pg_temp.profiles(id, nombre)
  SELECT ('20000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    'S11 synthetic seller ' || n
  FROM generate_series(1, 200) n;

  INSERT INTO pg_temp.products_services
    (id, creador_id, titulo, slug, descripcion, precio, modo_precio,
     ubicacion_geo, created_at)
  SELECT
    ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    ('20000000-0000-4000-8000-' ||
      lpad((CASE WHEN n <= 70000 THEN 1 + (n - 1) % 100
                 ELSE 101 + (n - 70001) % 100 END)::text, 12, '0'))::uuid,
    'S11 100k synthetic listing ' || n, 's11-100k-' || n, '', 10, 'precio',
    ST_SetSRID(ST_MakePoint(
      CASE WHEN n <= 70000
        THEN -98.43 + ((n - 1) % 45) * 0.01 + 0.00031
        ELSE -93.07 + ((n - 70001) % 25) * 0.01 + 0.00031 END,
      CASE WHEN n <= 70000
        THEN 18.82 + (floor((n - 1) / 45.0)::integer % 45) * 0.01 + 0.00049
        ELSE 17.87 + (floor((n - 70001) / 25.0)::integer % 25) * 0.01 + 0.00049 END
    ), 4326),
    CASE WHEN n % 3 = 0 THEN NULL ELSE '2026-09-30T12:00:00Z'::timestamptz END
  FROM generate_series(1, 100000) n;

  INSERT INTO pg_temp.product_categories(product_id, categoria_id, is_primary)
  SELECT id, '00000000-0000-4000-8000-000000000001'::uuid, true
  FROM pg_temp.products_services;

  INSERT INTO pg_temp.s11_results VALUES
    ('02 seed elapsed_ms',
     round((extract(epoch FROM clock_timestamp() - started) * 1000)::numeric, 2)
       || ' ms; seed/index maintenance, not an RPC latency');
END;
$seed$;
ANALYZE pg_temp.profiles;
ANALYZE pg_temp.products_services;
ANALYZE pg_temp.product_categories;
ANALYZE pg_temp.user_blocks;

SELECT pg_temp.s11_check('03 exactly 100000 eligible synthetic publications',
  (SELECT count(*) = 100000
     AND count(DISTINCT creador_id) = 200
     AND bool_and(dentro_de_cobertura(
       ST_Y(ubicacion_mapa), ST_X(ubicacion_mapa)))
   FROM pg_temp.products_services));
SELECT pg_temp.s11_check('04 private columns remain private',
  NOT has_column_privilege('anon', 'pg_temp.products_services', 'ubicacion_geo', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'pg_temp.products_services', 'ubicacion_mapa', 'SELECT'));

-- Measures each actual pg_temp v2 call once, without publishing the response.
-- Uses the function copied byte-for-byte above from the existing fixture.
CREATE FUNCTION pg_temp.s11_100k_read(scope_name text, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = pg_temp, public
AS $read$
DECLARE started timestamptz := clock_timestamp(); response jsonb;
BEGIN
  response := pg_temp.search_map_publications_v2(payload);
  INSERT INTO pg_temp.s11_100k_timings
    (scope, action, elapsed_ms, total, seller_total,
     marker_count, cell_count, listing_count)
  VALUES(scope_name, payload->>'action',
    round((extract(epoch FROM clock_timestamp() - started) * 1000)::numeric, 2),
    (response->>'total')::bigint, (response->>'seller_total')::bigint,
    jsonb_array_length(response->'features'),
    jsonb_array_length(response->'cells'),
    jsonb_array_length(response->'listings'));
  RETURN response;
END;
$read$;

-- One bounded block: 1 regional overview, seven regional cell pages,
-- 1 regional check, 1 country overview, 1 country check, 1 group detail.
-- No 20-sample loop. statement_timeout applies to this outer DO block.
DO $matrix$
DECLARE
  regional_query jsonb := '{"bounds":{"west":-98.8,"south":18.4,"east":-97.6,"north":19.7}}';
  country_query jsonb := '{"bounds":{"west":-118.5,"south":14.5,"east":-86.5,"north":32.8}}';
  request jsonb;
  overview jsonb;
  response jsonb;
  country jsonb;
  cell jsonb;
  cursor jsonb := NULL;
  previous_cursor jsonb := NULL;
  revision text;
  pages integer := 0;
  actual_cell_count integer;
  expected_count bigint;
  expected_sellers bigint;
  node_total bigint;
  node_sellers bigint;
  node_x integer;
  node_y integer;
  node_id text;
  started timestamptz := clock_timestamp();
BEGIN
  request := jsonb_build_object('action', 'overview',
    'query', regional_query,
    'coverage_center', jsonb_build_object('lat', 19.04, 'lng', -98.21));

  SELECT count(*), count(DISTINCT creador_id)
    INTO expected_count, expected_sellers
  FROM pg_temp.products_services
  WHERE ubicacion_mapa && ST_MakeEnvelope(-98.8,18.4,-97.6,19.7,4326)
    AND ST_DWithin(ubicacion_mapa::geography,
      ST_SetSRID(ST_MakePoint(-98.21,19.04),4326)::geography,50000);
  PERFORM pg_temp.s11_check('05 regional oracle: 70000 publications / 100 sellers',
    expected_count = 70000 AND expected_sellers = 100);

  overview := pg_temp.s11_100k_read('region_50km', request);
  revision := overview->>'revision';
  PERFORM pg_temp.s11_check('06 regional overview is complete and bounded',
    (overview->>'total')::bigint = expected_count
    AND (overview->>'seller_total')::bigint = expected_sellers
    AND jsonb_array_length(overview->'features') <= 300
    AND (SELECT sum((f->>'count')::bigint)
      FROM jsonb_array_elements(overview->'features') f) = expected_count
    AND jsonb_array_length(overview->'listings') = 0);

  LOOP
    response := pg_temp.s11_100k_read('region_50km',
      request || jsonb_build_object('action','cells',
        'revision',revision,'cell_cursor',cursor));
    pages := pages + 1;
    PERFORM pg_temp.s11_check('07 cell page ' || pages || ' bounded and coherent',
      jsonb_array_length(response->'cells') BETWEEN 1 AND 300
      AND response->>'revision' = revision
      AND (response->>'total')::bigint = expected_count
      AND (response->>'seller_total')::bigint = expected_sellers
      AND (response->>'complete')::boolean =
        (response->'next_cell_cursor' = 'null'::jsonb));

    FOR cell IN SELECT value FROM jsonb_array_elements(response->'cells') LOOP
      -- A duplicate raises unique_violation instead of hiding a cursor defect.
      INSERT INTO pg_temp.s11_100k_seen VALUES
        ((cell->>'x')::integer,(cell->>'y')::integer,
         (cell->>'count')::integer,(cell->>'seller_count')::integer);
    END LOOP;
    previous_cursor := cursor;
    cursor := response->'next_cell_cursor';
    EXIT WHEN cursor = 'null'::jsonb;
    IF cursor IS NULL OR cursor IS NOT DISTINCT FROM previous_cursor OR pages >= 10
      THEN RAISE EXCEPTION 'S11 100k: cell cursor did not complete within 10 pages'; END IF;
  END LOOP;

  SELECT count(*) INTO actual_cell_count FROM pg_temp.s11_100k_seen;
  PERFORM pg_temp.s11_check('08 all regional cells paged without omissions',
    pages = 7 AND actual_cell_count = 2025
    AND (SELECT sum(count) FROM pg_temp.s11_100k_seen) = expected_count);
  PERFORM pg_temp.s11_check('09 per-cell publication and DISTINCT seller counts',
    NOT EXISTS (
      SELECT 1
      FROM (
        SELECT round(ST_X(ubicacion_mapa)::numeric*100)::integer AS x,
          round(ST_Y(ubicacion_mapa)::numeric*100)::integer AS y,
          count(*) AS listing_count, count(DISTINCT creador_id) AS seller_count
        FROM pg_temp.products_services
        WHERE ubicacion_mapa && ST_MakeEnvelope(-98.8,18.4,-97.6,19.7,4326)
          AND ST_DWithin(ubicacion_mapa::geography,
            ST_SetSRID(ST_MakePoint(-98.21,19.04),4326)::geography,50000)
        GROUP BY x,y
      ) expected FULL JOIN pg_temp.s11_100k_seen actual USING(x,y)
      WHERE expected.listing_count IS DISTINCT FROM actual.count::bigint
        OR expected.seller_count IS DISTINCT FROM actual.seller_count::bigint
    ));

  response := pg_temp.s11_100k_read('region_50km',
    request || jsonb_build_object('action','check','revision',revision));
  PERFORM pg_temp.s11_check('10 regional check retains the manifest and totals',
    response->>'revision' = revision
    AND (response->>'total')::bigint = expected_count
    AND (response->>'seller_total')::bigint = expected_sellers
    AND jsonb_array_length(response->'listings') = 0);

  country := pg_temp.s11_100k_read('country_mexico',
    jsonb_build_object('action','overview','query',country_query,
      'coverage_center',NULL));
  PERFORM pg_temp.s11_check('11 country overview includes all 100000 and 200 sellers',
    (country->>'total')::bigint = 100000
    AND (country->>'seller_total')::bigint = 200
    AND jsonb_array_length(country->'features') BETWEEN 2 AND 300
    AND (SELECT sum((f->>'count')::bigint)
      FROM jsonb_array_elements(country->'features') f) = 100000
    AND jsonb_array_length(country->'listings') = 0);

  response := pg_temp.s11_100k_read('country_mexico',
    jsonb_build_object('action','check','query',country_query,
      'coverage_center',NULL,'revision',country->>'revision'));
  PERFORM pg_temp.s11_check('12 country check retains all eligible candidates',
    response->>'revision' = country->>'revision'
    AND (response->>'total')::bigint = 100000
    AND (response->>'seller_total')::bigint = 200
    AND (SELECT sum((f->>'count')::bigint)
      FROM jsonb_array_elements(response->'features') f) = 100000);

  SELECT x, y, count, seller_count
    INTO node_x, node_y, node_total, node_sellers
  FROM pg_temp.s11_100k_seen ORDER BY count DESC,x,y LIMIT 1;
  node_id := 'cell:1:' || node_x || ':' || node_y;
  response := pg_temp.s11_100k_read('regional_group',
    request || jsonb_build_object('action','listings','revision',revision,
      'query',regional_query || jsonb_build_object('cell_id',node_id)));
  PERFORM pg_temp.s11_check('13 group detail is bounded and distinct sellers exact',
    (response->>'total')::bigint = 70000
    AND (response->>'list_total')::bigint = node_total
    AND (response->>'list_seller_total')::bigint = node_sellers
    AND jsonb_array_length(response->'listings') = least(30,node_total)
    AND response->'next_cursor' <> 'null'::jsonb);

  INSERT INTO pg_temp.s11_results VALUES('14 matrix elapsed_ms',
    round((extract(epoch FROM clock_timestamp()-started)*1000)::numeric,2)
      || ' ms; sum of the sequential fixture workflow, not HTTP/UI p95');
END;
$matrix$;

SELECT check_name, result FROM pg_temp.s11_results ORDER BY check_name;
SELECT sequence,scope,action,elapsed_ms,total,seller_total,
  marker_count,cell_count,listing_count
FROM pg_temp.s11_100k_timings ORDER BY sequence;
SELECT
  (SELECT count(*) FROM pg_temp.s11_results WHERE result='PASS') AS passed_checks,
  count(*) AS measured_rpc_calls,
  round(sum(elapsed_ms),2) AS rpc_sum_ms,
  round(max(elapsed_ms),2) AS slowest_rpc_ms,
  jsonb_agg(jsonb_build_object('scope',scope,'action',action,'ms',elapsed_ms) ORDER BY sequence) AS individual_sql_observations,
  'Single observations; no p95/throughput/concurrency claim. Temporary schema and synthetic data. Network, API limits, Apple rendering, actual devices, live RLS and writer churn are not measured.' AS limitation
FROM pg_temp.s11_100k_timings;
ROLLBACK;
