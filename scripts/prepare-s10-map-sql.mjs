// Prepare an inspectable dashboard transaction; this script does not connect to a DB.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = '20260930220000';
const name = 'mapa_publicaciones_aproximadas';
const migration = readFileSync(resolve(root, `supabase/migrations/${version}_${name}.sql`), 'utf8');
if (migration.includes('$s10_source$')) throw new Error('SQL source delimiter collision');
const sql = `-- S10: install only after reviewing the selected Supabase project and approving public RPC access.
-- Prepared from the tracked migration; adds no original-data UPDATE/DELETE.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
SELECT pg_advisory_xact_lock(hashtext('vicino:s10:map:20260930220000'));
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}')
    OR to_regprocedure('public.search_map_publications_v1(jsonb)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='products_services' AND column_name='ubicacion_mapa') THEN
    RAISE EXCEPTION 'S10 already or partially installed; inspect before retrying';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.products_services'::regclass)
    OR has_column_privilege('anon','public.products_services','ubicacion_geo','SELECT')
    OR has_column_privilege('authenticated','public.products_services','ubicacion_geo','SELECT') THEN
    RAISE EXCEPTION 'S10 privacy prerequisites failed';
  END IF;
END;
$preflight$;

${migration}

DO $postflight$
BEGIN
  IF has_column_privilege('anon','public.products_services','ubicacion_mapa','SELECT')
    OR has_column_privilege('authenticated','public.products_services','ubicacion_mapa','SELECT')
    OR NOT has_function_privilege('anon','public.search_map_publications_v1(jsonb)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.search_map_publications_v1(jsonb)','EXECUTE')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.products_services'::regclass)
    OR to_regclass('public.idx_products_services_mapa') IS NULL THEN
    RAISE EXCEPTION 'S10 installation verification failed; transaction will not commit';
  END IF;
END;
$postflight$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES ('${version}','${name}',ARRAY[$s10_source$${migration}$s10_source$]);
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT version,name,'APPLIED; map projection and RPC installed' AS result
FROM supabase_migrations.schema_migrations WHERE version='${version}';
`;
const outputDir = resolve(root, 'apps/web/test-results/s10');
mkdirSync(outputDir, { recursive: true });
const output = resolve(outputDir, 's10-map-dashboard-apply.sql');
writeFileSync(output, sql, 'utf8');
console.log(output);
