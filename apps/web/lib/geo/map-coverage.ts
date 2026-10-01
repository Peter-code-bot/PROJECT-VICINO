import { MAP_AREA, type MapBounds, type MapCell, type MapFeature, type MapQuery } from '@vicino/shared';
import { boundsAround, intersectMapBounds } from './publication-map';
export const COVERAGE_RADIUS = 50_000;
export const COVERAGE_TTL = 30_000;
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
/** Only public cells; no individual listing coordinates or seller IDs. */
export function clusterMapCells(cells:MapCell[],viewport:MapBounds):MapFeature[] {
  let stride=1;
  for (;;) {
    const groups=new Map<string,{count:number;lat:number;lng:number;bounds:MapBounds}>();
    // Count the entire stable node. Cropping before grouping would make its
    // badge disagree with the SQL details when the camera cuts through it.
    for(const c of cells){
      const id=`cell:${stride}:${Math.floor(c.x/stride)}:${Math.floor(c.y/stride)}`;
      const lat=c.y/100,lng=c.x/100;
      const g=groups.get(id)??{count:0,lat:0,lng:0,bounds:{west:lng,east:lng,south:lat,north:lat}};
      g.count+=c.count;g.lat+=lat*c.count;g.lng+=lng*c.count;
      g.bounds={west:Math.min(g.bounds.west,lng),east:Math.max(g.bounds.east,lng),south:Math.min(g.bounds.south,lat),north:Math.max(g.bounds.north,lat)};groups.set(id,g);
    }
    const visible=[...groups].filter(([,g])=>g.bounds.east>=viewport.west&&g.bounds.west<=viewport.east&&g.bounds.north>=viewport.south&&g.bounds.south<=viewport.north);
    if(visible.length<=300)return visible.sort(([a],[b])=>a.localeCompare(b)).map(([id,g])=>({id,public_lat:g.lat/g.count,public_lng:g.lng/g.count,count:g.count,seller_count:0,bounds:g.bounds}));
    stride*=2;
  }
}
export function coverageQuery(query:MapQuery, center:{lat:number;lng:number}|null):MapQuery {
  return {...query,bounds:coverageBounds(center),cell_id:null,cursor:null};
}
