/** F00 S01/S02 in real PostgreSQL/WASM with real chat/sale migrations.
 * Synthetic prerequisites replace auth infrastructure and unrelated tables only.
 * No Supabase client, credentials, network, disabled RLS, or permission mocks.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/test-mcs-chat-security.ts <migration.sql>
 * Alternatively set MCS_CHAT_SECURITY_MIGRATION. PGlite has one connection:
 * this does not verify hosted Realtime, concurrency, or device behavior. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = path.resolve(__dirname, "..");
const candidate = process.argv[2] ?? process.env.MCS_CHAT_SECURITY_MIGRATION;
if (!candidate) throw new Error("Pass the generated migration path or MCS_CHAT_SECURITY_MIGRATION");
const migrationPath = path.resolve(root, candidate);
assert.equal(migrationPath,path.join(root,"supabase/migrations/20261015164501_mcs_chat_personal_state_security.sql"),
  "Use the final generated MCS migration, not a draft or a different SQL file");
const db = new PGlite();
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const chat = "10000000-0000-4000-8000-000000000001";
const absent = "10000000-0000-4000-8000-000000000099";
const pa = "20000000-0000-4000-8000-000000000001";
const pb = "20000000-0000-4000-8000-000000000002";
const key = "30000000-0000-4000-8000-000000000001";
let checks = 0;
const migration = (name: string) => readFile(path.join(root, "supabase/migrations", name), "utf8");
async function scalar(sql: string, params: unknown[] = []) {
  const { rows } = await db.query(sql, params);
  return Object.values(rows[0] ?? {})[0] as any;
}
async function asActor(actor: string | null, sql: string, params: unknown[] = [], role = "authenticated", claimRole = role) {
  assert.ok(["authenticated", "anon", "service_role"].includes(role));
  await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [actor ?? "", claimRole]);
    const result = await db.query(sql, params);
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}
async function rejects(run: () => Promise<unknown>, code: string, message?: RegExp) {
  await assert.rejects(run, (error: any) => error.code === code && (!message || message.test(error.message)));
}
async function test(name: string, run: () => Promise<void>) {
  await run(); checks++; console.log(`PASS ${name}`);
}
const state = () => scalar("SELECT to_jsonb(c) FROM chats c WHERE id=$1", [chat]);
const read = (actor: string | null, claimed: string | null, id: string | null = chat) => asActor(actor,
  "SELECT public.mark_messages_as_read($1,$2)", [id, claimed]);
const select = (actor: string, product: string, revision: number) => asActor(actor,
  "SELECT public.seleccionar_producto_chat($1,$2,$3) AS result", [chat, product, revision]);
const send = (actor: string, author = actor) => asActor(actor,
  "INSERT INTO public.messages(chat_id,autor_id,texto) VALUES ($1,$2,'fixture') RETURNING id", [chat, author]);

async function fixture() {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
           nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    CREATE TYPE sale_status AS ENUM ('pending_confirmation','completed','cancelled','expired');
    CREATE TABLE profiles(id uuid PRIMARY KEY,nombre text,is_hidden boolean NOT NULL DEFAULT false,
      trust_points integer NOT NULL DEFAULT 0,total_sales integer NOT NULL DEFAULT 0);
    CREATE TABLE user_roles(user_id uuid,role text);
    CREATE TABLE user_blocks(blocker_id uuid,blocked_id uuid);
    ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY users_manage_own_blocks ON user_blocks USING(auth.uid()=blocker_id);
    CREATE TABLE products_services(id uuid PRIMARY KEY,creador_id uuid NOT NULL REFERENCES profiles(id),
      titulo text NOT NULL,precio numeric(10,2),modo_precio text NOT NULL DEFAULT 'fijo',
      imagen_principal text,estatus text DEFAULT 'disponible',is_hidden boolean DEFAULT false,
      ventas_count integer NOT NULL DEFAULT 0);
    CREATE FUNCTION handle_updated_at() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
  `);
  // Apply the real helpers and ACLs preceding unrelated ALTER POLICY blocks.
  for (const file of ["20260912100000_bloqueo_bidireccional_desde_helper.sql", "20260912120000_suspension_impide_escribir.sql"]) {
    const sql = await migration(file);
    const firstPolicy = sql.indexOf('\nalter policy "');
    assert.ok(firstPolicy > 0, `Missing policy boundary in ${file}`);
    await db.exec(sql.slice(0, firstPolicy));
  }
  await db.exec(await migration("20260320000007_sale_confirmations.sql"));
  await db.exec((await migration("20260320000009_chats_messages.sql"))
    .replace(/ALTER PUBLICATION supabase_realtime ADD TABLE \w+;/g, ""));
  await db.exec(await migration("20260424000002_one_active_sale_per_chat.sql"));
  await db.exec(await migration("20260501000001_messages_unique_sale_confirmed.sql"));
  await db.exec(await migration("20260604000004_drop_chats_updated_at_trigger.sql"));
  await db.exec(await migration("20260826120000_sale_confirmations_grant_update.sql"));
  // Supabase platform SELECT/INSERT grants; the real S04 migration below owns
  // every chats UPDATE grant used by these tests. No all-table UPDATE shortcut.
  await db.exec(`
    GRANT SELECT ON profiles,products_services,chats,messages,sale_confirmations,user_roles TO authenticated;
    GRANT SELECT ON chats,messages TO anon;
    GRANT INSERT ON messages TO authenticated;
    GRANT UPDATE,SELECT ON chats TO service_role;
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_profile_read ON profiles FOR SELECT USING(id=auth.uid() OR NOT is_hidden);
    ALTER TABLE products_services ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_product_read ON products_services FOR SELECT USING(NOT is_hidden AND estatus NOT IN ('borrador','eliminado'));
  `);
  await db.exec(await migration("20260912300000_iniciar_conversacion_idempotente.sql"));
  await db.exec(await migration("20260912310000_get_or_create_chat_on_conflict.sql"));
  await db.exec(await migration("20260925010000_chat_producto_y_venta_atomica.sql"));
  await db.exec(`
    INSERT INTO profiles(id,nombre) VALUES('${A}','A'),('${B}','B'),('${C}','C');
    INSERT INTO products_services(id,creador_id,titulo,precio) VALUES('${pa}','${A}','Producto A',25),('${pb}','${B}','Producto B',30);
    INSERT INTO chats(id,comprador_id,vendedor_id,ultimo_producto_id) VALUES('${chat}','${A}','${B}','${pb}');
  `);
}

async function main() {
  await fixture();
  await test("baseline S02: A could overwrite B personal state with real RLS/grants", async () => {
    await asActor(A,"UPDATE chats SET no_leidos_vendedor=9,oculto_para_vendedor=true,deleted_at_vendedor=now() WHERE id=$1",[chat]);
    const row = await state();
    assert.equal(row.no_leidos_vendedor,9); assert.equal(row.oculto_para_vendedor,true); assert.ok(row.deleted_at_vendedor);
    await db.exec("UPDATE chats SET no_leidos_vendedor=0,oculto_para_vendedor=false,deleted_at_vendedor=NULL");
  });
  const sql = await readFile(migrationPath,"utf8");
  await test("staging rehearsal contains exact bodies and rolls back migration DDL/ACLs",async()=>{
    const validation=await readFile(path.join(root,"scripts/staging/validar-mcs-chat-seguridad.sql"),"utf8");
    const rehearsal=await readFile(path.join(root,"scripts/staging/ensayar-mcs-chat-seguridad.sql"),"utf8");
    const strip=(body:string,end:string)=>body.replace(/^BEGIN;\r?\n/m,"").replace(new RegExp(`^${end};\\r?\\n?`,"m"),"");
    assert.equal(rehearsal,
      "-- Ensayo STAGING: cuerpos exactos de migracion/validador, sin wrappers internos.\n"+
      "-- Generado desde 20261015164501_mcs_chat_personal_state_security.sql y validar-mcs-chat-seguridad.sql.\n"+
      "-- Una sola transaccion: NO ejecutar el COMMIT de la migracion en este ensayo.\nBEGIN;\n"+
      strip(sql,"COMMIT")+"\n"+strip(validation,"ROLLBACK")+"\nROLLBACK;\n");
    const before=await state();
    const beforeRead=await scalar("SELECT pg_get_functiondef('mark_messages_as_read(uuid,uuid)'::regprocedure)");
    await db.exec(rehearsal);
    assert.deepEqual(await state(),before);
    assert.equal(await scalar("SELECT to_regprocedure('public.guard_chat_personal_state_update()')"),null);
    assert.equal(await scalar("SELECT pg_get_functiondef('mark_messages_as_read(uuid,uuid)'::regprocedure)"),beforeRead);
    assert.equal(await scalar("SELECT prosecdef FROM pg_proc WHERE oid='increment_unread_count()'::regprocedure"),false);
    assert.equal(await scalar("SELECT has_function_privilege('anon','mark_messages_as_read(uuid,uuid)','EXECUTE')"),true);
    assert.equal(await scalar("SELECT to_regclass('pg_temp.mcs_guard_probe')"),null);
  });
  await db.exec(sql);

  await test("migration keeps RLS, column ACLs, signature and S04 revision guard", async () => {
    for (const table of ["chats","messages","sale_confirmations"]) {
      assert.equal(await scalar("SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass",[table]),true);
    }
    assert.equal(await scalar("SELECT count(*)::int FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='mark_messages_as_read'"),1);
    assert.equal(await scalar("SELECT prosecdef FROM pg_proc WHERE oid='public.guard_chat_personal_state_update()'::regprocedure"),false);
    assert.equal(await scalar("SELECT count(*)::int FROM pg_trigger WHERE tgrelid='chats'::regclass AND tgname='chat_producto_revision'"),1);
    for (const column of ["comprador_id","vendedor_id","ultimo_producto_id","producto_revision"]) {
      assert.equal(await scalar("SELECT has_column_privilege('authenticated','chats',$1,'UPDATE')",[column]),false);
    }
    for (const column of ["no_leidos_comprador","no_leidos_vendedor","oculto_para_comprador","oculto_para_vendedor","deleted_at_comprador","deleted_at_vendedor","updated_at"]) {
      assert.equal(await scalar("SELECT has_column_privilege('authenticated','chats',$1,'UPDATE')",[column]),true);
    }
  });
  for (const [actor, own, peer] of [[A,"comprador","vendedor"],[B,"vendedor","comprador"]]) {
    await test(`${own}: own state writes and unchanged peer assignments remain allowed`, async () => {
      await asActor(actor,`UPDATE chats SET no_leidos_${own}=4,oculto_para_${own}=true,deleted_at_${own}=now(),updated_at=now(),oculto_para_${peer}=oculto_para_${peer} WHERE id=$1`,[chat]);
      const row = await state();
      assert.equal(row[`no_leidos_${own}`],4); assert.equal(row[`oculto_para_${own}`],true); assert.ok(row[`deleted_at_${own}`]);
      await asActor(actor,`UPDATE chats SET no_leidos_${own}=0,oculto_para_${own}=false,deleted_at_${own}=NULL WHERE id=$1`,[chat]);
    });
    for (const [column,value] of [[`no_leidos_${peer}`,"17"],[`oculto_para_${peer}`,"true"],[`deleted_at_${peer}`,"now()"]]) {
      await test(`${own}: changing peer ${column} rejects and rolls back own changes`,async()=>{
        const before=await state();
        await rejects(()=>asActor(actor,`UPDATE chats SET oculto_para_${own}=true,${column}=${value} WHERE id=$1`,[chat]),"42501",/estado personal/);
        assert.deepEqual(await state(),before);
      });
    }
  }
  await test("forged service_role claim cannot bypass real authenticated SQL role",async()=>{
    await rejects(()=>asActor(A,"UPDATE chats SET no_leidos_vendedor=31 WHERE id=$1",[chat],"authenticated","service_role"),"42501");
  });
  await test("outsider and sessionless authenticated updates affect zero rows through RLS",async()=>{
    const before=await state();
    for(const actor of [C,null]) {
      const result=await asActor(actor,"UPDATE chats SET oculto_para_comprador=true WHERE id=$1 RETURNING id",[chat]);
      assert.equal(result.rows.length,0);
    }
    assert.deepEqual(await state(),before);
  });
  await test("anon has no UPDATE; anon/C cannot read chat/messages",async()=>{
    await rejects(()=>asActor(null,"UPDATE chats SET oculto_para_comprador=true WHERE id=$1",[chat],"anon"),"42501");
    for(const [actor,role] of [[null,"anon"],[C,"authenticated"]] as const) {
      assert.equal((await asActor(actor,"SELECT id FROM chats",[],role)).rows.length,0);
      assert.equal((await asActor(actor,"SELECT id FROM messages",[],role)).rows.length,0);
    }
  });
  await test("actual backend SQL role works even when its JWT claim is authenticated",async()=>{
    await asActor(A,"UPDATE chats SET oculto_para_comprador=true,oculto_para_vendedor=true WHERE id=$1",[chat],"service_role","authenticated");
    const row=await state(); assert.equal(row.oculto_para_comprador,true);assert.equal(row.oculto_para_vendedor,true);
  });
  await test("direct A message increments B and unhides both despite authenticated claims",async()=>{
    const id=(await send(A)).rows[0].id;
    const row=await state(); assert.equal(row.no_leidos_vendedor,1);assert.equal(row.no_leidos_comprador,0);
    assert.equal(row.oculto_para_comprador,false);assert.equal(row.oculto_para_vendedor,false);
    const message=await scalar("SELECT to_jsonb(m) FROM messages m WHERE id=$1",[id]);
    assert.equal(message.leido_por_comprador,true);assert.equal(message.leido_por_vendedor,false);
  });
  await test("direct B message increments A and unhides both",async()=>{
    await asActor(A,"UPDATE chats SET oculto_para_comprador=true WHERE id=$1",[chat]);
    await asActor(B,"UPDATE chats SET oculto_para_vendedor=true WHERE id=$1",[chat]);
    const id=(await send(B)).rows[0].id;
    const row=await state();assert.equal(row.no_leidos_comprador,1);assert.equal(row.no_leidos_vendedor,1);
    assert.equal(row.oculto_para_comprador,false);assert.equal(row.oculto_para_vendedor,false);
    const message=await scalar("SELECT to_jsonb(m) FROM messages m WHERE id=$1",[id]);
    assert.equal(message.leido_por_vendedor,true);assert.equal(message.leido_por_comprador,false);
  });
  await test("spoofed author and outsider messages fail RLS without trigger side effects",async()=>{
    const before=await state();const count=await scalar("SELECT count(*)::int FROM messages");
    await rejects(()=>send(A,B),"42501");await rejects(()=>send(C),"42501");
    assert.deepEqual(await state(),before);assert.equal(await scalar("SELECT count(*)::int FROM messages"),count);
  });
  await test("A read with forged p_user_id=B updates only A receipts/counter",async()=>{
    await read(A,B);
    assert.equal((await state()).no_leidos_comprador,0);assert.equal((await state()).no_leidos_vendedor,1);
    assert.equal(await scalar("SELECT count(*)::int FROM messages WHERE NOT leido_por_comprador"),0);
    assert.equal(await scalar("SELECT count(*)::int FROM messages WHERE NOT leido_por_vendedor"),1);
  });
  await test("B read with forged p_user_id=A updates only B and preserves revision/order",async()=>{
    const before=await state();await read(B,A);
    const after=await state();assert.equal(after.no_leidos_vendedor,0);assert.equal(after.no_leidos_comprador,0);
    assert.equal(after.producto_revision,before.producto_revision);assert.equal(after.updated_at,before.updated_at);
    assert.equal(await scalar("SELECT count(*)::int FROM messages WHERE NOT leido_por_vendedor"),0);
    await read(A,null); // Historical argument is accepted but ignored.
  });
  await test("outsider, no session, nonexistent/null chat reads reject without writes",async()=>{
    const before=await state();
    await rejects(()=>read(C,A),"P0001",/forbidden: no eres participante de este chat/);
    await rejects(()=>read(null,A),"P0001",/unauthenticated/);
    await rejects(()=>read(A,A,absent),"P0001",/chat not found/);
    await rejects(()=>read(A,A,null),"P0001",/chat not found/);
    assert.deepEqual(await state(),before);
  });
  await test("anon and PUBLIC cannot execute reads/internal trigger functions",async()=>{
    await rejects(()=>asActor(null,"SELECT mark_messages_as_read($1,$2)",[chat,A],"anon"),"42501");
    for(const name of ["mark_messages_as_read(uuid,uuid)","increment_unread_count()","unhide_chat_on_new_message()","guard_chat_personal_state_update()"]) {
      assert.equal(await scalar("SELECT has_function_privilege('anon',$1,'EXECUTE')",[`public.${name}`]),false);
    }
    for(const name of ["increment_unread_count()","unhide_chat_on_new_message()","guard_chat_personal_state_update()"]) {
      assert.equal(await scalar("SELECT has_function_privilege('authenticated',$1,'EXECUTE')",[`public.${name}`]),false);
    }
  });
  await test("S04 product selection/CAS still increments revision, direct writes remain closed",async()=>{
    const result=await select(A,pa,0);assert.equal(result.rows[0].result.revision,1);
    await rejects(()=>select(B,pb,0),"PT409");
    await rejects(()=>asActor(A,"UPDATE chats SET ultimo_producto_id=$1 WHERE id=$2",[pb,chat]),"42501");
    await rejects(()=>asActor(A,"UPDATE chats SET producto_revision=99 WHERE id=$1",[chat]),"42501");
    assert.equal((await state()).producto_revision,1);
  });
  let sale: any;
  await test("S04 reversed sale proposal increments recipient once and preserves product revision",async()=>{
    const result=await asActor(B,"SELECT iniciar_confirmacion_venta($1,$2,1,$3,25,1,NULL,NULL,'pickup') AS result",[chat,pa,key]);
    sale=result.rows[0].result.confirmation;
    assert.equal(sale.buyer_id,B);assert.equal(sale.seller_id,A);assert.equal(sale.buyer_confirmed,true);
    assert.equal((await state()).no_leidos_comprador,1);assert.equal((await state()).no_leidos_vendedor,0);
    assert.equal((await state()).producto_revision,1);
    const replay=await asActor(B,"SELECT iniciar_confirmacion_venta($1,$2,1,$3,25,1,NULL,NULL,'pickup') AS result",[chat,pa,key]);
    assert.equal(replay.rows[0].result.repeated,true);assert.equal((await state()).no_leidos_comprador,1);
  });
  await test("S04 mutual completion still awards points and inserts one counter-bearing message",async()=>{
    await asActor(A,"SELECT confirmar_venta($1)",[sale.id]);await asActor(A,"SELECT confirmar_venta($1)",[sale.id]);
    assert.equal(await scalar("SELECT status FROM sale_confirmations WHERE id=$1",[sale.id]),"completed");
    assert.equal(await scalar("SELECT trust_points FROM profiles WHERE id=$1",[A]),10);
    assert.equal(await scalar("SELECT trust_points FROM profiles WHERE id=$1",[B]),3);
    assert.equal(await scalar("SELECT count(*)::int FROM messages WHERE message_type='sale_confirmed' AND sale_confirmation_id=$1",[sale.id]),1);
    const row=await state();assert.equal(row.no_leidos_comprador,1);assert.equal(row.no_leidos_vendedor,1);assert.equal(row.producto_revision,1);
  });
  await test("legacy authorized chat RPCs still select product and only reopen caller",async()=>{
    await asActor(B,"UPDATE chats SET oculto_para_vendedor=true WHERE id=$1",[chat]);
    await asActor(A,"SELECT get_or_create_chat($1,$2,$3)",[A,B,pb]);
    assert.equal((await state()).oculto_para_vendedor,true);assert.equal((await state()).producto_revision,2);
    await asActor(B,"SELECT iniciar_conversacion($1,$2,'contacto',NULL)",[A,pa]);
    assert.equal((await state()).oculto_para_vendedor,false);assert.equal((await state()).producto_revision,3);
  });
  await test("trigger DEFINER owner can be BYPASSRLS without superuser, as in hosted Supabase",async()=>{
    assert.equal(await scalar("SELECT rolsuper FROM pg_roles WHERE rolname='service_role'"),false);
    await db.exec("ALTER FUNCTION increment_unread_count() OWNER TO service_role; ALTER FUNCTION unhide_chat_on_new_message() OWNER TO service_role");
    try {
      const before=await state();await send(A);await send(B);
      const after=await state();
      assert.equal(after.no_leidos_comprador,before.no_leidos_comprador+1);
      assert.equal(after.no_leidos_vendedor,before.no_leidos_vendedor+1);
      assert.equal(after.producto_revision,before.producto_revision);
    } finally {
      await db.exec("ALTER FUNCTION increment_unread_count() OWNER TO postgres; ALTER FUNCTION unhide_chat_on_new_message() OWNER TO postgres");
    }
  });
  await test("migration is reapplicable and keeps one personal-state trigger",async()=>{
    await db.exec(sql);
    assert.equal(await scalar("SELECT count(*)::int FROM pg_trigger WHERE tgrelid='chats'::regclass AND tgname='aa_guard_chat_personal_state_update'"),1);
    await rejects(()=>asActor(A,"UPDATE chats SET oculto_para_vendedor=true WHERE id=$1",[chat]),"42501");
  });
  await test("reversible staging validator executes with real guard and leaves no state/fixture",async()=>{
    const before=await state();
    await db.exec(await readFile(path.join(root,"scripts/staging/validar-mcs-chat-seguridad.sql"),"utf8"));
    assert.deepEqual(await state(),before);
    assert.equal(await scalar("SELECT to_regclass('pg_temp.mcs_guard_probe')"),null);
  });
  console.log(`${checks}/${checks} MCS chat SQL cases passed. Isolated PostgreSQL/PGlite; hosted Supabase, Realtime, concurrent sessions and devices not exercised.`);
}
main().catch((error:any)=>{console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;}).finally(()=>db.close());
