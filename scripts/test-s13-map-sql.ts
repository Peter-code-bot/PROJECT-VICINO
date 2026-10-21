/** S13 SQL contract: projection v2 (~110 m public cells) and search_map_publications_v3
 * in isolated PostgreSQL/PGlite. Spatial shims are NOT real PostGIS: the same migration
 * is exercised on PostGIS 3.3 by scripts/staging/probar-mapa-v3.mjs. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { mapCoverageRequestSchema, mapCoverageResultSchema, MAP_AREA } from '../packages/shared/src/validators/publications-map';
const db=new PGlite();
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002",c="00000000-0000-4000-8000-000000000003",viewer="00000000-0000-4000-8000-000000000004";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// Zona de la captura de Pedro (Tlaxcalancingo / Anáhuac), unos 10 km de lado.
const base={bounds:{west:-98.26,south:19.00,east:-98.16,north:19.08}};
const center={lat:19.04,lng:-98.21};
let passed=0;
async function query(input:unknown,actor:string|null=null,fn='search_map_publications_v3'){
 await db.exec(`BEGIN;SET LOCAL ROLE ${actor?'authenticated':'anon'};`);
 try{await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor??'']);
 const result=await db.query<{result:any}>(`SELECT ${fn}($1::jsonb) result`,[JSON.stringify(input)]);
 await db.exec('COMMIT');return result.rows[0]!.result;
 }catch(e){await db.exec('ROLLBACK');throw e;}
}
const req=(action:string='overview',q:unknown=base,extra:Record<string,unknown>={})=>({action,query:q,coverage_center:center,...extra});
const code=(e:any)=>e?.code;
async function test(name:string,run:()=>Promise<void>){await run();passed++;console.log('PASS '+name);}
async function main(){
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
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
    CREATE TABLE profiles(id uuid PRIMARY KEY,nombre text NOT NULL,is_hidden boolean NOT NULL DEFAULT false,
      es_vendedor boolean DEFAULT true,seller_type text DEFAULT 'casual',nombre_negocio text);
    CREATE TABLE categories(id uuid PRIMARY KEY,slug text UNIQUE);
    CREATE TABLE user_blocks(blocker_id uuid,blocked_id uuid);
    CREATE TABLE products_services(id uuid PRIMARY KEY,creador_id uuid REFERENCES profiles(id),titulo text,slug text,descripcion text,precio numeric,
      modo_precio text DEFAULT 'fijo',tipo text DEFAULT 'producto',categoria text DEFAULT 'comida',imagen_principal text,
      created_at timestamptz DEFAULT now(),estatus text DEFAULT 'disponible',is_hidden boolean DEFAULT false,ubicacion_geo geography,ubicacion text DEFAULT 'PRIVATE ADDRESS');
    CREATE TABLE product_categories(product_id uuid,categoria_id uuid,is_primary boolean);
    GRANT SELECT(id,titulo,creador_id) ON products_services TO anon,authenticated;
    INSERT INTO profiles(id,nombre,es_vendedor,seller_type,nombre_negocio) VALUES
      ('${a}','Ángela',true,'business','Strudel de la Anáhuac'),('${b}','Bruno',true,'casual',NULL),('${c}','Carla',true,'casual',NULL),('${viewer}','Visitante',false,'casual',NULL);
    INSERT INTO categories VALUES('${a}','comida'),('${b}','belleza');
    -- Tres vendedores en la misma manzana (menos de ~60 m entre sí) y uno a ~350 m.
    -- Todos caen en la MISMA celda de 0.01° (-98.21, 19.04) de la proyección v1.
    INSERT INTO products_services(id,creador_id,titulo,slug,descripcion,precio,ubicacion_geo) VALUES
      ('${id(1)}','${a}','Strudel de manzana','strudel','Postre artesanal',60,point(-98.20630,19.04140)),
      ('${id(2)}','${a}','Pan de la casa','pan','',20,point(-98.20610,19.04120)),
      ('${id(3)}','${b}','Uñas acrílicas','unas','',100,point(-98.20590,19.04110)),
      ('${id(4)}','${c}','Clases de guitarra','guitarra','',200,point(-98.20770,19.04380));
    INSERT INTO product_categories VALUES('${id(1)}','${a}',true),('${id(2)}','${a}',true),('${id(3)}','${b}',true),('${id(4)}','${a}',true);`);
  const migration=(name:string)=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
  await db.exec(await migration('20260930220000_mapa_publicaciones_aproximadas.sql'));
  await db.exec(await migration('20261001020000_mapa_cobertura_cache.sql'));
  await db.exec(await migration('20261002063000_guest_map_permissions.sql'));
  // Solo la función de identidad pública; el DO de esa migración reescribe RPC que este harness no tiene.
  const identidad=await migration('20261003213000_identidad_publica_modo_tienda.sql');
  await db.exec(identidad.slice(0,identidad.indexOf('DO $migration$')));
  await db.exec(await migration('20261004202352_guest_map_permissions_after_s02.sql'));
  await db.exec(await migration('20261020150000_mapa_puntos_precisos_v3.sql'));

  await test('v1 projection still stacks the whole block into one 1 km cell; v2 separates the 350 m neighbour',async()=>{
    const old=await query(req('cells',base),viewer,'search_map_publications_v2');
    assert.equal(old.projection_version,1);assert.equal(old.cells.length,1);assert.equal(old.cells[0].count,4);assert.equal(old.cells[0].seller_count,3);
    assert.deepEqual([old.cells[0].x,old.cells[0].y],[-9821,1904]);
    const r=await query(req('cells',base),viewer);
    assert.equal(r.projection_version,2);assert.equal(r.total,4);assert.equal(r.seller_total,3);assert.equal(r.complete,true);
    assert.deepEqual(r.cells.map((x:any)=>[x.x,x.y,x.count,x.seller_count]).sort(),[[-98208,19044,1,1],[-98206,19041,3,2]].sort());
    assert.ok(mapCoverageResultSchema.safeParse(r).success);
  });
  await test('public points carry 3 decimals at most and never the exact point, name or address',async()=>{
    const r=await query(req(),viewer);const text=JSON.stringify(r);
    assert.equal(r.features.reduce((n:number,f:any)=>n+f.count,0),4);
    // A group pin is the average of its public cells; the cells themselves (its bounds) carry at most 3 decimals.
    for(const f of r.features)for(const edge of [f.bounds.west,f.bounds.east,f.bounds.south,f.bounds.north])assert.equal(Math.round(edge*1000)/1000,edge);
    const cells=await query(req('cells',base),viewer);
    for(const cell of cells.cells){assert.ok(Number.isInteger(cell.x)&&Number.isInteger(cell.y));assert.ok(cell.x<-98000&&cell.x>-99000&&cell.y>19000&&cell.y<19100);}
    // Exact coordinates (4-5 decimals) must never appear; the 3-decimal cells may.
    for(const secret of ['-98.2063','-98.2061','-98.2059','-98.2077','19.0414','19.0412','19.0411','19.0438','PRIVATE ADDRESS'])assert.ok(!text.includes(secret),secret);
  });
  await test('group details list exactly the members of a thousandth-degree cell and show the public name',async()=>{
    const r=await query(req(),viewer);
    const d=await query(req('listings',{...base,cell_id:'cell:1:-98206:19041'},{revision:r.revision}),viewer);
    assert.equal(d.list_total,3);assert.equal(d.list_seller_total,2);assert.equal(d.listings.length,3);
    assert.ok(d.listings.every((p:any)=>p.cell_id==='cell:1:-98206:19041'));
    assert.ok(d.listings.some((p:any)=>p.vendedor_nombre==='Strudel de la Anáhuac'));
    assert.ok(d.listings.every((p:any)=>!('public_lat' in p)&&!('ubicacion' in p)));
    const single=await query(req('listings',{...base,cell_id:'cell:1:-98208:19044'},{revision:r.revision}),viewer);
    assert.equal(single.list_total,1);assert.equal(single.listings[0].titulo,'Clases de guitarra');
  });
  await test('nearby mode measures from the public point; 50 km coverage and national overview still hold',async()=>{
    await db.exec(`INSERT INTO products_services(id,creador_id,titulo,slug,precio,ubicacion_geo) VALUES('${id(5)}','${b}','Lejos','lejos',10,point(-98.22,19.06))`);
    const near=await query(req('overview',{...base,mode:'nearby',center:{lat:19.0414,lng:-98.2063},radius_meters:1000}),viewer);
    assert.equal(near.total,4);
    const wide=await query(req('overview',{...base,mode:'nearby',center:{lat:19.0414,lng:-98.2063},radius_meters:5000}),viewer);
    assert.equal(wide.total,5);
    await db.exec(`INSERT INTO products_services(id,creador_id,titulo,slug,precio,ubicacion_geo) VALUES('${id(6)}','${b}','Veracruz','veracruz',10,point(-96.13,19.17))`);
    assert.equal((await query(req(),viewer)).total,5);
    const national=await query(req('overview',{bounds:MAP_AREA},{coverage_center:null}),viewer);
    assert.equal(national.total,6);assert.equal(national.features.reduce((n:number,f:any)=>n+f.count,0),6);assert.ok(national.features.length<=300);
    for(const f of national.features){const stride=Number(f.id.split(':')[1]);assert.ok(stride>=1&&stride<=8192&&(stride&(stride-1))===0,f.id);}
    await assert.rejects(()=>query(req('cells',base,{coverage_center:null}),viewer),(e:any)=>code(e)==='22023');
  });
  await test('moving a listing inside its old kilometre changes the v3 revision (v2 could not see it)',async()=>{
    const before3=(await query(req(),viewer)).revision,before2=(await query(req(),viewer,'search_map_publications_v2')).revision;
    await db.exec(`UPDATE products_services SET ubicacion_geo=point(-98.20900,19.03900) WHERE id='${id(2)}'`);
    assert.notEqual((await query(req(),viewer)).revision,before3);
    assert.equal((await query(req(),viewer,'search_map_publications_v2')).revision,before2);
    await assert.rejects(()=>query(req('cells',base,{revision:before3}),viewer),(e:any)=>code(e)==='22023');
    await db.exec(`UPDATE products_services SET ubicacion_geo=point(-98.20610,19.04120) WHERE id='${id(2)}'`);
  });
  await test('cursors and groups from the old units or outside Mexico are rejected with 22023',async()=>{
    for(const request of [req('cells',base,{cell_cursor:{x:-9823,y:1904}}),req('cells',base,{cell_cursor:{x:-98230.5,y:19040}}),
      req('overview',{...base,cell_id:'cell:3:-98206:19041'}),req('overview',{...base,cell_id:'cell:1:-200000:19041'}),req('overview',{...base,cell_id:'cell:1:-98206:40000'}),
      // A v2 group id (hundredths of a degree) is outside Mexico in thousandths: rejected, not an empty list.
      req('listings',{...base,cell_id:'cell:1:-9821:1904'}),req('listings',{...base,cell_id:'cell:8:-1228:238'}),
      req('unknown'),req('cells',base,{revision:123})])
      await assert.rejects(()=>query(request,viewer),(e:any)=>code(e)==='22023');
    // Malformed listing cursors are invalid input (22023), not internal errors (22P02/22007).
    for(const cursor of [{key:'a'.repeat(32),created_at:'ayer',id:id(1)},{key:'a'.repeat(32),created_at:null,id:'no-es-uuid'}])
      await assert.rejects(()=>query(req('listings',{...base,cell_id:'cell:1:-98206:19041',cursor}),viewer),(e:any)=>code(e)==='22023');
    assert.equal(mapCoverageRequestSchema.safeParse(req('cells',base,{cell_cursor:{x:1e25,y:19}})).success,false);
    assert.equal(mapCoverageRequestSchema.safeParse(req('cells',base,{cell_cursor:{x:-98230,y:19040}})).success,true);
    assert.equal(mapCoverageRequestSchema.safeParse(req('overview',{...base,cell_id:'cell:1:-98206:19041'})).success,true);
  });
  await test('the new column is unreadable by clients and anon cannot execute v3; v1/v2/v3 exist exactly once',async()=>{
    for(const role of ['anon','authenticated'])for(const column of ['ubicacion_geo','ubicacion_mapa','ubicacion_publica','ubicacion']){
      const p=await db.query<{ok:boolean}>("SELECT has_column_privilege($1,'products_services',$2,'SELECT') ok",[role,column]);assert.equal(p.rows[0]!.ok,false,`${role}.${column}`);}
    await assert.rejects(()=>query(req(),null),(e:any)=>code(e)==='42501');
    const dup=await db.query<{proname:string;n:number}>("SELECT proname,count(*)::int n FROM pg_proc WHERE proname LIKE 'search_map_publications_v%' GROUP BY 1 ORDER BY 1");
    assert.deepEqual(dup.rows,[{proname:'search_map_publications_v1',n:1},{proname:'search_map_publications_v2',n:1},{proname:'search_map_publications_v3',n:1}]);
    const v1=await db.query<{r:any}>('SELECT search_map_publications_v1($1::jsonb) r',[JSON.stringify(base)]);assert.ok(v1.rows[0]!.r.total>0);
  });
  await test('a seller with two listings at the same public point keeps seller_listing_count; a block sorts into finer cells than its kilometre',async()=>{
    const r=await query(req(),viewer);
    const d=await query(req('listings',{...base,cell_id:'cell:1:-98206:19041'},{revision:r.revision}),viewer);
    const mine=d.listings.filter((p:any)=>p.creador_id===a);assert.equal(mine.length,2);
    assert.ok(mine.every((p:any)=>p.seller_listing_count===2));
  });
  await db.exec(`INSERT INTO products_services(id,creador_id,titulo,slug,precio,ubicacion_geo,created_at)
    SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,CASE WHEN n%2=0 THEN '${a}'::uuid ELSE '${b}'::uuid END,'Fixture '||n,'fixture-'||n,1,
    point(-98.255+(n%45)*0.001,19.005+(floor(n/45.0)::int%45)*0.001),CASE WHEN n%3=0 THEN NULL ELSE '2026-09-30'::timestamptz END FROM generate_series(10,2034)n`);
  await test('more than 300 thousandth-degree cells paginate completely with the same revision',async()=>{
    const r=await query(req(),viewer);let cursor:any=null;const seen=new Set<string>();let count=0,pages=0;
    do{const p=await query(req('cells',base,{revision:r.revision,cell_cursor:cursor}),viewer);pages++;assert.ok(p.cells.length<=300);
      for(const cell of p.cells){const k=cell.x+':'+cell.y;assert.ok(!seen.has(k));seen.add(k);count+=cell.count;}cursor=p.next_cell_cursor;assert.equal(p.complete,cursor===null);
    }while(cursor);
    assert.ok(pages>1);assert.ok(seen.size>300);assert.equal(count,r.total);assert.equal(r.features.reduce((n:number,f:any)=>n+f.count,0),r.total);assert.ok(r.features.length<=300);
  });
  await test('detail keyset pagination inside a group cannot cross groups or viewers',async()=>{
    const r=await query(req(),viewer);const f=r.features.find((f:any)=>f.count>30);assert.ok(f);
    const found=new Set<string>();let cursor:any=null,first:any;
    do{const p=await query(req('listings',{...base,cell_id:f.id,cursor},{revision:r.revision}),viewer);first??=p;assert.ok(p.listings.length<=30);
      for(const row of p.listings){assert.ok(!found.has(row.id));found.add(row.id);}cursor=p.next_cursor;}while(cursor);
    assert.equal(found.size,f.count);assert.ok(first.next_cursor);
    await assert.rejects(()=>query(req('listings',{...base,cell_id:r.features.find((x:any)=>x.id!==f.id).id,cursor:first.next_cursor},{revision:r.revision}),viewer),(e:any)=>code(e)==='22023');
    await assert.rejects(()=>query(req('listings',{...base,cell_id:f.id,cursor:first.next_cursor},{revision:r.revision}),c),(e:any)=>code(e)==='22023');
  });
  await db.close();console.log(`S13 SQL: ${passed}/${passed} PASS (isolated spatial shims; PostGIS real en staging con scripts/staging/probar-mapa-v3.mjs)`);
}
main().catch(async e=>{console.error(e);await db.close();process.exitCode=1;});
