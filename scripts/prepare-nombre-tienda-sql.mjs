// Prepare reviewable SQL from a reviewed catalog baseline. No database connection.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '20261003213000';
const name = 'identidad_publica_modo_tienda';
const targets = [
  'notify_sale_confirmation_created', 'notify_new_review', 'nearby_products',
  'search_nearby_products', 'search_nearby_products_v4', 'feed_nearby_requests',
  'get_ranking_hiperlocal', 'feed_comunidades_explorar', 'feed_muro_comunidad',
  'notificar_comentario_de_comunidad', 'solicitar_union_comunidad',
  'iniciar_conversacion', 'iniciar_confirmacion_venta',
  'search_map_publications_v1', 'search_map_publications_v2',
];
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

export function buildNombreTiendaApply(source, baseline, { mode = 'apply' } = {}) {
  if (!['apply', 'verify'].includes(mode)) throw new Error('Mode must be apply or verify');
  if (source.includes('$nt_source$')) throw new Error('SQL source delimiter collision');
  if (!Array.isArray(baseline) || baseline.length !== targets.length
    || new Set(baseline.map(row => row.proname)).size !== targets.length
    || baseline.some(row => !targets.includes(row.proname)
      || typeof row.identity_arguments !== 'string' || !/^[a-f0-9]{32}$/i.test(row.definition_md5))) {
    throw new Error('Expected the reviewed 15-function baseline: proname, identity_arguments, definition_md5');
  }
  const values = baseline.map(row => `(${quote(row.proname)},${quote(row.identity_arguments)},${quote(row.definition_md5.toLowerCase())})`).join(',\n');
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  const finish = mode === 'apply' ? `INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES('${version}','${name}',ARRAY[$nt_source$${source}$nt_source$]);
COMMIT;
SELECT version,name,'APPLIED; 15 current functions preserved; message emitter unchanged' AS result,
 md5(array_to_string(statements,'')) AS registered_source_md5
FROM supabase_migrations.schema_migrations WHERE version='${version}';`
    : `ROLLBACK;
SELECT 'VERIFIED; transaction rolled back; ledger untouched' AS result,
 to_regprocedure('public.profile_public_name(text,boolean,text,text)') IS NULL AS helper_absent,
 to_regprocedure('public.require_store_name()') IS NULL AS guard_absent,
 NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}') AS ledger_absent;`;
  return `-- VICINO/main: reviewed identity migration; no profile row INSERT/UPDATE/DELETE.
-- Mode: ${mode}. ${mode === 'verify' ? 'ROLLBACK only; no ledger INSERT.' : 'Migration and ledger commit in the same transaction.'}
-- Source SHA256: ${sourceSha256}
-- Baseline hashes were read from the reviewed production catalog.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtext('vicino:nombre-tienda:${version}'));
CREATE TEMP TABLE nt_expected(proname text PRIMARY KEY,identity_arguments text,definition_md5 text) ON COMMIT DROP;
INSERT INTO nt_expected VALUES
${values};
CREATE TEMP TABLE nt_functions_before ON COMMIT DROP AS
SELECT p.oid,p.proname,to_jsonb(p)-'prosrc' AS attributes,md5(p.prosrc) AS body_md5,
 pg_get_function_identity_arguments(p.oid) AS identity_arguments,md5(pg_get_functiondef(p.oid)) AS definition_md5
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (SELECT proname FROM nt_expected) AND p.prokind='f';
CREATE TEMP TABLE nt_emitter_before ON COMMIT DROP AS
SELECT p.oid,to_jsonb(p)-'prosrc' AS attributes,md5(p.prosrc) AS body_md5
FROM pg_proc p WHERE p.oid=to_regprocedure('public.call_send_push_on_message()');
CREATE TEMP TABLE nt_profiles_before ON COMMIT DROP AS
SELECT c.relrowsecurity,c.relforcerowsecurity,c.relacl::text AS acl,
 (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('attnum',a.attnum,'acl',a.attacl::text) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS column_acls
FROM pg_class c WHERE c.oid='public.profiles'::regclass;
CREATE TEMP TABLE nt_triggers_before ON COMMIT DROP AS
SELECT t.oid,to_jsonb(t) AS attributes FROM pg_trigger t
WHERE t.tgrelid IN ('public.profiles'::regclass,'public.messages'::regclass);
DO $nt_preflight$
BEGIN
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${version}')
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('profile_public_name','require_store_name'))
  OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND tgname='profiles_require_store_name') THEN
  RAISE EXCEPTION 'Identity migration already or partially installed; inspect before retry';
 END IF;
 IF (SELECT count(*) FROM nt_functions_before)<>15
  OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (SELECT proname FROM nt_expected))<>15
  OR EXISTS(SELECT 1 FROM nt_expected e LEFT JOIN nt_functions_before b USING(proname)
   WHERE b.oid IS NULL OR b.identity_arguments IS DISTINCT FROM e.identity_arguments OR b.definition_md5 IS DISTINCT FROM e.definition_md5) THEN
  RAISE EXCEPTION 'Reviewed function baseline has changed; no identity changes may be applied';
 END IF;
 IF to_regprocedure('public.notify_new_message()') IS NOT NULL
  OR (SELECT count(*) FROM nt_emitter_before)<>1
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.messages'::regclass AND tgfoid=to_regprocedure('public.call_send_push_on_message()') AND NOT tgisinternal)
  OR NOT (SELECT relrowsecurity FROM nt_profiles_before) THEN
  RAISE EXCEPTION 'Current message emitter or profile RLS prerequisite differs; inspect before retry';
 END IF;
END;
$nt_preflight$;

${source}

DO $nt_postflight$
DECLARE profiles_now record;
BEGIN
 IF EXISTS(SELECT 1 FROM nt_functions_before b LEFT JOIN pg_proc p ON p.oid=b.oid
   WHERE p.oid IS NULL OR (to_jsonb(p)-'prosrc') IS DISTINCT FROM b.attributes OR strpos(p.prosrc,'public.profile_public_name(')=0)
  OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (SELECT proname FROM nt_expected))<>15
  OR EXISTS(SELECT 1 FROM nt_emitter_before b LEFT JOIN pg_proc p ON p.oid=b.oid
   WHERE p.oid IS NULL OR (to_jsonb(p)-'prosrc') IS DISTINCT FROM b.attributes OR md5(p.prosrc) IS DISTINCT FROM b.body_md5)
  OR to_regprocedure('public.notify_new_message()') IS NOT NULL THEN
  RAISE EXCEPTION 'Function attributes or current message emitter changed; transaction must not commit';
 END IF;
 SELECT c.relrowsecurity,c.relforcerowsecurity,c.relacl::text AS acl,
  (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('attnum',a.attnum,'acl',a.attacl::text) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS column_acls
 INTO profiles_now FROM pg_class c WHERE c.oid='public.profiles'::regclass;
 IF EXISTS(SELECT 1 FROM nt_profiles_before b WHERE to_jsonb(profiles_now) IS DISTINCT FROM to_jsonb(b))
  OR EXISTS(SELECT 1 FROM nt_triggers_before b LEFT JOIN pg_trigger t ON t.oid=b.oid WHERE t.oid IS NULL OR to_jsonb(t) IS DISTINCT FROM b.attributes)
  OR (SELECT count(*) FROM pg_trigger WHERE tgrelid IN ('public.profiles'::regclass,'public.messages'::regclass))<>(SELECT count(*)+1 FROM nt_triggers_before)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass AND tgname='profiles_require_store_name' AND tgfoid='public.require_store_name()'::regprocedure AND tgenabled='O') THEN
  RAISE EXCEPTION 'Profile ACL/RLS/policies or existing triggers changed; transaction must not commit';
 END IF;
 IF NOT has_function_privilege('anon','public.profile_public_name(text,boolean,text,text)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.profile_public_name(text,boolean,text,text)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.profile_public_name(text,boolean,text,text)','EXECUTE')
  OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid IN ('public.profile_public_name(text,boolean,text,text)'::regprocedure,'public.require_store_name()'::regprocedure) AND a.grantee=0 AND a.privilege_type='EXECUTE')
  OR EXISTS(SELECT 1 FROM nt_functions_before b JOIN pg_proc p ON p.oid=b.oid
   WHERE p.prosecdef AND NOT has_function_privilege(p.proowner,'public.profile_public_name(text,boolean,text,text)','EXECUTE'))
  OR public.profile_public_name('Personal',true,'business',chr(160)||chr(65279))<>'Tienda'
  OR public.profile_public_name('Personal',true,'business',chr(160)||'Store'||chr(65279))<>'Store' THEN
  RAISE EXCEPTION 'Public identity helper or helper privileges failed verification; transaction must not commit';
 END IF;
END;
$nt_postflight$;
${finish}
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--baseline');
  if (flag < 0 || !process.argv[flag + 1]) throw new Error('Supply --baseline PATH to the reviewed catalog JSON');
  const source = readFileSync(path.join(root, `supabase/migrations/${version}_${name}.sql`), 'utf8');
  const baseline = JSON.parse(readFileSync(path.resolve(process.argv[flag + 1]), 'utf8'));
  const modeFlag = process.argv.indexOf('--mode');
  const mode = modeFlag < 0 ? 'apply' : process.argv[modeFlag + 1];
  if (!['apply', 'verify'].includes(mode)) throw new Error('Supply --mode apply or --mode verify');
  const outputDir = path.join(root, 'apps/web/test-results/nt');
  mkdirSync(outputDir, { recursive: true });
  const sql = buildNombreTiendaApply(source, baseline, { mode });
  const output = path.join(outputDir, `nombre-tienda-dashboard-${mode}.sql`);
  writeFileSync(output, sql, 'utf8');
  console.log(output);
}
