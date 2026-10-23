/** Real migration/trigger/RLS regressions in an isolated PostgreSQL PGlite instance.
 * No remote database, credentials or env files. PGlite serializes one connection;
 * these tests prove retries/transaction rollback, not simultaneous-session locking
 * or hosted Supabase Realtime behavior. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const isolatedRequire = createRequire(path.join(root, "package.json"));
const { PGlite } = isolatedRequire(process.env.S04_PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const A = "00000000-0000-4000-8000-000000000001"; // Buyer
const B = "00000000-0000-4000-8000-000000000002"; // Seller
const C = "00000000-0000-4000-8000-000000000003"; // Third party
const chat = "10000000-0000-4000-8000-000000000001";
const pa = "20000000-0000-4000-8000-000000000001";
const pb = "20000000-0000-4000-8000-000000000002";

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

async function main() {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth; CREATE SCHEMA vicino_guard;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth, vicino_guard TO authenticated, anon;
    CREATE TYPE sale_status AS ENUM ('pending_confirmation','completed','cancelled','expired');
    CREATE TYPE review_type AS ENUM ('buyer_to_seller','seller_to_buyer');
    CREATE TABLE profiles (id uuid PRIMARY KEY, nombre text, foto text, trust_level text DEFAULT 'nuevo', es_vendedor boolean DEFAULT false, seller_type text, nombre_negocio text, is_hidden boolean NOT NULL DEFAULT false,
      trust_points integer NOT NULL DEFAULT 0, total_sales integer NOT NULL DEFAULT 0,
      average_rating numeric(3,2) NOT NULL DEFAULT 0, reviews_count integer NOT NULL DEFAULT 0,
      average_rating_as_seller numeric(3,2) NOT NULL DEFAULT 0, reviews_count_as_seller integer NOT NULL DEFAULT 0,
      average_rating_as_buyer numeric(3,2) NOT NULL DEFAULT 0, reviews_count_as_buyer integer NOT NULL DEFAULT 0,
      updated_at timestamptz DEFAULT now());
    CREATE TABLE user_roles (user_id uuid, role text);
    CREATE TABLE user_blocks (blocker_id uuid, blocked_id uuid);
    CREATE TABLE products_services (id uuid PRIMARY KEY, creador_id uuid NOT NULL REFERENCES profiles(id),
      titulo text NOT NULL, tipo text DEFAULT 'producto', slug text, categoria text DEFAULT 'otros', precio numeric(10,2), modo_precio text NOT NULL DEFAULT 'fijo',
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
  await db.exec(await migration("20260320000008_reviews.sql"));
  await db.exec((await migration("20260320000009_chats_messages.sql"))
    .replace(/ALTER PUBLICATION supabase_realtime ADD TABLE \w+;/g, ""));
  await db.exec(await migration("20260424000002_one_active_sale_per_chat.sql"));
  await db.exec(await migration("20260501000001_messages_unique_sale_confirmed.sql"));
  await db.exec(await migration("20260604000004_drop_chats_updated_at_trigger.sql"));
  await db.exec(await migration("20260521000012_ratings_delete_trigger.sql"));
  await db.exec("ALTER TABLE messages ADD COLUMN is_hidden boolean NOT NULL DEFAULT false; ALTER TABLE reviews ADD COLUMN is_hidden boolean NOT NULL DEFAULT false;");
  const moderation = await migration("20260429120000_moderation_reports.sql");
  await db.exec(moderation.slice(moderation.indexOf("CREATE OR REPLACE FUNCTION sync_reviews_visibility()"), moderation.indexOf("-- Índices parciales")));
  await db.exec(await migration("20260826120000_sale_confirmations_grant_update.sql"));

  await db.exec(`
    GRANT SELECT ON profiles, products_services, chats, messages, sale_confirmations, reviews, user_roles TO authenticated;
    GRANT INSERT ON messages TO authenticated;
    GRANT UPDATE (ultimo_producto_id,no_leidos_comprador,no_leidos_vendedor,oculto_para_comprador,
      oculto_para_vendedor,deleted_at_comprador,deleted_at_vendedor,updated_at) ON chats TO authenticated;
    GRANT INSERT (product_id,buyer_id,seller_id,chat_id,precio_acordado,cantidad,metodo_pago,notas,tipo_entrega,initiated_by)
      ON sale_confirmations TO authenticated;
    GRANT INSERT (sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating, comentario, fotos)
      ON reviews TO authenticated;
    GRANT UPDATE (respuesta, respuesta_fecha) ON reviews TO authenticated;
  `);

  await db.exec(await migration("20260912300000_iniciar_conversacion_idempotente.sql"));
  await db.exec(await migration("20260912310000_get_or_create_chat_on_conflict.sql"));

  // Seed fixture
  await db.exec(`INSERT INTO profiles(id,nombre) VALUES ('${A}','Comprador A'),('${B}','Vendedor B'),('${C}','Tercero C');
    INSERT INTO products_services(id,creador_id,titulo,precio,estatus,is_hidden) VALUES
      ('${pa}','${A}','Producto A',25,'disponible',false),
      ('${pb}','${B}','Producto B',30,'disponible',false);
    INSERT INTO chats(id,comprador_id,vendedor_id,ultimo_producto_id) VALUES ('${chat}','${A}','${B}','${pb}');
  `);

  await db.exec(await migration("20260925010000_chat_producto_y_venta_atomica.sql"));
  await db.exec(await migration("20260927160000_resenas_sin_columnas_forjables.sql"));

  await db.exec(await migration("20261015164501_mcs_chat_personal_state_security.sql"));

  // Synthetic pre-feature intent: never backfill its terms from a current listing.
  const legacyId = "50000000-0000-4000-8000-000000000001";
  await db.query("INSERT INTO messages(id,chat_id,autor_id,texto,publicacion_id,message_type) VALUES($1,$2,$3,'Historic intent',$4,'purchase_intent')", [legacyId,chat,A,pb]);
  // Actual caller-RLS product visibility must also apply inside operation/review RPCs.
  await db.exec("ALTER TABLE products_services ENABLE ROW LEVEL SECURITY; CREATE POLICY visible_products ON products_services FOR SELECT USING(NOT is_hidden);");
  const oldSaleId="60000000-0000-4000-8000-000000000001";
  await db.query("INSERT INTO sale_confirmations(id,chat_id,product_id,buyer_id,seller_id,initiated_by,precio_acordado,cantidad,notas) VALUES($1,$2,$3,$4,$5,$5,17,3,'Historic agreed terms')",[oldSaleId,chat,pb,A,B]);
  // Apply new migration VENTA-CHAT-01
  await db.exec(await migration("20261023010000_venta_chat_y_resenas_local.sql"));

  await test("historic sale keeps agreed terms, real status and settlement controls without invented product history",async()=>{
    const r=await asActor(A,"SELECT get_chat_operations($1,NULL,20,ARRAY[$2]::uuid[])",[chat,oldSaleId]);
    assert.equal(r.items[0].status,"pending_confirmation"); assert.equal(r.items[0].price,17);
    assert.equal(r.items[0].quantity,3); assert.equal(r.items[0].notes,"Historic agreed terms");
    assert.equal(r.items[0].canConfirm,true); assert.equal(r.items[0].canReject,true);
    await db.exec("BEGIN;SET LOCAL ROLE authenticated;");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[A]);
    assert.equal((await scalar("SELECT confirmar_venta($1)",[oldSaleId])).success,true);
    assert.equal(await scalar("SELECT status FROM sale_confirmations WHERE id=$1",[oldSaleId]),"completed");
    await db.exec("ROLLBACK");
    await asActor(A,"UPDATE sale_confirmations SET status='cancelled',cancelled_by=$1 WHERE id=$2",[A,oldSaleId]);
    const historical=await asActor(A,"SELECT get_chat_operations($1,NULL,20,ARRAY[$2]::uuid[])",[chat,oldSaleId]);
    assert.equal(historical.items[0].status,"cancelled"); // No reinterpretation of old snapshot-less rows.
  });
  // 1. Iniciar confirmacion manual sin tipo_entrega ni metodo_pago
  await test("iniciar_confirmacion_venta allows null delivery and payment", async () => {
    const k1 = "30000000-0000-4000-8000-000000000001";
    const res = await asActor(A,
      "SELECT public.iniciar_confirmacion_venta($1,$2,$3,$4,$5,2,NULL,'Entrega acordada en chat',NULL)",
      [chat, pb, 0, k1, 30]
    );
    assert.equal(res.repeated, false);
    assert.equal(res.confirmation.precio_acordado, 30);
    assert.equal(res.confirmation.cantidad, 2);
    assert.equal(res.confirmation.tipo_entrega, null);
    assert.equal(res.confirmation.metodo_pago, null);
    assert.equal(res.confirmation.buyer_confirmed, true);
    assert.equal(res.confirmation.seller_confirmed, false);
    assert.equal(res.confirmation.status, "pending_confirmation");

    // Cancel it so we can test purchase intent next
    await asActor(A, "UPDATE public.sale_confirmations SET status='cancelled', cancelled_by=$1 WHERE id=$2", [A, res.confirmation.id]);
  });

  await test("new manual counterpart rejection differs from initiator cancellation without rewriting sale enum",async()=>{
    for(const [actor,expected] of [[B,"rejected"],[A,"cancelled"]] as const){
      const key=await scalar("SELECT gen_random_uuid()");
      const created=await asActor(A,"SELECT iniciar_confirmacion_venta($1,$2,0,$3,30,1)",[chat,pb,key]);
      await asActor(actor,"UPDATE sale_confirmations SET status='cancelled',cancelled_by=$1,cancelled_at=now() WHERE id=$2",[actor,created.confirmation.id]);
      assert.equal(await scalar("SELECT status FROM sale_confirmations WHERE id=$1",[created.confirmation.id]),"cancelled");
      const page=await asActor(A,"SELECT get_chat_operations($1,NULL,20,ARRAY[$2]::uuid[])",[chat,created.confirmation.id]);
      assert.equal(page.items[0].status,expected);
      assert.equal(page.items[0].canConfirm,false); assert.equal(page.items[0].canReject,false);
    }
  });
  // 2. Ruta Quiero comprarlo: iniciar_conversacion genera purchase_intent con intent_status = 'pending'
  const msgKey = "40000000-0000-4000-8000-000000000001";
  let msgId: string;
  await test("iniciar_conversacion creates purchase_intent message with pending intent_status", async () => {
    const conv = await asActor(A,
      "SELECT public.iniciar_conversacion($1,$2,'compra',$3)",
      [B, pb, msgKey]
    );
    assert.equal(conv.mensaje_nuevo, true);
    msgId = conv.message_id;
    assert.ok(msgId);

    const msg = await scalar("SELECT to_jsonb(m) FROM public.messages m WHERE id=$1", [msgId]);
    assert.equal(msg.message_type, "purchase_intent");
    assert.equal(msg.intent_status, "pending");
    assert.equal(msg.sale_confirmation_id, null);
  });

  // 3. Destinatario (Vendedor B) acepta la intencion de compra
  let saleId: string;
  await test("seller accepts purchase intent -> creates sale_confirmation with seller confirmed & buyer pending", async () => {
    // Buyer cannot accept own intent
    await rejects(() => asActor(A, "SELECT public.responder_intencion_compra($1, 'aceptar')", [msgId]), "42501");
    // Third party cannot accept
    await rejects(() => asActor(C, "SELECT public.responder_intencion_compra($1, 'aceptar')", [msgId]), "PT404");

    const res = await asActor(B, "SELECT public.responder_intencion_compra($1, 'aceptar')", [msgId]);
    assert.equal(res.success, true);
    assert.equal(res.status, "accepted");
    assert.equal(res.repeated, false);
    assert.ok(res.confirmation.id);
    saleId = res.confirmation.id;

    assert.equal(res.confirmation.seller_id, B);
    assert.equal(res.confirmation.buyer_id, A);
    assert.equal(res.confirmation.seller_confirmed, true);
    assert.equal(res.confirmation.buyer_confirmed, false);
    assert.equal(res.confirmation.status, "pending_confirmation");
    assert.equal(res.confirmation.purchase_intent_message_id, msgId);

    // Message is now linked and accepted
    const msg = await scalar("SELECT to_jsonb(m) FROM public.messages m WHERE id=$1", [msgId]);
    assert.equal(msg.intent_status, "accepted");
    assert.equal(msg.sale_confirmation_id, saleId);
  });

  // 4. Idempotencia al aceptar compra
  await test("repeated accept returns existing confirmation without duplicate", async () => {
    const res = await asActor(B, "SELECT public.responder_intencion_compra($1, 'aceptar')", [msgId]);
    assert.equal(res.repeated, true);
    assert.equal(res.confirmation.id, saleId);
  });

  // 5. Comprador confirma recepcion -> status = completed
  await test("buyer confirms receipt -> sale completes and trust points awarded", async () => {
    const res = await asActor(A, "SELECT public.confirmar_venta($1)", [saleId]);
    assert.equal(res.success, true);
    assert.equal(res.alreadyConfirmed, false);

    const sale = await scalar("SELECT to_jsonb(sc) FROM public.sale_confirmations sc WHERE id=$1", [saleId]);
    assert.equal(sale.status, "completed");
    assert.equal(sale.buyer_confirmed, true);
    assert.equal(sale.seller_confirmed, true);

    // Trust points: seller B got +10, buyer A got +3
    const sellerTrust = await scalar("SELECT trust_points FROM public.profiles WHERE id=$1", [B]);
    const buyerTrust = await scalar("SELECT trust_points FROM public.profiles WHERE id=$1", [A]);
    assert.equal(sellerTrust, 10);
    assert.equal(buyerTrust, 3);
  });

  // 6. Rechazo de intencion de compra en nueva solicitud
  await test("seller can reject a purchase intent without creating sale confirmation", async () => {
    const msgKey2 = "40000000-0000-4000-8000-000000000002";
    const conv2 = await asActor(A,
      "SELECT public.iniciar_conversacion($1,$2,'compra',$3)",
      [B, pb, msgKey2]
    );
    const msgId2 = conv2.message_id;

    const res = await asActor(B, "SELECT public.responder_intencion_compra($1, 'rechazar')", [msgId2]);
    assert.equal(res.success, true);
    assert.equal(res.status, "rejected");

    const msg = await scalar("SELECT to_jsonb(m) FROM public.messages m WHERE id=$1", [msgId2]);
    assert.equal(msg.intent_status, "rejected");
    assert.equal(msg.sale_confirmation_id, null);

    // Subsequent accept on rejected intent is rejected with PT409
    await rejects(() => asActor(B, "SELECT public.responder_intencion_compra($1, 'aceptar')", [msgId2]), "PT409");
  });

  // 7. Resenas generales del local: publicar_resena_local
  await test("publicar_resena_local allows general reviews without sale", async () => {
    // Unauthenticated rejected
    await rejects(() => asActor(null, "SELECT public.publicar_resena_local($1, 5, 'Excelente local')", [B]), "42501");
    // Self review rejected
    await rejects(() => asActor(B, "SELECT public.publicar_resena_local($1, 5, 'Mi propio local')", [B]), "22023");
    // Invalid rating rejected
    await rejects(() => asActor(C, "SELECT public.publicar_resena_local($1, 6, 'Invalido')", [B]), "22023");

    // Actor C (who has NO sales with B) reviews local B
    const res = await asActor(C, "SELECT public.publicar_resena_local($1, 4, 'Buena atencion en tienda')", [B]);
    assert.equal(res.success, true);
    assert.equal(res.review.rating, 4);
    assert.equal(res.review.origen, "local");
    assert.equal(res.review.sale_confirmation_id, null);
    assert.equal(res.review.product_id, null);

    // Profile average rating and count updated, but trust points NOT awarded for local reviews
    const profileB = await scalar("SELECT to_jsonb(p) FROM public.profiles p WHERE id=$1", [B]);
    assert.equal(profileB.reviews_count, 1);
    assert.equal(Number(profileB.average_rating), 4);
    assert.equal(profileB.trust_points, 10); // unchanged from completed sale earlier!

    const profileC = await scalar("SELECT to_jsonb(p) FROM public.profiles p WHERE id=$1", [C]);
    assert.equal(profileC.trust_points, 0); // No bonus for general review
  });

  // 8. Resena general es editable por el mismo autor sin duplicar
  await test("editing general review updates in place without duplicating count", async () => {
    const res = await asActor(C, "SELECT public.publicar_resena_local($1, 5, 'Mejor aun!')", [B]);
    assert.equal(res.success, true);
    assert.equal(res.review.rating, 5);

    const profileB = await scalar("SELECT to_jsonb(p) FROM public.profiles p WHERE id=$1", [B]);
    assert.equal(profileB.reviews_count, 1); // Still 1!
    assert.equal(Number(profileB.average_rating), 5); // Updated to 5.00!
  });

  // 9. Resena por compra completada usa origen = 'venta' y otorga trust points
  await test("sale review uses origen='venta' and awards trust points", async () => {
    await asActor(A,
      "INSERT INTO public.reviews (sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating, comentario, fotos) VALUES ($1,$2,$3,$4,'buyer_to_seller',5,'Excelente compra verificada','{}')",
      [saleId, pb, A, B]
    );

    const profileB = await scalar("SELECT to_jsonb(p) FROM public.profiles p WHERE id=$1", [B]);
    assert.equal(profileB.reviews_count, 2); // 1 local + 1 venta = 2
    assert.equal(Number(profileB.average_rating), 5); // (5+5)/2 = 5
    assert.equal(profileB.trust_points, 15); // 10 from sale + 5 from 5-star review!
  });


  const newIntent = async () => {
    const key = await scalar("SELECT gen_random_uuid()");
    const r = await asActor(A,"SELECT iniciar_conversacion($1,$2,'compra',$3)",[B,pb,key]);
    return r.message_id as string;
  };
  const cancel = async (id: string) => asActor(B,"UPDATE sale_confirmations SET status='cancelled',cancelled_by=$1,cancelled_at=now() WHERE id=$2",[B,id]);

  await test("old intents retain no snapshot and expose no action controls", async () => {
    assert.equal(await scalar("SELECT intent_snapshot FROM messages WHERE id=$1",[legacyId]),null);
    await rejects(()=>asActor(B,"SELECT responder_intencion_compra($1,'aceptar')",[legacyId]),"PT409");
    const page = await asActor(B,"SELECT get_chat_operations($1,NULL,100,ARRAY[$2]::uuid[])",[chat,legacyId]);
    assert.equal(page.items.length,1); assert.equal(page.items[0].status,"legacy");
    assert.equal(page.items[0].canRespond,false); assert.equal(page.items[0].canConfirm,false);
  });
  await test("original fixed total and title survive listing edits", async () => {
    const id=await newIntent();
    await db.query("UPDATE products_services SET precio=75,titulo='Edited title' WHERE id=$1",[pb]);
    const accepted=await asActor(B,"SELECT responder_intencion_compra($1,'aceptar')",[id]);
    assert.equal(accepted.confirmation.precio_acordado,30);
    assert.equal(accepted.confirmation.terms_snapshot.title,"Producto B");
    assert.equal(accepted.confirmation.buyer_confirmed,false);
    await rejects(()=>scalar("UPDATE messages SET intent_snapshot='{}' WHERE id=$1",[id]),"42501");
    await rejects(()=>scalar("UPDATE sale_confirmations SET precio_acordado=99 WHERE id=$1",[accepted.confirmation.id]),"42501");
    await cancel(accepted.confirmation.id);
  });
  await test("quote and reservation need explicit positive total proposals", async () => {
    for(const mode of ["cotizacion","reservacion"]){
      await db.query("UPDATE products_services SET modo_precio=$1 WHERE id=$2",[mode,pb]);
      const id=await newIntent();
      await rejects(()=>asActor(B,"SELECT responder_intencion_compra($1,'aceptar')",[id]),"PT409");
      for(const [price,qty] of [[0,1],[40,0],[40.001,1],[null,1]]){
        await rejects(()=>asActor(B,"SELECT responder_intencion_compra($1,'aceptar',$2,$3,'terms')",[id,price,qty]),"22023");
      }
      const r=await asActor(B,"SELECT responder_intencion_compra($1,'aceptar',40,2,'Two units')",[id]);
      assert.equal(r.proposal,true); assert.equal(r.confirmation.precio_acordado,40); assert.equal(r.confirmation.cantidad,2);
      assert.equal(r.confirmation.buyer_confirmed,false); assert.equal(r.confirmation.seller_confirmed,true);
      assert.equal((await asActor(B,"SELECT responder_intencion_compra($1,'aceptar',40,2,'Two units')",[id])).repeated,true);
      await rejects(()=>asActor(B,"SELECT responder_intencion_compra($1,'aceptar',45,2,'Two units')",[id]),"PT409");
      await cancel(r.confirmation.id);
    }
    await db.query("UPDATE products_services SET modo_precio='fijo' WHERE id=$1",[pb]);
  });
  await test("blocks in either direction and hidden counterparts deny accept and retry", async () => {
    const id=await newIntent();
    for(const [from,to] of [[A,B],[B,A]]){
      await db.query("INSERT INTO user_blocks VALUES($1,$2)",[from,to]);
      await rejects(()=>asActor(B,"SELECT responder_intencion_compra($1,'aceptar')",[id]),"PT404");
      await rejects(()=>asActor(B,"SELECT get_chat_operations($1)",[chat]),"PT404");
      await db.exec("DELETE FROM user_blocks");
    }
    await db.query("UPDATE profiles SET is_hidden=true WHERE id=$1",[A]);
    await rejects(()=>asActor(B,"SELECT responder_intencion_compra($1,'aceptar')",[id]),"PT404");
    await db.query("UPDATE profiles SET is_hidden=false WHERE id=$1",[A]);
    await db.query("UPDATE profiles SET is_hidden=true WHERE id=$1",[B]);
    await rejects(()=>asActor(B,"SELECT responder_intencion_compra($1,'aceptar')",[id]),"42501");
    await db.query("UPDATE profiles SET is_hidden=false WHERE id=$1",[B]);
    await asActor(B,"SELECT responder_intencion_compra($1,'rechazar')",[id]);
  });
  await test("reversed chat roles follow listing ownership and one pending contract",async()=>{
    const key=await scalar("SELECT gen_random_uuid()");
    const r=await asActor(B,"SELECT iniciar_conversacion($1,$2,'compra',$3)",[A,pa,key]);
    const accepted=await asActor(A,"SELECT responder_intencion_compra($1,'aceptar')",[r.message_id]);
    assert.equal(accepted.confirmation.seller_id,A); assert.equal(accepted.confirmation.buyer_id,B);
    assert.equal(accepted.confirmation.seller_confirmed,true); assert.equal(accepted.confirmation.buyer_confirmed,false);
    const next=await newIntent();
    await rejects(()=>asActor(B,"SELECT responder_intencion_compra($1,'aceptar')",[next]),"PT409");
    await db.query("INSERT INTO user_blocks VALUES($1,$2)",[A,B]);
    await rejects(()=>asActor(A,"SELECT responder_intencion_compra($1,'aceptar')",[r.message_id]),"PT404");
    await db.exec("DELETE FROM user_blocks");
    await cancel(accepted.confirmation.id);
    const retry=await asActor(A,"SELECT responder_intencion_compra($1,'aceptar')",[r.message_id]);
    assert.equal(retry.confirmation.status,"cancelled");
    await rejects(()=>asActor(B,"SELECT confirmar_venta($1)",[accepted.confirmation.id]),"PT409");
    await asActor(B,"SELECT responder_intencion_compra($1,'rechazar')",[next]);
  });
  await test("real message sender and receipt guards survive snapshot triggers",async()=>{
    await rejects(()=>asActor(A,"INSERT INTO messages(chat_id,autor_id,texto) VALUES($1,$2,'spoof')",[chat,B]),"42501");
    await rejects(()=>asActor(A,"INSERT INTO messages(chat_id,autor_id,texto,sale_confirmation_id) VALUES($1,$2,'forged link',$3)",[chat,A,saleId]),"42501");
    // Grant participant UPDATE in this isolated fixture to prove the trigger remains
    // secure even if broader table ACLs/policies are restored accidentally.
    await db.exec("GRANT UPDATE ON messages TO authenticated; CREATE POLICY fixture_message_update ON messages FOR UPDATE USING(EXISTS(SELECT 1 FROM chats c WHERE c.id=messages.chat_id AND auth.uid() IN(c.comprador_id,c.vendedor_id)));");
    await rejects(()=>asActor(A,"UPDATE messages SET intent_status='rejected' WHERE id=$1",[msgId]),"42501");
    await rejects(()=>asActor(A,"UPDATE messages SET sale_confirmation_id=NULL WHERE id=$1",[msgId]),"42501");
    await db.exec("DROP POLICY fixture_message_update ON messages;REVOKE UPDATE ON messages FROM authenticated;");
    const snapshot=await scalar("SELECT intent_snapshot FROM messages WHERE id=$1",[msgId]);
    await asActor(B,"SELECT mark_messages_as_read($1,$2)",[chat,A]);
    assert.deepEqual(await scalar("SELECT intent_snapshot FROM messages WHERE id=$1",[msgId]),snapshot);
    await rejects(()=>asActor(A,"UPDATE chats SET no_leidos_vendedor=99 WHERE id=$1",[chat]),"42501");
  });
  await test("null or hidden listing cannot be accepted",async()=>{
    const id=await newIntent();
    for(const update of ["estatus=NULL","is_hidden=true","is_hidden=NULL"]){
      await db.query(`UPDATE products_services SET ${update} WHERE id=$1`,[pb]);
      await rejects(()=>asActor(B,"SELECT responder_intencion_compra($1,'aceptar')",[id]),"PT404");
      await db.query("UPDATE products_services SET estatus='disponible',is_hidden=false WHERE id=$1",[pb]);
    }
    await asActor(B,"SELECT responder_intencion_compra($1,'rechazar')",[id]);
  });
  await test("structured intent cannot be forged through authenticated table insert", async()=>{
    await rejects(()=>asActor(A,"INSERT INTO messages(chat_id,autor_id,texto,publicacion_id,message_type) VALUES($1,$2,'fake',$3,'purchase_intent')",[chat,A,pb]),"42501");
    await rejects(()=>asActor(null,"SELECT get_chat_operations($1)",[chat]),"42501");
    await rejects(()=>asActor(C,"SELECT get_chat_operations($1)",[chat]),"PT404");
  });
  await test("operations paginate deterministically and resolve old structured message IDs", async()=>{
    const seen=new Set<string>(); let cursor=null; let pages=0;
    do {
      const page=await asActor(A,"SELECT get_chat_operations($1,$2,2)",[chat,cursor]);
      for(const item of page.items){assert.ok(!seen.has(item.id));seen.add(item.id);}
      cursor=page.nextCursor; pages++; assert.ok(pages<30);
    } while(cursor);
    assert.ok(seen.size>=8);
    const proposed=await scalar("SELECT id FROM messages WHERE message_type='sale_proposed' ORDER BY created_at LIMIT 1");
    const page=await asActor(A,"SELECT get_chat_operations($1,NULL,100,ARRAY[$2]::uuid[])",[chat,proposed]);
    assert.equal(page.items.length,1); assert.equal(page.items[0].source,"manual"); assert.equal(page.items[0].status,"cancelled");
    await db.query("UPDATE products_services SET is_hidden=true WHERE id=$1",[pb]);
    const hidden=await asActor(A,"SELECT get_chat_operations($1,NULL,100,ARRAY[$2]::uuid[])",[chat,saleId]);
    assert.equal(hidden.items[0].product,null); assert.equal(hidden.items[0].title,"Producto B");
    await db.query("UPDATE products_services SET is_hidden=false,estatus='eliminado' WHERE id=$1",[pb]);
    const deleted=await asActor(B,"SELECT get_chat_operations($1,NULL,100,ARRAY[$2]::uuid[])",[chat,saleId]);
    assert.equal(deleted.items[0].product,null); assert.equal(deleted.items[0].title,"Producto B");
    await db.query("UPDATE products_services SET estatus='disponible' WHERE id=$1",[pb]);
  });
  await test("completion retries preserve exactly one completion effect", async()=>{
    const before=await scalar("SELECT jsonb_build_array(trust_points,total_sales) FROM profiles WHERE id=$1",[B]);
    for(let i=0;i<3;i++) assert.equal((await asActor(A,"SELECT confirmar_venta($1)",[saleId])).alreadyConfirmed,true);
    assert.deepEqual(await scalar("SELECT jsonb_build_array(trust_points,total_sales) FROM profiles WHERE id=$1",[B]),before);
    assert.equal(await scalar("SELECT count(*)::int FROM messages WHERE sale_confirmation_id=$1 AND message_type='sale_confirmed'",[saleId]),1);
  });
  await test("verified label is server computed for public readers and aggregate spans all visible seller reviews",async()=>{
    const r=await asActor(C,"SELECT leer_resenas_local($1)",[B]);
    assert.equal(r.summary.count,2); assert.equal(r.summary.buckets[5],2);
    assert.equal(r.reviews.filter((r:any)=>r.is_verified).length,1);
    assert.equal(r.own_local_review.rating,5);
    const page2=await asActor(C,"SELECT leer_resenas_local($1,1,1)",[B]);
    assert.equal(page2.summary.count,2); assert.equal(page2.reviews.length,1);
    await rejects(()=>scalar("INSERT INTO reviews(reviewer_id,reviewed_id,review_type,rating,origen) VALUES($1,$2,'buyer_to_seller',5,'venta')",[C,B]),"23514");
  });
  await test("rating edits and visibility changes recalculate without any repeated reward",async()=>{
    const trust=await scalar("SELECT trust_points FROM profiles WHERE id=$1",[B]);
    const verifiedId=await scalar("SELECT id FROM reviews WHERE sale_confirmation_id=$1",[saleId]);
    await db.query("UPDATE reviews SET rating=4 WHERE id=$1",[verifiedId]);
    assert.equal(await scalar("SELECT trust_points FROM profiles WHERE id=$1",[B]),trust);
    assert.equal(Number(await scalar("SELECT average_rating FROM profiles WHERE id=$1",[B])),4.5);
    await db.query("UPDATE reviews SET is_hidden=true WHERE id=$1",[verifiedId]);
    assert.equal(await scalar("SELECT reviews_count FROM profiles WHERE id=$1",[B]),1);
    assert.equal(await scalar("SELECT reviews_count_as_seller FROM profiles WHERE id=$1",[B]),1);
    const r=await asActor(C,"SELECT leer_resenas_local($1)",[B]); assert.equal(r.summary.count,1);
    await db.query("UPDATE reviews SET is_hidden=false WHERE id=$1",[verifiedId]);
    assert.equal(await scalar("SELECT trust_points FROM profiles WHERE id=$1",[B]),trust);
  });
  await test("editing moderated local review preserves hidden state and private own prefill",async()=>{
    await db.query("UPDATE reviews SET is_hidden=true WHERE reviewer_id=$1 AND origen='local'",[C]);
    const saved=await asActor(C,"SELECT publicar_resena_local($1,3,'Edited while hidden')",[B]);
    assert.equal(saved.review.visible,false); assert.equal(saved.review.is_hidden,true);
    const own=await asActor(C,"SELECT leer_resenas_local($1)",[B]);
    assert.equal(own.own_local_review.rating,3); assert.equal(own.own_local_review.visible,false); assert.equal(own.summary.count,1);
    const stranger=await asActor(A,"SELECT leer_resenas_local($1)",[B]); assert.equal(stranger.own_local_review,null);
  });
  await test("DELETE recalculates combined and separated averages using OLD",async()=>{
    await db.query("DELETE FROM reviews WHERE sale_confirmation_id=$1",[saleId]);
    assert.equal(await scalar("SELECT reviews_count FROM profiles WHERE id=$1",[B]),0);
    assert.equal(await scalar("SELECT reviews_count_as_seller FROM profiles WHERE id=$1",[B]),0);
    await db.query("DELETE FROM reviews WHERE reviewer_id=$1",[C]);
    assert.equal(await scalar("SELECT reviews_count FROM profiles WHERE id=$1",[B]),0);
  });
  await test("rollback preserves accumulated local rows and live trigger dependencies",async()=>{
    await asActor(C,"SELECT publicar_resena_local($1,4,'Keep this row')",[B]);
    await db.exec(await readFile(path.join(root,"docs/rollback/20261023010000_venta_chat_y_resenas_local_rollback.sql"),"utf8"));
    await rejects(()=>asActor(C,"SELECT publicar_resena_local($1,5,'disabled')",[B]),"42501");
    await db.query("UPDATE reviews SET rating=2 WHERE reviewer_id=$1 AND origen='local'",[C]);
    assert.equal(Number(await scalar("SELECT average_rating FROM profiles WHERE id=$1",[B])),2);
    assert.equal(await scalar("SELECT count(*)::int FROM reviews WHERE origen='local'"),1);
    await db.query("DELETE FROM reviews WHERE reviewer_id=$1",[C]);
    assert.equal(await scalar("SELECT reviews_count FROM profiles WHERE id=$1",[B]),0);
  });

  console.log(`\nALL ${tests} SQL CONTRACT TESTS PASSED!`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
