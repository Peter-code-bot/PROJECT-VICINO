-- Checks the installed S10 contract; results use pg_temp only and end in ROLLBACK.
BEGIN;
SET LOCAL statement_timeout='15s';

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
