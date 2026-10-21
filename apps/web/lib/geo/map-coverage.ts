import { MAP_AREA, MAP_CELL_UNITS_V1, MAP_CELL_UNITS_V2, type MapBounds, type MapCell, type MapFeature, type MapQuery } from '@vicino/shared';
import { boundsAround, intersectMapBounds } from './publication-map';
export const COVERAGE_RADIUS = 50_000;
export const COVERAGE_TTL = 30_000;
/** Minimum span when framing one public cell: a ~110 m cell alone is unreadable. */
export const MIN_ZONE_SPAN = 0.006;
/**
 * Units per degree of the public cells a response carries.
 * Projection v1 (RPC v1/v2) rounds to 0.01° (100 per degree); projection v2
 * (RPC v3) rounds to 0.001° (1000 per degree). The server says which one it
 * used in `projection_version`; the camera layer must not assume.
 */
export function cellUnits(projectionVersion: number): number {
  return projectionVersion >= 2 ? MAP_CELL_UNITS_V2 : MAP_CELL_UNITS_V1;
}
export function coverageBounds(center: {lat:number;lng:number}|null): MapBounds {
  return center ? intersectMapBounds(boundsAround(center,COVERAGE_RADIUS)) ?? MAP_AREA : MAP_AREA;
}
export function coverageContains(center: {lat:number;lng:number}, viewport: MapBounds): boolean {
  return [[viewport.south,viewport.west],[viewport.north,viewport.east],[viewport.south,viewport.east],[viewport.north,viewport.west]]
    .every(([lat,lng])=>publicDistance(center,{lat:lat!,lng:lng!}) <= COVERAGE_RADIUS * .85);
}
export function publicDistance(a:{lat:number;lng:number},b:{lat:number;lng:number}):number {
  const r=Math.PI/180, dlat=(b.lat-a.lat)*r, dlng=(b.lng-a.lng)*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2;
  return 6371008.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export interface MapCellLayer { features: MapFeature[]; stride: number }
/** Frame whole public cells (never a more precise seller location), with a
 * margin and a readable minimum span. `units` is the response's cell size. */
export function publicZoneBounds(bounds: MapBounds, units = MAP_CELL_UNITS_V2): MapBounds {
  const half = .5 / units;
  const cell = { west: bounds.west - half, east: bounds.east + half, south: bounds.south - half, north: bounds.north + half };
  const longitudeMargin = Math.max((cell.east - cell.west) * .15, (MIN_ZONE_SPAN - (cell.east - cell.west)) / 2, 0);
  const latitudeMargin = Math.max((cell.north - cell.south) * .15, (MIN_ZONE_SPAN - (cell.north - cell.south)) / 2, 0);
  return intersectMapBounds({ west: cell.west - longitudeMargin, east: cell.east + longitudeMargin,
    south: cell.south - latitudeMargin, north: cell.north + latitudeMargin }) ?? MAP_AREA;
}
/** Only public cells; count each entire node before clipping to the camera. */
function featuresAtStride(cells:MapCell[],viewport:MapBounds,stride:number,units:number):MapFeature[] {
    const groups=new Map<string,{count:number;lat:number;lng:number;bounds:MapBounds}>();
    // Count the entire stable node. Cropping before grouping would make its
    // badge disagree with the SQL details when the camera cuts through it.
    for(const c of cells){
      const id=`cell:${stride}:${Math.floor(c.x/stride)}:${Math.floor(c.y/stride)}`;
      const lat=c.y/units,lng=c.x/units;
      const g=groups.get(id)??{count:0,lat:0,lng:0,bounds:{west:lng,east:lng,south:lat,north:lat}};
      g.count+=c.count;g.lat+=lat*c.count;g.lng+=lng*c.count;
      g.bounds={west:Math.min(g.bounds.west,lng),east:Math.max(g.bounds.east,lng),south:Math.min(g.bounds.south,lat),north:Math.max(g.bounds.north,lat)};groups.set(id,g);
    }
    const visible=[...groups].filter(([,g])=>g.bounds.east>=viewport.west&&g.bounds.west<=viewport.east&&g.bounds.north>=viewport.south&&g.bounds.south<=viewport.north);
    return visible.sort(([a],[b])=>a.localeCompare(b)).map(([id,g])=>({id,public_lat:g.lat/g.count,public_lng:g.lng/g.count,count:g.count,seller_count:0,bounds:g.bounds}));
}
/** Keep a level until a finer one has room to spare; a small pan cannot toggle
 * between 299 and 301 markers on every camera event. The hard cap stays 300.
 * `units` must match the projection that produced `cells` (see cellUnits). */
export function clusterMapLayer(cells:MapCell[],viewport:MapBounds,previousStride=1,units=MAP_CELL_UNITS_V2):MapCellLayer {
  let stride=Number.isInteger(previousStride)&&previousStride>=1&&previousStride<=8192&&(previousStride&(previousStride-1))===0?previousStride:1;
  let features=featuresAtStride(cells,viewport,stride,units);
  while(features.length>300){stride*=2;features=featuresAtStride(cells,viewport,stride,units);}
  while(stride>1){
    const finer=featuresAtStride(cells,viewport,stride/2,units);
    if(finer.length>180)break;
    stride/=2;features=finer;
  }
  return {features,stride};
}
export function clusterMapCells(cells:MapCell[],viewport:MapBounds,units=MAP_CELL_UNITS_V2):MapFeature[] {
  return clusterMapLayer(cells,viewport,1,units).features;
}
export function coverageQuery(query:MapQuery, center:{lat:number;lng:number}|null):MapQuery {
  return {...query,bounds:coverageBounds(center),cell_id:null,cursor:null};
}
