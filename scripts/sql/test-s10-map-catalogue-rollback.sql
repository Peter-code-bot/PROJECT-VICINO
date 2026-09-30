-- S10 actual-schema preflight: transactional DDL followed by ROLLBACK.
-- Holds a products_services lock briefly; lock_timeout 2s.
ROLLBACK;
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
-- S10 / ADR 2026-09-30: public_lat/public_lng are derived ~1 km cells,
-- never products_services.ubicacion_geo. Existing column grants stay intact.
-- Generated geometry updates atomically with the private point; no client
-- can write it or publish a more precise point. Generic geometry is safe here:
-- the generated expression can produce only a POINT with SRID 4326.
ALTER TABLE public.products_services ADD COLUMN ubicacion_mapa geometry
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(
      round(ST_X(ubicacion_geo::geometry)::numeric, 2)::double precision,
      round(ST_Y(ubicacion_geo::geometry)::numeric, 2)::double precision
    ), 4326)
  ) STORED;
COMMENT ON COLUMN public.products_services.ubicacion_mapa IS
  'S10 projection v1: stable two-decimal public cell; no direct client SELECT. Exact point remains private.';
CREATE INDEX idx_products_services_mapa ON public.products_services USING gist (ubicacion_mapa)
  WHERE ubicacion_mapa IS NOT NULL AND estatus = 'disponible' AND is_hidden = false;

CREATE FUNCTION public.search_map_publications_v1(p_query jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET statement_timeout = '4s'
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
REVOKE ALL ON FUNCTION public.search_map_publications_v1(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_map_publications_v1(jsonb) TO anon,authenticated;
COMMENT ON FUNCTION public.search_map_publications_v1(jsonb) IS
  'S10 read-only bounded map: only generated two-decimal public points. Same snapshot for cells/counts/cards; bilateral blocks and visibility. Does not return private coordinates or address.';

CREATE TEMP TABLE s10_remote_results(check_name text,result text);
DO $grant$ BEGIN EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon,authenticated',(SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema()));END $grant$;
GRANT INSERT ON pg_temp.s10_remote_results TO anon,authenticated;
DO $verify$
DECLARE q jsonb:='{"bounds":{"west":-118.5,"south":14.5,"east":-86.5,"north":32.8}}'; r jsonb; expected bigint; feature_sum bigint; i integer; started timestamptz; durations numeric[]:='{}'; p95 numeric;
BEGIN
SELECT count(*) INTO expected FROM public.products_services ps JOIN public.profiles pr ON pr.id=ps.creador_id WHERE ps.estatus='disponible' AND NOT ps.is_hidden AND NOT pr.is_hidden AND ps.ubicacion_mapa IS NOT NULL AND ps.ubicacion_mapa && ST_MakeEnvelope(-118.5,14.5,-86.5,32.8,4326) AND public.dentro_de_cobertura(ST_Y(ps.ubicacion_mapa),ST_X(ps.ubicacion_mapa));
r:=public.search_map_publications_v1(q);
SELECT coalesce(sum((x->>'count')::bigint),0) INTO feature_sum FROM jsonb_array_elements(r->'features') x;
IF (r->>'total')::bigint<>expected OR feature_sum<>expected OR jsonb_array_length(r->'features')>300 OR jsonb_array_length(r->'listings')>30 THEN RAISE EXCEPTION 'Catalogue totals or limits mismatch'; END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'listings') x WHERE jsonb_typeof(x->'titulo')<>'string' OR jsonb_typeof(x->'categoria')<>'string' OR jsonb_typeof(x->'vendedor_nombre')<>'string' OR jsonb_typeof(x->'modo_precio')<>'string' OR x->>'tipo' NOT IN ('producto','servicio')) THEN RAISE EXCEPTION 'Catalogue incompatible with response contract';END IF;
IF r::text~'"(ubicacion_geo|ubicacion|lat|lng|distance_meters)"' THEN RAISE EXCEPTION 'Private field present';END IF;
IF EXISTS(SELECT 1 FROM public.products_services WHERE ubicacion_mapa IS NOT NULL AND (ST_SRID(ubicacion_mapa)<>4326 OR ST_GeometryType(ubicacion_mapa)<>'ST_Point' OR ST_X(ubicacion_mapa)<>round(ST_X(ubicacion_geo::geometry)::numeric,2)::double precision OR ST_Y(ubicacion_mapa)<>round(ST_Y(ubicacion_geo::geometry)::numeric,2)::double precision)) THEN RAISE EXCEPTION 'Projection mismatch';END IF;
IF has_column_privilege('anon','public.products_services','ubicacion_geo','SELECT') OR has_column_privilege('anon','public.products_services','ubicacion_mapa','SELECT') OR has_column_privilege('authenticated','public.products_services','ubicacion_geo','SELECT') OR has_column_privilege('authenticated','public.products_services','ubicacion_mapa','SELECT') THEN RAISE EXCEPTION 'Private column privileges changed';END IF;
IF NOT has_function_privilege('anon','public.search_map_publications_v1(jsonb)','EXECUTE') OR NOT has_function_privilege('authenticated','public.search_map_publications_v1(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'RPC role permissions missing';END IF;
IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid='public.products_services'::regclass) THEN RAISE EXCEPTION 'RLS disabled';END IF;
INSERT INTO pg_temp.s10_remote_results VALUES('01 catalogue totals / marker sum / limits','PASS; '||expected||' eligible publications'),('02 response field types and privacy','PASS'),('03 all actual projections POINT / SRID / rounded','PASS'),('04 exact and derived column SELECT private for anon/authenticated','PASS'),('05 RLS intact and RPC permissions','PASS');
FOR i IN 1..20 LOOP started:=clock_timestamp();PERFORM public.search_map_publications_v1(q);durations:=array_append(durations,extract(epoch FROM clock_timestamp()-started)*1000);END LOOP;
SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY d) INTO p95 FROM unnest(durations) d;
INSERT INTO pg_temp.s10_remote_results VALUES('06 p95 20 warm direct SQL calls',round(p95,2)||' ms; real catalogue; excludes network/API');
END;$verify$;
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE anon;
INSERT INTO pg_temp.s10_remote_results SELECT '07 anon executes real-table RPC',(public.search_map_publications_v1('{"bounds":{"west":-118.5,"south":14.5,"east":-86.5,"north":32.8}}')->>'total')||' eligible publications' AS result;
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.s10_remote_results SELECT '08 authenticated executes real-table RPC',(public.search_map_publications_v1('{"bounds":{"west":-118.5,"south":14.5,"east":-86.5,"north":32.8}}')->>'total')||' eligible publications' AS result;
RESET ROLE;
SELECT check_name,result FROM pg_temp.s10_remote_results ORDER BY check_name;
ROLLBACK;
