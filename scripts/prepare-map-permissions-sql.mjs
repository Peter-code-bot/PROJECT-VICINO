// Apply only the reviewed post-S02 permission migration with its ledger entry.
// Produces SQL for the authenticated Supabase editor; no remote access or secrets.
import {createHash} from 'node:crypto';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '20261004202352';
const name = 'guest_map_permissions_after_s02';
const source = readFileSync(path.join(root, 'supabase/migrations/' + version + '_' + name + '.sql'), 'utf8').replaceAll('\r\n', '\n');
if (source.includes('$map_s02_source$')) throw new Error('Source delimiter collision');
const sourceMd5 = createHash('md5').update(source).digest('hex');
const sourceSha = createHash('sha256').update(source).digest('hex');
const verify = process.argv.includes('--verify');
const readback = `SELECT jsonb_build_object('result','${verify ? 'VERIFIED; ROLLBACK' : 'APPLIED; COMMIT'}',
 'ledger_present',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}'),
 'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
 'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
 'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
 'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'),
 'public_grant',EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
 'definition_md5',md5(pg_get_functiondef(p.oid))) ORDER BY p.proname)
 FROM pg_proc p WHERE p.oid IN ('public.search_map_publications_v1(jsonb)'::regprocedure,'public.search_map_publications_v2(jsonb)'::regprocedure))) AS result;`;
const sql = `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $map_s02_preflight$ BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') THEN
  RAISE EXCEPTION 'Migration already recorded; inspect the existing ledger';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261002063000')
  OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261004041500') THEN
  RAISE EXCEPTION 'S02 prerequisite migrations missing';
 END IF;
 IF md5(pg_get_functiondef('public.search_map_publications_v1(jsonb)'::regprocedure)) IS DISTINCT FROM 'bfddfb6b1eecc7584591da12ee57ac98'
  OR md5(pg_get_functiondef('public.search_map_publications_v2(jsonb)'::regprocedure)) IS DISTINCT FROM 'b810ef6ed4605ad68944c40b7ae5ddd2' THEN
  RAISE EXCEPTION 'Live map definitions drifted; review before modifying permissions';
 END IF;
END $map_s02_preflight$;
CREATE TEMP TABLE map_s02_baseline ON COMMIT DROP AS
 SELECT p.oid,p.proowner,md5(pg_get_functiondef(p.oid)) AS definition_md5,
 ARRAY(SELECT a.grantor::text||':'||a.grantee::text||':'||a.privilege_type||':'||a.is_grantable::text
 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE a.grantee NOT IN (0,(SELECT oid FROM pg_roles WHERE rolname='anon'))
 ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable) AS private_acl
 FROM pg_proc p WHERE p.oid IN ('public.search_map_publications_v1(jsonb)'::regprocedure,'public.search_map_publications_v2(jsonb)'::regprocedure);
${source}
DO $map_s02_postflight$ BEGIN
 IF (SELECT count(*) FROM map_s02_baseline)<>2 THEN RAISE EXCEPTION 'Expected two map functions'; END IF;
 IF EXISTS(SELECT 1 FROM map_s02_baseline b JOIN pg_proc p ON p.oid=b.oid
 WHERE p.proowner<>b.proowner OR md5(pg_get_functiondef(p.oid))<>b.definition_md5
 OR ARRAY(SELECT a.grantor::text||':'||a.grantee::text||':'||a.privilege_type||':'||a.is_grantable::text
 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE a.grantee NOT IN (0,(SELECT oid FROM pg_roles WHERE rolname='anon'))
 ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable) IS DISTINCT FROM b.private_acl
 OR has_function_privilege('anon',p.oid,'EXECUTE')
 OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
 OR NOT has_function_privilege('service_role',p.oid,'EXECUTE')
 OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) THEN
  RAISE EXCEPTION 'Map restriction or preserved definition/private ACL check failed';
 END IF;
END $map_s02_postflight$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES('${version}','${name}',ARRAY[$map_s02_source$${source}$map_s02_source$]);
DO $map_s02_ledger$ BEGIN
 IF (SELECT md5(replace(statements[1],E'\\r\\n',E'\\n')) FROM supabase_migrations.schema_migrations WHERE version='${version}') IS DISTINCT FROM '${sourceMd5}' THEN
  RAISE EXCEPTION 'Ledger source mismatch';
 END IF;
END $map_s02_ledger$;
${verify ? 'ROLLBACK' : 'COMMIT'};
${readback}
`;
const folder=path.join(root,'apps/web/test-results/release-production');
mkdirSync(folder,{recursive:true});
writeFileSync(path.join(folder,verify ? 'map-verify.sql' : 'map-apply.sql'),sql);
console.log(JSON.stringify({version,mode:verify?'verify':'apply',sourceMd5,sourceSha,output:'apps/web/test-results/release-production/map-'+(verify?'verify':'apply')+'.sql'}));
