/** Aplica las migraciones pendientes del 27-sep (rama fix/base-pendiente-27-sep)
 * sobre un Postgres aislado en memoria (PGlite) con un esquema minimo, y las
 * ejercita con los roles anon y authenticated. Nada remoto: sin credenciales,
 * sin staging, sin prod. Prueba SQL, privilegios y RLS; no prueba la carga ni
 * los datos reales de produccion.
 *
 *   npx tsx scripts/test-migraciones-27-sep.ts
 *   (PGLITE_MODULE=<ruta absoluta a @electric-sql/pglite> si este checkout no tiene node_modules)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const requireRoot = createRequire(path.join(root, "package.json"));
const { PGlite } = requireRoot(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();
const migration = (name: string) => readFile(path.join(root, "supabase/migrations", name), "utf8");
let pasos = 0;
async function paso(nombre: string, fn: () => Promise<void>) {
  await fn();
  pasos++;
  console.log(`PASS ${nombre}`);
}
async function scalar(sql: string, params: unknown[] = []) {
  const r = await db.query(sql, params);
  return Object.values((r.rows[0] ?? {}) as Record<string, unknown>)[0];
}
async function como(rol: "anon" | "authenticated", sub: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${rol};`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [sub ?? ""]);
    const r = await db.query(sql, params);
    await db.exec("COMMIT");
    return r;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}
async function rechaza(fn: () => Promise<unknown>, codigo: string) {
  await assert.rejects(fn, (e: { code?: string }) => {
    assert.equal(e.code, codigo);
    return true;
  });
}

const A = "00000000-0000-4000-8000-00000000000a"; // comprador
const V = "00000000-0000-4000-8000-00000000000b"; // vendedor
const OTRO = "00000000-0000-4000-8000-00000000000c";
const P = "20000000-0000-4000-8000-000000000001";
const P2 = "20000000-0000-4000-8000-000000000002";
const SALE = "30000000-0000-4000-8000-000000000001";

async function esquemaMinimo() {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE SCHEMA vicino_guard; GRANT USAGE ON SCHEMA vicino_guard TO anon, authenticated;
    CREATE FUNCTION vicino_guard.cuenta_suspendida() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE TYPE sale_status AS ENUM ('pending_confirmation', 'completed', 'cancelled');
    CREATE TYPE review_type AS ENUM ('buyer_to_seller', 'seller_to_buyer');

    CREATE TABLE categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, activo boolean DEFAULT true);
    INSERT INTO categories (slug) VALUES ('libros'), ('ropa');
    INSERT INTO categories (slug, activo) VALUES ('archivada', false);
    -- Como en prod: SELECT con RLS que solo deja ver las activas.
    GRANT SELECT ON categories TO anon, authenticated;
    ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Anyone can view active categories" ON categories FOR SELECT USING (activo = true);
    CREATE TABLE profiles (id uuid PRIMARY KEY);
    INSERT INTO profiles VALUES ('${A}'), ('${V}'), ('${OTRO}');
    CREATE TABLE products_services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creador_id uuid, titulo text, descripcion text,
      categoria text NOT NULL, categoria_id uuid REFERENCES categories(id), precio numeric, estatus text,
      updated_at timestamptz DEFAULT now());
    GRANT SELECT, INSERT ON products_services TO authenticated;
    GRANT UPDATE (titulo, categoria, categoria_id) ON products_services TO authenticated;
    -- Filas legadas publicadas desde la app: categoria_id NULL.
    INSERT INTO products_services (id, creador_id, titulo, categoria, precio, estatus)
      VALUES ('${P}', '${V}', 'Legado', 'ropa', 10, 'disponible'), ('${P2}', '${OTRO}', 'Ajeno', 'libros', 10, 'disponible');

    CREATE TABLE sale_confirmations (id uuid PRIMARY KEY, product_id uuid NOT NULL, buyer_id uuid, seller_id uuid, status sale_status);
    GRANT SELECT ON sale_confirmations TO authenticated;
    INSERT INTO sale_confirmations VALUES ('${SALE}', '${P}', '${A}', '${V}', 'completed');

    CREATE TABLE reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_confirmation_id uuid, product_id uuid, reviewer_id uuid,
      reviewed_id uuid, review_type review_type, rating int, comentario text, fotos text[], respuesta text,
      respuesta_fecha timestamptz, created_at timestamptz DEFAULT now(), is_hidden boolean DEFAULT false);
    GRANT SELECT, INSERT, UPDATE, DELETE ON reviews TO authenticated;
    ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Participants can create reviews on completed sales" ON reviews FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY lectura ON reviews FOR SELECT USING (true);
    CREATE POLICY responder ON reviews FOR UPDATE USING (reviewed_id = auth.uid());

    CREATE TABLE seller_rankings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, category_id uuid,
      period text, ingresos numeric, ventas_count int, response_avg_minutes numeric);
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON seller_rankings TO anon, authenticated;
    ALTER TABLE seller_rankings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Rankings are publicly readable" ON seller_rankings FOR SELECT USING (true);
    INSERT INTO seller_rankings (seller_id, category_id, period, ingresos, ventas_count) VALUES ('${V}', gen_random_uuid(), '2026-09', 12800, 3);
    CREATE FUNCTION get_ranking_hiperlocal() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;

    CREATE TABLE bookings (id uuid PRIMARY KEY);
    CREATE FUNCTION notify_push() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE FUNCTION call_send_push_real() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TRIGGER on_sale_confirmation_inserted AFTER INSERT ON sale_confirmations FOR EACH ROW EXECUTE FUNCTION notify_push();
    CREATE TRIGGER on_booking_inserted AFTER INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION notify_push();
    CREATE TRIGGER push_on_sale_pgnet AFTER INSERT ON sale_confirmations FOR EACH ROW EXECUTE FUNCTION call_send_push_real();
    CREATE TRIGGER "push-on-booking" AFTER INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION call_send_push_real();

    -- La version vieja de la funcion de recalculo (firma real), con ACL de prod.
    CREATE FUNCTION recompute_seller_rankings_for_category(p_category_id uuid, p_period text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
    REVOKE ALL ON FUNCTION recompute_seller_rankings_for_category(uuid, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION recompute_seller_rankings_for_category(uuid, text) TO service_role;
  `);
}

async function main() {
  await esquemaMinimo();
  const ropa = await scalar("SELECT id FROM categories WHERE slug='ropa'");
  const libros = await scalar("SELECT id FROM categories WHERE slug='libros'");

  await paso("140000 aplica y el backfill rellena categoria_id desde el slug", async () => {
    await db.exec(await migration("20260927140000_categoria_id_desde_el_slug.sql"));
    assert.equal(await scalar("SELECT categoria_id FROM products_services WHERE id=$1", [P]), ropa);
    assert.equal(await scalar("SELECT categoria_id FROM products_services WHERE id=$1", [P2]), libros);
  });

  await paso("140000: el vendedor no puede hacer PATCH de categoria_id (42501)", async () => {
    await rechaza(() => como("authenticated", V, "UPDATE products_services SET categoria_id=$1 WHERE id=$2", [libros, P]), "42501");
  });

  await paso("140000: aunque alguien con privilegios mande un id, gana el slug", async () => {
    await db.query("UPDATE products_services SET categoria_id=$1 WHERE id=$2", [libros, P]);
    assert.equal(await scalar("SELECT categoria_id FROM products_services WHERE id=$1", [P]), ropa);
  });

  await paso("140000: cambiar la categoria por la app mueve el id; slug desconocido conserva el anterior", async () => {
    await como("authenticated", V, "UPDATE products_services SET categoria='libros' WHERE id=$1", [P]);
    assert.equal(await scalar("SELECT categoria_id FROM products_services WHERE id=$1", [P]), libros);
    await db.query("UPDATE products_services SET categoria='no-existe' WHERE id=$1", [P]);
    assert.equal(await scalar("SELECT categoria_id FROM products_services WHERE id=$1", [P]), libros);
    await db.query("UPDATE products_services SET categoria='ropa' WHERE id=$1", [P]);
  });

  await paso("140000: el id no depende de la RLS de quien edita (categoria inactiva)", async () => {
    const archivada = await scalar("SELECT id FROM categories WHERE slug='archivada'");
    await como("authenticated", V, "UPDATE products_services SET categoria='archivada' WHERE id=$1", [P]);
    assert.equal(await scalar("SELECT categoria_id FROM products_services WHERE id=$1", [P]), archivada);
    await db.query("UPDATE products_services SET categoria='ropa' WHERE id=$1", [P]);
  });

  await paso("140000: INSERT con slug desconocido e id explicito queda en NULL", async () => {
    const id = await scalar("INSERT INTO products_services (creador_id, titulo, categoria, categoria_id, precio, estatus) VALUES ($1,'x','no-existe',$2,1,'disponible') RETURNING id", [V, ropa]);
    assert.equal(await scalar("SELECT categoria_id FROM products_services WHERE id=$1", [id]), null);
  });

  await paso("140000 es idempotente", async () => {
    await db.exec(await migration("20260927140000_categoria_id_desde_el_slug.sql"));
  });

  await paso("150000 quita notify_push y deja el push real", async () => {
    await db.exec(await migration("20260927150000_quitar_notify_push_sin_autorizacion.sql"));
    assert.equal(await scalar("SELECT count(*)::int FROM pg_proc WHERE proname='notify_push'"), 0);
    assert.equal(await scalar("SELECT count(*)::int FROM pg_trigger WHERE tgname IN ('push_on_sale_pgnet','push-on-booking')"), 2);
    await db.exec(await migration("20260927150000_quitar_notify_push_sin_autorizacion.sql"));
  });

  await db.exec(await migration("20260927160000_resenas_sin_columnas_forjables.sql"));
  const base = [SALE, P, A, V, "buyer_to_seller", 5];
  await paso("160000: el comprador ya no puede insertar respuesta ni created_at (42501)", async () => {
    await rechaza(() => como("authenticated", A,
      "INSERT INTO reviews (sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating, respuesta) VALUES ($1,$2,$3,$4,$5,$6,'falsa')", base), "42501");
    await rechaza(() => como("authenticated", A,
      "INSERT INTO reviews (sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating, created_at) VALUES ($1,$2,$3,$4,$5,$6,'2026-08-15')", base), "42501");
  });

  await paso("160000: un product_id que no es el de la venta lo rechaza la policy (42501)", async () => {
    await rechaza(() => como("authenticated", A,
      "INSERT INTO reviews (sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating) VALUES ($1,$2,$3,$4,$5,$6)",
      [SALE, P2, A, V, "buyer_to_seller", 5]), "42501");
  });

  await paso("160000: la resena legitima (las 8 columnas de la app) entra y el vendedor puede responder", async () => {
    await como("authenticated", A,
      "INSERT INTO reviews (sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating, comentario, fotos) VALUES ($1,$2,$3,$4,$5,$6,'bien',ARRAY[]::text[])", base);
    await como("authenticated", V, "UPDATE reviews SET respuesta='gracias', respuesta_fecha=now() WHERE reviewed_id=$1", [V]);
    assert.equal(await scalar("SELECT respuesta FROM reviews WHERE reviewer_id=$1", [A]), "gracias");
  });

  await paso("160000: un tercero no resena una venta ajena (42501)", async () => {
    await rechaza(() => como("authenticated", OTRO,
      "INSERT INTO reviews (sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating) VALUES ($1,$2,$3,$4,$5,$6)",
      [SALE, P, OTRO, V, "buyer_to_seller", 1]), "42501");
  });

  await db.exec(await migration("20260927170000_seller_rankings_sin_ingresos_publicos.sql"));
  await paso("170000: anon y authenticated ya no leen ingresos ni seller_id (42501)", async () => {
    await rechaza(() => como("anon", null, "SELECT ingresos FROM seller_rankings"), "42501");
    await rechaza(() => como("authenticated", A, "SELECT seller_id, ventas_count FROM seller_rankings"), "42501");
  });

  await paso("170000: la consulta que usa la app (category_id por periodo) sigue funcionando", async () => {
    const r = await como("anon", null, "SELECT category_id FROM seller_rankings WHERE period='2026-09'");
    assert.equal(r.rows.length, 1);
  });

  await paso("180000: el mes se corta en CDMX, sin sobrecarga y sin EXECUTE para anon", async () => {
    await db.exec(await migration("20260927180000_ranking_mes_en_hora_de_cdmx.sql"));
    assert.equal(await scalar("SELECT count(*)::int FROM pg_proc WHERE proname='recompute_seller_rankings_for_category'"), 1);
    const inicio = await scalar("SELECT to_char((('2026-09' || '-01')::timestamp AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')");
    const fin = await scalar("SELECT to_char(((('2026-09' || '-01')::timestamp + INTERVAL '1 month') AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')");
    assert.equal(inicio, "2026-09-01 06:00");
    assert.equal(fin, "2026-10-01 06:00");
    assert.equal(await scalar("SELECT has_function_privilege('service_role', 'recompute_seller_rankings_for_category(uuid, text)', 'EXECUTE')"), true);
    assert.equal(await scalar("SELECT has_function_privilege('anon', 'recompute_seller_rankings_for_category(uuid, text)', 'EXECUTE')"), false);
  });

  console.log(`\n${pasos}/${pasos} pasos OK (PGlite en memoria, sin nada remoto).`);
}

main().catch((e) => {
  console.error(`FALLO: ${e.message}`);
  process.exit(1);
});
