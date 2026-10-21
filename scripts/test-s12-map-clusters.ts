/** Public synthetic cells; grouping stability and SQL membership, no DB/SDK.
 * Cells come in thousandths of a degree (projection v2, 20261020150000) unless
 * a case says otherwise; projection v1 (hundredths) must keep working for the
 * route's fallback to RPC v2. */
import assert from 'node:assert/strict';
import { cellUnits, clusterMapLayer, MIN_ZONE_SPAN, publicZoneBounds } from '../apps/web/lib/geo/map-coverage';
import { MAP_AREA, MAP_CELL_UNITS_V1, MAP_CELL_UNITS_V2, mapBoundsSchema, mapCoverageRequestSchema, mapQuerySchema, type MapCell } from '../packages/shared/src/validators/publications-map';

let passed=0;
function check(name:string,run:()=>void){run();passed++;console.log('PASS '+name);}
const cells:MapCell[]=Array.from({length:360},(_,i)=>({x:-98200+i,y:19000,count:i%3+1,seller_count:1}));
const bounds={west:-98.2005,east:-97.9005,south:18.999,north:19.001};
check('a camera shift around 300 points keeps the coarser level on return',()=>{
  const first=clusterMapLayer(cells,bounds);
  assert.equal(first.stride,1);assert.equal(first.features.length,300);
  const shifted=clusterMapLayer(cells,{...bounds,east:bounds.east+.001},first.stride);
  assert.equal(shifted.stride,2);assert.ok(shifted.features.length<=300);
  const back=clusterMapLayer(cells,bounds,shifted.stride);
  assert.equal(back.stride,2);
  assert.deepEqual(back.features.map(f=>f.id),shifted.features.filter(f=>f.bounds.west<=bounds.east).map(f=>f.id));
});
check('zooming into fewer than 180 finer groups refines again',()=>{
  const broad=clusterMapLayer(cells,{...bounds,east:-97.60});
  assert.equal(broad.stride,2);
  const close=clusterMapLayer(cells,{...bounds,east:-98.08},broad.stride);
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
  const dense=Array.from({length:10000},(_,i)=>({x:-99000+i%100,y:18000+Math.floor(i/100),count:1,seller_count:1}));
  for(const previous of [0,3,Infinity,NaN,32768]){
    const layer=clusterMapLayer(dense,{west:-99.001,east:-98.900,south:17.999,north:18.1},previous);
    assert.ok(layer.features.length<=300);assert.equal(layer.features.reduce((n,f)=>n+f.count,0),10000);
  }
  assert.deepEqual(clusterMapLayer([],bounds,8),{features:[],stride:1});
});
check('the same public place is drawn at the same coordinate in both projections',()=>{
  assert.equal(cellUnits(1),MAP_CELL_UNITS_V1);assert.equal(cellUnits(2),MAP_CELL_UNITS_V2);
  const v1=clusterMapLayer([{x:-9823,y:1904,count:2,seller_count:1}],{west:-98.3,east:-98.1,south:19,north:19.1},1,cellUnits(1));
  const v2=clusterMapLayer([{x:-98230,y:19040,count:2,seller_count:1}],{west:-98.3,east:-98.1,south:19,north:19.1},1,cellUnits(2));
  assert.deepEqual([v1.features[0]!.public_lat,v1.features[0]!.public_lng],[19.04,-98.23]);
  assert.deepEqual([v2.features[0]!.public_lat,v2.features[0]!.public_lng],[19.04,-98.23]);
  assert.equal(v1.features[0]!.id,'cell:1:-9823:1904');assert.equal(v2.features[0]!.id,'cell:1:-98230:19040');
});
check('a block of three sellers becomes three points in projection v2 where projection v1 had one',()=>{
  const viewport={west:-98.215,east:-98.195,south:19.035,north:19.05};
  const v1=clusterMapLayer([{x:-9821,y:1904,count:12,seller_count:10}],viewport,1,cellUnits(1));
  assert.equal(v1.features.length,1);assert.equal(v1.features[0]!.count,12);
  const v2=clusterMapLayer([{x:-98206,y:19041,count:5,seller_count:4},{x:-98208,y:19044,count:4,seller_count:3},{x:-98204,y:19039,count:3,seller_count:3}],viewport,1,cellUnits(2));
  assert.equal(v2.features.length,3);assert.equal(v2.features.reduce((n,f)=>n+f.count,0),12);
  for(const f of v2.features)assert.ok(Math.abs(f.public_lat-19.04)<.01&&Math.abs(f.public_lng+98.21)<.01);
});
check('a single public cell frames its area with a margin and a readable minimum span',()=>{
  const center={west:-98.206,east:-98.206,south:19.041,north:19.041};
  const framed=publicZoneBounds(center);
  assert.ok(mapBoundsSchema.safeParse(framed).success);
  assert.ok(framed.west < center.west-.0005 && framed.east > center.east+.0005);
  assert.ok(framed.south < center.south-.0005 && framed.north > center.north+.0005);
  assert.ok(framed.east-framed.west >= MIN_ZONE_SPAN && framed.north-framed.south >= MIN_ZONE_SPAN);
  assert.ok(Math.abs((framed.east+framed.west)/2-center.west)<1e-9 && Math.abs((framed.north+framed.south)/2-center.south)<1e-9);
  const legacy=publicZoneBounds({west:-98.21,east:-98.21,south:19.04,north:19.04},cellUnits(1));
  assert.ok(legacy.west < -98.21-.005 && legacy.east > -98.21+.005 && legacy.south < 19.04-.005 && legacy.north > 19.04+.005);
});
check('a group frames all public member cells instead of zooming to its weighted pin',()=>{
  const group={west:-98.25,east:-98.20,south:19.02,north:19.05};
  const framed=publicZoneBounds(group);
  assert.ok(framed.west < group.west-.0005 && framed.east > group.east+.0005);
  assert.ok(framed.south < group.south-.0005 && framed.north > group.north+.0005);
  assert.ok(framed.east-framed.west > (group.east-group.west)*1.2);
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
