/** Executes the real migration in PostgreSQL/PGlite. Geography is a point shim;
 * this verifies SQL contracts, identity, idempotency and storage RLS, not PostGIS. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { COMMUNITY_CATEGORIES } from "../packages/shared/src/constants/community-categories";

const uid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixtures = [
  ["93f9bc9c-b899-4f47-b0f6-c80e2aa940da", "Tecnología Villahermosa", "tecnologia"],
  ["6b777773-f6c8-471e-bbc1-0488837b3cbd", "Sabores de Villahermosa", "comida"],
  ["1c0eeddd-eadf-4cdd-8b88-f12656910be3", "Hogar y Servicios Tabasco", "servicios-hogar"],
  ["99e60f68-1b50-4713-b7b6-2f1ab7b69fda", "Intercambios Tabasco 2000", "comunidad-vecinal"],
  ["24278f23-1e68-447a-b0e9-0df9dae01960", "Vecinos Tabasco 2000", "comunidad-vecinal"],
  ["7090ab5d-bb07-4f03-82b8-a85d909e1684", "Club Emprendedores Vhsa", "otros"],
] as const;
const db = new PGlite();
let passed = 0;
async function test(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }
async function asUser<T>(user: string | null, fn: () => Promise<T>, role = "authenticated") {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${user ?? ""}',false)`);
  try { return await fn(); } finally { await db.exec("RESET ROLE"); }
}
async function create(n: number, category: string | null = "comunidad-vecinal", privateGroup = false) {
  return db.query<{ value: { id: string; es_privada: boolean } }>("SELECT public.fundar_comunidad_v2($1,17.99,-92.94,NULL,$2,$3,$4) AS value", [`Grupo ${n}`, category, privateGroup, uid(n)]);
}
async function main() {
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth,storage TO anon,authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
    CREATE DOMAIN public.geometry AS point; CREATE DOMAIN public.geography AS point;
    CREATE FUNCTION public.ST_MakePoint(float8,float8) RETURNS public.geometry IMMUTABLE LANGUAGE sql AS $$ SELECT point($1,$2)::public.geometry $$;
    CREATE FUNCTION public.ST_SetSRID(public.geometry,integer) RETURNS public.geometry IMMUTABLE LANGUAGE sql AS $$ SELECT $1 $$;
    CREATE FUNCTION public.ST_X(public.geometry) RETURNS float8 IMMUTABLE LANGUAGE sql AS $$ SELECT ($1::point)[0] $$;
    CREATE FUNCTION public.ST_Y(public.geometry) RETURNS float8 IMMUTABLE LANGUAGE sql AS $$ SELECT ($1::point)[1] $$;
    CREATE FUNCTION public.ST_Distance(public.geography,public.geography) RETURNS float8 IMMUTABLE LANGUAGE sql AS $$ SELECT ($1::point <-> $2::point)*111000 $$;
    CREATE FUNCTION public.ST_DWithin(public.geography,public.geography,float8) RETURNS boolean IMMUTABLE LANGUAGE sql AS $$ SELECT public.ST_Distance($1,$2)<=$3 $$;
    CREATE TABLE public.categories(id uuid PRIMARY KEY,slug text UNIQUE,nombre text,activo boolean DEFAULT true);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_hidden boolean DEFAULT false);
    CREATE TABLE public.communities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),nombre text,descripcion text,
      owner_id uuid,fundador_id uuid,centro public.geography,es_privada boolean DEFAULT false,is_hidden boolean DEFAULT false,
      archived_at timestamptz,miembros_count integer DEFAULT 1,publicaciones_count integer DEFAULT 0,ultima_publicacion_at timestamptz,created_at timestamptz DEFAULT now());
    CREATE TABLE public.community_members(community_id uuid,user_id uuid,role text,left_at timestamptz);
    CREATE TABLE public.community_join_requests(community_id uuid,user_id uuid,status text);
    CREATE TABLE public.community_posts(community_id uuid,author_id uuid,parent_post_id uuid,is_hidden boolean DEFAULT false,created_at timestamptz DEFAULT now());
    CREATE TABLE public.vicino_cobertura(clave text); INSERT INTO public.vicino_cobertura VALUES('operacion');
    CREATE FUNCTION public.dentro_de_cobertura(float8,float8) RETURNS boolean IMMUTABLE LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION public.hay_bloqueo_con(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.solicitud_aceptada_vigente(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.comunidades_limite(text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT CASE $1 WHEN 'radio_descubrir_metros' THEN 5000 WHEN 'pagina_descubrir' THEN 30 WHEN 'membresias_vivas' THEN 20 ELSE 1000 END $$;
    CREATE FUNCTION public.comunidad_fundacion_estado(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('puede_fundar',true) $$;
    CREATE FUNCTION public.mis_comunidades() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
    CREATE FUNCTION public.descubrir_comunidades(float8,float8,integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
    CREATE FUNCTION public.detalle_comunidad(uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
    CREATE FUNCTION public.home_guest_communities_preview(integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
    CREATE FUNCTION public.fundar_comunidad(text,float8,float8,text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON storage.objects TO anon; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
    CREATE POLICY unrelated_broad_policy ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
    CREATE POLICY unrelated_broad_anon_read ON storage.objects FOR SELECT TO anon USING(true);
    INSERT INTO public.profiles(id) VALUES('${uid(1)}'),('${uid(2)}'),('${uid(3)}');`);
  for (const [index, category] of COMMUNITY_CATEGORIES.entries()) {
    if (category.sourceCategoryId) await db.query("INSERT INTO public.categories VALUES($1,$2,$3,true)", [uid(1000 + index), category.id, category.name]);
  }
  for (const [id, nombre] of fixtures) await db.query("INSERT INTO public.communities(id,nombre,owner_id,centro) VALUES($1,$2,$3,point(-90,20))", [id, nombre, uid(2)]);
  await db.query("INSERT INTO public.communities(id,nombre,owner_id,centro) VALUES($1,'Comunidad previa conservada',$2,point(-90,20))", [uid(30), uid(2)]);
  const migration = await readFile("supabase/migrations/20261014054500_comunidades_categorias_foto.sql", "utf8");
  await db.exec(migration);
  await test("six_scoped_backfills_and_other_existing_groups_preserved", async () => {
    for (const [id, nombre, category] of fixtures) {
      assert.deepEqual((await db.query("SELECT nombre,categoria_id FROM public.communities WHERE id=$1", [id])).rows[0], { nombre, categoria_id: category });
    }
    assert.equal((await db.query("SELECT categoria_id FROM public.communities WHERE id=$1", [uid(30)])).rows[0].categoria_id, "otros");
  });
  await test("catalog_33_options_separate_from_marketplace", async () => {
    assert.deepEqual((await db.query<{ id: string }>("SELECT id FROM public.community_categories ORDER BY id")).rows.map(row => row.id), COMMUNITY_CATEGORIES.map(category => category.id).sort());
    assert.equal((await db.query("SELECT * FROM public.categories WHERE slug='comunidad-vecinal'")).rows.length, 0);
    assert.equal((await db.query("SELECT to_regprocedure('public.fundar_comunidad(text,double precision,double precision,text)') AS legacy")).rows[0].legacy !== null, true);
  });
  await test("required_category_and_auth", async () => {
    await asUser(uid(1), () => assert.rejects(create(10, null), /categoria/));
    await asUser(null, () => assert.rejects(create(10), /sesion/));
    await asUser(uid(1), () => assert.rejects(create(10, "Negocios"), /categoria/));
  });
  await test("atomic_privacy_membership_and_category", async () => {
    const result = await asUser(uid(1), () => create(10, "tecnologia", true));
    assert.equal(result.rows[0].value.es_privada, true);
    const row = (await db.query("SELECT categoria_id,es_privada FROM public.communities WHERE id=$1", [uid(10)])).rows[0];
    assert.deepEqual(row, { categoria_id: "tecnologia", es_privada: true });
    assert.equal((await db.query("SELECT role FROM public.community_members WHERE community_id=$1", [uid(10)])).rows[0].role, "owner");
  });
  await test("retry_same_creation_does_not_duplicate", async () => {
    await asUser(uid(1), () => create(10, "tecnologia", true));
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.communities WHERE id=$1", [uid(10)])).rows[0].n, 1);
    await asUser(uid(2), () => assert.rejects(create(10, "tecnologia", true), /repetir/));
    await asUser(uid(1), () => assert.rejects(db.query("SELECT public.fundar_comunidad_v2('Grupo 10',17.99,-92.94,'Nueva descripcion','tecnologia',true,$1)", [uid(10)]), /repetir/));
    await asUser(uid(1), () => assert.rejects(db.query("SELECT public.fundar_comunidad_v2('Grupo 10',18.02,-92.94,NULL,'tecnologia',true,$1)", [uid(10)]), /repetir/));
  });
  const path = `${uid(10)}/${uid(1)}/${uid(50)}.webp`;
  await test("only_owner_uploads_group_photo", async () => {
    await asUser(uid(2), () => assert.rejects(db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('community-photos',$1)", [path]), /row-level security/));
    await asUser(uid(1), () => db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('community-photos',$1)", [path]));
    await asUser(uid(1), () => db.query("SELECT public.editar_identidad_comunidad($1,'comunidad-vecinal',$2)", [uid(10), path]));
  });
  await test("members_and_moderators_cannot_edit_identity", async () => {
    await db.query("INSERT INTO public.community_members VALUES($1,$2,'moderator',NULL)", [uid(10), uid(2)]);
    await asUser(uid(2), () => assert.rejects(db.query("SELECT public.editar_identidad_comunidad($1,'otros',NULL)", [uid(10)]), /administra/));
    await asUser(uid(1), () => assert.rejects(db.query("SELECT public.editar_identidad_comunidad($1,'otros',$2)", [uid(10), `${uid(10)}/${uid(2)}/${uid(51)}.webp`]), /Foto invalida/));
    await asUser(uid(1), () => assert.rejects(db.query("SELECT public.editar_identidad_comunidad($1,'otros',$2)", [uid(10), `${uid(10)}/${uid(1)}/${uid(51)}.webp`]), /Foto invalida/));
  });
  await test("private_photo_storage_acl", async () => {
    assert.equal((await asUser(uid(3), () => db.query("SELECT * FROM storage.objects"))).rows.length, 0);
    assert.equal((await asUser(null, () => db.query("SELECT * FROM storage.objects"), "anon")).rows.length, 0);
    assert.equal((await asUser(uid(2), () => db.query("SELECT * FROM storage.objects"))).rows.length, 1);
    assert.equal((await db.query("SELECT public FROM storage.buckets WHERE id='community-photos'")).rows[0].public, false);
    assert.equal((await asUser(uid(1), () => db.query("UPDATE storage.objects SET name=name WHERE name=$1 RETURNING id", [path]))).rows.length, 0);
  });
  await test("private_paths_redacted_in_discover_detail_and_guest", async () => {
    const discovery = await asUser(uid(3), () => db.query("SELECT * FROM public.descubrir_comunidades(17.99,-92.94,30)"));
    assert.equal(discovery.rows[0].foto_path, null);
    assert.equal((await asUser(uid(3), () => db.query("SELECT * FROM public.detalle_comunidad($1)", [uid(10)]))).rows[0].foto_path, null);
    assert.equal((await asUser(null, () => db.query("SELECT * FROM public.home_guest_communities_preview(12)"), "service_role")).rows.some(row => row.id === uid(10)), false);
    assert.equal((await asUser(uid(1), () => db.query("SELECT * FROM public.mis_comunidades()"))).rows[0].foto_path, path);
  });
  await test("referenced_photo_cannot_be_deleted_then_orphan_cleanup", async () => {
    assert.equal((await asUser(uid(1), () => db.query("DELETE FROM storage.objects WHERE name=$1 RETURNING id", [path]))).rows.length, 0);
    await asUser(uid(1), () => db.query("SELECT public.editar_identidad_comunidad($1,'otros',NULL)", [uid(10)]));
    assert.equal((await asUser(uid(1), () => db.query("DELETE FROM storage.objects WHERE name=$1 RETURNING id", [path]))).rows.length, 1);
  });
  await test("new_owner_retains_or_cleans_previous_owner_photo_safely", async () => {
    await asUser(uid(1), () => db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('community-photos',$1)", [path]));
    await asUser(uid(1), () => db.query("SELECT public.editar_identidad_comunidad($1,'otros',$2)", [uid(10), path]));
    await db.query("UPDATE public.communities SET owner_id=$1 WHERE id=$2", [uid(2), uid(10)]);
    await db.query("UPDATE public.community_members SET role='owner' WHERE community_id=$1 AND user_id=$2", [uid(10), uid(2)]);
    await db.query("UPDATE public.community_members SET left_at=now() WHERE community_id=$1 AND user_id=$2", [uid(10), uid(1)]);
    assert.equal((await asUser(uid(1), () => db.query("SELECT * FROM storage.objects"))).rows.length, 0);
    await asUser(uid(2), () => db.query("SELECT public.editar_identidad_comunidad($1,'comunidad-vecinal',$2)", [uid(10), path]));
    assert.equal((await asUser(uid(2), () => db.query("DELETE FROM storage.objects WHERE name=$1 RETURNING id", [path]))).rows.length, 0);
    await asUser(uid(2), () => db.query("SELECT public.editar_identidad_comunidad($1,'otros',NULL)", [uid(10)]));
    assert.equal((await asUser(uid(2), () => db.query("DELETE FROM storage.objects WHERE name=$1 RETURNING id", [path]))).rows.length, 1);
  });
  await test("membership_directory_has_no_radius_and_discover_is_fixed_five_km", async () => {
    await db.query("INSERT INTO public.communities(id,nombre,owner_id,centro) VALUES($1,'Comunidad lejana',$2,point(-97,19))", [uid(80), uid(1)]);
    await db.query("INSERT INTO public.community_members VALUES($1,$2,'member',NULL)", [uid(80), uid(1)]);
    assert.equal((await asUser(uid(1), () => db.query("SELECT * FROM public.mis_comunidades()"))).rows.some(row => row.id === uid(80)), true);
    await db.query("INSERT INTO public.communities(id,nombre,owner_id,centro) VALUES($1,'Apenas fuera de cinco km',$2,point(-92.90,18.01))", [uid(81), uid(2)]);
    const distance = (await db.query("SELECT public.ST_Distance(centro,point(-92.94,17.989)::public.geography) AS distance FROM public.communities WHERE id=$1", [uid(81)])).rows[0].distance as number;
    assert.ok(distance > 5000 && distance < 5100);
    assert.equal((await asUser(uid(3), () => db.query("SELECT * FROM public.descubrir_comunidades(17.989,-92.94,30)"))).rows.some(row => row.id === uid(81)), false);
  });
  await test("rpc_grants_and_geo_output", async () => {
    await asUser(null, () => assert.rejects(db.query("SELECT public.editar_identidad_comunidad($1,'otros',NULL)", [uid(10)]), /permission denied/), "anon");
    const attrs = (await db.query<{ proargnames: string[] }>("SELECT proargnames FROM pg_proc WHERE proname IN ('mis_comunidades','descubrir_comunidades','detalle_comunidad','home_guest_communities_preview')")).rows.flatMap(row => row.proargnames);
    assert.equal(attrs.some(name => ["centro", "lat", "lng", "ubicacion_geo"].includes(name)), false);
  });
  console.log(`COMMUNITY_SQL=${passed}/${passed} (PostGIS distance simulated)`);
} finally { await db.close(); }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
