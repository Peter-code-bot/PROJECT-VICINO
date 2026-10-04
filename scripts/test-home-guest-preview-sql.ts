/** Executes MP03-D SQL unchanged in PostgreSQL/PGlite. Geometry is a point shim:
 * eligibility, ACL, real coverage function and DTO projection are tested; actual
 * PostGIS geography/index behavior and installed production state are not. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../supabase/migrations/20261004041500_home_guest_requests_communities_preview.sql", import.meta.url);
const generator = new URL("./prepare-home-guest-preview-sql.mjs", import.meta.url);
const version = "20261004041500";
const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const functions = ["home_guest_requests_preview", "home_guest_communities_preview", "home_guest_posts_preview"];
type CatalogSnapshot = { functions: { oid: number; [attribute: string]: unknown }[]; permissions: unknown[]; ledger: unknown[]; coverage: unknown[] };
async function main() {
  const db = new PGlite();
  let passed = 0;
  async function test(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`PASS ${name}`); }
  async function call(fn: string, limit: number | null = 12) {
    await db.exec("SET ROLE service_role");
    try { return (await db.query<Record<string, unknown>>(`SELECT * FROM public.${fn}($1)`, [limit])).rows; }
    finally { await db.exec("RESET ROLE"); }
  }
  async function snapshot() {
    return (await db.query<{ state: CatalogSnapshot }>(`SELECT jsonb_build_object(
      'functions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
      'permissions',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',c.oid,'name',c.relname,
        'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,
        'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_policy p WHERE p.polrelid=c.oid),
        'column_acls',(SELECT coalesce(jsonb_agg(jsonb_build_object('attnum',a.attnum,'acl',a.attacl::text) ORDER BY a.attnum),'[]'::jsonb)
          FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.oid),'[]'::jsonb)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),
      'ledger',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.version),'[]'::jsonb) FROM supabase_migrations.schema_migrations m),
      'coverage',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.clave),'[]'::jsonb) FROM public.vicino_cobertura c)
      ) AS state`)).rows[0].state;
  }
  async function rejectWithoutChanges(sql: string, message: RegExp) {
    const before = await snapshot();
    try { await assert.rejects(db.exec(sql), message); }
    finally { await db.exec("ROLLBACK"); }
    assert.deepEqual(await snapshot(), before, "failed wrapper preserves the baseline, ledger and permissions");
  }
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE DOMAIN public.geometry AS point; CREATE DOMAIN public.geography AS point;
      CREATE FUNCTION public.ST_X(public.geometry) RETURNS float8 IMMUTABLE STRICT LANGUAGE sql AS $$ SELECT ($1::point)[0] $$;
      CREATE FUNCTION public.ST_Y(public.geometry) RETURNS float8 IMMUTABLE STRICT LANGUAGE sql AS $$ SELECT ($1::point)[1] $$;
      CREATE FUNCTION public.ST_MakePoint(float8,float8) RETURNS public.geometry IMMUTABLE STRICT LANGUAGE sql AS $$ SELECT point($1,$2)::public.geometry $$;
      CREATE FUNCTION public.ST_DWithin(public.geography,public.geography,float8) RETURNS boolean IMMUTABLE STRICT LANGUAGE sql AS
        $$ SELECT sqrt(power((($1::point)[0]-($2::point)[0])*105000,2)+power((($1::point)[1]-($2::point)[1])*111000,2)) <= $3 $$;
      CREATE TABLE public.vicino_cobertura(clave text PRIMARY KEY,modo text,centro_lat float8,centro_lng float8,radio_km float8);
      INSERT INTO public.vicino_cobertura VALUES('operacion','pais',19.0414,-98.2063,200);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_hidden boolean NOT NULL DEFAULT false,email text DEFAULT 'PRIVATE_EMAIL',telefono text DEFAULT 'PRIVATE_PHONE');
      CREATE TABLE public.categories(id uuid PRIMARY KEY,slug text);
      CREATE TABLE public.purchase_request_categories(request_id uuid,categoria_id uuid);
      CREATE TABLE public.purchase_requests(id uuid PRIMARY KEY,buyer_id uuid,title varchar(100),description text,budget_estimated numeric,
        image_url text DEFAULT 'PRIVATE_IMAGE',ubicacion_geo public.geography,status text DEFAULT 'open',expires_at timestamptz DEFAULT now()+interval '1 day',created_at timestamptz DEFAULT now());
      CREATE TABLE public.communities(id uuid PRIMARY KEY,nombre text,descripcion text,owner_id uuid,centro public.geography,
        es_privada boolean DEFAULT false,is_hidden boolean DEFAULT false,archived_at timestamptz,miembros_count integer DEFAULT 4,
        publicaciones_count integer DEFAULT 999,ultima_publicacion_at timestamptz DEFAULT now()+interval '1 year',created_at timestamptz DEFAULT now());
      CREATE TABLE public.community_posts(id uuid PRIMARY KEY,community_id uuid,author_id uuid,parent_post_id uuid,cuerpo text,
        imagenes text[] DEFAULT ARRAY['PRIVATE_MEDIA_PATH'],is_hidden boolean DEFAULT false,created_at timestamptz DEFAULT now(),likes_count integer DEFAULT 2,comentarios_count integer DEFAULT 3);
      CREATE TABLE public.community_members(community_id uuid,user_id uuid,role text DEFAULT 'PRIVATE_MEMBERSHIP');
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY; ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
      CREATE POLICY unrelated_policy ON public.communities FOR SELECT TO authenticated USING(false);
      CREATE FUNCTION public.existing_private_rpc() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
      REVOKE ALL ON FUNCTION public.existing_private_rpc() FROM PUBLIC,anon;
      GRANT EXECUTE ON FUNCTION public.existing_private_rpc() TO authenticated;
      INSERT INTO public.profiles(id,is_hidden) VALUES('${uid(1)}',false),('${uid(2)}',true);
      INSERT INTO public.categories VALUES('${uid(1)}','tecnologia'),('${uid(2)}','comida');
      INSERT INTO public.purchase_requests(id,buyer_id,title,description,budget_estimated,ubicacion_geo) VALUES
        ('${uid(10)}','${uid(1)}','Solicitud Puebla',repeat('Solicitud real ',40),500,point(-98.2063,19.0414)),
        ('${uid(11)}','${uid(1)}','Solicitud Villahermosa','Texto real',NULL,point(-92.94,17.99)),
        ('${uid(12)}','${uid(1)}','Solicitud Tijuana',NULL,1000,point(-117.03,32.53)),
        ('${uid(13)}','${uid(1)}','Solicitud Chetumal','Texto',10,point(-88.3,18.5)),
        ('${uid(14)}','${uid(1)}','NO Madrid','HIDDEN_SENTINEL',1,point(-3.7,40.4)),
        ('${uid(15)}','${uid(1)}','NO Guatemala','HIDDEN_SENTINEL',1,point(-90.5,16.5)),
        ('${uid(16)}','${uid(2)}','NO suspendido','HIDDEN_SENTINEL',1,point(-98.2,19)),
        ('${uid(17)}','${uid(1)}','NO sin geo','HIDDEN_SENTINEL',1,NULL),
        ('${uid(18)}','${uid(1)}','NO vencida','HIDDEN_SENTINEL',1,point(-98.2,19)),
        ('${uid(19)}','${uid(1)}','NO cerrada','HIDDEN_SENTINEL',1,point(-98.2,19)),
        ('${uid(20)}','${uid(1)}','NO futura','HIDDEN_SENTINEL',1,point(-98.2,19));
      UPDATE public.purchase_requests SET expires_at=now()-interval '1 hour' WHERE id='${uid(18)}';
      UPDATE public.purchase_requests SET status='closed' WHERE id='${uid(19)}';
      UPDATE public.purchase_requests SET created_at=now()+interval '1 hour' WHERE id='${uid(20)}';
      INSERT INTO public.purchase_request_categories VALUES('${uid(10)}','${uid(1)}'),('${uid(10)}','${uid(2)}');
      INSERT INTO public.communities(id,nombre,descripcion,owner_id,centro) VALUES
        ('${uid(30)}','Comunidad Puebla',repeat('Comunidad real ',40),'${uid(1)}',point(-98.2,19.04)),
        ('${uid(31)}','Comunidad Villahermosa','Real','${uid(1)}',point(-92.94,17.99)),
        ('${uid(32)}','NO privada','HIDDEN_SENTINEL','${uid(1)}',point(-98.2,19)),
        ('${uid(33)}','NO oculta','HIDDEN_SENTINEL','${uid(1)}',point(-98.2,19)),
        ('${uid(34)}','NO archivada','HIDDEN_SENTINEL','${uid(1)}',point(-98.2,19)),
        ('${uid(35)}','NO owner suspendido','HIDDEN_SENTINEL','${uid(2)}',point(-98.2,19)),
        ('${uid(36)}','NO Madrid','HIDDEN_SENTINEL','${uid(1)}',point(-3.7,40.4));
      UPDATE public.communities SET es_privada=true WHERE id='${uid(32)}';
      UPDATE public.communities SET is_hidden=true WHERE id='${uid(33)}';
      UPDATE public.communities SET archived_at=now() WHERE id='${uid(34)}';
      INSERT INTO public.community_posts(id,community_id,author_id,cuerpo) VALUES
        ('${uid(40)}','${uid(30)}','${uid(1)}',repeat('Publicacion real ',40)),
        ('${uid(41)}','${uid(31)}','${uid(1)}','Publicacion nacional'),
        ('${uid(42)}','${uid(32)}','${uid(1)}','HIDDEN_SENTINEL'),
        ('${uid(43)}','${uid(33)}','${uid(1)}','HIDDEN_SENTINEL'),
        ('${uid(44)}','${uid(34)}','${uid(1)}','HIDDEN_SENTINEL'),
        ('${uid(45)}','${uid(35)}','${uid(1)}','HIDDEN_SENTINEL'),
        ('${uid(46)}','${uid(36)}','${uid(1)}','HIDDEN_SENTINEL'),
        ('${uid(47)}','${uid(30)}','${uid(2)}','HIDDEN_SENTINEL'),
        ('${uid(48)}','${uid(30)}','${uid(1)}','HIDDEN_SENTINEL'),
        ('${uid(49)}','${uid(30)}','${uid(1)}','HIDDEN_SENTINEL'),
        ('${uid(50)}','${uid(30)}','${uid(1)}','HIDDEN_SENTINEL'),
        ('${uid(51)}','${uid(30)}','${uid(1)}','');
      UPDATE public.community_posts SET is_hidden=true WHERE id='${uid(48)}';
      UPDATE public.community_posts SET parent_post_id='${uid(40)}' WHERE id='${uid(49)}';
      UPDATE public.community_posts SET created_at=now()+interval '1 hour' WHERE id='${uid(50)}';
      INSERT INTO public.community_members VALUES('${uid(30)}','${uid(2)}','PRIVATE_MEMBERSHIP');`);
    const coverage = await readFile(new URL("../supabase/migrations/20260913160000_cobertura_de_operacion_en_la_base.sql", import.meta.url), "utf8");
    const coverageFunction = coverage.match(/create or replace function public\.dentro_de_cobertura\([\s\S]*?\$\$;/i)?.[0];
    assert.ok(coverageFunction, "real operation coverage function is present");
    await db.exec(coverageFunction);
    await db.exec(`CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);`);
    const wrappers: Record<"verify" | "apply", string> = { verify: "", apply: "" };
    await test("deployment wrappers are produced by the actual generator from LF-normalized migration source", async () => {
      for (const mode of ["verify", "apply"] as const) {
        const generated = spawnSync(process.execPath, [fileURLToPath(generator), `--${mode}`], { encoding: "utf8" });
        assert.equal(generated.error, undefined);
        assert.equal(generated.status, 0, generated.stderr);
        assert.equal(generated.stderr, "");
        const artifact = new URL(`../apps/web/test-results/guest-preview/dashboard-${mode}.sql`, import.meta.url);
        assert.equal(generated.stdout.trim(), fileURLToPath(artifact));
        wrappers[mode] = await readFile(artifact, "utf8");
        const source = (await readFile(migration, "utf8")).replaceAll("\r\n", "\n");
        assert.ok(wrappers[mode].includes(source));
        assert.ok(wrappers[mode].includes(`source SHA256=${createHash("sha256").update(source).digest("hex")}`));
      }
    });
    await test("verify wrapper executes all RPCs then rolls back functions, permissions and ledger", async () => {
      const before = await snapshot();
      const result = await db.exec(wrappers.verify);
      assert.deepEqual(result.at(-1)?.rows, [{ result: "VERIFIED; rolled back; ledger untouched", ledger_absent: true, previews_absent: true }]);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual((await db.query("SELECT to_regprocedure('public.home_guest_requests_preview(integer)') AS fn")).rows, [{ fn: null }]);
      assert.equal((await db.query("SELECT * FROM supabase_migrations.schema_migrations")).rows.length, 0);
    });
    await test("preflight rejects coverage drift and missing baseline tables without transactional changes", async () => {
      await db.exec("UPDATE public.vicino_cobertura SET modo='radio'");
      await rejectWithoutChanges(wrappers.apply, /Preview baseline differs or partially installed/);
      await db.exec("UPDATE public.vicino_cobertura SET modo='pais'");
      await db.exec("ALTER TABLE public.community_members RENAME TO community_members_moved");
      await rejectWithoutChanges(wrappers.verify, /Preview baseline differs or partially installed/);
      await db.exec("ALTER TABLE public.community_members_moved RENAME TO community_members");
    });
    await test("preflight rejects a partial RPC or an existing ledger entry without changing either", async () => {
      await db.exec("CREATE FUNCTION public.home_guest_requests_preview(integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$");
      await rejectWithoutChanges(wrappers.apply, /Preview baseline differs or partially installed/);
      await db.exec("DROP FUNCTION public.home_guest_requests_preview(integer)");
      await db.query("INSERT INTO supabase_migrations.schema_migrations VALUES($1,'partial',ARRAY['sentinel'])", [version]);
      await rejectWithoutChanges(wrappers.verify, /Preview baseline differs or partially installed/);
      await db.query("DELETE FROM supabase_migrations.schema_migrations WHERE version=$1", [version]);
    });
    await test("postflight rejects existing function, table, column, policy or RPC permission changes and restores everything", async () => {
      const changes = [
        "ALTER FUNCTION public.existing_private_rpc() SET search_path='public';",
        "CREATE OR REPLACE FUNCTION public.existing_private_rpc() RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$;",
        "CREATE FUNCTION public.unexpected_rpc() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;",
        "ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;",
        "GRANT SELECT(email) ON public.profiles TO anon;",
        "ALTER POLICY unrelated_policy ON public.communities USING(true);",
        "GRANT EXECUTE ON FUNCTION public.home_guest_posts_preview(integer) TO anon;",
        "DROP TABLE public.community_members;",
      ];
      for (const change of changes) await rejectWithoutChanges(
        wrappers.apply.replace("DO $gp_postflight$ BEGIN", () => `${change}\nDO $gp_postflight$ BEGIN`),
        /Preview permissions, projection or existing functions differ/,
      );
    });
    await test("apply wrapper commits all three RPCs and exactly the LF-normalized source in the ledger", async () => {
      const before = await snapshot();
      const result = await db.exec(wrappers.apply);
      const source = (await readFile(migration, "utf8")).replaceAll("\r\n", "\n");
      const md5 = createHash("md5").update(source).digest("hex");
      assert.deepEqual(result.at(-1)?.rows, [{ version, name: "home_guest_requests_communities_preview",
        result: "APPLIED; only service_role; existing permissions preserved", source_md5_lf: md5 }]);
      const ledger = await db.query<{ statements: string[]; source_md5: string }>(
        "SELECT statements,md5(statements[1]) AS source_md5 FROM supabase_migrations.schema_migrations WHERE version=$1", [version]);
      assert.deepEqual(ledger.rows, [{ statements: [source], source_md5: md5 }]);
      const after = await snapshot();
      assert.deepEqual(after.permissions, before.permissions);
      assert.deepEqual(after.coverage, before.coverage);
      const existing = new Set(before.functions.map(p => p.oid));
      assert.deepEqual(after.functions.filter(p => existing.has(p.oid)), before.functions);
      assert.equal(after.functions.length - before.functions.length, 3);
    });
    await test("only service_role can execute all three previews; PUBLIC/anon/authenticated denied", async () => {
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`SET ROLE ${role}`);
        for (const fn of functions) await assert.rejects(db.query(`SELECT * FROM public.${fn}()`), /permission denied/);
        await db.exec("RESET ROLE");
      }
      const acl = await db.query<{ name: string; defin: boolean; config: string[]; public_acl: boolean }>(`SELECT proname AS name,prosecdef AS defin,proconfig AS config,
        EXISTS(SELECT 1 FROM aclexplode(proacl) WHERE grantee=0 AND privilege_type='EXECUTE') AS public_acl
        FROM pg_proc WHERE proname = ANY($1::text[]) ORDER BY proname`, [functions]);
      assert.equal(acl.rows.length, 3);
      for (const row of acl.rows) { assert.equal(row.defin, true); assert.ok(row.config.includes('search_path=""')); assert.equal(row.public_acl, false); }
    });
    await test("requests are open, unexpired and owned by a visible buyer; geography stays in Mexico", async () => {
      const rows = await call(functions[0]);
      assert.deepEqual(new Set(rows.map(r => r.id)), new Set([10, 11, 12, 13].map(uid)));
      assert.equal(rows.find(r => r.id === uid(10))?.categoria, "comida");
    });
    await test("communities exclude private, hidden, archived, suspended owner and foreign coverage", async () => {
      assert.deepEqual(new Set((await call(functions[1])).map(r => r.id)), new Set([30, 31].map(uid)));
    });
    await test("posts contain public visible roots only; no comments, hidden/suspended/future/media-only rows", async () => {
      assert.deepEqual(new Set((await call(functions[2])).map(r => r.id)), new Set([40, 41].map(uid)));
    });
    await test("community activity aggregates only visible roots from non-suspended authors", async () => {
      const rows = await call(functions[1]);
      assert.equal(rows.find(r => r.id === uid(30))?.publicaciones_count, 2);
      assert.equal(rows.find(r => r.id === uid(31))?.publicaciones_count, 1);
      assert.ok(rows.every(r => new Date(String(r.ultima_publicacion_at)).getTime() <= Date.now()));
    });
    await test("preview projection has no coordinates, private profile, media, membership or hidden text", async () => {
      const expected = [
        ["id", "titulo", "descripcion", "presupuesto_max", "categoria", "created_at"],
        ["id", "nombre", "descripcion", "miembros_count", "publicaciones_count", "ultima_publicacion_at"],
        ["id", "community_id", "community_nombre", "contenido", "created_at", "likes_count", "comentarios_count"],
      ];
      for (const [i, fn] of functions.entries()) {
        const rows = await call(fn); assert.ok(rows.length > 0);
        assert.deepEqual(Object.keys(rows[0]), expected[i]);
        assert.ok(!/PRIVATE_|HIDDEN_SENTINEL|ubicacion|centro|author_id|buyer_id|owner_id|\.2063/.test(JSON.stringify(rows)));
      }
      assert.equal(String((await call(functions[0])).find(r => r.id === uid(10))?.descripcion).length, 240);
      assert.equal(String((await call(functions[2])).find(r => r.id === uid(40))?.contenido).length, 240);
    });
    await test("coverage missing fails closed; live radio restriction is reused without client coordinates", async () => {
      await db.exec("DELETE FROM public.vicino_cobertura");
      for (const fn of functions) assert.equal((await call(fn)).length, 0);
      await db.exec("INSERT INTO public.vicino_cobertura VALUES('operacion','radio',19.0414,-98.2063,50)");
      assert.deepEqual((await call(functions[0])).map(r => r.id), [uid(10)]);
      assert.deepEqual((await call(functions[1])).map(r => r.id), [uid(30)]);
      assert.deepEqual((await call(functions[2])).map(r => r.id), [uid(40)]);
      await db.exec("UPDATE public.vicino_cobertura SET modo='pais'");
    });
    await test("private community changes immediately remove its roots and preview", async () => {
      await db.exec(`UPDATE public.communities SET es_privada=true WHERE id='${uid(30)}'`);
      assert.equal((await call(functions[1])).some(r => r.id === uid(30)), false);
      assert.equal((await call(functions[2])).some(r => r.id === uid(40)), false);
      await db.exec(`UPDATE public.communities SET es_privada=false WHERE id='${uid(30)}'`);
    });
    await db.exec(`INSERT INTO public.purchase_requests(id,buyer_id,title,ubicacion_geo)
      SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${uid(1)}','Solicitud '||n,point(-98.2,19) FROM generate_series(1,25) n;
      INSERT INTO public.communities(id,nombre,owner_id,centro)
      SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Comunidad '||n,'${uid(1)}',point(-98.2,19) FROM generate_series(1,25) n;
      INSERT INTO public.community_posts(id,community_id,author_id,cuerpo)
      SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${uid(30)}','${uid(1)}','Publicacion '||n FROM generate_series(1,25) n;`);
    await test("limits are bounded to twelve, including null, negative, zero and excessively large input", async () => {
      for (const fn of functions) for (const [limit, count] of [[null, 12], [-50, 1], [0, 1], [2, 2], [100000, 12]] as const) assert.equal((await call(fn, limit)).length, count);
      for (const fn of functions) assert.deepEqual(await call(fn), await call(fn));
    });
    await test("no added table grants or changes to existing RPC privileges and RLS", async () => {
      const rls = await db.query<{ enabled: boolean }>("SELECT relrowsecurity AS enabled FROM pg_class WHERE relname=ANY($1::text[])", [["profiles", "purchase_requests", "communities", "community_posts", "community_members"]]);
      assert.equal(rls.rows.length, 5); assert.ok(rls.rows.every(r => r.enabled));
      for (const role of ["anon", "authenticated", "service_role"]) {
        await db.exec(`SET ROLE ${role}`);
        for (const table of ["profiles", "purchase_requests", "communities", "community_posts", "community_members"]) await assert.rejects(db.query(`SELECT * FROM public.${table}`), /permission denied/);
        await db.exec("RESET ROLE");
      }
      const unchanged = await db.query<{ allowed: boolean; denied: boolean; policies: number }>("SELECT has_function_privilege('authenticated','public.existing_private_rpc()','EXECUTE') AS allowed,has_function_privilege('anon','public.existing_private_rpc()','EXECUTE') AS denied,(SELECT count(*)::int FROM pg_policies WHERE policyname='unrelated_policy') AS policies");
      assert.deepEqual(unchanged.rows[0], { allowed: true, denied: false, policies: 1 });
    });
    console.log(`MP03-D SQL: ${passed}/${passed} PASS (real PostgreSQL/PGlite; point shims, real coverage function; remote/PostGIS acceptance pending)`);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
