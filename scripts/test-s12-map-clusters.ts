/** Public synthetic cells; grouping stability and SQL membership, no DB/SDK. */
import assert from 'node:assert/strict';
import { clusterMapLayer, publicZoneBounds } from '../apps/web/lib/geo/map-coverage';
import { MAP_AREA, mapBoundsSchema, mapCoverageRequestSchema, mapQuerySchema, type MapCell } from '../packages/shared/src/validators/publications-map';

let passed=0;
function check(name:string,run:()=>void){run();passed++;console.log('PASS '+name);}
const cells:MapCell[]=Array.from({length:360},(_,i)=>({x:-9820+i,y:1900,count:i%3+1,seller_count:1}));
const bounds={west:-98.205,east:-95.205,south:18.99,north:19.01};
check('a camera shift around 300 points keeps the coarser level on return',()=>{
  const first=clusterMapLayer(cells,bounds);
  assert.equal(first.stride,1);assert.equal(first.features.length,300);
  const shifted=clusterMapLayer(cells,{...bounds,east:bounds.east+.01},first.stride);
  assert.equal(shifted.stride,2);assert.ok(shifted.features.length<=300);
  const back=clusterMapLayer(cells,bounds,shifted.stride);
  assert.equal(back.stride,2);
  assert.deepEqual(back.features.map(f=>f.id),shifted.features.filter(f=>f.bounds.west<=bounds.east).map(f=>f.id));
});
check('zooming into fewer than 180 finer groups refines again',()=>{
  const broad=clusterMapLayer(cells,{...bounds,east:-94.60});
  assert.equal(broad.stride,2);
  const close=clusterMapLayer(cells,{...bounds,east:-97.00},broad.stride);
  assert.equal(close.stride,1);assert.equal(close.features.length,121);
});
check('counts and negative grid membership stay valid for details at every retained level',()=>{
  for(const previous of [1,2,4,8]){
    const layer=clusterMapLayer(cells,bounds,previous);
    assert.ok(layer.features.length<=300);
    for(const f of layer.features){
      const [,s,x,y]=f.id.split(':').map(Number);
      const members=cells.filter(c=>Math.floor(c.x/s!)===x&&Math.floor(c.y/s!)===y);
      assert.equal(f.count,members.reduce((n,c)=>n+c.count,0));
      assert.equal(f.seller_count,0);
      assert.ok(mapCoverageRequestSchema.safeParse({action:'listings',query:mapQuerySchema.parse({bounds,cell_id:f.id}),coverage_center:null,revision:null,cell_cursor:null}).success);
    }
  }
});
check('invalid previous levels recover and dense layers respect the hard limit',()=>{
  const dense=Array.from({length:10000},(_,i)=>({x:-9900+i%100,y:1800+Math.floor(i/100),count:1,seller_count:1}));
  for(const previous of [0,3,Infinity,NaN,32768]){
    const layer=clusterMapLayer(dense,{west:-99.01,east:-98.00,south:17.99,north:19},previous);
    assert.ok(layer.features.length<=300);assert.equal(layer.features.reduce((n,f)=>n+f.count,0),10000);
  }
  assert.deepEqual(clusterMapLayer([],bounds,8),{features:[],stride:1});
});
check('a single public cell frames its entire approximate area with a margin',()=>{
  const center={west:-98.21,east:-98.21,south:19.04,north:19.04};
  const framed=publicZoneBounds(center);
  assert.ok(mapBoundsSchema.safeParse(framed).success);
  assert.ok(framed.west < center.west-.005 && framed.east > center.east+.005);
  assert.ok(framed.south < center.south-.005 && framed.north > center.north+.005);
  assert.ok(framed.east-framed.west >= .01 && framed.north-framed.south >= .01);
});
check('a group frames all public member cells instead of zooming to its weighted pin',()=>{
  const group={west:-98.25,east:-98.20,south:19.02,north:19.05};
  const framed=publicZoneBounds(group);
  assert.ok(framed.west < group.west-.005 && framed.east > group.east+.005);
  assert.ok(framed.south < group.south-.005 && framed.north > group.north+.005);
});
check('public area framing stays valid at every Mexico coverage edge',()=>{
  for(const lng of [MAP_AREA.west,MAP_AREA.east])for(const lat of [MAP_AREA.south,MAP_AREA.north]){
    const framed=publicZoneBounds({west:lng,east:lng,south:lat,north:lat});
    assert.ok(mapBoundsSchema.safeParse(framed).success);
    assert.ok(framed.west<=lng&&framed.east>=lng&&framed.south<=lat&&framed.north>=lat);
  }
  assert.deepEqual(publicZoneBounds(MAP_AREA),MAP_AREA);
});
console.log(`S12 map clusters: ${passed}/${passed} PASS; synthetic public cells`);
