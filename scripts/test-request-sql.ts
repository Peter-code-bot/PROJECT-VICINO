/** Executes the entire SC02 migration in PostgreSQL/PGlite. Point shims verify
 * contracts and privacy/ACL/transaction behavior; real PostGIS is a remote check. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const uid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
let passed = 0;
async function test(name: string, fn: () => Promise<void>) { await fn(); passed++; console.log(`PASS ${name}`); }
async function asUser<T>(user: string | null, fn: () => Promise<T>, role = "authenticated") {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${user ?? ""}',false)`);
  try { return await fn(); } finally { await db.exec("RESET ROLE"); }
}
function create(n: number, categories = ["comida"], extra: { lat?: number; title?: string; budget?: number; image?: string; hours?: number } = {}) {
  return db.query<{ id: string }>("SELECT public.create_purchase_request_v2($1,$2,$3,-92.94,$4,'Referencia',$5,$6,$7) AS id", [uid(n),extra.title ?? `Solicitud ${n}`,extra.lat ?? 17.99,categories,extra.budget ?? 800,extra.image ?? null,extra.hours ?? 72]);
}
function feed(limit=13, time: string | null=null, id: string | null=null, cat: string | null=null, radius=1000) {
  return db.query<{ id: string; created_at: string; distance_meters: number; categories: unknown; title: string }>("SELECT * FROM public.feed_nearby_requests_v2(17.99,-92.94,$1,$2,$3,$4,$5)",[radius,time,id,limit,cat]);
}
async function main() {
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO anon,authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
      CREATE DOMAIN public.geometry AS point; CREATE DOMAIN public.geography AS point;
      CREATE FUNCTION public.ST_MakePoint(float8,float8) RETURNS public.geometry IMMUTABLE LANGUAGE sql AS $$ SELECT point($1,$2)::public.geometry $$;
      CREATE FUNCTION public.ST_SetSRID(public.geometry,integer) RETURNS public.geometry IMMUTABLE LANGUAGE sql AS $$ SELECT $1 $$;
      CREATE FUNCTION public.ST_X(public.geometry) RETURNS float8 IMMUTABLE LANGUAGE sql AS $$ SELECT ($1::point)[0] $$;
      CREATE FUNCTION public.ST_Y(public.geometry) RETURNS float8 IMMUTABLE LANGUAGE sql AS $$ SELECT ($1::point)[1] $$;
      CREATE FUNCTION public.ST_Distance(public.geography,public.geography) RETURNS float8 IMMUTABLE LANGUAGE sql AS $$ SELECT ($1::point <-> $2::point)*111000 $$;
      CREATE FUNCTION public.ST_DWithin(public.geography,public.geography,float8) RETURNS boolean IMMUTABLE LANGUAGE sql AS $$ SELECT public.ST_Distance($1,$2)<=$3 $$;
      CREATE FUNCTION public.dentro_de_cobertura(float8,float8) RETURNS boolean IMMUTABLE LANGUAGE sql AS $$ SELECT $1 BETWEEN 17 AND 19 AND $2 BETWEEN -94 AND -91 $$;
      CREATE TYPE public.request_status AS ENUM('open','closed','expired');
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,nombre text,foto text,is_hidden boolean DEFAULT false);
      CREATE TABLE public.categories(id uuid PRIMARY KEY,slug text UNIQUE,nombre text,activo boolean DEFAULT true);
      CREATE TABLE public.purchase_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),buyer_id uuid REFERENCES public.profiles,title varchar(100) NOT NULL,
        description text,budget_estimated numeric,image_url text,ubicacion_geo public.geography,status public.request_status DEFAULT 'open',
        expires_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),CHECK(char_length(title)>=3),CHECK(budget_estimated IS NULL OR budget_estimated>=0));
      CREATE TABLE public.purchase_request_categories(request_id uuid REFERENCES public.purchase_requests ON DELETE CASCADE,categoria_id uuid REFERENCES public.categories,PRIMARY KEY(request_id,categoria_id));
      CREATE TABLE public.request_responses(id uuid DEFAULT gen_random_uuid(),request_id uuid REFERENCES public.purchase_requests,seller_id uuid);
      CREATE TABLE public.user_blocks(blocker_id uuid,blocked_id uuid);
      ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.purchase_request_categories ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.request_responses ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
      GRANT SELECT(id,buyer_id,title,description,budget_estimated,image_url,status,expires_at,created_at,updated_at) ON public.purchase_requests TO anon,authenticated;
      CREATE POLICY request_select ON public.purchase_requests FOR SELECT USING(status='open' OR buyer_id=auth.uid());
      CREATE FUNCTION public.feed_nearby_requests(float8,float8,integer DEFAULT 25000,timestamptz DEFAULT NULL,integer DEFAULT 50,text DEFAULT NULL) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
      INSERT INTO public.profiles VALUES('${uid(1)}','Comprador',NULL,false),('${uid(2)}','Vecino',NULL,false),('${uid(3)}','Suspendido',NULL,true);
      INSERT INTO public.categories VALUES('${uid(100)}','comida','Comida',true),('${uid(101)}','hogar','Hogar',true),('${uid(102)}','otros','Otros',false);`);
    const coverage = await readFile("supabase/migrations/20260913160000_cobertura_de_operacion_en_la_base.sql","utf8");
    const functionStart = coverage.indexOf("create or replace function public.exigir_cobertura_operacion()");
    const functionEnd = coverage.indexOf("drop trigger if exists exigir_cobertura_products_services",functionStart);
    await db.exec(coverage.slice(functionStart,functionEnd));
    await db.exec("CREATE TRIGGER exigir_cobertura_purchase_requests BEFORE INSERT OR UPDATE OF ubicacion_geo ON public.purchase_requests FOR EACH ROW EXECUTE FUNCTION public.exigir_cobertura_operacion()");
    const sql = await readFile("supabase/migrations/20261014054632_solicitudes_categorias_atomicas_feed.sql","utf8");
    await db.exec(sql);
    await test("migration_and_legacy_rollout", async () => {
      assert.equal((await db.query("SELECT public.feed_nearby_requests(0,0) AS legacy")).rows[0].legacy,1);
      assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='vicino_guard.request_creation_operations'::regclass")).rows[0].relrowsecurity,true);
      assert.equal((await db.query("SELECT has_column_privilege('authenticated','public.purchase_requests','ubicacion_geo','SELECT') AS visible")).rows[0].visible,false);
    });
    await test("authenticated_atomic_create_with_all_categories", async () => {
      const result=await asUser(uid(1),()=>create(10,["hogar","comida"]));
      assert.equal(result.rows[0].id,uid(10));
      assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.purchase_request_categories WHERE request_id=$1",[uid(10)])).rows[0].n,2);
    });
    await test("idempotent_retry_and_payload_identity", async () => {
      await asUser(uid(1),()=>create(10,["comida","hogar"]));
      assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.purchase_requests WHERE id=$1",[uid(10)])).rows[0].n,1);
      await asUser(uid(2),()=>assert.rejects(create(10,["comida","hogar"]),/repetir/));
      await asUser(uid(1),()=>assert.rejects(create(10,["comida","hogar"],{title:"Otra solicitud"}),/repetir/));
      await asUser(uid(1),()=>assert.rejects(create(10,["comida","hogar"],{lat:18.01}),/repetir/));
      await asUser(uid(1),()=>assert.rejects(create(10,["comida","hogar"],{image:"https://example.invalid/image.jpg"}),/repetir/));
    });
    await test("auth_suspension_and_private_receipt_acl", async () => {
      await asUser(null,()=>assert.rejects(create(11),/sesion/));
      await asUser(null,()=>assert.rejects(create(11),/permission denied/),"anon");
      await asUser(uid(3),()=>assert.rejects(create(11),/cuenta/));
      await asUser(uid(1),()=>assert.rejects(db.query("SELECT * FROM vicino_guard.request_creation_operations"),/permission denied/));
      await db.query("UPDATE public.profiles SET is_hidden=true WHERE id=$1",[uid(1)]);
      await asUser(uid(1),()=>create(10,["comida","hogar"])); // A completed operation can be confirmed after suspension.
      await db.query("UPDATE public.profiles SET is_hidden=false WHERE id=$1",[uid(1)]);
    });
    await test("invalid_categories_ranges_and_expiry_create_no_orphan", async () => {
      for(const cats of [[],["comida","comida"],["missing"],["otros"],["comida","hogar","otros","missing"]]) await asUser(uid(1),()=>assert.rejects(create(12,cats),/invalid|invalida/i));
      await asUser(uid(1),()=>assert.rejects(create(12,["comida"],{lat:91}),/invalida/));
      await asUser(uid(1),()=>assert.rejects(create(12,["comida"],{budget:-1}),/invalida/));
      await asUser(uid(1),()=>assert.rejects(create(12,["comida"],{hours:25}),/invalida/));
      assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.purchase_requests WHERE id=$1",[uid(12)])).rows[0].n,0);
    });
    await test("existing_coverage_trigger_remains_authoritative", async () => {
      await asUser(uid(1),()=>assert.rejects(create(13,["comida"],{lat:20}),/fuera/));
      assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.purchase_requests WHERE id=$1",[uid(13)])).rows[0].n,0);
    });
    await test("pivot_failure_rolls_back_parent_receipt_and_pivots", async () => {
      await db.exec("CREATE FUNCTION public.fail_pivot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.categoria_id='"+uid(101)+"'::uuid THEN RAISE EXCEPTION 'fixture pivot failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_fail_pivot BEFORE INSERT ON public.purchase_request_categories FOR EACH ROW EXECUTE FUNCTION public.fail_pivot()");
      await asUser(uid(1),()=>assert.rejects(create(14,["comida","hogar"]),/pivot failure/));
      assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.purchase_requests WHERE id=$1",[uid(14)])).rows[0].n,0);
      assert.equal((await db.query("SELECT count(*)::integer AS n FROM vicino_guard.request_creation_operations WHERE operation_id=$1",[uid(14)])).rows[0].n,0);
      assert.equal((await db.query("SELECT count(*)::integer AS n FROM public.purchase_request_categories WHERE request_id=$1",[uid(14)])).rows[0].n,0);
      await db.exec("DROP TRIGGER fixture_fail_pivot ON public.purchase_request_categories");
      await asUser(uid(1),()=>create(14,["comida","hogar"]));
    });
    await test("same_timestamp_keyset_pagination_no_missing_or_duplicates", async () => {
      for(let n=200;n<225;n++) await db.query("INSERT INTO public.purchase_requests(id,buyer_id,title,expires_at,created_at,ubicacion_geo) VALUES($1,$2,'Tie request',now()+interval '1 day','2026-01-01T00:00:00Z',point(-92.94,17.99))",[uid(n),uid(2)]);
      let time:string|null=null,id:string|null=null; const seen:string[]=[];
      do {
        const result=await asUser(uid(1),()=>feed(7,time,id));
        if(!result.rows.length) break;
        seen.push(...result.rows.map(row=>row.id)); const last=result.rows.at(-1)!; time=last.created_at;id=last.id;
      } while(seen.length<100);
      assert.equal(new Set(seen).size,seen.length);
      assert.equal(seen.filter(id=>Number(id.slice(-12))>=200).length,25);
      const missingCursor=await asUser(uid(1),()=>feed(7,'2026-01-01T00:00:00Z',null)); assert.equal(missingCursor.rows.length,0);
    });
    await db.query("INSERT INTO public.purchase_request_categories VALUES($1,$2)",[uid(200),uid(101)]);
    await test("all_category_discovery_beyond_first_page_and_multicat", async () => {
      const categories=await asUser(uid(1),()=>db.query("SELECT * FROM public.nearby_request_categories(17.99,-92.94,1000)"));
      assert.deepEqual(categories.rows.map(row=>row.slug).sort(),["comida","hogar"]);
      const filtered=await asUser(uid(1),()=>feed(50,null,null,"hogar"));
      assert.ok(filtered.rows.some(row=>row.id===uid(200)));
      assert.ok(filtered.rows.some(row=>row.id===uid(10)));
    });
    await test("feed_hidden_expired_closed_both_block_directions", async () => {
      await db.query("INSERT INTO public.purchase_requests(id,buyer_id,title,expires_at,ubicacion_geo) VALUES($1,$2,'Hidden request',now()+interval '1 day',point(-92.94,17.99))",[uid(300),uid(3)]);
      await db.query("UPDATE public.purchase_requests SET status='closed' WHERE id=$1",[uid(14)]);
      await db.query("UPDATE public.purchase_requests SET expires_at=now()-interval '1 hour' WHERE id=$1",[uid(10)]);
      let rows=(await asUser(uid(1),()=>feed(50))).rows;
      assert.ok(!rows.some(row=>[uid(300),uid(14),uid(10)].includes(row.id)));
      await db.query("INSERT INTO public.user_blocks VALUES($1,$2)",[uid(1),uid(2)]);
      assert.equal((await asUser(uid(1),()=>feed(50))).rows.length,0);
      await db.exec("DELETE FROM public.user_blocks");
      await db.query("INSERT INTO public.user_blocks VALUES($1,$2)",[uid(2),uid(1)]);
      assert.equal((await asUser(uid(1),()=>feed(50))).rows.length,0);
      assert.equal((await asUser(uid(1),()=>db.query("SELECT * FROM public.nearby_request_categories(17.99,-92.94,1000)"))).rows.length,0);
      await db.exec("DELETE FROM public.user_blocks");
    });
    await test("geo_rounding_radius_min_max_and_no_coordinate_return", async () => {
      await db.query("INSERT INTO public.purchase_requests(id,buyer_id,title,expires_at,ubicacion_geo) VALUES($1,$2,'Offset request',now()+interval '1 day',point(-92.937,17.99)),($3,$2,'Far request',now()+interval '1 day',point(-92.4,17.99))",[uid(400),uid(2),uid(401)]);
      const min=await asUser(uid(1),()=>feed(50,null,null,null,0));
      assert.ok(min.rows.some(row=>row.id===uid(400)));
      assert.ok(min.rows.every(row=>row.distance_meters%100===0));
      const max=await asUser(uid(1),()=>feed(50,null,null,null,200000)); assert.ok(!max.rows.some(row=>row.id===uid(401)));
      assert.ok(!Object.keys(min.rows[0]).some(key=>/lat|lng|ubicacion_geo|point/.test(key)));
      assert.equal((await asUser(null,()=>feed(50))).rows.length,0);
      await asUser(null,()=>assert.rejects(feed(50),/permission denied/),"anon");
    });
    console.log(`Solicitudes SQL: ${passed} tests passed (PGlite; PostGIS geometry is an explicit fixture)`);
  } finally { await db.close(); }
}
main().catch(error=>{ console.error(error.message); process.exitCode=1; });
