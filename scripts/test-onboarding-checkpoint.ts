/** Isolated PostgreSQL WASM. No network, accounts or production credentials. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const ALICE = "00000000-0000-4000-8000-000000000001";
const BOB = "00000000-0000-4000-8000-000000000002";
const CAROL = "00000000-0000-4000-8000-000000000003";
const operation = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let count = 0;
async function check(name: string, fn: () => Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }
async function asUser(id: string | null) { await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]); }
async function code(fn: () => Promise<unknown>, expected: string) {
  await assert.rejects(fn, (error: unknown) => (error as { code?: string }).code === expected);
}
async function result(sql: string, args: unknown[] = []) { return (await db.query<{ value: any }>(sql, args)).rows[0].value; }
async function checkpoint(n: number, revision: number, fields: object = {}, next = "usuario", camino = "vender", from?: string) {
  const source = from ?? ({ username: "usuario", nombre: "nombre", nombre_negocio: "nombre", bio: "descripcion", descripcion_negocio: "descripcion",
    foto: "foto", intereses: "intereses", categoria_negocio: "categoria", seller_type: "tipo", metodos_pago_aceptados: "pagos" } as Record<string, string>)[Object.keys(fields)[0]] ?? "usuario";
  return result("SELECT guardar_checkpoint_onboarding_v3($1,$2,$3,$4,$5,$6) AS value", [operation(n), revision, source, next, camino, fields]);
}
async function finish(n: number, revision: number, decision = "activar") {
  return result("SELECT finalizar_onboarding_v3($1,$2,$3) AS value", [operation(n), revision, decision]);
}
async function profile(id = ALICE) { return result("SELECT to_jsonb(p) AS value FROM profiles p WHERE id=$1", [id]); }
async function confirm() { await db.query("SELECT confirmar_documentos_cuenta('1.1','2.2',true,true)"); }
async function migration(name: string) { return readFile(resolve(__dirname, "../supabase/migrations", name), "utf8"); }

async function main() {
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE TABLE profiles(id uuid PRIMARY KEY,user_id text UNIQUE,nombre text NOT NULL DEFAULT 'Vecino',bio text,foto text,
        ubicacion text,es_vendedor boolean DEFAULT false,has_seen_onboarding boolean DEFAULT false,seller_type text DEFAULT 'casual',
        categoria_negocio text,nombre_negocio text,descripcion_negocio text,metodos_pago_aceptados text,alta_vendedor_paso text);
      ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
      CREATE TABLE categories(slug text PRIMARY KEY,activo boolean NOT NULL);
      INSERT INTO categories VALUES('comida',true),('hogar',true),('desactivada',false);
      CREATE TABLE products_services(creador_id uuid,estatus text);
    `);
    for (const name of ["20260521000011_rpc_update_profile_and_pause.sql", "20260826250000_profiles_username_editable.sql",
      "20260826251000_rpc_set_username.sql", "20260905100000_onboarding_por_pasos.sql",
      "20260714000002_onboarding_rpc_fail_loudly.sql", "20260903240000_registro_manual_activar_modo_vendedor.sql",
      "20260826380000_registro_y_aviso_de_cambios_legales.sql", "20261010120000_onboarding_por_dato_y_usuario.sql"])
      await db.exec(await migration(name));
    await db.query("INSERT INTO profiles(id,user_id,nombre) VALUES($1,'U0000001','Alice'),($2,'U0000002','Bob'),($3,'U0000003','Carol')", [ALICE, BOB, CAROL]);
    await db.query("INSERT INTO legal_acceptances(user_id,documento,version,modo,aceptado_en) VALUES($1,'terminos','1.1','uso_continuado','2026-09-01T00:00:00Z')", [ALICE]);
    await db.exec(await migration("20261011120000_confirmacion_cuenta_y_checkpoint.sql"));
    const storeGuard = await migration("20261003213000_identidad_publica_modo_tienda.sql");
    await db.exec(storeGuard.slice(storeGuard.indexOf("CREATE OR REPLACE FUNCTION public.require_store_name()")));
    await asUser(ALICE);

    await check("historial automático no confirma y RPC vieja no añade aprobación", async () => {
      assert.equal((await result("SELECT estado_confirmacion_legal() AS value")).confirmed, false);
      await db.query("SELECT * FROM registrar_aceptacion_legal('expreso')");
      assert.equal((await db.query("SELECT * FROM legal_acceptances")).rows.length, 1);
      await code(() => checkpoint(1, 0), "42501");
      await code(() => db.query("SELECT guardar_paso_onboarding_v2(p_nombre=>'Cambio')"), "42501");
      await code(() => db.query("SELECT complete_user_onboarding()"), "42501");
    });
    await check("requiere ambas casillas, versión vista vigente y transacción legal completa", async () => {
      await code(() => db.query("SELECT confirmar_documentos_cuenta('1.1','2.2',false,true)"), "22023");
      await code(() => db.query("SELECT confirmar_documentos_cuenta('0.0','2.2',true,true)"), "22023");
      assert.equal((await db.query("SELECT * FROM legal_acceptances")).rows.length, 1);
      await confirm();
      const prior = await result("SELECT to_jsonb(a) AS value FROM legal_acceptances a WHERE documento='terminos'");
      assert.equal(prior.modo, "uso_continuado"); assert.equal(new Date(prior.aceptado_en).toISOString(), "2026-09-01T00:00:00.000Z");
      assert.equal(prior.confirmacion_tipo, "aceptacion_terminos");
      assert.equal(prior.confirmacion_origen, "confirmar_cuenta");
      await confirm();
      assert.equal((await result("SELECT to_jsonb(a) AS value FROM legal_acceptances a WHERE documento='terminos'")).confirmacion_en, prior.confirmacion_en);
      assert.equal((await result("SELECT estado_confirmacion_legal() AS value")).confirmed, true);
    });
    await check("cambiar de recorrido usa el contrato v3 existente, preserva legales y recupera el mismo recibo", async () => {
      await asUser(CAROL); await confirm();
      const legal = await result("SELECT jsonb_agg(a) AS value FROM legal_acceptances a WHERE user_id=auth.uid()");
      const original = await profile(CAROL);
      const seller = await checkpoint(201, 0, {}, "categoria", "vender", "usuario");
      assert.equal(seller.revision, 1); assert.equal(seller.paso, "categoria");
      const category = await checkpoint(202, 1, { categoria_negocio: "comida" }, "tipo", "vender", "categoria");
      const buyer = await checkpoint(203, category.revision, {}, "usuario", "explorar", "tipo");
      assert.equal(buyer.camino, "explorar"); assert.equal(buyer.revision, 3);
      assert.equal(buyer.snapshot.categoria_negocio, "comida"); assert.equal(buyer.snapshot.username, original.username);
      assert.deepEqual(await checkpoint(203, 2, {}, "usuario", "explorar", "tipo"), buyer);
      assert.equal((await profile(CAROL)).onboarding_revision, 3);
      const stale = await checkpoint(204, 2, {}, "categoria", "vender", "tipo");
      assert.equal(stale.status, "conflict"); assert.equal(stale.camino, "explorar");
      assert.deepEqual(await result("SELECT jsonb_agg(a) AS value FROM legal_acceptances a WHERE user_id=auth.uid()"), legal);
      await asUser(ALICE);
    });
    await check("la pantalla sólo guarda su dato y límites no crean recibos ni cambios", async () => {
      const before = await profile();
      await code(() => checkpoint(15, 0, { nombre: "Nombre ajeno" }, "nombre", "vender", "usuario"), "22023");
      await code(() => checkpoint(15, 0, { username: "otro" }, "nombre", "vender", "ubicacion"), "22023");
      await code(() => checkpoint(15, 0, {}, "nombre", "vender", "inventada"), "22023");
      await code(() => checkpoint(15, 2147483647, {}), "22023");
      assert.deepEqual(await profile(), before);
      assert.equal((await db.query("SELECT * FROM onboarding_operation_receipts WHERE operation_id=$1", [operation(15)])).rows.length, 0);
    });
    await check("checkpoint username multiescritura = +1 y replay idéntico devuelve recibo", async () => {
      const saved = await checkpoint(2, 0, { username: "alice_2026" }, "nombre");
      assert.equal(saved.revision, 1); assert.equal(saved.snapshot.username, "alice_2026");
      assert.deepEqual(await checkpoint(2, 0, { username: "alice_2026" }, "nombre"), saved);
      assert.equal((await profile()).onboarding_revision, 1);
      await code(() => checkpoint(2, 0, { username: "different" }, "nombre"), "22023");
    });
    await check("Omitir no-op incrementa una vez y recibo antiguo no revierte nuevos datos", async () => {
      const saved = await checkpoint(3, 1, {}, "nombre");
      assert.equal(saved.revision, 2);
      const later = await checkpoint(4, 2, { nombre: "Alice nueva" }, "foto");
      assert.equal(later.revision, 3);
      const oldReceipt = await checkpoint(2, 0, { username: "alice_2026" }, "nombre");
      assert.equal(oldReceipt.revision, 1);
      assert.equal((await profile()).nombre, "Alice nueva");
      assert.equal((await profile()).onboarding_revision, 3);
    });
    await check("dos operaciones misma revisión: sólo una escribe, la otra obtiene conflicto", async () => {
      const first = await checkpoint(5, 3, { categoria_negocio: "comida" }, "tipo");
      const second = await checkpoint(6, 3, { categoria_negocio: "hogar" }, "tipo");
      assert.equal(first.status, "saved"); assert.equal(second.status, "conflict");
      assert.equal(second.revision, 4); assert.equal(second.snapshot.categoria_negocio, "comida");
      assert.equal((await db.query("SELECT * FROM onboarding_operation_receipts WHERE operation_id=$1", [operation(6)])).rows.length, 0);
    });
    await check("negocio tipo+paso incrementa sólo una y final sin nombre revierte todo", async () => {
      const type = await checkpoint(7, 4, { seller_type: "business" }, "usuario");
      assert.equal(type.revision, 5);
      const before = await profile();
      await code(() => checkpoint(15, 5, { nombre: "No es el negocio" }, "foto", "vender", "nombre"), "22023");
      await code(() => finish(8, 5), "22023");
      assert.deepEqual(await profile(), before);
      assert.equal((await db.query("SELECT * FROM onboarding_operation_receipts WHERE operation_id=$1", [operation(8)])).rows.length, 0);
    });
    await check("final consciente activa+completa+limpia atómicamente, doble envío no repite", async () => {
      await checkpoint(9, 5, { nombre_negocio: "Tienda Alice" }, "listo");
      const before = await profile();
      await db.exec(`ALTER TABLE onboarding_operation_receipts ADD CONSTRAINT fixture_receipt_failure CHECK(operation_id <> '${operation(10)}'::uuid)`);
      await code(() => finish(10, 6), "23514");
      assert.deepEqual(await profile(), before, "receipt failure rolls back activation, completion and visibility evidence");
      await db.exec("ALTER TABLE onboarding_operation_receipts DROP CONSTRAINT fixture_receipt_failure");
      const final = await finish(10, 6);
      assert.equal(final.revision, 7); assert.equal(final.snapshot.es_vendedor, true);
      assert.equal(final.snapshot.has_seen_onboarding, true); assert.equal(final.snapshot.onboarding_paso, null);
      const at = (await profile()).seller_visibility_confirmed_at;
      assert.ok(at); assert.deepEqual(await finish(10, 6), final);
      assert.equal((await profile()).seller_visibility_confirmed_at, at);
      await code(() => finish(10, 6, "explorar"), "22023");
    });
    await check("otra cuenta no puede leer/reutilizar recibos de Alice", async () => {
      await asUser(BOB); await confirm();
      const other = await checkpoint(2, 0, { username: "bob_2026" }, "nombre", "explorar");
      assert.equal(other.snapshot.id, BOB); assert.equal(other.revision, 1);
      assert.equal((await profile()).username, "alice_2026");
    });
    await check("explorar usa nombre y bio personales aunque haya un borrador business", async () => {
      await db.query("UPDATE profiles SET seller_type='business',nombre_negocio='Borrador previo' WHERE id=$1", [BOB]);
      const before = await profile(BOB);
      assert.equal(before.onboarding_revision, 2);
      await code(() => checkpoint(13, 2, { nombre_negocio: "No confirmar" }, "foto", "explorar", "nombre"), "22023");
      const personal = await checkpoint(13, 2, { nombre: "Bob vecino" }, "foto", "explorar", "nombre");
      assert.equal(personal.revision, 3); assert.equal(personal.snapshot.nombre, "Bob vecino");
      assert.equal(personal.snapshot.nombre_negocio, "Borrador previo");
      await code(() => checkpoint(14, 3, { descripcion_negocio: "No confirmar" }, "intereses", "explorar", "descripcion"), "22023");
      const bio = await checkpoint(14, 3, { bio: "Compro cerca" }, "intereses", "explorar", "descripcion");
      assert.equal(bio.revision, 4); assert.equal(bio.snapshot.bio, "Compro cerca");
      assert.equal(bio.snapshot.descripcion_negocio, null);
    });
    await check("explorar no activa vendedor; conversión posterior registra visibilidad explícita", async () => {
      await code(() => db.query("SELECT update_profile_and_pause_products($1,'Bob',null,null,null,true,'casual',null,null,null)", [BOB]), "42501");
      assert.equal((await profile(BOB)).es_vendedor, false);
      const final = await finish(11, 4, "explorar");
      assert.equal(final.snapshot.es_vendedor, false);
      await db.query("SELECT activar_modo_vendedor('comida','casual')");
      assert.equal((await profile(BOB)).es_vendedor, true);
      assert.ok((await profile(BOB)).seller_visibility_confirmed_at);
    });
    await check("cambio de versión vuelve a pedir confirmación pero permite desactivar", async () => {
      await db.exec("INSERT INTO legal_documents(documento,version,publicado_en,vigente_desde,resumen) VALUES('terminos','1.2',now(),now(),'Prueba local')");
      assert.equal((await result("SELECT estado_confirmacion_legal() AS value")).confirmed, false);
      await code(() => db.query("SELECT activar_modo_vendedor('comida','casual')"), "42501");
      await code(() => db.query("SELECT confirmar_documentos_cuenta('1.1','2.2',true,true)"), "22023");
      await db.query("SELECT update_profile_and_pause_products($1,'Bob',null,null,null,false,'casual',null,null,null)", [BOB]);
      assert.equal((await profile(BOB)).es_vendedor, false);
    });
    await check("permisos: no escritura cliente ni ejecución de helpers internos", async () => {
      const allowed = await result("SELECT has_table_privilege('authenticated','onboarding_operation_receipts','INSERT') AS value");
      assert.equal(allowed, false);
      assert.equal(await result("SELECT has_column_privilege('authenticated','profiles','onboarding_revision','UPDATE') AS value"), false);
      assert.equal(await result("SELECT has_function_privilege('authenticated','guardar_paso_onboarding_v2_internal(text,text,text,text,text,text[],text,text,text,text,text,text)','EXECUTE') AS value"), false);
      assert.equal(await result("SELECT has_function_privilege('anon','finalizar_onboarding_v3(uuid,integer,text)','EXECUTE') AS value"), false);
      assert.equal(await result("SELECT has_function_privilege('anon','guardar_paso_onboarding(text,text,text,text,text,text[])','EXECUTE') AS value"), false);
      assert.equal(await result("SELECT has_function_privilege('authenticated','guardar_paso_onboarding(text,text,text,text,text,text[])','EXECUTE') AS value"), true);
    });
    await check("anónimo no confirma ni finaliza", async () => {
      await asUser(null);
      await code(() => db.query("SELECT confirmar_documentos_cuenta('1.1','2.2',true,true)"), "42501");
      await code(() => finish(12, 0, "explorar"), "42501");
    });
    console.log(`${count} SQL checks passed (isolated PGlite).`);
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
