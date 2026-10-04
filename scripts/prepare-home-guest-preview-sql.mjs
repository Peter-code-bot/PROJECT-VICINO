// Reviewed single-migration SQL for the existing authenticated SQL Editor.
// No remote connection, env or user data is read by this generator.
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '20261004041500';
const name = 'home_guest_requests_communities_preview';
const source = readFileSync(path.join(root, `supabase/migrations/${version}_${name}.sql`), 'utf8').replaceAll('\r\n', '\n');
if (source.includes('$gp_source$')) throw new Error('Source delimiter collision');
const mode = process.argv.includes('--verify') ? 'verify' : 'apply';
const sourceMd5 = createHash('md5').update(source).digest('hex');
const sourceSha = createHash('sha256').update(source).digest('hex');
const names = "ARRAY['home_guest_requests_preview','home_guest_communities_preview','home_guest_posts_preview']";
const tables = "ARRAY['profiles','purchase_requests','purchase_request_categories','categories','communities','community_posts','community_members','vicino_cobertura']";
const finish = mode === 'verify' ? `ROLLBACK;
DO $gp_verify$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}')
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(${names})) THEN
  RAISE EXCEPTION 'Verification rollback did not restore the baseline; inspect before applying';
 END IF;
END $gp_verify$;
SELECT 'VERIFIED; rolled back; ledger untouched' AS result,
 NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') AS ledger_absent,
 NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(${names})) AS previews_absent;`
 : `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES('${version}','${name}',ARRAY[$gp_source$${source}$gp_source$]);
DO $gp_ledger$ BEGIN
 IF (SELECT md5(replace(statements[1],E'\\r\\n',E'\\n')) FROM supabase_migrations.schema_migrations WHERE version='${version}') IS DISTINCT FROM '${sourceMd5}' THEN
  RAISE EXCEPTION 'Source ledger mismatch; transaction must not commit';
 END IF;
END $gp_ledger$;
COMMIT;
SELECT version,name,'APPLIED; only service_role; existing permissions preserved' AS result,
 md5(replace(statements[1],E'\\r\\n',E'\\n')) AS source_md5_lf
FROM supabase_migrations.schema_migrations WHERE version='${version}';`;
const sql = `-- VICINO/main MP03-D; mode=${mode}; source SHA256=${sourceSha}
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtext('vicino:guest-preview:${version}'));
CREATE TEMP TABLE gp_functions_before ON COMMIT DROP AS
 SELECT p.oid,to_jsonb(p) AS attributes FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';
CREATE TEMP TABLE gp_permissions_before ON COMMIT DROP AS
 SELECT c.oid,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text AS acl,
 (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('attnum',a.attnum,'acl',a.attacl::text) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS column_acls
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(${tables});
DO $gp_preflight$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}')
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(${names}))
  OR to_regprocedure('public.dentro_de_cobertura(double precision,double precision)') IS NULL
  OR to_regtype('public.geometry') IS NULL
  OR (SELECT count(*) FROM gp_permissions_before)<>8
  OR NOT EXISTS(SELECT 1 FROM public.vicino_cobertura WHERE clave='operacion' AND modo='pais') THEN
  RAISE EXCEPTION 'Preview baseline differs or partially installed; inspect before applying';
 END IF;
END $gp_preflight$;
${source}
DO $gp_postflight$ BEGIN
 IF EXISTS(SELECT 1 FROM gp_functions_before b LEFT JOIN pg_proc p ON p.oid=b.oid WHERE p.oid IS NULL OR to_jsonb(p) IS DISTINCT FROM b.attributes)
  OR EXISTS(SELECT 1 FROM gp_permissions_before b LEFT JOIN pg_class c ON c.oid=b.oid WHERE
   c.oid IS NULL OR c.relrowsecurity IS DISTINCT FROM b.relrowsecurity OR c.relforcerowsecurity IS DISTINCT FROM b.relforcerowsecurity OR c.relacl::text IS DISTINCT FROM b.acl
   OR (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_policy p WHERE p.polrelid=c.oid) IS DISTINCT FROM b.policies
   OR (SELECT coalesce(jsonb_agg(jsonb_build_object('attnum',a.attnum,'acl',a.attacl::text) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM b.column_acls)
  OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(${names}))<>3
  OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')<>(SELECT count(*)+3 FROM gp_functions_before)
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(${names}) AND (
   p.provolatile<>'s' OR NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR NOT has_function_privilege('service_role',p.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
   OR EXISTS(SELECT 1 FROM unnest(p.proargnames[p.pronargs+1:array_length(p.proargnames,1)]) col WHERE col=ANY(ARRAY['lat','lng','ubicacion_geo','distance_meters','buyer_id','author_id','owner_id','email','telefono','imagenes','mi_rol','soy_miembro'])))) THEN
  RAISE EXCEPTION 'Preview permissions, projection or existing functions differ; transaction must not commit';
 END IF;
 PERFORM * FROM public.home_guest_requests_preview(1);
 PERFORM * FROM public.home_guest_communities_preview(1);
 PERFORM * FROM public.home_guest_posts_preview(1);
END $gp_postflight$;
${finish}
`;
const folder = path.join(root, 'apps/web/test-results/guest-preview');
mkdirSync(folder, { recursive: true });
const output = path.join(folder, `dashboard-${mode}.sql`);
writeFileSync(output, sql, 'utf8');
console.log(output);
