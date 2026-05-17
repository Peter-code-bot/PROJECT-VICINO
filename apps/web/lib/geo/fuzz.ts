/**
 * Round a coordinate to ~100m precision (3 decimal places at the equator).
 * Use before exposing lat/lng to a non-owner client. Owners (creador_id === user.id)
 * should bypass this and receive exact coords.
 */
export function fuzzCoordinate(
  lat: number,
  lng: number,
  decimals = 3,
): { lat: number; lng: number } {
  const factor = 10 ** decimals;
  return {
    lat: Math.round(lat * factor) / factor,
    lng: Math.round(lng * factor) / factor,
  };
}

/**
 * Bucket a distance to the nearest `bucketSize` meters (default 100m).
 * Use before returning distance to the client so attackers cannot triangulate
 * a listing's exact position via a series of probe requests.
 */
export function fuzzDistance(meters: number, bucketSize = 100): number {
  if (!Number.isFinite(meters)) return 0;
  return Math.round(meters / bucketSize) * bucketSize;
}
