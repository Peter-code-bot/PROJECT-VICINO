import assert from 'node:assert/strict';
import { mapQuerySchema,mapResultSchema,MAP_AREA } from '../packages/shared/src';
import { boundsAround,intersectMapBounds,queryFromMapParams } from '../apps/web/lib/geo/publication-map';
const base={bounds:{west:-98.4,south:18.9,east:-98,north:19.2}};
let passed=0;
function test(name:string,run:()=>void){run();passed++;console.log('PASS '+name);}
test('strict bounds and bounded filters',()=>{
  for(const q of [{...base,other:1},{...base,bounds:{...base.bounds,north:Infinity}},{...base,bounds:{...base.bounds,west:1}},
    {...base,q:'x'.repeat(121)},{...base,radius_meters:50001},{...base,price_min:20,price_max:1},{...base,mode:'nearby'},
    {...base,categories:['missing']}])assert.equal(mapQuerySchema.safeParse(q).success,false);
});
test('canonical defaults discard zone center and deduplicate categories',()=>{
  const r=mapQuerySchema.parse({...base,q:' hola ',categories:['comida','comida'],center:{lat:19,lng:-98}});
  assert.equal(r.q,'hola');assert.deepEqual(r.categories,['comida']);assert.equal(r.center,null);assert.equal(r.radius_meters,10000);
});
test('outside viewport yields empty state, overlap clips',()=>{
  assert.equal(intersectMapBounds({west:0,east:1,south:0,north:1}),null);
  assert.deepEqual(intersectMapBounds({west:-180,east:180,south:-90,north:90}),MAP_AREA);
  assert.ok(intersectMapBounds(boundsAround({lat:19,lng:-98})));
});
test('safe URL filters preserve valid search and reject malformed input',()=>{
  const r=queryFromMapParams({q:'cafe',category:'comida',price_min:'20'},{lat:19,lng:-98},10000);
  assert.equal(r.q,'cafe');assert.equal(r.price_min,20);
  assert.equal(queryFromMapParams({price_max:'NaN'},{lat:19,lng:-98},10000).price_max,null);
});
test('output projection strips unexpected private fields deeply',()=>{
  const r=mapResultSchema.parse({query_key:'a'.repeat(32),projection_version:1,as_of:'2026-09-30',features:[{id:'cell:1:1:1',public_lat:19,public_lng:-98,count:1,seller_count:1,bounds:base.bounds,ubicacion_geo:'secret'}],listings:[],total:1,seller_total:1,list_total:0,next_cursor:null,private:'secret'});
  assert.ok(!JSON.stringify(r).includes('secret'));
});
console.log(`S10 contracts: ${passed}/${passed} PASS`);
