/** Executes the real S04 migration and previous sale/chat triggers in isolated
 * PostgreSQL (PGlite). No remote client, credentials or .env files are loaded.
 * PGlite serializes one connection: this proves SQL/RLS/rollback and stale CAS,
 * not a two-connection deadlock or production Supabase Realtime integration. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const isolatedRequire = createRequire(path.join(root, "package.json"));
const { PGlite } = isolatedRequire(process.env.S04_PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const chat = "10000000-0000-4000-8000-000000000001";
const pa = "20000000-0000-4000-8000-000000000001";
const pb = "20000000-0000-4000-8000-000000000002";
const pc = "20000000-0000-4000-8000-000000000003";
const paused = "20000000-0000-4000-8000-000000000004";
const hidden = "20000000-0000-4000-8000-000000000005";
const deleted = "20000000-0000-4000-8000-000000000006";
let tests = 0;
const migration = (name: string) => readFile(path.join(root, "supabase/migrations", name), "utf8");
async function scalar(sql: string, params: unknown[] = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0] as any;
}
async function asActor(actor: string | null, sql: string, params: unknown[] = []) {
  await db.exec("BEGIN; SET LOCAL ROLE authenticated;");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [actor ?? ""]);
    const result = await scalar(sql, params);
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}
async function rejects(run: () => Promise<unknown>, code: string) {
  await assert.rejects(run, (error: any) => error.code === code);
}
async function test(name: string, run: () => Promise<void>) {
  await run(); tests++; console.log(`PASS ${name}`);
}
const select = (actor: string | null, product: string, revision: number) => asActor(actor,
  "SELECT public.seleccionar_producto_chat($1,$2,$3)", [chat, product, revision]);
const revision = () => scalar("SELECT producto_revision FROM chats WHERE id=$1", [chat]);
const key = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const create = (actor: string | null, product: string, rev: number, id = key(1), price = 25) => asActor(actor,
  "SELECT public.iniciar_confirmacion_venta($1,$2,$3,$4,$5,1,NULL,NULL,'pickup')", [chat, product, rev, id, price]);
const confirm = (actor: string | null, id: string) => asActor(actor, "SELECT public.confirmar_venta($1)", [id]);

async function main() {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth; CREATE SCHEMA vicino_guard;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth, vicino_guard TO authenticated, anon;
    CREATE TYPE sale_status AS ENUM ('pending_confirmation','completed','cancelled','expired');
    CREATE TABLE profiles (id uuid PRIMARY KEY, nombre text, is_hidden boolean NOT NULL DEFAULT false,
      trust_points integer NOT NULL DEFAULT 0, total_sales integer NOT NULL DEFAULT 0);
    CREATE TABLE user_roles (user_id uuid, role text);
    CREATE TABLE user_blocks (blocker_id uuid, blocked_id uuid);
    CREATE TABLE products_services (id uuid PRIMARY KEY, creador_id uuid NOT NULL REFERENCES profiles(id),
      titulo text NOT NULL, precio numeric(10,2), modo_precio text NOT NULL DEFAULT 'fijo',
      imagen_principal text, estatus text DEFAULT 'disponible', is_hidden boolean DEFAULT false,
      ventas_count integer NOT NULL DEFAULT 0);
    CREATE FUNCTION vicino_guard.cuenta_suspendida() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path=public,pg_temp AS $$ SELECT coalesce((SELECT is_hidden FROM profiles WHERE id=auth.uid()),false) $$;
    CREATE FUNCTION vicino_guard.bloqueados_conmigo() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path=public,pg_temp AS $$ SELECT coalesce(array_agg(CASE WHEN blocker_id=auth.uid() THEN blocked_id ELSE blocker_id END),'{}'::uuid[])
      FROM user_blocks WHERE blocker_id=auth.uid() OR blocked_id=auth.uid() $$;
    CREATE FUNCTION handle_updated_at() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
  `);
  await db.exec(await migration("20260320000007_sale_confirmations.sql"));
  await db.exec((await migration("20260320000009_chats_messages.sql"))
    .replace(/ALTER PUBLICATION supabase_realtime ADD TABLE \w+;/g, ""));
  await db.exec(await migration("20260424000002_one_active_sale_per_chat.sql"));
  await db.exec(await migration("20260501000001_messages_unique_sale_confirmed.sql"));
  await db.exec(await migration("20260604000004_drop_chats_updated_at_trigger.sql"));
  await db.exec(await migration("20260826120000_sale_confirmations_grant_update.sql"));
  // Existing column ACLs from 20260827110000. Its unrelated appointments and
  // verification tables are intentionally absent from this minimal fixture.
  await db.exec(`
    GRANT SELECT ON profiles, products_services, chats, messages, sale_confirmations, user_roles TO authenticated;
    GRANT INSERT ON messages TO authenticated;
    GRANT UPDATE (ultimo_producto_id,no_leidos_comprador,no_leidos_vendedor,oculto_para_comprador,
      oculto_para_vendedor,deleted_at_comprador,deleted_at_vendedor,updated_at) ON chats TO authenticated;
    GRANT INSERT (product_id,buyer_id,seller_id,chat_id,precio_acordado,cantidad,metodo_pago,notas,tipo_entrega,initiated_by)
      ON sale_confirmations TO authenticated;
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_profile_read ON profiles FOR SELECT USING (id=auth.uid() OR NOT is_hidden);
    ALTER TABLE products_services ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_product_read ON products_services FOR SELECT USING (NOT is_hidden AND estatus NOT IN ('borrador','eliminado'));
  `);
  await db.exec(await migration("20260912300000_iniciar_conversacion_idempotente.sql"));
  await db.exec(await migration("20260912310000_get_or_create_chat_on_conflict.sql"));
  await db.exec(`INSERT INTO profiles(id,nombre) VALUES ('${A}','A'),('${B}','B'),('${C}','C');
    INSERT INTO products_services(id,creador_id,titulo,precio,estatus,is_hidden) VALUES
      ('${pa}','${A}','Producto A',25,'disponible',false),('${pb}','${B}','Producto B',30,'disponible',false),
      ('${pc}','${C}','Producto ajeno',50,'disponible',false),('${paused}','${B}','Pausado',50,'pausado',false),
      ('${hidden}','${B}','Oculto',50,'disponible',true),('${deleted}','${B}','Eliminado',50,'eliminado',false);
    INSERT INTO chats(id,comprador_id,vendedor_id,ultimo_producto_id) VALUES ('${chat}','${A}','${B}','${pb}');
    INSERT INTO sale_confirmations(id,chat_id,product_id,buyer_id,seller_id,initiated_by,precio_acordado,status)
      VALUES ('40000000-0000-4000-8000-000000000001','${chat}','${pb}','${A}','${B}','${A}',30,'completed');`);
  await db.exec(await migration("20260925010000_chat_producto_y_venta_atomica.sql"));

  await test("migration preserves historical sale and initializes revision", async () => {
    assert.equal(await revision(), 0);
    assert.equal(await scalar("SELECT clave_idempotencia FROM sale_confirmations LIMIT 1"), null);
    assert.equal(await scalar("SELECT status FROM sale_confirmations LIMIT 1"), "completed");
  });
  await test("unauthenticated actor and third party cannot select", async () => {
    await rejects(() => select(null, pa, 0), "42501");
    await rejects(() => select(C, pa, 0), "PT404");
  });
  await test("paused, hidden, eliminated and third party products rejected", async () => {
    for (const id of [paused, hidden, deleted, pc]) await rejects(() => select(A, id, 0), "PT404");
    await db.exec(`UPDATE products_services SET estatus=NULL WHERE id='${paused}'`);
    await rejects(() => select(A, paused, 0), "PT404");
    await db.exec(`UPDATE products_services SET estatus='pausado' WHERE id='${paused}'`);
    await db.exec(`UPDATE products_services SET is_hidden=NULL WHERE id='${hidden}'`);
    await rejects(() => select(A, hidden, 0), "PT404");
    await db.exec(`UPDATE products_services SET is_hidden=true WHERE id='${hidden}'`);
  });
  await test("either participant selects either participant's available product", async () => {
    const selected = await select(B, pa, 0);
    assert.equal(selected.product.creador_id, A); assert.equal(selected.revision, 1);
    const same = await select(A, pa, 1); assert.equal(same.revision, 1);
  });
  await test("stale selection loses CAS without overwriting", async () => {
    await rejects(() => select(A, pb, 0), "PT409");
    assert.equal(await scalar("SELECT ultimo_producto_id FROM chats WHERE id=$1", [chat]), pa);
  });
  await test("legacy iniciar_conversacion changes revision for reversed sales", async () => {
    await asActor(A, "SELECT iniciar_conversacion($1,$2,'contacto',NULL)", [B, pb]);
    assert.equal(await revision(), 2);
    await asActor(B, "SELECT get_or_create_chat($1,$2,$3)", [B, A, pa]);
    assert.equal(await revision(), 3);
  });
  await test("block in either direction and suspended actor fail closed", async () => {
    await db.exec(`INSERT INTO user_blocks VALUES ('${B}','${A}')`);
    await rejects(() => select(A, pb, 3), "PT404");
    await db.exec("DELETE FROM user_blocks");
    await db.exec(`UPDATE profiles SET is_hidden=true WHERE id='${A}'`);
    await rejects(() => select(A, pb, 3), "42501");
    await rejects(() => select(B, pb, 3), "PT404");
    await db.exec(`UPDATE profiles SET is_hidden=false WHERE id='${A}'`);
  });
  await test("direct writes closed; chat soft-delete and counters retained", async () => {
    await rejects(() => asActor(A, "UPDATE chats SET ultimo_producto_id=$1 WHERE id=$2", [pb, chat]), "42501");
    await rejects(() => asActor(A, "UPDATE chats SET producto_revision=999 WHERE id=$1", [chat]), "42501");
    await asActor(A, "UPDATE chats SET deleted_at_comprador=now(),no_leidos_comprador=0 WHERE id=$1", [chat]);
    assert.equal(await revision(), 3);
    await rejects(() => asActor(A, "INSERT INTO sale_confirmations(product_id,buyer_id,seller_id,chat_id,precio_acordado,initiated_by) VALUES ($1,$2,$3,$4,1,$2)", [pa,A,B,chat]), "42501");
  });
  await test("RPC execution absent for anon", async () => {
    assert.equal(await scalar("SELECT has_function_privilege('anon','public.seleccionar_producto_chat(uuid,uuid,integer)','EXECUTE')"), false);
    assert.equal(await scalar("SELECT has_function_privilege('anon','public.iniciar_confirmacion_venta(uuid,uuid,integer,uuid,numeric,integer,text,text,text)','EXECUTE')"), false);
    assert.equal(await scalar("SELECT has_function_privilege('anon','public.confirmar_venta(uuid)','EXECUTE')"), false);
  });
  await test("stale form and tampered active product cannot create", async () => {
    await rejects(() => create(A, pa, 2), "PT409");
    await rejects(() => create(A, pb, 3), "PT409");
    await rejects(() => create(C, pa, 3), "PT404");
    await rejects(() => create(A, pa, 3, key(1), 1.001), "22023");
  });
  let sale: any;
  await test("sale derives reversed roles; proposal and unread event are atomic", async () => {
    sale = await create(B, pa, 3);
    assert.equal(sale.confirmation.seller_id, A); assert.equal(sale.confirmation.buyer_id, B);
    assert.equal(sale.confirmation.buyer_confirmed, true); assert.equal(sale.confirmation.seller_confirmed, false);
    assert.equal(await scalar("SELECT count(*)::int FROM messages WHERE sale_confirmation_id=$1 AND message_type='sale_proposed'", [sale.confirmation.id]), 1);
    assert.equal(await revision(), 3);
  });
  await test("same key replays; changed payload and new pending attempt conflict", async () => {
    const replay = await create(B, pa, 3); assert.equal(replay.confirmation.id, sale.confirmation.id); assert.equal(replay.repeated, true);
    await rejects(() => create(B, pa, 3, key(1), 27), "PT409");
    await rejects(() => create(A, pa, 3, key(2)), "PT409");
    assert.equal(await scalar("SELECT count(*)::int FROM sale_confirmations WHERE status='pending_confirmation'"), 1);
  });
  await test("pending sale keeps product and roles while shared product changes", async () => {
    await select(A, pb, 3);
    const replay = await create(B, pa, 3); assert.equal(replay.confirmation.product_id, pa);
    assert.equal(replay.confirmation.seller_id, A);
    await db.exec(`UPDATE products_services SET estatus='pausado' WHERE id='${pa}'`);
    assert.equal((await create(B, pa, 3)).repeated, true);
  });
  await test("outsider cannot confirm and initiator retry does not complete alone", async () => {
    await rejects(() => confirm(C, sale.confirmation.id), "PT404");
    assert.equal((await confirm(B, sale.confirmation.id)).alreadyConfirmed, true);
    assert.equal(await scalar("SELECT status FROM sale_confirmations WHERE id=$1", [sale.confirmation.id]), "pending_confirmation");
  });
  await test("direct confirmation flag changes are denied", async () => {
    await rejects(() => asActor(A, "UPDATE sale_confirmations SET seller_confirmed=true WHERE id=$1", [sale.confirmation.id]), "42501");
    await rejects(() => asActor(A, "UPDATE sale_confirmations SET cancelled_by=$1 WHERE id=$2", [B,sale.confirmation.id]), "42501");
    await rejects(() => asActor(A, "INSERT INTO messages(chat_id,autor_id,texto,sale_confirmation_id,message_type) VALUES ($1,$2,'spoof',$3,'sale_proposed')", [chat,A,sale.confirmation.id]), "42501");
  });
  await test("completion message failure rolls back confirmation and trust points", async () => {
    await db.exec(`CREATE FUNCTION fixture_fail_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.message_type='sale_confirmed' THEN RAISE EXCEPTION 'synthetic failure' USING ERRCODE='P0001'; END IF;
      RETURN NEW; END $$; CREATE TRIGGER fixture_fail_message BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION fixture_fail_message();`);
    await rejects(() => confirm(A, sale.confirmation.id), "P0001");
    assert.equal(await scalar("SELECT seller_confirmed FROM sale_confirmations WHERE id=$1", [sale.confirmation.id]), false);
    assert.equal(await scalar("SELECT trust_points FROM profiles WHERE id=$1", [A]), 0);
    await db.exec("DROP TRIGGER fixture_fail_message ON messages; DROP FUNCTION fixture_fail_message()");
  });
  await test("mutual completion awards points and produces exactly one message", async () => {
    assert.equal((await confirm(A, sale.confirmation.id)).alreadyConfirmed, false);
    assert.equal((await confirm(A, sale.confirmation.id)).alreadyConfirmed, true);
    assert.equal((await confirm(B, sale.confirmation.id)).alreadyConfirmed, true);
    assert.equal(await scalar("SELECT trust_points FROM profiles WHERE id=$1", [A]), 10);
    assert.equal(await scalar("SELECT trust_points FROM profiles WHERE id=$1", [B]), 3);
    assert.equal(await scalar("SELECT count(*)::int FROM messages WHERE sale_confirmation_id=$1 AND message_type='sale_confirmed'", [sale.confirmation.id]), 1);
  });
  await test("proposal failure rolls back sale, key and unread count", async () => {
    const before = await scalar("SELECT no_leidos_vendedor FROM chats WHERE id=$1", [chat]);
    await db.exec(`CREATE FUNCTION fixture_fail_proposal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.message_type='sale_proposed' THEN RAISE EXCEPTION 'synthetic failure' USING ERRCODE='P0001'; END IF;
      RETURN NEW; END $$; CREATE TRIGGER fixture_fail_proposal BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION fixture_fail_proposal();`);
    await rejects(() => create(A, pb, 4, key(3)), "P0001");
    assert.equal(await scalar("SELECT count(*)::int FROM sale_confirmations WHERE clave_idempotencia=$1", [key(3)]), 0);
    assert.equal(await scalar("SELECT no_leidos_vendedor FROM chats WHERE id=$1", [chat]), before);
    await db.exec("DROP TRIGGER fixture_fail_proposal ON messages; DROP FUNCTION fixture_fail_proposal()");
  });
  await test("normal roles work; cancelled cannot confirm or reopen", async () => {
    const normal = await create(A, pb, 4, key(3));
    assert.equal(normal.confirmation.seller_id, B); assert.equal(normal.confirmation.buyer_id, A);
    await asActor(B, "UPDATE sale_confirmations SET status='cancelled',cancelled_by=$1,cancelled_at=now() WHERE id=$2", [B,normal.confirmation.id]);
    await rejects(() => confirm(A, normal.confirmation.id), "PT409");
    await rejects(() => asActor(A, "UPDATE sale_confirmations SET status='pending_confirmation' WHERE id=$1", [normal.confirmation.id]), "PT409");
    assert.equal((await create(A, pb, 4, key(3))).confirmation.status, "cancelled");
  });
  await test("expired confirmation reports conflict", async () => {
    const expiring = await create(A, pb, 4, key(4));
    await db.query("UPDATE sale_confirmations SET status='expired' WHERE id=$1", [expiring.confirmation.id]);
    await rejects(() => confirm(B, expiring.confirmation.id), "PT409");
  });
  await test("RLS hides chats and confirmations from outsiders", async () => {
    assert.equal(await asActor(C, "SELECT count(*)::int FROM chats"), 0);
    assert.equal(await asActor(C, "SELECT count(*)::int FROM sale_confirmations"), 0);
  });
  console.log(`${tests}/${tests} SQL cases passed. PostgreSQL single-connection fixture; concurrent sessions and hosted Realtime not exercised.`);
}
main().catch((error) => { console.error({ message: error.message, code: error.code, where: error.where }); process.exitCode = 1; }).finally(() => db.close());
