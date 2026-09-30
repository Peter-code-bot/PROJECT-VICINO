import { MAP_AREA, mapQuerySchema, type MapBounds, type MapQuery } from "@vicino/shared";

export const DEFAULT_MAP_CENTER = { lat: 19.0414, lng: -98.2063 };
export function intersectMapBounds(bounds: MapBounds): MapBounds | null {
  if (!Object.values(bounds).every(Number.isFinite)) return null;
  const clipped = {
    west: Math.max(MAP_AREA.west, bounds.west), south: Math.max(MAP_AREA.south, bounds.south),
    east: Math.min(MAP_AREA.east, bounds.east), north: Math.min(MAP_AREA.north, bounds.north),
  };
  return clipped.west < clipped.east && clipped.south < clipped.north ? clipped : null;
}
export function boundsAround(center: { lat: number; lng: number }, meters = 10000): MapBounds {
  const lat = Math.max(0.025, meters / 111000 * 1.25);
  const lng = lat / Math.max(0.2, Math.cos(center.lat * Math.PI / 180));
  return { west: center.lng - lng, east: center.lng + lng, south: center.lat - lat, north: center.lat + lat };
}
export function queryFromMapParams(params: Record<string, string | string[] | undefined>, center: { lat: number; lng: number }, radius: number): MapQuery {
  const single = (key: string) => typeof params[key] === "string" ? params[key] as string : undefined;
  const base = mapQuerySchema.parse({ bounds: intersectMapBounds(boundsAround(center, radius)) ?? MAP_AREA, center, radius_meters: radius });
  const optional = mapQuerySchema.safeParse({ ...base, q: single("q") ?? "", categories: single("category")?.split(",") ?? [],
    tipo: single("tipo") || null, price_min: single("price_min") ? Number(single("price_min")) : null, price_max: single("price_max") ? Number(single("price_max")) : null });
  return optional.success ? optional.data : base;
}
