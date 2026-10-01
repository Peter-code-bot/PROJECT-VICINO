-- Run ONLY after the separately approved S11 installation.
-- Read-only installed-contract diagnosis: no diagnostic tables, grants, seeds or writes.
-- This does not run or replace the separately blocked 100k fixture/volume test.
-- Fingerprints are from tracked migration text: LF-normalized prosrc and whitespace-normalized ledger source.
-- If a migration is intentionally revised, regenerate these expected fingerprints before approving its installation.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
SELECT set_config('request.jwt.claim.sub','',true);

DO $verify$
DECLARE
  v1 oid:=to_regprocedure('public.search_map_publications_v1(jsonb)');
  v2 oid:=to_regprocedure('public.search_map_publications_v2(jsonb)');
  v1_body constant text:='06d02e27f25bc0375168a7e6029d3ecc';
  v2_body constant text:='16d981cbd75c5e39e86ef97848576b3a';
  v1_ledger constant text:='13d5e3a6a433fb8f05bd9235cc59d4e7';
  v2_ledger constant text:='140887937a13e99319b3e9c7ac11c811';
  fn record; role_name text; expected_hash text; version_name text; source_hash text; ledger_name text;
  query jsonb:='{"bounds":{"west":-118.5,"south":14.5,"east":-86.5,"north":32.8}}';
  request jsonb; old_result jsonb; new_result jsonb; feature_sum bigint; projection_bad bigint;
