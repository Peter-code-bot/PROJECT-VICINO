export interface LocationSearchResult {
  id: string;
  name: string;
  fullName: string;
  lat: number;
  lng: number;
  subtitle?: string;
  distanceKm?: number;
}

export interface SearchLocationsOptions {
  center?: { lat: number; lng: number };
  limit?: number;
}

// Centro por defecto: Puebla, Pue.
const DEFAULT_CENTER = { lat: 19.0414, lng: -98.2063 };
const BIAS_SPAN_DEGREES = 0.8; // ~85 km de cobertura alrededor del usuario

/** Calcula la distancia aproximada en km entre dos puntos (fórmula de Haversine) */
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Búsqueda mediante Apple MapKit JS (si está inicializado en window.mapkit)
 */
async function searchWithMapKit(
  query: string,
  center: { lat: number; lng: number },
  limit: number
): Promise<LocationSearchResult[] | null> {
  if (typeof window === "undefined" || !window.mapkit) return null;

  try {
    const mapkit = window.mapkit as any;
    if (!mapkit.Search || !mapkit.Coordinate) return null;

    const searchInstance = new mapkit.Search({
      coordinate: new mapkit.Coordinate(center.lat, center.lng),
      language: "es",
    });

    return await new Promise((resolve) => {
      searchInstance.search(query, (error: any, data: any) => {
        if (error || !data || !Array.isArray(data.places) || data.places.length === 0) {
          resolve(null);
          return;
        }

        const items: LocationSearchResult[] = data.places.slice(0, limit).map((place: any, index: number) => {
          const lat = place.coordinate.latitude;
          const lng = place.coordinate.longitude;
          const dist = calculateDistanceKm(center.lat, center.lng, lat, lng);
          return {
            id: `mk-${index}-${lat}-${lng}`,
            name: place.name || place.formattedAddress,
            fullName: place.formattedAddress || place.name,
            lat,
            lng,
            subtitle: place.formattedAddress !== place.name ? place.formattedAddress : undefined,
            distanceKm: dist,
          };
        });

        // Ordenar por distancia más cercana al usuario
        items.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
        resolve(items);
      });
    });
  } catch {
    return null;
  }
}

/**
 * Búsqueda mediante OpenStreetMap Nominatim con sesgo de proximidad (viewbox con bounded=0)
 */
async function searchWithNominatim(
  query: string,
  center: { lat: number; lng: number },
  limit: number
): Promise<LocationSearchResult[]> {
  const minLng = center.lng - BIAS_SPAN_DEGREES;
  const maxLng = center.lng + BIAS_SPAN_DEGREES;
  const minLat = center.lat - BIAS_SPAN_DEGREES;
  const maxLat = center.lat + BIAS_SPAN_DEGREES;

  // Formato viewbox: left,top,right,bottom (min_lon, max_lat, max_lon, min_lat)
  const viewbox = `${minLng.toFixed(4)},${maxLat.toFixed(4)},${maxLng.toFixed(4)},${minLat.toFixed(4)}`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query
  )}&format=json&countrycodes=mx&viewbox=${viewbox}&bounded=0&limit=${Math.max(limit * 2, 8)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const mapped: LocationSearchResult[] = [];
    for (const item of data) {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const rawDisplay = typeof item.display_name === "string" ? item.display_name : "";
      const parts = rawDisplay.split(",").map((p: string) => p.trim());
      const shortName = parts.slice(0, 2).join(", ");
      const sub = parts.slice(2, 5).join(", ");
      const dist = calculateDistanceKm(center.lat, center.lng, lat, lng);

      mapped.push({
        id: `osm-${item.place_id || item.osm_id || `${lat}-${lng}`}`,
        name: shortName || rawDisplay,
        fullName: rawDisplay,
        lat,
        lng,
        subtitle: sub || undefined,
        distanceKm: dist,
      });
    }

    // Priorizar los resultados más cercanos al usuario
    mapped.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));

    return mapped.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Búsqueda inteligente de direcciones y lugares con sesgo de proximidad (Location Biasing).
 * Prioriza Apple MapKit JS y cae con gracia a Nominatim sesgado.
 */
export async function searchLocations(
  query: string,
  options?: SearchLocationsOptions
): Promise<LocationSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const center = options?.center && Number.isFinite(options.center.lat) && Number.isFinite(options.center.lng)
    ? options.center
    : DEFAULT_CENTER;
  const limit = options?.limit ?? 5;

  // 1. Intentar con Apple MapKit JS
  const mapKitResults = await searchWithMapKit(trimmed, center, limit);
  if (mapKitResults && mapKitResults.length > 0) {
    return mapKitResults;
  }

  // 2. Fallback a Nominatim con sesgo de coordenadas
  return searchWithNominatim(trimmed, center, limit);
}
