/** Executes the unchanged S10 migration in isolated PostgreSQL/PGlite.
 * PostGIS is unavailable here: point/box shims test SQL filtering, aggregation,
 * generated values, grants and cursors, NOT PostGIS indexing or performance. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const a="00000000-0000-4000-8000-000000000001", b="00000000-0000-4000-8000-000000000002", viewer="00000000-0000-4000-8000-000000000003";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const base={bounds:{west:-98.4,south:18.9,east:-98,north:19.2}};
let passed=0;
async function query(q:unknown=base,actor:string|null=null) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${actor?'authenticated':'anon'};`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor??'']);
    const r=await db.query<{result:any}>('SELECT search_map_publications_v1($1::jsonb) AS result',[JSON.stringify(q)]);
    await db.exec('COMMIT');return r.rows[0].result;
  } catch(e) {await db.exec('ROLLBACK');throw e;}
}
async function test(name:string,run:()=>Promise<void>){await run();passed++;console.log('PASS '+name);}
async function main(){
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
    CREATE DOMAIN geometry AS point;CREATE DOMAIN geography AS point;
    CREATE FUNCTION ST_X(geometry) RETURNS float8 IMMUTABLE STRICT LANGUAGE sql AS $$ SELECT ($1::point)[0] $$;
    CREATE FUNCTION ST_Y(geometry) RETURNS float8 IMMUTABLE STRICT LANGUAGE sql AS $$ SELECT ($1::point)[1] $$;
    CREATE FUNCTION ST_MakePoint(float8,float8) RETURNS geometry IMMUTABLE STRICT LANGUAGE sql AS $$ SELECT point($1,$2)::geometry $$;
    CREATE FUNCTION ST_SetSRID(geometry,int) RETURNS geometry IMMUTABLE STRICT LANGUAGE sql AS $$ SELECT $1 $$;
    CREATE FUNCTION ST_MakeEnvelope(float8,float8,float8,float8,int) RETURNS box IMMUTABLE STRICT LANGUAGE sql AS $$ SELECT box(point($1,$2),point($3,$4)) $$;
    CREATE FUNCTION map_overlaps(geometry,box) RETURNS boolean IMMUTABLE STRICT LANGUAGE sql AS $$ SELECT $1::point <@ $2 $$;
    CREATE OPERATOR && (LEFTARG=geometry,RIGHTARG=box,FUNCTION=map_overlaps);
    CREATE FUNCTION ST_DWithin(geography,geography,float8) RETURNS boolean IMMUTABLE STRICT LANGUAGE sql AS
      $$ SELECT sqrt(power((($1::point)[0]-($2::point)[0])*105000,2)+power((($1::point)[1]-($2::point)[1])*111000,2)) <= $3 $$;
    CREATE FUNCTION dentro_de_cobertura(float8,float8) RETURNS boolean IMMUTABLE LANGUAGE sql AS $$ SELECT $1 BETWEEN 14.5 AND 32.8 AND $2 BETWEEN -118.5 AND -86.5 $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY,nombre text NOT NULL,is_hidden boolean NOT NULL DEFAULT false);
    CREATE TABLE categories(id uuid PRIMARY KEY,slug text UNIQUE);
    CREATE TABLE user_blocks(blocker_id uuid,blocked_id uuid);
    CREATE TABLE products_services(id uuid PRIMARY KEY,creador_id uuid REFERENCES profiles(id),titulo text,slug text,descripcion text,precio numeric,
      modo_precio text DEFAULT 'fijo',tipo text DEFAULT 'producto',categoria text DEFAULT 'comida',imagen_principal text,
      created_at timestamptz DEFAULT now(),estatus text DEFAULT 'disponible',is_hidden boolean DEFAULT false,ubicacion_geo geography,ubicacion text DEFAULT 'PRIVATE ADDRESS');
    CREATE TABLE product_categories(product_id uuid,categoria_id uuid,is_primary boolean);
    GRANT SELECT(id,titulo,creador_id) ON products_services TO anon,authenticated;
    INSERT INTO profiles VALUES('${a}','Ángela',false),('${b}','Bruno',false),('${viewer}','Visitante',false);
    INSERT INTO categories VALUES('${a}','comida'),('${b}','belleza');
    INSERT INTO products_services(id,creador_id,titulo,slug,descripcion,precio,ubicacion_geo) VALUES
      ('${id(1)}','${a}','Café recién hecho','cafe','Postre artesanal',30,point(-98.20631,19.04149)),
      ('${id(2)}','${a}','Pan','pan','',20,point(-98.20641,19.04159)),
      ('${id(3)}','${b}','Uñas','unas','',100,point(-98.15,19.08));
    INSERT INTO product_categories VALUES('${id(1)}','${a}',true),('${id(2)}','${a}',true),('${id(3)}','${b}',true);`);
  await db.exec(await readFile(new URL('../supabase/migrations/20260930220000_mapa_publicaciones_aproximadas.sql',import.meta.url),'utf8'));
  await test('anonymous sees public approximation, totals and distinct sellers',async()=>{
    const r=await query();assert.equal(r.total,3);assert.equal(r.seller_total,2);assert.equal(r.features.reduce((s:number,f:any)=>s+f.count,0),3);
    assert.equal(r.listings.find((p:any)=>p.id===id(1)).seller_listing_count,2);
    const publicPoint=await db.query<{x:number,y:number}>(`SELECT ST_X(ubicacion_mapa) x,ST_Y(ubicacion_mapa) y FROM products_services WHERE id='${id(1)}'`);
    assert.deepEqual(publicPoint.rows[0],{x:-98.21,y:19.04});
    assert.ok(!JSON.stringify(r).includes('-98.20631'));assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.ok(!JSON.stringify(r).includes('ubicacion_geo'));
  });
  await test('projection automatically follows private point update',async()=>{
    await db.exec(`UPDATE products_services SET ubicacion_geo=point(-98.209,19.042) WHERE id='${id(1)}'`);
    const r=await query();assert.equal(r.total,3);assert.ok(r.features.some((f:any)=>f.public_lat===19.04));
  });
  await test('no direct coordinate grants for anon or authenticated',async()=>{
    for(const role of ['anon','authenticated']) for(const column of ['ubicacion_geo','ubicacion_mapa','ubicacion']){
      const r=await db.query<{ok:boolean}>("SELECT has_column_privilege($1,'products_services',$2,'SELECT') ok",[role,column]);assert.equal(r.rows[0].ok,false);
    }
  });
  await test('bilateral blocks apply even when viewer owns other listings',async()=>{
    await db.exec(`INSERT INTO user_blocks VALUES('${viewer}','${a}')`);assert.equal((await query(base,viewer)).total,1);
    await db.exec(`DELETE FROM user_blocks;INSERT INTO user_blocks VALUES('${a}','${viewer}')`);assert.equal((await query(base,viewer)).total,1);
    await db.exec('DELETE FROM user_blocks');
  });
  await test('hidden sellers, hidden listings and unavailable listings omitted',async()=>{
    await db.exec(`UPDATE profiles SET is_hidden=true WHERE id='${a}'`);assert.equal((await query()).total,1);
    await db.exec(`UPDATE profiles SET is_hidden=false;UPDATE products_services SET is_hidden=true WHERE id='${id(1)}';UPDATE products_services SET estatus='vendido' WHERE id='${id(2)}'`);
    assert.equal((await query()).total,1);await db.exec("UPDATE products_services SET is_hidden=false,estatus='disponible'");
  });
  await test('bounds and nearby membership depend only on public point',async()=>{
    assert.equal((await query({bounds:{west:-98.208,south:19.03,east:-98.2,north:19.05}})).total,0);
    assert.equal((await query({...base,mode:'nearby',center:{lat:19.04,lng:-98.21},radius_meters:1000})).total,2);
  });
  await test('search accents, category, prices and literal wildcard',async()=>{
    assert.equal((await query({...base,q:'cafe'})).total,1);assert.equal((await query({...base,q:'angela'})).total,2);
    assert.equal((await query({...base,categories:['belleza']})).total,1);
    assert.equal((await query({...base,price_min:25,price_max:35})).total,1);assert.equal((await query({...base,q:'%'})).total,0);
  });
  await test('invalid direct RPC filters and foreign keys rejected',async()=>{
    for(const q of [{...base,bounds:{...base.bounds,east:-100}},{...base,center:{lat:19,lng:-98,private:1}},
      {...base,categories:['invalid']},{...base,mode:'nearby'},{...base,radius_meters:1.5},{...base,price_min:100,price_max:1},{...base,ubicacion_geo:'x'}])
      await assert.rejects(()=>query(q),(e:any)=>e.code==='22023');
  });
  await db.exec(`INSERT INTO products_services(id,creador_id,titulo,slug,descripcion,precio,ubicacion_geo,created_at)
    SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${a}','Producto '||n,'p'||n,'',1,
      point(-98.30+(n%20)*0.01,19+(n%10)*0.01),CASE WHEN n%3=0 THEN NULL ELSE '2026-09-30'::timestamptz END FROM generate_series(10,1009) n`);
  await test('all 1003 listings contribute to bounded features',async()=>{
    const r=await query();assert.equal(r.total,1003);assert.ok(r.features.length<=300);assert.equal(r.features.reduce((s:number,f:any)=>s+f.count,0),1003);assert.equal(r.listings.length,30);
  });
  await test('keyset pagination covers ties and null dates without duplicates',async()=>{
    const found=new Set<string>();let cursor:any=null;
    do{const r=await query({...base,cursor});for(const p of r.listings){assert.ok(!found.has(p.id));found.add(p.id);}cursor=r.next_cursor;}while(cursor);
    assert.equal(found.size,1003);
  });
  await test('cursor cannot cross filters or viewers',async()=>{
    const r=await query();await assert.rejects(()=>query({...base,q:'Pan',cursor:r.next_cursor}),(e:any)=>e.code==='22023');
    await assert.rejects(()=>query({...base,cursor:r.next_cursor},viewer),(e:any)=>e.code==='22023');
  });
  await test('point selection retains area totals and filters list',async()=>{
    const r=await query();const f=r.features[0];const s=await query({...base,cell_id:f.id});assert.equal(s.total,r.total);assert.equal(s.list_total,f.count);assert.ok(s.listings.every((p:any)=>p.cell_id===f.id));
  });
  await db.close();console.log(`S10 SQL: ${passed}/${passed} PASS (spatial shims; real PostGIS acceptance pending)`);
}
main().catch(async e=>{console.error(e);await db.close();process.exitCode=1;});
