/** SQL contract tests in isolated PostgreSQL/PGlite. Spatial shims are NOT real PostGIS or performance acceptance. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { mapCoverageRequestSchema, mapCoverageResultSchema, MAP_AREA } from '../packages/shared/src/validators/publications-map';
const db=new PGlite();
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002",viewer="00000000-0000-4000-8000-000000000003";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const base={bounds:{west:-98.8,south:18.4,east:-97.6,north:19.7}};
const center={lat:19.04,lng:-98.21};
let passed=0;
async function query(input:unknown,actor:string|null=null){
 await db.exec(`BEGIN;SET LOCAL ROLE ${actor?'authenticated':'anon'};`);
 try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor??'']);
 const result=await db.query<{result:any}>('SELECT search_map_publications_v2($1::jsonb) result',[JSON.stringify(input)]);
 await db.exec('COMMIT');return result.rows[0]!.result;
 }catch(e){await db.exec('ROLLBACK');throw e;}
}
const req=(action:string='overview',q:unknown=base,extra:Record<string,unknown>={})=>({action,query:q,coverage_center:center,...extra});
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

 await db.exec(await readFile(new URL('../supabase/migrations/20261001020000_mapa_cobertura_cache.sql',import.meta.url),'utf8'));
 await test('overview has all approximate points; no cards until requested',async()=>{
 const r=await query(req());assert.equal(r.total,3);assert.equal(r.seller_total,2);assert.equal(r.listings.length,0);assert.equal(r.cells.length,0);assert.equal(r.complete,false);
 assert.equal(r.features.reduce((n:number,f:any)=>n+f.count,0),3);assert.ok(mapCoverageResultSchema.safeParse(r).success);
 assert.ok(!JSON.stringify(r).includes('-98.20631'));assert.ok(!JSON.stringify(r).includes('PRIVATE ADDRESS'));
 const page=await query(req('cells',base,{revision:r.revision}));assert.equal(page.complete,true);assert.equal(page.cells.length,2);assert.equal(page.cells.reduce((n:number,c:any)=>n+c.count,0),3);
 });
 await test('public point controls true 50km coverage; national overview includes distant listing',async()=>{
 await db.exec(`INSERT INTO products_services(id,creador_id,titulo,slug,precio,ubicacion_geo) VALUES('${id(4)}','${b}','Lejos','lejos',10,point(-98.7,19.04))`);
 assert.equal((await query(req())).total,3);
 const r=await query(req('overview',{bounds:MAP_AREA},{coverage_center:null}));assert.equal(r.total,4);assert.equal(r.features.reduce((n:number,f:any)=>n+f.count,0),4);
 await assert.rejects(()=>query(req('cells',base,{coverage_center:null})),(e:any)=>e.code==='22023');
 });
 await test('group detail has distinct sellers, frozen node and same revision',async()=>{
 const r=await query(req());const f={id:'cell:1:-9821:1904'};const d=await query(req('listings',{...base,cell_id:f.id},{revision:r.revision}));
 assert.equal(d.list_total,2);assert.equal(d.list_seller_total,1);assert.equal(d.listings.length,2);assert.ok(d.listings.every((p:any)=>p.cell_id===f.id));
 });
 await test('revision covers public field edits, eligibility, categories and bilateral blocks',async()=>{
 let prev=(await query(req())).revision;
 for(const sql of [`UPDATE products_services SET titulo='Nuevo' WHERE id='${id(1)}'`,`UPDATE profiles SET nombre='Nombre actualizado' WHERE id='${a}'`,`UPDATE products_services SET is_hidden=true WHERE id='${id(2)}'`,`UPDATE products_services SET ubicacion_geo=point(-98.18,19.06) WHERE id='${id(1)}'`]){
 await db.exec(sql);const r=await query(req());assert.notEqual(r.revision,prev);await assert.rejects(()=>query(req('cells',base,{revision:prev})),(e:any)=>e.code==='22023');prev=r.revision;
 }
 const personal=(await query(req(),viewer)).revision;await db.exec(`INSERT INTO user_blocks VALUES('${a}','${viewer}')`);
 assert.notEqual((await query(req(),viewer)).revision,personal);assert.equal((await query(req(),viewer)).total,1);
 await db.exec('DELETE FROM user_blocks;UPDATE products_services SET is_hidden=false');
 const catReq=req('overview',{...base,categories:['comida']});const catRev=(await query(catReq)).revision;
 await db.exec(`UPDATE product_categories SET categoria_id='${b}' WHERE product_id='${id(1)}'`);assert.notEqual((await query(catReq)).revision,catRev);
 });
 await test('check can replace stale revision; unrelated changes preserve revision',async()=>{
 const r=await query(req());await db.exec(`UPDATE products_services SET titulo='Distant change' WHERE id='${id(4)}'`);
 assert.equal((await query(req('check',base,{revision:r.revision}))).revision,r.revision);
 await db.exec(`UPDATE profiles SET is_hidden=true WHERE id='${a}'`);const c=await query(req('check',base,{revision:r.revision}));assert.notEqual(c.revision,r.revision);
 await db.exec('UPDATE profiles SET is_hidden=false');
 });
 await test('invalid RPC requests, oversized cell IDs and private fields rejected',async()=>{
 for(const request of [req('unknown'),req('cells',base,{revision:123}),req('cells',base,{cell_cursor:{x:1e25,y:19}}),req('cells',base,{cell_cursor:{x:-9821.5,y:1904}}),req('overview',{...base,cell_id:'cell:3:-1:1'}),req('overview',{...base,cell_id:'cell:999999999999999999999999:-1:1'}),req('overview',{...base,ubicacion_geo:'x'}),req('overview',base,{coverage_center:{...center,private:1}})])
 await assert.rejects(()=>query(request),(e:any)=>e.code==='22023');
 assert.equal(mapCoverageRequestSchema.safeParse(req('cells',base,{cell_cursor:{x:1e25,y:19}})).success,false);
 });
 await db.exec(`INSERT INTO products_services(id,creador_id,titulo,slug,precio,ubicacion_geo,created_at)
 SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n%2=0 THEN '${a}'::uuid ELSE '${b}'::uuid END,'Fixture '||n,'fixture-'||n,1,
 point(-98.43+(n%45)*0.01,18.82+(floor(n/45.0)::int%45)*0.01),CASE WHEN n%3=0 THEN NULL ELSE '2026-09-30'::timestamptz END FROM generate_series(10,2034)n`);
 await test('more than 300 base cells paginate completely with same revision',async()=>{
 const r=await query(req());let cursor:any=null;const seen=new Set<string>();let count=0,pages=0;
 do{const p=await query(req('cells',base,{revision:r.revision,cell_cursor:cursor}));pages++;assert.ok(p.cells.length<=300);
 for(const c of p.cells){const k=c.x+':'+c.y;assert.ok(!seen.has(k));seen.add(k);count+=c.count;}cursor=p.next_cell_cursor;assert.equal(p.complete,cursor===null);
 }while(cursor);assert.ok(pages>1);assert.ok(seen.size>300);assert.equal(count,r.total);assert.equal(r.features.reduce((n:number,f:any)=>n+f.count,0),r.total);assert.ok(r.features.length<=300);
 });
 await test('detail keyset includes null/tied dates; cannot cross nodes/viewer/revision',async()=>{
 const r=await query(req());const f=r.features.find((f:any)=>f.count>30);assert.ok(f);
 const found=new Set<string>();let cursor:any=null,first:any;
 do{const p=await query(req('listings',{...base,cell_id:f.id,cursor},{revision:r.revision}));first??=p;assert.ok(p.listings.length<=30);
 for(const row of p.listings){assert.ok(!found.has(row.id));found.add(row.id);}cursor=p.next_cursor;}while(cursor);
 assert.equal(found.size,f.count);assert.ok(first.next_cursor);
 await assert.rejects(()=>query(req('listings',{...base,cell_id:r.features.find((x:any)=>x.id!==f.id).id,cursor:first.next_cursor},{revision:r.revision})),(e:any)=>e.code==='22023');
 await assert.rejects(()=>query(req('listings',{...base,cell_id:f.id,cursor:first.next_cursor},{revision:r.revision}),viewer),(e:any)=>e.code==='22023');
 });
 await test('exact point and address grants remain private; v1 remains available',async()=>{
 for(const role of ['anon','authenticated'])for(const column of ['ubicacion_geo','ubicacion_mapa','ubicacion']){
 const p=await db.query<{ok:boolean}>("SELECT has_column_privilege($1,'products_services',$2,'SELECT') ok",[role,column]);assert.equal(p.rows[0]!.ok,false);}
 const v1=await db.query<{r:any}>('SELECT search_map_publications_v1($1::jsonb) r',[JSON.stringify(base)]);assert.ok(v1.rows[0]!.r.total>0);
 });
 if(process.argv.includes('--scale-100k')) await test('100000 LOCAL rows: complete overview/cells/revision and distinct seller counts',async()=>{
 const started=performance.now(),budgetMs=90_000;
 // This PGlite instance is local and in-memory. No connection URL or remote data is used.
 await db.exec(`DELETE FROM product_categories;DELETE FROM products_services;DELETE FROM user_blocks;
   UPDATE profiles SET is_hidden=false;
   INSERT INTO products_services(id,creador_id,titulo,slug,precio,ubicacion_geo,created_at)
   SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
     CASE WHEN n%2=0 THEN '${a}'::uuid ELSE '${b}'::uuid END,'Local scale '||n,'local-scale-'||n,1,
     point(-98.43+(n%45)*0.01,18.82+(floor(n/45.0)::int%45)*0.01),
     CASE WHEN n%3=0 THEN NULL ELSE '2026-09-30'::timestamptz END
   FROM generate_series(1,100000)n;`);
 const overview=await query(req());assert.ok(mapCoverageResultSchema.safeParse(overview).success);
 assert.equal(overview.total,100000);assert.equal(overview.seller_total,2);
 assert.ok(overview.features.length<=300);assert.equal(overview.features.reduce((n:number,f:any)=>n+f.count,0),100000);
 assert.equal(overview.listings.length,0);assert.equal(overview.cells.length,0);
 assert.ok(overview.features.every((f:any)=>f.seller_count===2));
 console.log(`INFO LOCAL 100000: ${overview.features.length} overview groups; spatial substitutes, not PostGIS`);
 let cursor:any=null,last:[number,number]|null=null,count=0,pages=0;
 const seen=new Set<string>(),cursors=new Set<string>();
 do{
   assert.ok(performance.now()-started<budgetMs,'Local scale time budget exhausted; no completeness claim');
   assert.ok(++pages<=8,'Local fixture exceeded its bounded eight-page budget');
   const page=await query(req('cells',base,{revision:overview.revision,cell_cursor:cursor}));
   assert.equal(page.revision,overview.revision);assert.equal(page.total,100000);assert.equal(page.seller_total,2);
   assert.ok(page.cells.length<=300);assert.ok(mapCoverageResultSchema.safeParse(page).success);
   for(const cell of page.cells){
     const key=`${cell.x}:${cell.y}`;assert.ok(!seen.has(key),'Repeated public cell');seen.add(key);count+=cell.count;
     assert.equal(cell.seller_count,2,'A repeated seller must remain distinct within each public cell');
     if(last)assert.ok(cell.x>last[0]||(cell.x===last[0]&&cell.y>last[1]),'Cell keyset did not progress monotonically');
     last=[cell.x,cell.y];
   }
   cursor=page.next_cell_cursor;assert.equal(page.complete,cursor===null);
   if(cursor){const key=JSON.stringify(cursor);assert.ok(!cursors.has(key),'Repeated cell cursor');cursors.add(key);}
   console.log(`INFO LOCAL 100000 cells page ${pages}: ${page.cells.length} cells; cumulative ${count} publications`);
 }while(cursor);
 assert.equal(seen.size,2025);assert.equal(pages,7);assert.equal(count,100000);
 // Summing sellers across cells would be incorrect: the two sellers occur in many cells.
 assert.equal(overview.seller_total,2);assert.ok(seen.size*2>overview.seller_total);
 const feature=overview.features.find((f:any)=>f.count>60);assert.ok(feature);
 const first=await query(req('listings',{...base,cell_id:feature.id},{revision:overview.revision}));
 assert.equal(first.list_total,feature.count);assert.equal(first.list_seller_total,2);assert.equal(first.listings.length,30);
 assert.ok(first.listings.every((item:any)=>item.cell_id===feature.id));assert.ok(first.next_cursor);
 const second=await query(req('listings',{...base,cell_id:feature.id,cursor:first.next_cursor},{revision:overview.revision}));
 assert.equal(second.revision,first.revision);assert.equal(second.list_total,first.list_total);assert.equal(second.list_seller_total,2);
 const ids=new Set(first.listings.map((item:any)=>item.id));assert.ok(second.listings.every((item:any)=>!ids.has(item.id)));
 assert.ok(performance.now()-started<budgetMs,'Local scale time budget exhausted; no completeness claim');
 console.log(`INFO LOCAL 100000 complete: 2025 cells / 7 pages / 2 distinct sellers; harness elapsed ${Math.round(performance.now()-started)} ms; NOT PostGIS/network/device performance`);
 });
 await db.close();console.log(`S11 SQL: ${passed}/${passed} PASS (isolated spatial shims; real PostGIS still required)`);
}
main().catch(async e=>{console.error(e);await db.close();process.exitCode=1;});