BEGIN
  IF v1 IS NULL OR v2 IS NULL THEN RAISE EXCEPTION 'S11 FAIL: installed v1/v2 signatures missing'; END IF;
  FOR fn IN SELECT oid,proname,prosrc,prosecdef,provolatile,prorettype,prolang,proconfig,proacl,proowner FROM pg_proc WHERE oid IN(v1,v2) LOOP
    expected_hash:=CASE WHEN fn.oid=v1 THEN v1_body ELSE v2_body END;
    IF md5(replace(fn.prosrc,E'\r\n',E'\n'))<>expected_hash THEN RAISE EXCEPTION 'S11 FAIL: installed % body differs from reviewed migration',fn.proname; END IF;
    IF NOT fn.prosecdef OR fn.provolatile<>'s' OR fn.prorettype<>'jsonb'::regtype OR fn.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') THEN
      RAISE EXCEPTION 'S11 FAIL: % function contract changed',fn.proname;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM unnest(fn.proconfig) setting WHERE replace(setting,' ','')='search_path=public,pg_temp')
      OR NOT EXISTS(SELECT 1 FROM unnest(fn.proconfig) setting WHERE setting='statement_timeout=4s') THEN
      RAISE EXCEPTION 'S11 FAIL: % configured search path/deadline differs',fn.proname;
    END IF;
    IF EXISTS(SELECT 1 FROM aclexplode(coalesce(fn.proacl,acldefault('f',fn.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'S11 FAIL: PUBLIC execute was granted to %',fn.proname;
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF NOT has_function_privilege(role_name,fn.oid,'EXECUTE') THEN RAISE EXCEPTION 'S11 FAIL: % cannot execute %',role_name,fn.proname; END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE '01 PASS: v2 signature/source/STABLE/SECURITY DEFINER/configured deadline; reviewed body fingerprint matches';
  RAISE NOTICE '02 PASS: v1 signature/source/configuration remains intact; S10 body fingerprint unchanged';
  RAISE NOTICE '03 PASS: anon/authenticated execute and PUBLIC revoked';

  FOREACH version_name IN ARRAY ARRAY['20260930220000','20261001020000'] LOOP
    expected_hash:=CASE WHEN version_name='20260930220000' THEN v1_ledger ELSE v2_ledger END;
    SELECT md5(btrim(regexp_replace(replace(array_to_string(statements,E'\n'),E'\r\n',E'\n'),'[[:space:]]+',' ','g'))),name
      INTO source_hash,ledger_name FROM supabase_migrations.schema_migrations WHERE version=version_name;
    IF source_hash IS DISTINCT FROM expected_hash OR ledger_name IS DISTINCT FROM
      (CASE WHEN version_name='20260930220000' THEN 'mapa_publicaciones_aproximadas' ELSE 'mapa_cobertura_cache' END) THEN
      RAISE EXCEPTION 'S11 FAIL: ledger % missing or differs from reviewed migration source/name',version_name;
    END IF;
  END LOOP;
  RAISE NOTICE '04 PASS: S10/S11 ledger and equivalent migration source; whitespace-normalized fingerprints match';

  IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid='public.products_services'::regclass) THEN RAISE EXCEPTION 'S11 FAIL: products RLS disabled'; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_column_privilege(role_name,'public.products_services','ubicacion_geo','SELECT')
      OR has_column_privilege(role_name,'public.products_services','ubicacion_mapa','SELECT') THEN
      RAISE EXCEPTION 'S11 FAIL: exact/derived geometry SELECT exposed to %',role_name;
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.products_services'::regclass AND attname='ubicacion_mapa' AND attgenerated='s' AND NOT attisdropped)
    OR to_regclass('public.idx_products_services_mapa') IS NULL THEN RAISE EXCEPTION 'S11 FAIL: S10 generated projection/index missing'; END IF;
  SELECT count(*) INTO projection_bad FROM public.products_services
    WHERE ubicacion_mapa IS NOT NULL AND (ST_SRID(ubicacion_mapa)<>4326 OR ST_GeometryType(ubicacion_mapa)<>'ST_Point'
      OR ST_X(ubicacion_mapa)<>round(ST_X(ubicacion_geo::geometry)::numeric,2)::double precision
      OR ST_Y(ubicacion_mapa)<>round(ST_Y(ubicacion_geo::geometry)::numeric,2)::double precision);
  IF projection_bad<>0 THEN RAISE EXCEPTION 'S11 FAIL: approximate projection changed'; END IF;
  RAISE NOTICE '05 PASS: RLS/geometry privileges/generated projection/index; exact points remain private and projection stays at 2 decimals';

  request:=jsonb_build_object('action','overview','query',query,'coverage_center',NULL,'revision',NULL,'cell_cursor',NULL);
  old_result:=public.search_map_publications_v1(query); new_result:=public.search_map_publications_v2(request);
  SELECT coalesce(sum((feature->>'count')::bigint),0) INTO feature_sum FROM jsonb_array_elements(new_result->'features') feature;
  IF (old_result->>'total')::bigint<>(new_result->>'total')::bigint OR feature_sum<>(new_result->>'total')::bigint
    OR jsonb_array_length(new_result->'features')>300 OR jsonb_array_length(new_result->'cells')<>0 OR jsonb_array_length(new_result->'listings')<>0
    OR new_result->>'projection_version'<>'1' THEN RAISE EXCEPTION 'S11 FAIL: national overview or compatibility totals mismatch'; END IF;
  IF new_result::text~'"(ubicacion_geo|ubicacion_mapa|ubicacion|direccion|address|lat|lng|distance_meters|exact_lat|exact_lng)"[[:space:]]*:' THEN
    RAISE EXCEPTION 'S11 FAIL: private field in response';
  END IF;
  RAISE NOTICE '06 PASS: real catalogue v1/v2 totals/overview/no eager cards/privacy; % eligible publications',new_result->>'total';
END $verify$;

SET LOCAL ROLE anon;
SELECT '07 anon executes installed real-table v2' AS check_name,
  'PASS; '||(public.search_map_publications_v2('{"action":"overview","query":{"bounds":{"west":-118.5,"south":14.5,"east":-86.5,"north":32.8}},"coverage_center":null,"revision":null,"cell_cursor":null}')->>'total')||' eligible publications' AS result;
RESET ROLE;
SET LOCAL ROLE authenticated;
-- This role execution has no account JWT. Dedicated account/block coverage remains separate.
SELECT '08 authenticated role executes installed real-table v2' AS check_name,
  'PASS; '||(public.search_map_publications_v2('{"action":"overview","query":{"bounds":{"west":-118.5,"south":14.5,"east":-86.5,"north":32.8}},"coverage_center":null,"revision":null,"cell_cursor":null}')->>'total')||' eligible publications; no dedicated account' AS result;
RESET ROLE;
-- The transaction reaches this owner summary only after all fail-closed checks
-- and both preceding role-only invocations have completed without SQL errors.
SELECT check_name,result FROM (VALUES
  ('01 v2 signature/source/STABLE/SECURITY DEFINER/configured deadline','PASS; reviewed body fingerprint matches'),
  ('02 v1 signature/source/configuration remains intact','PASS; S10 body fingerprint unchanged'),
  ('03 anon/authenticated execute and PUBLIC revoked','PASS'),
  ('04 S10/S11 ledger and equivalent migration source','PASS; whitespace-normalized fingerprints match'),
  ('05 RLS/geometry privileges/generated projection/index','PASS; exact points remain private and projection stays at 2 decimals'),
  ('06 real catalogue v1/v2 totals/overview/no eager cards/privacy','PASS; see verified catalogue total in NOTICE 06'),
  ('07 anon executes installed real-table v2','PASS; see preceding anon SELECT for real catalogue total'),
  ('08 authenticated role executes installed real-table v2','PASS; role only, no account JWT; dedicated account/block tests remain pending')
) AS diagnostics(check_name,result) ORDER BY check_name;
ROLLBACK;
