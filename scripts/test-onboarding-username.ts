// Prueba aislada: PostgreSQL real en WASM, sin credenciales ni conexión remota.
// pnpm exec tsx scripts/test-onboarding-username.ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  usernameSuggestionBase,
  usernameSuggestionCandidates,
  usernameLookupSchema,
} from "../apps/web/lib/onboarding/username-suggestions.ts";

const ALICE = "00000000-0000-4000-8000-000000000001";
const BOB = "00000000-0000-4000-8000-000000000002";
const LEGACY = "00000000-0000-4000-8000-000000000004";
const ABSENT = "00000000-0000-4000-8000-000000000099";
const db = new PGlite();
let checks = 0;

async function check(name: string, body: () => void | Promise<void>) {
  await body();
  checks++;
  console.log(`PASS ${name}`);
}

async function asUser(id: string | null) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
}

async function lookup(username: string, suggestions: string[] = []) {
  const { rows } = await db.query<{ result: unknown }>(
    "SELECT public.consultar_usuarios_onboarding($1, $2::text[]) AS result", [username, suggestions],
  );
  return usernameLookupSchema.parse(rows[0].result);
}

async function snapshot(id: string) {
  const { rows } = await db.query<{ username: string; nombre: string; user_id: string; onboarding_paso: string | null; es_vendedor: boolean }>(
    "SELECT username, nombre, user_id, onboarding_paso, es_vendedor FROM profiles WHERE id = $1", [id],
  );
  return rows[0];
}

async function rejectsCode(body: () => Promise<unknown>, code: string) {
  await assert.rejects(body, (error: unknown) => {
    assert.equal((error as { code?: string }).code, code);
    return true;
  });
}

