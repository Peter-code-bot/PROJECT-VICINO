/** Local regression tests. No environment files, remote DB, or real accounts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { publicProfileName, publicProfileSearchFilter } from "../packages/shared/src/utils/profile-name";
import { updateProfileSchema } from "../packages/shared/src/validators/profile";
import { loadChatCatalog } from "../apps/web/lib/chat/catalogo-chat";

const root = path.resolve(__dirname, "..");
const web = path.join(root, "apps/web");
const webRequire = createRequire(path.join(web, "package.json"));
const esbuild = webRequire(webRequire.resolve("esbuild", { paths: [webRequire.resolve("tsx")] }));
const React = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");
const store = { id: "00000000-0000-4000-8000-000000000001", nombre: "Alex Cabrera", es_vendedor: true, seller_type: "business", nombre_negocio: " Creed ", foto: null, trust_level: "nuevo" };
const cases = [
  [store, "Creed"],
  [{ ...store, nombre_negocio: "Creed Nueva" }, "Creed Nueva"],
  [{ ...store, es_vendedor: false }, "Alex Cabrera"],
  [{ ...store, seller_type: "casual" }, "Alex Cabrera"],
  [{ ...store, es_vendedor: null }, "Alex Cabrera"],
  [{ ...store, seller_type: null }, "Alex Cabrera"],
  [{ ...store, nombre_negocio: null }, "Tienda"],
  [{ ...store, nombre_negocio: " \t\n " }, "Tienda"],
] as const;

test("visible identity follows store mode, renaming and legacy empty data", () => {
  for (const [profile, expected] of cases) {
    assert.equal(publicProfileName(profile), expected);
    assert.equal(publicProfileName([profile]), expected);
    assert.equal(profile.nombre, "Alex Cabrera", "personal identity is not mutated");
  }
  assert.equal(publicProfileName(null, "Vendedor"), "Vendedor");
  assert.equal(publicProfileName({ nombre: "  Ana  " }), "Ana");
});

test("store activation rejects missing/blank names; individual profiles remain editable", () => {
  for (const name of [null, undefined, "", " \t\n "]) {
    const result = updateProfileSchema.safeParse({ ...store, nombre_negocio: name });
    assert.equal(result.success, false);
    if (!result.success) assert.deepEqual(result.error.issues[0]?.path, ["nombre_negocio"]);
    assert.equal(updateProfileSchema.safeParse({ ...store, es_vendedor: false, nombre_negocio: name }).success, true);
  }
  assert.equal(updateProfileSchema.parse(store).nombre_negocio, "Creed");
});

test("search values keep punctuation and quotes inside one PostgREST value", async () => {
  const pattern = '%Creed, ("local")\\%';
  const filter = publicProfileSearchFilter(pattern);
  const match = /nombre_negocio\.ilike\.("(?:\\.|[^"\\])*")/.exec(filter);
  assert.ok(match);
  assert.equal(JSON.parse(match[1]!), pattern);
  assert.ok(filter.includes("and(es_vendedor.eq.true,seller_type.eq.business,"));
  // Exercise the real Supabase URL builder; no HTTP request is sent.
  const { PostgrestClient } = createRequire(webRequire.resolve("@supabase/supabase-js"))("@supabase/postgrest-js");
  let requested: URL | undefined;
  const db = new PostgrestClient("https://local.invalid/rest/v1", { fetch: async (url: string) => {
    requested = new URL(url); return new Response("[]", { headers: { "Content-Type": "application/json" } });
  } });
  await db.from("profiles").select("nombre").or(filter);
  assert.equal(requested?.searchParams.get("or"), `(${filter})`);
});

async function bundle(relative: string, mocks: Record<string, unknown>) {
  const result = await esbuild.build({ entryPoints: [path.join(web, relative)], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
    packages: "external", external: Object.keys(mocks), logLevel: "silent" });
  const module = { exports: {} as any };
  new vm.Script(result.outputFiles[0].text, { filename: relative }).runInNewContext({ module, exports: module.exports,
    require: (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : webRequire(name), console, process, setTimeout, clearTimeout, URL, crypto, FormData });
  return module.exports;
}

const anchor = ({ children, href, ...props }: any) => React.createElement("a", { ...props, href }, children);
const image = ({ fill: _fill, priority: _priority, ...props }: any) => React.createElement("img", props);
test("real product card and detail seller render Creed; deactivation restores personal name", async () => {
  const mocks = { "next/link": { __esModule: true, default: anchor }, "next/image": { __esModule: true, default: image },
    "@/hooks/use-favorite": { useFavorite: () => ({ isFavorite: false, isPending: false, toggle() {} }) } };
  const { ProductCard } = await bundle("components/product/product-card.tsx", mocks);
  const { SellerCardMini } = await bundle("components/product/seller-card-mini.tsx", mocks);
  for (const [profile, expected] of cases) {
    const card = renderToStaticMarkup(React.createElement(ProductCard, { id: "p", titulo: "Playera YoungLa", precio: 1099, imagen: null, categoria: "ropa", slug: "playera", vendedor: profile, rating: 0, reviewsCount: 0 }));
    const detail = renderToStaticMarkup(React.createElement(SellerCardMini, { seller: profile }));
    for (const html of [card, detail]) {
      assert.ok(html.includes(expected));
      if (expected !== "Alex Cabrera") assert.ok(!html.includes("Alex Cabrera"));
    }
  }
});

test("chat catalog projects canonical seller name before dropping profile fields", async () => {
  const client = { from(table: string) {
    const query: any = { then(resolve: any) { return Promise.resolve({ data: table === "profiles" ? [store] : [{ creador_id: store.id }], error: null }).then(resolve); } };
    for (const method of ["select", "eq", "in", "order", "limit", "ilike"]) query[method] = () => query;
    return query;
  } };
  const result = await loadChatCatalog(client as any, [store.id]);
  assert.equal(result.sellers[0]?.nombre, "Creed");
});

test("real profile action authenticates, validates, and awaits global cache invalidation", async () => {
  let actor: string | null = store.id, writes = 0, invalidated = false, fail = false;
  const { updateProfile } = await bundle("app/(marketplace)/perfil/actions.ts", {
    "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: actor ? { id: actor } : null } }) }, rpc: async () => { writes++; return { error: fail ? { message: "offline" } : null }; } }) },
    "@/lib/rate-limit": { writeRateLimit: {}, enforce: async () => ({ ok: true }) },
    "@/lib/revalidate-session": { revalidatePath: async (route: string, type: string) => { await Promise.resolve(); assert.equal(route, "/"); assert.equal(type, "layout"); invalidated = true; } },
    "@sentry/nextjs": {},
  });
  const form = new FormData(); form.set("nombre", store.nombre); form.set("es_vendedor", "on"); form.set("seller_type", "business");
  assert.ok((await updateProfile(form)).error); assert.equal(writes, 0);
  form.set("nombre_negocio", "Creed"); actor = null;
  assert.equal((await updateProfile(form)).error, "No autenticado"); assert.equal(writes, 0);
  actor = store.id; fail = true; assert.equal((await updateProfile(form)).error, "offline"); assert.equal(invalidated, false);
  fail = false; assert.equal((await updateProfile(form)).success, true); assert.equal(invalidated, true);
});

const targets = ["notify_sale_confirmation_created", "notify_new_review", "nearby_products", "search_nearby_products", "search_nearby_products_v4", "feed_nearby_requests", "get_ranking_hiperlocal", "feed_comunidades_explorar", "feed_muro_comunidad", "notificar_comentario_de_comunidad", "solicitar_union_comunidad", "iniciar_conversacion", "iniciar_confirmacion_venta", "search_map_publications_v1", "search_map_publications_v2"];

async function installedFunctions() {
  // Resolve CREATE/DROP argument types in PostgreSQL and retain definitions by
  // identity. Historical snapshots change return shapes, so they are parsed under
  // temporary names instead of pretending the whole historical schema is present.
  const catalog = new PGlite();
  const dir = path.join(root, "supabase/migrations");
  const historicalTargets = new Set([...targets, "notify_new_message"]);
  const current = new Map<string, { name: string; sql: string }>();
  let parserId = 0;
  try {
    await catalog.exec("CREATE TYPE request_status AS ENUM ('open','closed','expired'); SET check_function_bodies=false;");
    for (const filename of (await readdir(dir)).filter(f => f.endsWith(".sql") && !f.includes("identidad_publica_modo_tienda")).sort()) {
      const sql = await readFile(path.join(dir, filename), "utf8");
      const operations: { index: number; name: string; kind: "create" | "drop"; sql: string; args?: string }[] = [];
      for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi)) {
        if (!historicalTargets.has(match[1]!)) continue;
        const rest = sql.slice(match.index);
        const as = /\bAS\s+(\$[\w]*\$)/i.exec(rest); assert.ok(as, filename);
        const end = rest.indexOf(as[1]!, as.index + as[0].length); assert.ok(end >= 0, filename);
        const semicolon = rest.indexOf(";", end + as[1]!.length); assert.ok(semicolon >= 0);
        operations.push({ index: match.index!, name: match[1]!, kind: "create", sql: rest.slice(0, semicolon + 1) });
      }
      for (const match of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s*\([^;]*\)\s*;/gi)) {
        if (historicalTargets.has(match[1]!)) operations.push({ index: match.index!, name: match[1]!, kind: "drop", sql: match[0], args: /\(([^;]*)\)/s.exec(match[0])![1] });
      }
      for (const operation of operations.sort((a, b) => a.index - b.index)) {
        const parserName = `nt_fixture_signature_${parserId++}`;
        const parseSql = operation.kind === "create"
          ? operation.sql.replace(/^(create\s+(?:or\s+replace\s+)?function\s+)(?:public\.)?[a-z_0-9]+/i, `$1public.${parserName}`)
          : `CREATE FUNCTION public.${parserName}(${operation.args}) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;`;
        await catalog.exec(parseSql);
        const types = (await catalog.query<any>("SELECT proargtypes::text input_types FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=$1", [parserName])).rows[0].input_types;
        const identity = `${operation.name}:${types}`;
        if (operation.kind === "create") current.set(identity, { name: operation.name, sql: operation.sql });
        else current.delete(identity);
      }
    }
    assert.ok(![...current.values()].some(f => f.name === "notify_new_message"), "the retired message notice stays removed");
    const definitions = [...current.values()].filter(f => targets.includes(f.name));
    assert.equal(definitions.length, targets.length, "exactly one current function per name");
    const latest = new Map<string, string>(definitions.map(f => [f.name, f.sql]));
    assert.equal(latest.size, targets.length, "no surviving overload may be omitted");
    return latest;
  } finally {
    await catalog.close();
  }
}

test("SQL migration patches all 15 current bodies, preserves RPC signatures/grants and RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TYPE request_status AS ENUM ('open','closed','expired'); SET check_function_bodies = false;
      CREATE TABLE profiles(id uuid PRIMARY KEY,nombre text,es_vendedor boolean,seller_type text,nombre_negocio text);
      ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY visible ON profiles FOR SELECT USING(true);
      INSERT INTO profiles VALUES ('${store.id}','Alex Cabrera',true,'business','Creed');`);
    for (const sql of (await installedFunctions()).values()) await db.exec(sql);
    await db.exec(`REVOKE ALL ON FUNCTION public.iniciar_conversacion(uuid,uuid,text,uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.iniciar_conversacion(uuid,uuid,text,uuid) TO authenticated;
      REVOKE ALL ON FUNCTION public.nearby_products(double precision,double precision,integer,text,integer) FROM PUBLIC,anon,authenticated;
      REVOKE ALL ON FUNCTION public.search_nearby_products(double precision,double precision,integer,text,uuid[]) FROM PUBLIC,anon,authenticated;`);
    const snapshot = () => db.query<any>("SELECT oid,proname,prosrc,to_jsonb(p)-'prosrc' AS attributes FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname=ANY($1) ORDER BY oid", [targets]);
    const before = (await snapshot()).rows;
    const migration = await readFile(path.join(root, "supabase/migrations/20261003213000_identidad_publica_modo_tienda.sql"), "utf8");
    await db.exec("BEGIN"); await db.exec(migration); await db.exec("COMMIT");
    const after = (await snapshot()).rows;
    assert.equal((await db.query<any>("SELECT to_regprocedure('public.notify_new_message()') IS NULL absent")).rows[0].absent, true);
    for (const old of before) {
      const next = after.find((f: any) => f.oid === old.oid)!; assert.ok(next.prosrc.includes("profile_public_name("), old.proname);
      const { prosrc: oldBody, ...oldAttributes } = old, { prosrc: newBody, ...newAttributes } = next;
      assert.deepEqual(newAttributes, oldAttributes, old.proname);
      // Only the identity expression changes: reverse it and compare the complete body.
      let reversed = newBody.replace(/public\.profile_public_name\(([a-z_0-9]+)\.nombre, \1\.es_vendedor, \1\.seller_type, \1\.nombre_negocio\)/g, "$1.nombre")
        .replace(/public\.profile_public_name\(nombre, es_vendedor, seller_type, nombre_negocio\)/g, "nombre");
      if (old.proname === "get_ranking_hiperlocal") reversed = reversed.replace("p.nombre AS display_name", "COALESCE(NULLIF(btrim(p.display_name), ''), p.nombre) AS display_name");
      assert.equal(reversed, oldBody, `unrelated SQL changed in ${old.proname}`);
    }
    assert.equal((await db.query<any>("SELECT relrowsecurity FROM pg_class WHERE oid='profiles'::regclass")).rows[0].relrowsecurity, true);
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM pg_policy WHERE polrelid='profiles'::regclass")).rows[0].n, 1);
    for (const signature of ["nearby_products(double precision,double precision,integer,text,integer)", "search_nearby_products(double precision,double precision,integer,text,uuid[])"]) {
      for (const role of ["anon", "authenticated"]) assert.equal((await db.query<any>("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed, false);
    }
    for (const [profile, expected] of cases) {
      const result = await db.query<any>("SELECT profile_public_name($1,$2,$3,$4) name", [profile.nombre, profile.es_vendedor, profile.seller_type, profile.nombre_negocio]);
      assert.equal(result.rows[0].name, expected);
    }
    await assert.rejects(() => db.exec(`UPDATE profiles SET nombre_negocio=E' \t\n ' WHERE id='${store.id}'`), (e: any) => e.code === "22023");
    await db.exec(`UPDATE profiles SET nombre_negocio='Creed Nueva' WHERE id='${store.id}'`);
    assert.equal((await db.query<any>("SELECT profile_public_name(nombre,es_vendedor,seller_type,nombre_negocio) name FROM profiles")).rows[0].name, "Creed Nueva");
    await db.exec("UPDATE profiles SET es_vendedor=false");
    assert.equal((await db.query<any>("SELECT profile_public_name(nombre,es_vendedor,seller_type,nombre_negocio) name FROM profiles")).rows[0].name, "Alex Cabrera");
    // Verify an actual installed notification trigger, including a rename between events.
    await db.exec(`CREATE TABLE notice_log(body text); CREATE FUNCTION create_notification(uuid,text,text,text,jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO notice_log VALUES($4) $$;
      CREATE TABLE reviews(reviewer_id uuid,reviewed_id uuid,rating int,id uuid,sale_confirmation_id uuid);
      CREATE TRIGGER review_notice AFTER INSERT ON reviews FOR EACH ROW EXECUTE FUNCTION notify_new_review();
      UPDATE profiles SET es_vendedor=true;
      INSERT INTO reviews VALUES('${store.id}','${store.id}',5,'${store.id}','${store.id}');`);
    assert.ok((await db.query<any>("SELECT body FROM notice_log")).rows[0].body.startsWith("Creed Nueva te dejó"));
    await db.exec("BEGIN");
    await assert.rejects(() => db.exec(migration), /already present/);
    await db.exec("ROLLBACK");
  } finally { await db.close(); }
});

async function withIdentitySqlFixture(run: (db: PGlite, functions: Map<string, string>, migration: string) => Promise<void>) {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TYPE request_status AS ENUM ('open','closed','expired'); SET check_function_bodies=false;
      CREATE TABLE profiles(id uuid PRIMARY KEY,nombre text,display_name text,es_vendedor boolean,seller_type text,nombre_negocio text);
      INSERT INTO profiles VALUES('${store.id}','Personal','Personal',true,'business','Store');`);
    const functions = await installedFunctions();
    for (const sql of functions.values()) await db.exec(sql);
    await run(db, functions, await readFile(path.join(root, "supabase/migrations/20261003213000_identidad_publica_modo_tienda.sql"), "utf8"));
  } finally { await db.close(); }
}

test("SQL identity and store guard match ECMAScript trim for all whitespace, including NBSP/BOM", async () => {
  await withIdentitySqlFixture(async (db, _functions, migration) => {
    // A legacy blank store is displayed safely, without rewriting its saved identity.
    await db.query("UPDATE profiles SET nombre_negocio=$1 WHERE id=$2", ["\u00a0\ufeff", store.id]);
    await db.exec(migration);
    assert.equal((await db.query<any>("SELECT profile_public_name(nombre,es_vendedor,seller_type,nombre_negocio) visible,nombre,nombre_negocio FROM profiles")).rows[0].visible, "Tienda");
    assert.equal((await db.query<any>("SELECT nombre_negocio FROM profiles")).rows[0].nombre_negocio, "\u00a0\ufeff");
    const codepoints = [9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279];
    for (const point of codepoints) {
      const space = String.fromCodePoint(point);
      for (const name of [space, `${space}Store${space}`]) {
        const expected = publicProfileName({ ...store, nombre: "Personal", nombre_negocio: name });
        assert.equal((await db.query<any>("SELECT profile_public_name('Personal',true,'business',$1) visible", [name])).rows[0].visible, expected, `U+${point.toString(16)}`);
      }
      await assert.rejects(() => db.query("UPDATE profiles SET nombre_negocio=$1 WHERE id=$2", [space, store.id]), (e: any) => e.code === "22023", `guard U+${point.toString(16)}`);
    }
    for (const point of [133,6158,8203]) {
      const text = String.fromCodePoint(point); // These characters are not removed by JS trim.
      assert.equal((await db.query<any>("SELECT profile_public_name('Personal',true,'business',$1) visible", [text])).rows[0].visible, text);
      await db.query("UPDATE profiles SET nombre_negocio=$1 WHERE id=$2", [text, store.id]);
    }
    const allWhitespace = String.fromCodePoint(...codepoints);
    assert.equal((await db.query<any>("SELECT profile_public_name($1,false,'business',NULL) visible", [`${allWhitespace}Personal${allWhitespace}`])).rows[0].visible, "Personal");
    assert.equal((await db.query<any>("SELECT profile_public_name($1,false,'business',NULL) visible", [allWhitespace])).rows[0].visible, "Usuario");
  });
});

test("SQL ranking survives multiline formatting and alias casing without legacy name priority", async () => {
  await withIdentitySqlFixture(async (db, functions, migration) => {
    const original = "COALESCE(NULLIF(btrim(p.display_name), ''), p.nombre)";
    assert.ok(functions.get("get_ranking_hiperlocal")!.includes(original));
    for (const formatted of [
      "COALESCE(NULLIF(btrim(p.display_name), ''),\n      p.nombre)",
      "CoAlEsCe (\n      NuLlIf ( btrim ( P . display_name ),\n        '' ),\n      p . nombre\n    )",
    ]) {
      await db.exec("BEGIN");
      await db.exec(functions.get("get_ranking_hiperlocal")!.replace(original, formatted));
      const before = (await db.query<any>("SELECT to_jsonb(p)-'prosrc' attributes FROM pg_proc p WHERE oid='get_ranking_hiperlocal(uuid,text,double precision,double precision,integer,integer)'::regprocedure")).rows[0].attributes;
      await db.exec(migration);
      const installed = (await db.query<any>("SELECT prosrc,to_jsonb(p)-'prosrc' attributes FROM pg_proc p WHERE oid='get_ranking_hiperlocal(uuid,text,double precision,double precision,integer,integer)'::regprocedure")).rows[0];
      assert.deepEqual(installed.attributes, before);
      assert.ok(!/\bp\s*\.\s*display_name\b/i.test(installed.prosrc));
      const expression = /(public\.profile_public_name\([^\n]+\)) AS display_name/i.exec(installed.prosrc)?.[1];
      assert.ok(expression);
      assert.equal((await db.query<any>(`SELECT ${expression} visible FROM profiles p`)).rows[0].visible, "Store");
      await db.exec("ROLLBACK");
    }
    // Unquoted SQL aliases fold to lower case. Different casing in separate v4
    // branches must not make the text transformer wrap already mapped arguments.
    await db.exec("BEGIN");
    await db.exec(functions.get("search_nearby_products_v4")!.replace("JOIN profiles pr", "JOIN profiles PR"));
    await db.exec(migration);
    const v4 = (await db.query<any>("SELECT prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='search_nearby_products_v4'")).rows[0].prosrc;
    assert.equal([...v4.matchAll(/public\.profile_public_name\(/g)].length, 3);
    assert.ok(!v4.includes("profile_public_name(public.profile_public_name("));
    await db.exec("ROLLBACK");
  });
});

test("SQL drift guards reject missing emitters, unexpected overloads and unknown legacy expressions", async () => {
  await withIdentitySqlFixture(async (db, functions, migration) => {
    for (const prepare of [
      () => db.exec("DROP FUNCTION notify_new_review()"),
      () => db.exec("CREATE FUNCTION search_nearby_products_v4(text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$"),
      () => db.exec(functions.get("get_ranking_hiperlocal")!.replace("COALESCE(NULLIF(btrim(p.display_name), ''), p.nombre)", "COALESCE(p.display_name, p.nombre)")),
    ]) {
      await db.exec("BEGIN");
      await prepare();
      await assert.rejects(() => db.exec(migration), /Missing or overloaded function|Unmapped legacy display_name/);
      await db.exec("ROLLBACK");
      assert.equal((await db.query<any>("SELECT to_regprocedure('public.profile_public_name(text,boolean,text,text)') IS NULL absent")).rows[0].absent, true);
    }
  });
});

test("SQL prepared transaction checks the reviewed baseline and atomically preserves the current emitter and ledger", async () => {
  await withIdentitySqlFixture(async (db, functions, migration) => {
    const { buildNombreTiendaApply } = await import("./prepare-nombre-tienda-sql.mjs");
    await db.exec(`ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      CREATE TABLE messages(id uuid);
      CREATE FUNCTION call_send_push_on_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER push_on_message_pgnet AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION call_send_push_on_message();
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
      REVOKE ALL ON FUNCTION nearby_products(double precision,double precision,integer,text,integer) FROM PUBLIC,anon,authenticated;`);
    const baseline = (await db.query<any>("SELECT proname,pg_get_function_identity_arguments(oid) identity_arguments,md5(pg_get_functiondef(oid)) definition_md5 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY($1)", [targets])).rows;
    const profileBefore = (await db.query<any>("SELECT to_jsonb(p) saved FROM profiles p")).rows[0].saved;
    const emitterBefore = (await db.query<any>("SELECT to_jsonb(p) saved FROM pg_proc p WHERE oid='call_send_push_on_message()'::regprocedure")).rows[0].saved;
    const functionsBefore = (await db.query<any>("SELECT oid,to_jsonb(p) saved FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname=ANY($1) ORDER BY oid", [targets])).rows;
    // Drift between review and apply must stop before the source is installed.
    await db.exec(functions.get("notify_new_review")!.replace("BEGIN", "BEGIN\n -- semantic-neutral drift after review"));
    await assert.rejects(() => db.exec(buildNombreTiendaApply(migration, baseline)), /Reviewed function baseline has changed/);
    await db.exec("ROLLBACK");
    assert.equal((await db.query<any>("SELECT to_regprocedure('profile_public_name(text,boolean,text,text)') IS NULL absent")).rows[0].absent, true);
    await db.exec(functions.get("notify_new_review")!);
    // The postflight must roll back both helper changes and any unexpected ACL widening.
    const badSource = `${migration}\nGRANT EXECUTE ON FUNCTION nearby_products(double precision,double precision,integer,text,integer) TO anon;`;
    await assert.rejects(() => db.exec(buildNombreTiendaApply(badSource, baseline)), /Function attributes or current message emitter changed/);
    await db.exec("ROLLBACK");
    assert.equal((await db.query<any>("SELECT to_regprocedure('profile_public_name(text,boolean,text,text)') IS NULL absent")).rows[0].absent, true);
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM supabase_migrations.schema_migrations")).rows[0].n, 0);
    assert.equal((await db.query<any>("SELECT has_function_privilege('anon','nearby_products(double precision,double precision,integer,text,integer)','EXECUTE') allowed")).rows[0].allowed, false);
    // Verification exercises the same preflight/source/postflight, then restores
    // every original function and leaves no helper, trigger or ledger row behind.
    await db.exec(buildNombreTiendaApply(migration, baseline, { mode: "verify" }));
    assert.deepEqual((await db.query<any>("SELECT oid,to_jsonb(p) saved FROM pg_proc p WHERE pronamespace='public'::regnamespace AND proname=ANY($1) ORDER BY oid", [targets])).rows, functionsBefore);
    assert.equal((await db.query<any>("SELECT to_regprocedure('profile_public_name(text,boolean,text,text)') IS NULL absent")).rows[0].absent, true);
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM supabase_migrations.schema_migrations")).rows[0].n, 0);
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='profiles'::regclass AND tgname='profiles_require_store_name'")).rows[0].n, 0);
    await db.exec(buildNombreTiendaApply(migration, baseline));
    assert.equal((await db.query<any>("SELECT statements[1]=$1 source_matches FROM supabase_migrations.schema_migrations WHERE version='20261003213000'", [migration])).rows[0].source_matches, true);
    assert.deepEqual((await db.query<any>("SELECT to_jsonb(p) saved FROM profiles p")).rows[0].saved, profileBefore);
    assert.deepEqual((await db.query<any>("SELECT to_jsonb(p) saved FROM pg_proc p WHERE oid='call_send_push_on_message()'::regprocedure")).rows[0].saved, emitterBefore);
    assert.equal((await db.query<any>("SELECT to_regprocedure('notify_new_message()') IS NULL absent")).rows[0].absent, true);
    await assert.rejects(() => db.exec(buildNombreTiendaApply(migration, baseline)), /already or partially installed/);
    await db.exec("ROLLBACK");
    assert.equal((await db.query<any>("SELECT count(*)::int n FROM supabase_migrations.schema_migrations")).rows[0].n, 1);
  });
});
