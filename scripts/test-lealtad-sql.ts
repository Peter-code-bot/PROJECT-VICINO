/**
 * Motor de lealtad (20261020120000_tarjetas_de_lealtad.sql) en PostgreSQL
 * real por WASM (PGlite). Sin red, sin credenciales, sin tocar Supabase.
 *
 * Se aplican las migraciones REALES de sale_confirmations y del nombre
 * publico; lo demas (auth, roles, profiles minimos, guard de suspension) se
 * sustituye por lo minimo que el motor necesita. PGlite tiene una sola
 * conexion: esto no prueba concurrencia real ni el servicio remoto.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/test-lealtad-sql.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(__dirname, "..");
const db = new PGlite();
const A = "00000000-0000-4000-8000-00000000000a"; // negocio con programa
const B = "00000000-0000-4000-8000-00000000000b"; // cliente
const C = "00000000-0000-4000-8000-00000000000c"; // otro cliente
const D = "00000000-0000-4000-8000-00000000000d"; // otro vendedor
const E = "00000000-0000-4000-8000-00000000000e"; // cliente suspendido
const producto = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clave = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Role = "authenticated" | "anon" | "service_role";
let checks = 0;

const migration = (name: string) => readFile(path.join(root, "supabase/migrations", name), "utf8");

async function como<T = Record<string, unknown>>(actor: string | null, sql: string, params: unknown[] = [], role: Role = "authenticated") {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor ?? ""]);
    const result = await db.query<T>(sql, params);
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}
async function rpc(actor: string | null, fn: string, args: unknown[] = [], role: Role = "authenticated") {
  const marcas = args.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await como<{ value: any }>(actor, `SELECT public.${fn}(${marcas}) AS value`, args, role);
  return rows[0]?.value;
}
async function admin<T = any>(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<T>(sql, params);
  return rows;
}
async function escalar(sql: string, params: unknown[] = []) {
  const rows = await admin(sql, params);
  const valor = Object.values(rows[0] ?? {})[0] as any;
  // count(*) llega como bigint o number segun la version de PGlite.
  return typeof valor === "bigint" ? Number(valor) : valor;
}
async function rechaza(run: () => Promise<unknown>, code: string, hint?: string) {
  await assert.rejects(run, (error: any) => {
    const ok = error.code === code && (!hint || error.hint === hint);
    if (!ok) console.error(`  esperaba ${code}${hint ? "/" + hint : ""}, llego ${error.code}/${error.hint}: ${error.message}`);
    return ok;
  });
}
async function test(name: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log(`PASS ${name}`);
}

/** Venta vendedor->comprador que ambos confirman (mismo camino que confirmar_venta). */
async function ventaCompletada(seller: string, buyer: string, n: number) {
  const [row] = await admin<{ id: string }>(
    `INSERT INTO sale_confirmations (product_id, buyer_id, seller_id, precio_acordado, initiated_by)
     VALUES ($1,$2,$3, 100, $2) RETURNING id`,
    [producto(n), buyer, seller],
  );
  await admin("UPDATE sale_confirmations SET seller_confirmed = true, seller_confirmed_at = now() WHERE id = $1", [row.id]);
  const status = await escalar("SELECT status FROM sale_confirmations WHERE id = $1", [row.id]);
  assert.equal(status, "completed");
  return row.id;
}
const saldo = (m: string) => escalar("SELECT sellos_disponibles FROM loyalty_memberships WHERE id = $1", [m]);
const fila = (tabla: string, id: string) => escalar(`SELECT to_jsonb(t) FROM ${tabla} t WHERE id = $1`, [id]);