async function main() {
try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY,
      user_id text UNIQUE,
      nombre text,
      bio text,
      foto text,
      es_vendedor boolean DEFAULT false,
      has_seen_onboarding boolean DEFAULT false,
      seller_type text DEFAULT 'casual',
      categoria_negocio text,
      nombre_negocio text,
      descripcion_negocio text,
      metodos_pago_aceptados text
    );
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    CREATE TABLE public.categories (slug text PRIMARY KEY, activo boolean NOT NULL);
    INSERT INTO categories VALUES ('comida', true), ('hogar', true), ('desactivada', false);
  `);
  for (const name of [
    "20260826250000_profiles_username_editable.sql",
    "20260826251000_rpc_set_username.sql",
    "20260905100000_onboarding_por_pasos.sql",
    "20260714000002_onboarding_rpc_fail_loudly.sql",
    "20261010120000_onboarding_por_dato_y_usuario.sql",
  ]) {
    await db.exec(await readFile(resolve(__dirname, "../supabase/migrations", name), "utf8"));
  }
  await db.query("INSERT INTO profiles (id, user_id, nombre) VALUES ($1, 'U0000001', 'Alice'), ($2, 'U0000002', 'Bob')", [ALICE, BOB]);
  await db.query("INSERT INTO profiles (id, user_id, nombre, es_vendedor, seller_type) VALUES ($1, 'U0000004', 'Negocio previo', true, 'business')", [LEGACY]);
  const storeGuard = await readFile(resolve(__dirname, "../supabase/migrations/20261003213000_identidad_publica_modo_tienda.sql"), "utf8");
  const storeGuardStart = storeGuard.indexOf("CREATE OR REPLACE FUNCTION public.require_store_name()");
  assert(storeGuardStart >= 0);
  await db.exec(storeGuard.slice(storeGuardStart));

  await check("normaliza diacríticos, separadores y alias del correo", () => {
    assert.equal(usernameSuggestionBase("José..Muñoz+compras@example.invalid"), "jose_munoz");
    assert.equal(usernameSuggestionBase("  Ána--López@example.invalid"), "ana_lopez");
  });
  await check("correo relay no expone su identificador aleatorio", () => {
    assert.equal(usernameSuggestionBase("oculto123@privaterelay.appleid.com", "María Peña"), "maria_pena");
    assert.equal(usernameSuggestionBase(null, "李"), "vecino");
    assert.equal(usernameSuggestionBase("oculto@duck.com", null), "vecino");
  });
  await check("sufijos distintos, formato válido y tope de 30 al truncar", () => {
    const candidates = usernameSuggestionCandidates("a".repeat(100), 8995);
    assert.equal(candidates.length, 24);
    assert.equal(new Set(candidates).size, 24);
    assert(candidates.every((candidate) => candidate.length === 30 && /^[a-z0-9_]{3,30}$/.test(candidate)));
    assert(candidates.some((candidate) => candidate.endsWith("_1000")));
  });
  await check("consulta y escritura comparten reservados y formato", async () => {
    await asUser(ALICE);
    assert.equal((await lookup("AdMiN")).status, "reserved");
    assert.equal((await lookup("a")).status, "invalid");
    await rejectsCode(() => db.query("SELECT set_username('AdMiN')"), "22023");
    await rejectsCode(() => db.query("SELECT set_username('in válido')"), "22023");
  });
  await check("tres opciones disponibles, distintas e insensibles a mayúsculas", async () => {
    await asUser(ALICE);
    const result = await lookup("u0000002", ["U0000002", "AdMiN", "a", "Alice_1000", "alice_1000", "alice_1001", "alice_1002"]);
    assert.equal(result.status, "taken");
    assert.deepEqual(result.suggestions, ["Alice_1000", "alice_1001", "alice_1002"]);
    assert.deepEqual(Object.keys(result).sort(), ["message", "status", "suggestions", "username"]);
    assert.equal((await lookup("u0000001")).status, "available");
  });
  await check("guarda dato, username y siguiente paso sin cambiar identidad interna", async () => {
    await asUser(ALICE);
    await db.query("SELECT guardar_paso_onboarding_v2(p_username => 'Alice_1000', p_nombre => 'Alicia', p_paso => 'foto')");
    const saved = await snapshot(ALICE);
    assert.equal(saved.username, "Alice_1000");
    assert.equal(saved.nombre, "Alicia");
    assert.equal(saved.onboarding_paso, "foto");
    assert.equal(saved.user_id, "U0000001");
    assert.equal(saved.es_vendedor, false);
  });
  await check("colisión posterior al chequeo revierte nombre y avance del perdedor", async () => {
    await asUser(BOB);
    assert.equal((await lookup("nuevo_1000")).status, "available");
    await asUser(ALICE);
    assert.equal((await lookup("nuevo_1000")).status, "available");
    await db.query("SELECT guardar_paso_onboarding_v2(p_username => 'nuevo_1000', p_paso => 'descripcion')");
    await asUser(BOB);
    const before = await snapshot(BOB);
    await rejectsCode(() => db.query("SELECT guardar_paso_onboarding_v2(p_username => 'NUEVO_1000', p_nombre => 'No guardar', p_paso => 'foto')"), "23505");
    assert.deepEqual(await snapshot(BOB), before);
  });
  await check("fallo del guardado revierte también un username elegido", async () => {
    await asUser(BOB);
    const before = await snapshot(BOB);
    await db.exec("ALTER TABLE profiles ADD CONSTRAINT test_nombre CHECK (nombre <> 'Rechazar')");
    await rejectsCode(() => db.query("SELECT guardar_paso_onboarding_v2(p_username => 'bob_1000', p_nombre => 'Rechazar', p_paso => 'foto')"), "23514");
    assert.deepEqual(await snapshot(BOB), before);
    await db.exec("ALTER TABLE profiles DROP CONSTRAINT test_nombre");
  });
  await check("omitir conserva datos, guardar intereses rechaza lista vacía/nula", async () => {
    await asUser(ALICE);
    const before = await snapshot(ALICE);
    await db.query("SELECT guardar_paso_onboarding_v2(p_paso => 'pagos')");
    assert.equal((await snapshot(ALICE)).username, before.username);
    assert.equal((await snapshot(ALICE)).nombre, before.nombre);
    await rejectsCode(() => db.query("SELECT guardar_paso_onboarding_v2(p_intereses => ARRAY[]::text[])"), "22023");
    await rejectsCode(() => db.query("SELECT guardar_paso_onboarding_v2(p_intereses => ARRAY[NULL]::text[])"), "22023");
    await db.query("SELECT guardar_paso_onboarding_v2(p_paso => 'ubicacion')");
  });
  await check("borradores de negocio nunca activan el vendedor", async () => {
    await asUser(BOB);
    await db.query(`SELECT guardar_paso_onboarding_v2(p_camino => 'vender', p_paso => 'activar',
      p_categoria_negocio => 'comida', p_seller_type => 'business', p_nombre_negocio => 'Tienda de Bob',
      p_descripcion_negocio => 'Pan hecho en casa', p_metodos_pago_aceptados => 'Efectivo')`);
    assert.equal((await snapshot(BOB)).es_vendedor, false);
    await rejectsCode(() => db.query("SELECT guardar_paso_onboarding_v2(p_categoria_negocio => 'desactivada')"), "22023");
  });
  await check("cliente antiguo conserva su RPC y valor perfil", async () => {
    await asUser(BOB);
    await db.query("SELECT guardar_paso_onboarding(p_paso => 'perfil')");
    assert.equal((await snapshot(BOB)).onboarding_paso, "perfil");
    await db.query("SELECT guardar_paso_onboarding(p_paso => 'intereses')");
    assert.equal((await snapshot(BOB)).onboarding_paso, "intereses");
  });
  await check("negocio legacy sin nombre puede reanudar y omitir sin disparar guard de tienda", async () => {
    await asUser(LEGACY);
    await db.query("SELECT guardar_paso_onboarding_v2(p_username => 'negocio_1000', p_paso => 'nombre')");
    await db.query("SELECT guardar_paso_onboarding_v2(p_paso => 'foto')");
    assert.equal((await snapshot(LEGACY)).onboarding_paso, "foto");
    assert.equal((await snapshot(LEGACY)).es_vendedor, true);
    await db.query("SELECT guardar_paso_onboarding_v2(p_seller_type => 'business', p_paso => 'usuario')");
    assert.equal((await snapshot(LEGACY)).onboarding_paso, "usuario");
    await db.query("SELECT guardar_paso_onboarding_v2(p_nombre_negocio => 'Negocio previo', p_paso => 'descripcion')");
    assert.equal((await snapshot(LEGACY)).onboarding_paso, "descripcion");
  });
  await check("un código elegido como @ no rompe el sorteo del alta siguiente", async () => {
    await db.query("SELECT setseed(0.123)");
    const { rows: randomRows } = await db.query<{ code: string }>(
      "SELECT 'U' || lpad(floor(random() * 10000000)::text, 7, '0') AS code",
    );
    const code = randomRows[0].code;
    await asUser(BOB);
    await db.query("SELECT set_username($1)", [code.toLowerCase()]);
    await db.query("SELECT setseed(0.123)");
    const { rows } = await db.query<{ user_id: string; username: string }>(
      "INSERT INTO profiles (id, nombre) VALUES ('00000000-0000-4000-8000-000000000003', 'Nueva cuenta') RETURNING user_id, username",
    );
    assert.notEqual(rows[0].user_id.toLowerCase(), code.toLowerCase());
    assert.equal(rows[0].username, rows[0].user_id);
    assert.equal((await snapshot(BOB)).user_id, "U0000002");
  });
  await check("finalizar con campos omitidos confirma bandera y limpia paso atómicamente", async () => {
    await asUser(BOB);
    await db.query("SELECT guardar_paso_onboarding_v2(p_paso => 'listo')");
    await db.query("SELECT complete_user_onboarding()");
    const { rows } = await db.query<{ has_seen_onboarding: boolean; onboarding_paso: string | null; bio: string | null; foto: string | null }>(
      "SELECT has_seen_onboarding, onboarding_paso, bio, foto FROM profiles WHERE id = $1", [BOB],
    );
    assert.deepEqual(rows[0], { has_seen_onboarding: true, onboarding_paso: null, bio: null, foto: null });
  });
  await check("perfil ausente no escribe ni aparenta avanzar", async () => {
    await asUser(ABSENT);
    await rejectsCode(() => db.query("SELECT guardar_paso_onboarding_v2(p_paso => 'foto')"), "P0002");
    await rejectsCode(() => lookup("usuario"), "P0002");
    await rejectsCode(() => db.query("SELECT complete_user_onboarding()"), "P0002");
  });
  await check("anónimo no consulta, no escribe y no ejecuta helpers", async () => {
    const { rows } = await db.query<{ lookup: boolean; write: boolean; helper: boolean; auth_lookup: boolean; auth_write: boolean; auth_username: boolean; auth_complete: boolean }>(`SELECT
      has_function_privilege('anon', 'public.consultar_usuarios_onboarding(text,text[])', 'EXECUTE') AS lookup,
      has_function_privilege('anon', 'public.guardar_paso_onboarding_v2(text,text,text,text,text,text[],text,text,text,text,text,text)', 'EXECUTE') AS write,
      has_function_privilege('authenticated', 'public.username_validation_status(text)', 'EXECUTE') AS helper,
      has_function_privilege('authenticated', 'public.consultar_usuarios_onboarding(text,text[])', 'EXECUTE') AS auth_lookup,
      has_function_privilege('authenticated', 'public.guardar_paso_onboarding_v2(text,text,text,text,text,text[],text,text,text,text,text,text)', 'EXECUTE') AS auth_write,
      has_function_privilege('authenticated', 'public.set_username(text)', 'EXECUTE') AS auth_username,
      has_function_privilege('authenticated', 'public.complete_user_onboarding()', 'EXECUTE') AS auth_complete`);
    assert.deepEqual(rows[0], { lookup: false, write: false, helper: false, auth_lookup: true, auth_write: true, auth_username: true, auth_complete: true });
    await asUser(null);
    await rejectsCode(() => lookup("usuario"), "42501");
    await rejectsCode(() => db.query("SELECT guardar_paso_onboarding_v2(p_paso => 'foto')"), "42501");
  });
  await check("RLS e índice único quedan presentes", async () => {
    const { rows } = await db.query<{ rls: boolean; unique_index: boolean }>(`SELECT
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass) AS rls,
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'profiles_username_lower_key') AS unique_index`);
    assert.deepEqual(rows[0], { rls: true, unique_index: true });
  });
  await check("un fallo del ledger revierte también el DDL de la migración", async () => {
    await db.exec("CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text); INSERT INTO supabase_migrations.schema_migrations VALUES ('20261010120000', 'fixture');");
    const migration = await readFile(resolve(__dirname, "../supabase/migrations/20261010120000_onboarding_por_dato_y_usuario.sql"), "utf8");
    await rejectsCode(() => db.exec(`BEGIN; CREATE TABLE public.onboarding_atomic_sentinel (id integer); ${migration} INSERT INTO supabase_migrations.schema_migrations VALUES ('20261010120000', 'duplicate'); COMMIT;`), "23505");
    await db.query("ROLLBACK");
    const { rows } = await db.query<{ sentinel: string | null; ledger: number }>("SELECT to_regclass('public.onboarding_atomic_sentinel')::text AS sentinel, (SELECT count(*)::integer FROM supabase_migrations.schema_migrations) AS ledger");
    assert.deepEqual(rows[0], { sentinel: null, ledger: 1 });
  });
  await check("un ensayo completo con ROLLBACK no persiste DDL ni ledger", async () => {
    const migration = await readFile(resolve(__dirname, "../supabase/migrations/20261010120000_onboarding_por_dato_y_usuario.sql"), "utf8");
    await db.exec(`BEGIN; CREATE TABLE public.onboarding_atomic_sentinel (id integer); ${migration} INSERT INTO supabase_migrations.schema_migrations VALUES ('20990101000000', 'dry_run'); ROLLBACK;`);
    const { rows } = await db.query<{ sentinel: string | null; ledger: number }>("SELECT to_regclass('public.onboarding_atomic_sentinel')::text AS sentinel, (SELECT count(*)::integer FROM supabase_migrations.schema_migrations) AS ledger");
    assert.deepEqual(rows[0], { sentinel: null, ledger: 1 });
  });
  await check("reaplicar migración conserva perfiles y progreso existentes", async () => {
    const before = await snapshot(ALICE);
    await db.exec(await readFile(resolve(__dirname, "../supabase/migrations/20261010120000_onboarding_por_dato_y_usuario.sql"), "utf8"));
    assert.deepEqual(await snapshot(ALICE), before);
  });
  console.log(`${checks} comprobaciones aisladas aprobadas. PGlite serializa escrituras; sin prueba multisesión ni remoto.`);
} finally {
  await db.close();
}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
