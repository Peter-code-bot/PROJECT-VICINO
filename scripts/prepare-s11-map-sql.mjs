// Rebuild reviewable SQL artifacts; does not connect to a database.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const version='20261001020000',name='mapa_cobertura_cache';
const source=readFileSync(path.join(root,`supabase/migrations/${version}_${name}.sql`),'utf8');
if(source.includes('$s11_source$'))throw new Error('Delimiter collision');
const apply=`-- S11: apply only after approval for VICINO/main/PRODUCTION.
-- Adds one read-only RPC over the already approved approximate projection.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
SELECT pg_advisory_xact_lock(hashtext('vicino:s11:coverage:${version}'));
DO $preflight$
BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') OR to_regprocedure('public.search_map_publications_v2(jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'S11 already or partially installed; inspect before retry';END IF;
 IF to_regprocedure('public.search_map_publications_v1(jsonb)') IS NULL OR NOT(SELECT relrowsecurity FROM pg_class WHERE oid='public.products_services'::regclass)
 OR has_column_privilege('anon','public.products_services','ubicacion_geo','SELECT') OR has_column_privilege('authenticated','public.products_services','ubicacion_geo','SELECT')
 OR has_column_privilege('anon','public.products_services','ubicacion_mapa','SELECT') OR has_column_privilege('authenticated','public.products_services','ubicacion_mapa','SELECT') THEN RAISE EXCEPTION 'S11 privacy prerequisites failed';END IF;
END;
$preflight$;
${source}
DO $postflight$
BEGIN
 IF NOT has_function_privilege('anon','public.search_map_publications_v2(jsonb)','EXECUTE') OR NOT has_function_privilege('authenticated','public.search_map_publications_v2(jsonb)','EXECUTE')
 OR has_column_privilege('anon','public.products_services','ubicacion_geo','SELECT') OR has_column_privilege('authenticated','public.products_services','ubicacion_geo','SELECT')
 OR has_column_privilege('anon','public.products_services','ubicacion_mapa','SELECT') OR has_column_privilege('authenticated','public.products_services','ubicacion_mapa','SELECT')
 OR NOT(SELECT relrowsecurity FROM pg_class WHERE oid='public.products_services'::regclass) THEN RAISE EXCEPTION 'S11 verification failed; no commit';END IF;
END;
$postflight$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)VALUES('${version}','${name}',ARRAY[$s11_source$${source}$s11_source$]);
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT version,name,'APPLIED; coverage RPC registered' AS result FROM supabase_migrations.schema_migrations WHERE version='${version}';
`;
const out=path.join(root,'apps/web/test-results/s11');mkdirSync(out,{recursive:true});
writeFileSync(path.join(out,'s11-map-dashboard-apply.sql'),apply);
const fixturePath=path.join(root,'scripts/sql/test-s11-map-postgis-rollback.sql');
const prior=readFileSync(fixturePath,'utf8');
const header=prior.slice(0,prior.indexOf('-- S10 / ADR'));
const checks=prior.slice(prior.indexOf('DO $test$'));
const v1=readFileSync(path.join(root,'supabase/migrations/20260930220000_mapa_publicaciones_aproximadas.sql'),'utf8');
const temp=sql=>sql.replaceAll('public.products_services','pg_temp.products_services').replaceAll('public.search_map_publications','pg_temp.search_map_publications').replaceAll('SET search_path = public, pg_temp','SET search_path = pg_temp, public');
writeFileSync(fixturePath,header+temp(v1)+temp(source)+checks);
console.log('S11 reviewable apply transaction and temporary PostGIS fixture prepared. No database connection.');