async function fixture() {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    CREATE TYPE sale_status AS ENUM ('pending_confirmation','completed','cancelled','expired');
    CREATE TABLE profiles(id uuid PRIMARY KEY, nombre text NOT NULL DEFAULT 'Vecino',
      es_vendedor boolean DEFAULT false, seller_type text DEFAULT 'casual', nombre_negocio text,
      foto text, is_hidden boolean NOT NULL DEFAULT false,
      trust_points integer NOT NULL DEFAULT 0, total_sales integer NOT NULL DEFAULT 0);
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    CREATE TABLE user_roles(user_id uuid, role text);
    CREATE TABLE products_services(id uuid PRIMARY KEY, creador_id uuid REFERENCES profiles(id),
      ventas_count integer NOT NULL DEFAULT 0);
    CREATE FUNCTION handle_updated_at() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
    CREATE SCHEMA vicino_guard;
    GRANT USAGE ON SCHEMA vicino_guard TO anon, authenticated;
    CREATE FUNCTION vicino_guard.cuenta_suspendida() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
      $$ SELECT coalesce((SELECT is_hidden FROM public.profiles WHERE id = auth.uid()), false) $$;
    GRANT EXECUTE ON FUNCTION vicino_guard.cuenta_suspendida() TO anon, authenticated;
  `);
  await db.exec(await migration("20260320000007_sale_confirmations.sql"));
  const identidad = await migration("20261003213000_identidad_publica_modo_tienda.sql");
  const inicio = identidad.indexOf("CREATE OR REPLACE FUNCTION public.profile_public_name(");
  const fin = identidad.indexOf("$name$;", inicio) + "$name$;".length;
  assert.ok(inicio > -1 && fin > inicio, "No se encontro profile_public_name");
  await db.exec(identidad.slice(inicio, fin));
  await db.exec(await migration("20261020120000_tarjetas_de_lealtad.sql"));
  await db.query(
    `INSERT INTO profiles(id, nombre, es_vendedor, seller_type, nombre_negocio, is_hidden) VALUES
      ($1,'Ana',true,'business','Café Strudel',false),
      ($2,'Beto Ramírez Soto',false,'casual',NULL,false),
      ($3,'Carla',false,'casual',NULL,false),
      ($4,'Dani',true,'casual',NULL,false),
      ($5,'Eli',false,'casual',NULL,true)`,
    [A, B, C, D, E],
  );
  for (let n = 1; n <= 40; n++) await db.query("INSERT INTO products_services(id, creador_id) VALUES ($1,$2)", [producto(n), n <= 30 ? A : D]);
}

async function main() {
  await fixture();
  let programa: any;
  let membresiaB: string;
  let membresiaC: string;

  await test("solo un vendedor crea programa; borrador sin versiones; publicar crea v1; cambiar reglas crea v2", async () => {
    await rechaza(() => rpc(B, "loyalty_programa_guardar", ["Tarjeta", "Café", 5]), "42501");
    await rechaza(() => rpc(A, "loyalty_programa_guardar", ["", "Café", 5]), "22023");
    await rechaza(() => rpc(A, "loyalty_programa_guardar", ["Tarjeta", "Café", 2]), "22023");
    await rechaza(() => rpc(A, "loyalty_programa_guardar", ["Tarjeta", "Café", 5, null, "rojo"]), "22023");
    programa = await rpc(A, "loyalty_programa_guardar", ["  Tarjeta Strudel ", "1 café americano", 5, " Solo en sucursal ", "#1F5A4E", "sellos"]);
    assert.equal(programa.status, "borrador");
    assert.equal(programa.nombre, "Tarjeta Strudel");
    assert.equal(programa.condiciones, "Solo en sucursal");
    assert.equal(programa.version_actual, 0);
    const otra = await rpc(A, "loyalty_programa_guardar", ["Tarjeta Strudel", "1 café grande", 5]);
    assert.equal(otra.id, programa.id, "un solo programa por negocio");
    assert.equal(otra.version_actual, 0);
    assert.equal(await escalar("SELECT count(*) FROM loyalty_program_versions"), 0);
    await rechaza(() => rpc(A, "loyalty_programa_estado", ["pausado"]), "PT409", "transicion_invalida");
    await rechaza(() => rpc(A, "loyalty_programa_estado", ["archivado"]), "22023");
    programa = await rpc(A, "loyalty_programa_estado", ["activo"]);
    assert.equal(programa.status, "activo");
    assert.equal(programa.version_actual, 1);
    assert.ok(programa.publicado_at);
    programa = await rpc(A, "loyalty_programa_guardar", ["Tarjeta Strudel", "1 café americano", 5, "Solo en sucursal", "#2E8773", "clasica"]);
    assert.equal(programa.version_actual, 2, "cambiar el premio versiona");
    programa = await rpc(A, "loyalty_programa_guardar", ["Tarjeta Strudel", "1 café americano", 5, "Solo en sucursal", "#1F5A4E", "clasica"]);
    assert.equal(programa.version_actual, 2, "cambiar solo el color no versiona");
    assert.equal(await escalar("SELECT count(*) FROM loyalty_program_versions WHERE program_id = $1", [programa.id]), 2);
    const mismo = await rpc(A, "loyalty_programa_estado", ["activo"]);
    assert.equal(mismo.version_actual, 2, "publicar de nuevo es idempotente");
  });

  await test("las versiones publicadas son inmutables", async () => {
    await rechaza(() => db.query("UPDATE loyalty_program_versions SET nombre = 'x'"), "42501");
  });

  await test("lectura: anon y clientes ven solo programas activos; el dueño ve su borrador", async () => {
    const borradorD = await rpc(D, "loyalty_programa_guardar", ["Tarjeta Dani", "Descuento", 3]);
    assert.equal(borradorD.status, "borrador");
    const anon = await como<{ id: string }>(null, "SELECT id FROM loyalty_programs", [], "anon");
    assert.deepEqual(anon.rows.map((r) => r.id), [programa.id]);
    const b = await como<{ id: string }>(B, "SELECT id FROM loyalty_programs");
    assert.deepEqual(b.rows.map((r) => r.id), [programa.id]);
    const d = await como<{ id: string }>(D, "SELECT id FROM loyalty_programs ORDER BY created_at");
    assert.deepEqual(d.rows.map((r) => r.id), [programa.id, borradorD.id]);
    await rechaza(() => como(null, "INSERT INTO loyalty_programs(seller_id, nombre, premio) VALUES ($1,'x','y')", [A], "anon"), "42501");
    await rechaza(() => como(B, "INSERT INTO loyalty_programs(seller_id, nombre, premio) VALUES ($1,'x','y')", [B]), "42501");
    await rechaza(() => como(A, "UPDATE loyalty_programs SET meta_sellos = 3 WHERE id = $1", [programa.id]), "42501");
  });

  await test("inscripción idempotente; ni el dueño ni un suspendido ni anon", async () => {
    await rechaza(() => rpc(A, "loyalty_inscribirse", [programa.id]), "PT409", "propio_programa");
    await rechaza(() => rpc(E, "loyalty_inscribirse", [programa.id]), "42501");
    await rechaza(() => rpc(null, "loyalty_inscribirse", [programa.id], "anon"), "42501");
    await rechaza(() => rpc(B, "loyalty_inscribirse", ["10000000-0000-4000-8000-000000000099"]), "PT404");
    const una = await rpc(B, "loyalty_inscribirse", [programa.id]);
    const dos = await rpc(B, "loyalty_inscribirse", [programa.id]);
    assert.equal(una.membership.id, dos.membership.id);
    assert.equal(una.membership.version_aceptada, 2);
    assert.match(una.membership.public_id, /^vl_[0-9a-f]{32}$/);
    assert.equal(una.program.seller_id, A);
    assert.equal(await escalar("SELECT count(*) FROM loyalty_memberships WHERE customer_profile_id = $1", [B]), 1);
    membresiaB = una.membership.id;
    membresiaC = (await rpc(C, "loyalty_inscribirse", [programa.id])).membership.id;
  });

  await test("una venta completada da UN sello; repetir no duplica; la recuperación manual es idempotente", async () => {
    const venta = await ventaCompletada(A, B, 1);
    assert.equal(await saldo(membresiaB), 1);
    await admin("UPDATE sale_confirmations SET notas = 'otra vez' WHERE id = $1", [venta]);
    assert.equal(await saldo(membresiaB), 1);
    const manual = await rpc(A, "loyalty_sello_desde_venta", [venta]);
    assert.equal(manual.ok, true);
    assert.equal(manual.repeated, true);
    assert.equal(await saldo(membresiaB), 1);
    await rechaza(() => rpc(D, "loyalty_sello_desde_venta", [venta]), "PT404");
    const eventos = await admin("SELECT tipo, sellos, origen_tipo, origen_id FROM loyalty_events WHERE membership_id = $1", [membresiaB]);
    assert.deepEqual(eventos, [{ tipo: "earn", sellos: 1, origen_tipo: "sale_confirmation", origen_id: venta }]);
    // Sin membresía: la venta se completa igual y no hay sello.
    const ventaD = await ventaCompletada(D, B, 31);
    assert.equal((await rpc(D, "loyalty_sello_desde_venta", [ventaD])).motivo, "sin_programa_activo");
    assert.equal(await saldo(membresiaB), 1);
  });

  await test("RLS: cada cliente ve su membresía y sus eventos; el negocio ve las de su programa", async () => {
    const verB = await como<{ id: string }>(B, "SELECT id FROM loyalty_memberships");
    assert.deepEqual(verB.rows.map((r) => r.id), [membresiaB]);
    const verC = await como<{ id: string }>(C, "SELECT id FROM loyalty_memberships");
    assert.deepEqual(verC.rows.map((r) => r.id), [membresiaC]);
    const verA = await como<{ id: string }>(A, "SELECT id FROM loyalty_memberships ORDER BY created_at");
    assert.deepEqual(verA.rows.map((r) => r.id), [membresiaB, membresiaC]);
    const verD = await como<{ id: string }>(D, "SELECT id FROM loyalty_memberships");
    assert.equal(verD.rows.length, 0);
    assert.equal((await como(C, "SELECT id FROM loyalty_events")).rows.length, 0);
    assert.equal((await como(B, "SELECT id FROM loyalty_events")).rows.length, 1);
    assert.equal((await como(A, "SELECT id FROM loyalty_events")).rows.length, 1);
    await rechaza(() => como(null, "SELECT id FROM loyalty_memberships", [], "anon"), "42501");
    await rechaza(() => como(B, "SELECT id FROM loyalty_redemptions"), "42501");
    await rechaza(() => como(B, "SELECT id FROM wallet_passes"), "42501");
    await rechaza(() => como(B, "UPDATE loyalty_memberships SET sellos_disponibles = 99 WHERE id = $1", [membresiaB]), "42501");
    await rechaza(() => como(B, "SELECT nombre FROM profiles"), "42501");
  });

  await test("canje: saldo insuficiente, inicio idempotente, confirmación atómica y doble lectura", async () => {
    await rechaza(() => rpc(B, "loyalty_canje_iniciar", [membresiaB, clave(1)]), "PT409", "sellos_insuficientes");
    for (let n = 2; n <= 5; n++) await ventaCompletada(A, B, n);
    assert.equal(await saldo(membresiaB), 5);
    // B acepto la version 2 (meta 5). El negocio sube la meta a 10 (version 3):
    // a B se le cobra 5, la meta vigente se le cobra a quien entre despues.
    const subida = await rpc(A, "loyalty_programa_guardar", ["Tarjeta Strudel", "1 café americano", 10, "Solo en sucursal", "#1F5A4E", "clasica"]);
    assert.equal(subida.version_actual, 3);
    assert.equal((await rpc(B, "loyalty_mi_tarjeta", [membresiaB])).meta_canje, 5);
    const inicio = await rpc(B, "loyalty_canje_iniciar", [membresiaB, clave(1)]);
    assert.equal(inicio.repeated, false);
    assert.match(inicio.redemption.codigo, /^[0-9]{6}$/);
    assert.equal(inicio.redemption.costo_sellos, 5);
    assert.equal(inicio.redemption.premio, "1 café americano");
    const repetido = await rpc(B, "loyalty_canje_iniciar", [membresiaB, clave(1)]);
    assert.equal(repetido.repeated, true);
    assert.equal(repetido.redemption.id, inicio.redemption.id);
    const otraClave = await rpc(B, "loyalty_canje_iniciar", [membresiaB, clave(2)]);
    assert.equal(otraClave.redemption.id, inicio.redemption.id, "un solo canje pendiente");
    await rechaza(() => rpc(C, "loyalty_canje_iniciar", [membresiaB, clave(3)]), "PT404");
    const tarjeta = await rpc(B, "loyalty_mi_tarjeta", [membresiaB]);
    assert.equal(tarjeta.canje_pendiente.codigo, inicio.redemption.codigo);
    assert.equal(tarjeta.negocio.nombre, "Café Strudel");
    assert.equal(tarjeta.cliente.nombre, "Beto", "solo el primer nombre viaja al pase");
    assert.equal(tarjeta.program.meta_sellos, 10, "la meta vigente es 10");
    assert.equal(tarjeta.meta_canje, 5, "pero a B se le cobra la meta que acepto");
    await rechaza(() => rpc(C, "loyalty_mi_tarjeta", [membresiaB]), "PT404");
    await rechaza(() => rpc(D, "loyalty_canje_confirmar", [inicio.redemption.codigo]), "PT404");
    await rechaza(() => rpc(B, "loyalty_canje_confirmar", [inicio.redemption.codigo]), "PT404");
    await rechaza(() => rpc(A, "loyalty_canje_confirmar", ["12345"]), "22023");
    const confirmado = await rpc(A, "loyalty_canje_confirmar", [inicio.redemption.codigo]);
    assert.equal(confirmado.repeated, false);
    assert.equal(confirmado.cliente, "Beto");
    assert.equal(confirmado.redemption.status, "canjeado");
    assert.equal(confirmado.redemption.confirmed_by, A);
    assert.equal(await saldo(membresiaB), 0);
    const m = await fila("loyalty_memberships", membresiaB);
    assert.equal(m.premios_canjeados, 1);
    assert.equal(m.sellos_totales, 5);
    assert.equal(m.version_aceptada, 3, "tras canjear, la tarjeta pasa a las reglas vigentes");
    assert.equal((await rpc(B, "loyalty_mi_tarjeta", [membresiaB])).meta_canje, 10);
    // De vuelta a 5 para el resto de la prueba (version 4).
    assert.equal((await rpc(A, "loyalty_programa_guardar", ["Tarjeta Strudel", "1 café americano", 5, "Solo en sucursal", "#1F5A4E", "clasica"])).version_actual, 4);
    const otraVez = await rpc(A, "loyalty_canje_confirmar", [inicio.redemption.codigo]);
    assert.equal(otraVez.repeated, true);
    assert.equal(otraVez.redemption.id, inicio.redemption.id);
    assert.equal(await saldo(membresiaB), 0, "la doble lectura no descuenta dos veces");
    const redeem = await admin("SELECT sellos FROM loyalty_events WHERE membership_id = $1 AND tipo = 'redeem'", [membresiaB]);
    assert.deepEqual(redeem, [{ sellos: -5 }]);
  });

  await test("canje vencido se rechaza y expira; cancelar es del titular e idempotente", async () => {
    for (let n = 6; n <= 10; n++) await ventaCompletada(A, B, n);
    const inicio = await rpc(B, "loyalty_canje_iniciar", [membresiaB, clave(3)]);
    await admin("UPDATE loyalty_redemptions SET expires_at = now() - interval '1 minute' WHERE id = $1", [inicio.redemption.id]);
    await rechaza(() => rpc(A, "loyalty_canje_confirmar", [inicio.redemption.codigo]), "PT409", "codigo_expirado");
    const tarjeta = await rpc(B, "loyalty_mi_tarjeta", [membresiaB]);
    assert.equal(tarjeta.canje_pendiente, null);
    assert.equal((await fila("loyalty_redemptions", inicio.redemption.id)).status, "expirado");
    assert.equal(await saldo(membresiaB), 5);
    const nuevo = await rpc(B, "loyalty_canje_iniciar", [membresiaB, clave(4)]);
    assert.notEqual(nuevo.redemption.id, inicio.redemption.id);
    await rechaza(() => rpc(C, "loyalty_canje_cancelar", [nuevo.redemption.id]), "PT404");
    assert.equal((await rpc(B, "loyalty_canje_cancelar", [nuevo.redemption.id])).status, "cancelado");
    assert.equal((await rpc(B, "loyalty_canje_cancelar", [nuevo.redemption.id])).status, "cancelado");
    await rechaza(() => rpc(A, "loyalty_canje_confirmar", [nuevo.redemption.codigo]), "PT404", "codigo_no_encontrado");
    assert.equal(await saldo(membresiaB), 5);
  });

  await test("canje con programa en pausa: no inicia, pero sí se confirma el pendiente", async () => {
    const pendiente = await rpc(B, "loyalty_canje_iniciar", [membresiaB, clave(5)]);
    assert.equal((await rpc(A, "loyalty_programa_estado", ["pausado"])).status, "pausado");
    await rechaza(() => rpc(C, "loyalty_inscribirse", [programa.id]), "PT404");
    const confirmado = await rpc(A, "loyalty_canje_confirmar", [pendiente.redemption.codigo]);
    assert.equal(confirmado.redemption.status, "canjeado");
    assert.equal(await saldo(membresiaB), 0);
    await ventaCompletada(A, B, 11);
    assert.equal(await saldo(membresiaB), 0, "en pausa no se acumulan sellos");
    assert.equal((await rpc(A, "loyalty_programa_estado", ["activo"])).status, "activo");
    assert.equal((await rpc(A, "loyalty_sello_desde_venta", [await escalar("SELECT id FROM sale_confirmations WHERE product_id = $1", [producto(11)])])).repeated, false);
    assert.equal(await saldo(membresiaB), 1);
  });

  await test("reversa: compensa, una vez por evento, y se bloquea si el sello ya se canjeó", async () => {
    const venta = await ventaCompletada(A, C, 12);
    assert.equal(await saldo(membresiaC), 1);
    const [earn] = await admin<{ id: string }>("SELECT id FROM loyalty_events WHERE origen_id = $1", [venta]);
    await rechaza(() => rpc(D, "loyalty_revertir_evento", [earn.id]), "PT404");
    const reversa = await rpc(A, "loyalty_revertir_evento", [earn.id, "Compra cancelada"]);
    assert.equal(reversa.tipo, "reverse");
    assert.equal(reversa.sellos, -1);
    assert.equal(reversa.origen_id, earn.id);
    assert.equal(await saldo(membresiaC), 0);
    assert.equal((await fila("loyalty_memberships", membresiaC)).sellos_totales, 0);
    await rechaza(() => rpc(A, "loyalty_revertir_evento", [earn.id]), "PT409", "ya_revertido");
    await rechaza(() => rpc(A, "loyalty_revertir_evento", [reversa.id]), "PT409", "no_reversible");
    // B tiene 1 sello (venta 11): revertirlo deja 0 y es una reversa normal.
    const [ultimo] = await admin<{ id: string }>("SELECT id FROM loyalty_events WHERE membership_id = $1 AND tipo = 'earn' ORDER BY created_at DESC LIMIT 1", [membresiaB]);
    assert.equal((await rpc(A, "loyalty_revertir_evento", [ultimo.id])).sellos, -1);
    assert.equal(await saldo(membresiaB), 0);
    // Sus primeros 5 sellos ya se gastaron en un premio: revertir uno de esos earns choca.
    const [gastado] = await admin<{ id: string }>("SELECT id FROM loyalty_events WHERE membership_id = $1 AND tipo = 'earn' ORDER BY created_at LIMIT 1", [membresiaB]);
    await rechaza(() => rpc(A, "loyalty_revertir_evento", [gastado.id]), "PT409", "ya_canjeado");
    assert.equal(await saldo(membresiaB), 0);
    const [canje] = await admin<{ id: string }>("SELECT id FROM loyalty_events WHERE membership_id = $1 AND tipo = 'redeem' ORDER BY created_at LIMIT 1", [membresiaB]);
    const devuelto = await rpc(A, "loyalty_revertir_evento", [canje.id, "Premio no entregado"]);
    assert.equal(devuelto.sellos, 5);
    assert.equal(await saldo(membresiaB), 5);
    assert.equal((await fila("loyalty_memberships", membresiaB)).premios_canjeados, 1);
  });

  await test("resumen del negocio y tarjetas del cliente", async () => {
    const resumen = await rpc(A, "loyalty_resumen_negocio");
    assert.equal(resumen.program.id, programa.id);
    assert.equal(resumen.metricas.miembros, 2);
    assert.equal(resumen.metricas.canjes, 2);
    assert.equal(resumen.metricas.canjes_pendientes, 0);
    assert.ok(resumen.eventos.length > 0 && resumen.eventos.length <= 20);
    assert.ok(resumen.eventos.every((e: any) => typeof e.cliente === "string"));
    assert.ok(resumen.canjes_recientes.every((r: any) => !("codigo" in r) && typeof r.expires_at === "string"), "los códigos no salen al negocio");
    assert.deepEqual(resumen.ventas_sin_sello, []);
    assert.equal((await rpc(D, "loyalty_resumen_negocio")).program.status, "borrador");
    assert.equal((await rpc(C, "loyalty_resumen_negocio")).program, null);
    const tarjetas = await rpc(B, "loyalty_mis_tarjetas");
    assert.equal(tarjetas.length, 1);
    assert.equal(tarjetas[0].negocio.nombre, "Café Strudel");
    assert.equal(tarjetas[0].program.meta_sellos, 5);
    assert.deepEqual(await rpc(D, "loyalty_mis_tarjetas"), []);
  });

  await test("wallet: sin pase no hay cola; con pase, un trabajo vivo con versión creciente", async () => {
    assert.equal(await escalar("SELECT count(*) FROM wallet_update_jobs"), 0);
    const antes = (await fila("loyalty_memberships", membresiaB)).wallet_version;
    assert.ok(antes > 0);
    await rechaza(() => rpc(B, "wallet_pase_preparar", [membresiaB, "samsung"]), "22023");
    await rechaza(() => rpc(C, "wallet_pase_preparar", [membresiaB, "google"]), "PT404");
    const google = await rpc(B, "wallet_pase_preparar", [membresiaB, "google", "3388.vicino-p", "3388.vicino-m"]);
    assert.equal(google.pass.serial_number, `vicino-${membresiaB}`);
    assert.equal(google.pass.authentication_token, null);
    assert.equal(google.pass.class_id, "3388.vicino-p");
    assert.equal(google.snapshot.negocio.nombre, "Café Strudel");
    assert.equal(google.snapshot.membership.sellos_disponibles, 5);
    const apple = await rpc(B, "wallet_pase_preparar", [membresiaB, "apple"]);
    assert.match(apple.pass.authentication_token, /^[0-9a-f]{64}$/);
    const deNuevo = await rpc(B, "wallet_pase_preparar", [membresiaB, "apple"]);
    assert.equal(deNuevo.pass.authentication_token, apple.pass.authentication_token, "el token se conserva");
    assert.equal(deNuevo.pass.id, apple.pass.id);
    await ventaCompletada(A, B, 13);
    const trabajos = await admin("SELECT membership_id, version, status FROM wallet_update_jobs");
    assert.equal(trabajos.length, 1);
    assert.equal(trabajos[0].status, "pendiente");
    const v1 = (await fila("loyalty_memberships", membresiaB)).wallet_version;
    assert.equal(Number(trabajos[0].version), v1);
    await ventaCompletada(A, B, 14);
    const otra = await admin("SELECT version FROM wallet_update_jobs");
    assert.equal(otra.length, 1, "un solo trabajo vivo");
    assert.equal(Number(otra[0].version), v1 + 1);
  });

  await test("cola: solo service_role; reencola si la versión subió; reintenta con retroceso", async () => {
    await rechaza(() => rpc(B, "wallet_jobs_tomar", [10]), "42501");
    await rechaza(() => rpc(null, "wallet_jobs_tomar", [10], "anon"), "42501");
    const tomados = (await como<any>(null, "SELECT * FROM public.wallet_jobs_tomar(10)", [], "service_role")).rows;
    assert.equal(tomados.length, 1);
    assert.equal(tomados[0].status, "procesando");
    assert.equal(tomados[0].intentos, 1);
    assert.equal((await como(null, "SELECT * FROM public.wallet_jobs_tomar(10)", [], "service_role")).rows.length, 0);
    const version = Number(tomados[0].version);
    await como(null, "SELECT public.wallet_job_terminar($1, $2, true)", [tomados[0].id, version - 1], "service_role");
    assert.equal((await fila("wallet_update_jobs", tomados[0].id)).status, "pendiente", "versión vieja: vuelve a la cola");
    const otraVez = (await como<any>(null, "SELECT * FROM public.wallet_jobs_tomar(10)", [], "service_role")).rows;
    await como(null, "SELECT public.wallet_job_terminar($1, $2, true)", [otraVez[0].id, version], "service_role");
    assert.equal((await fila("wallet_update_jobs", tomados[0].id)).status, "hecho");
    await ventaCompletada(A, B, 15);
    const [nuevo] = (await como<any>(null, "SELECT * FROM public.wallet_jobs_tomar(10)", [], "service_role")).rows;
    await como(null, "SELECT public.wallet_job_terminar($1, $2, false, $3)", [nuevo.id, Number(nuevo.version), "boom"], "service_role");
    const fallo = await fila("wallet_update_jobs", nuevo.id);
    assert.equal(fallo.status, "pendiente");
    assert.equal(fallo.ultimo_error, "boom");
    assert.ok(new Date(fallo.siguiente_intento_at).getTime() > Date.now() + 60_000);
    assert.equal((await como(null, "SELECT * FROM public.wallet_jobs_tomar(10)", [], "service_role")).rows.length, 0, "espera el retroceso");
    await admin("UPDATE wallet_update_jobs SET intentos = 8 WHERE id = $1", [nuevo.id]);
    await como(null, "SELECT public.wallet_job_terminar($1, $2, false, $3)", [nuevo.id, Number(nuevo.version), "otra vez"], "service_role");
    assert.equal((await fila("wallet_update_jobs", nuevo.id)).status, "fallido");
    const snapshot = (await como<any>(null, "SELECT public.wallet_snapshot_membresia($1) AS value", [membresiaB], "service_role")).rows[0].value;
    assert.equal(snapshot.cliente.nombre, "Beto");
    await rechaza(() => rpc(B, "wallet_snapshot_membresia", [membresiaB]), "42501");
  });

  await test("tope de 10 cambios de reglas por día", async () => {
    assert.equal((await rpc(D, "loyalty_programa_estado", ["activo"])).version_actual, 1);
    for (let n = 2; n <= 10; n++) {
      assert.equal((await rpc(D, "loyalty_programa_guardar", ["Tarjeta Dani", `Descuento ${n}`, 3])).version_actual, n);
    }
    await rechaza(() => rpc(D, "loyalty_programa_guardar", ["Tarjeta Dani", "Descuento 11", 3]), "PT409", "demasiadas_versiones");
    assert.equal((await fila("loyalty_programs", (await rpc(D, "loyalty_resumen_negocio")).program.id)).version_actual, 10);
  });

  await test("ventas sin sello: el negocio las ve y las repite; luego desaparecen", async () => {
    const venta = await escalar("SELECT id FROM sale_confirmations WHERE product_id = $1", [producto(12)]);
    await admin("INSERT INTO loyalty_sellos_fallidos(sale_id, seller_id, buyer_id, error) VALUES ($1,$2,$3,'XX000 simulado')", [venta, A, C]);
    const resumen = await rpc(A, "loyalty_resumen_negocio");
    assert.equal(resumen.ventas_sin_sello.length, 1);
    assert.equal(resumen.ventas_sin_sello[0].sale_id, venta);
    await rechaza(() => como(A, "SELECT * FROM loyalty_sellos_fallidos"), "42501");
    const repetido = await rpc(A, "loyalty_sello_desde_venta", [venta]);
    assert.equal(repetido.ok, true);
    assert.equal(repetido.repeated, true, "el sello ya existia (fue revertido, no borrado)");
    assert.deepEqual((await rpc(A, "loyalty_resumen_negocio")).ventas_sin_sello, []);
  });

  await test("Apple: como mucho 5 dispositivos por pase; la cola retoma trabajos atascados", async () => {
    const [pase] = await admin<{ id: string }>("SELECT id FROM wallet_passes WHERE membership_id = $1 AND proveedor = 'apple'", [membresiaB]);
    for (let n = 1; n <= 7; n++) {
      await admin("INSERT INTO apple_device_registrations(device_library_identifier, pass_id, push_token, created_at) VALUES ($1,$2,$3, now() + ($4 || ' seconds')::interval)",
        [`disp-${n}`, pase.id, "ab".repeat(32), String(n)]);
    }
    const dispositivos = await admin<{ device_library_identifier: string }>("SELECT device_library_identifier FROM apple_device_registrations WHERE pass_id = $1 ORDER BY created_at", [pase.id]);
    assert.deepEqual(dispositivos.map((d) => d.device_library_identifier), ["disp-3", "disp-4", "disp-5", "disp-6", "disp-7"]);
    await ventaCompletada(A, B, 16);
    const [trabajo] = (await como<any>(null, "SELECT * FROM public.wallet_jobs_tomar(10)", [], "service_role")).rows;
    assert.equal(trabajo.status, "procesando");
    assert.equal((await como(null, "SELECT * FROM public.wallet_jobs_tomar(10)", [], "service_role")).rows.length, 0, "en proceso: nadie lo toma");
    // handle_updated_at pisa cualquier updated_at: para envejecer el trabajo se apaga el trigger un momento.
    await db.exec("ALTER TABLE wallet_update_jobs DISABLE TRIGGER wallet_update_jobs_updated_at");
    await admin("UPDATE wallet_update_jobs SET updated_at = now() - interval '6 minutes' WHERE id = $1", [trabajo.id]);
    await db.exec("ALTER TABLE wallet_update_jobs ENABLE TRIGGER wallet_update_jobs_updated_at");
    const [retomado] = (await como<any>(null, "SELECT * FROM public.wallet_jobs_tomar(10)", [], "service_role")).rows;
    assert.equal(retomado.id, trabajo.id, "atascado 5 minutos: se retoma");
    assert.equal(retomado.intentos, trabajo.intentos + 1);
    await como(null, "SELECT public.wallet_job_terminar($1, $2, true)", [retomado.id, Number(retomado.version)], "service_role");
  });

  await test("editar un programa publicado encola los pases existentes", async () => {
    const antes = (await fila("loyalty_memberships", membresiaB)).wallet_version;
    await rpc(A, "loyalty_programa_guardar", ["Tarjeta Strudel", "1 café americano", 5, "Solo en sucursal", "#2E8773", "clasica"]);
    assert.equal((await fila("loyalty_memberships", membresiaB)).wallet_version, antes + 1, "cambiar el color toca los pases");
    assert.equal(await escalar("SELECT count(*) FROM wallet_update_jobs WHERE membership_id = $1 AND status = 'pendiente'", [membresiaB]), 1);
    assert.equal(await escalar("SELECT count(*) FROM wallet_update_jobs WHERE membership_id = $1", [membresiaC]), 0, "sin pase no hay cola");
  });

  await test("ninguna función de lealtad quedó duplicada", async () => {
    const dup = await admin(`SELECT p.proname, count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND (p.proname LIKE 'loyalty\\_%' OR p.proname LIKE 'wallet\\_%') GROUP BY 1 HAVING count(*) > 1`);
    assert.deepEqual(dup, []);
  });

  console.log(`PASA ${checks}/${checks} pruebas del motor de lealtad en PGlite. No acredita la migración remota ni la concurrencia real.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => db.close());
