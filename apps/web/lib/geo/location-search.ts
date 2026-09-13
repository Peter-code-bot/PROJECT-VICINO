export interface LocationSearchResult {
  id: string;
  name: string;
  fullName: string;
  lat: number;
  lng: number;
  subtitle?: string;
  distanceKm?: number;
  countryCode?: string;
  needsResolution?: boolean;
}

import type { MapKitAutocompleteResponse } from "@/hooks/use-mapkit";

export interface SearchLocationsOptions {
  center?: { lat: number; lng: number };
  limit?: number;
  signal?: AbortSignal;
}

// Centro por defecto: Puebla, Pue.
export const DEFAULT_CENTER = { lat: 19.0414, lng: -98.2063 };
export const BIAS_SPAN_DEGREES = 0.35; // ~39 km de cobertura (zona metropolitana)
export const SEARCH_TIMEOUT_MS = 4000; // 4 segundos de timeout estricto

export const MEXICO_BBOX = {
  minLat: 14.5,
  maxLat: 32.8,
  minLng: -118.5,
  maxLng: -86.5,
};

// Cobertura máxima por defecto para búsquedas metropolitanas/regionales (km)
export const MAX_METRO_DISTANCE_KM = 200;

// Caché en memoria durante la sesión para términos normalizados (P1-3)
const sessionSearchCache = new Map<string, LocationSearchResult[]>();

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

/** Construye un ID determinista independiente del índice del array (P2-4) */
export function buildDeterministicId(lat: number, lng: number, name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `mk-${lat.toFixed(5)}-${lng.toFixed(5)}-${slug || "loc"}`;
}

/**
 * Filtro puro de validez de resultado (P0-3, P2-5):
 * 1. countryCode === 'MX' (criterio primario).
 * 2. Bounding box de México y límite de distancia máxima al centro (segunda red).
 * 3. Coordenadas finitas válidas.
 */
export function esResultadoValido(
  candidate: { lat?: number | null; lng?: number | null; countryCode?: string | null },
  center?: { lat: number; lng: number } | null,
  maxDistanceKm: number = MAX_METRO_DISTANCE_KM
): boolean {
  if (candidate.lat == null || candidate.lng == null) return false;
  if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) return false;

  // 1. Filtro estricto por código de país si viene informado por MapKit
  if (candidate.countryCode && candidate.countryCode.trim().toUpperCase() !== "MX") {
    return false;
  }

  // 2. Bounding box de México
  if (
    candidate.lat < MEXICO_BBOX.minLat ||
    candidate.lat > MEXICO_BBOX.maxLat ||
    candidate.lng < MEXICO_BBOX.minLng ||
    candidate.lng > MEXICO_BBOX.maxLng
  ) {
    return false;
  }

  // 3. Límite de distancia al centro de referencia
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
    const dist = calculateDistanceKm(center.lat, center.lng, candidate.lat, candidate.lng);
    if (dist > maxDistanceKm) {
      return false;
    }
  }

  return true;
}

/**
 * Realiza la búsqueda inicial typeahead con autocomplete() de Apple MapKit JS (B-4, P0-3).
 * Protegido con timeout de 4 segundos y soporte para AbortSignal (P0-2).
 */
async function searchWithMapKit(
  query: string,
  center: { lat: number; lng: number },
  limit: number,
  signal?: AbortSignal
): Promise<LocationSearchResult[]> {
  if (typeof window === "undefined" || !window.mapkit) return [];
  if (signal?.aborted) return [];

  const mapkit = window.mapkit;
  if (!mapkit || !mapkit.Search || !mapkit.Coordinate) return [];

  return new Promise((resolve) => {
    let finished = false;
    const cleanup = () => {
      finished = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    const finish = (results: LocationSearchResult[]) => {
      if (finished) return;
      cleanup();
      resolve(results);
    };

    const timer = setTimeout(() => {
      finish([]);
    }, SEARCH_TIMEOUT_MS);

    const onAbort = () => {
      finish([]);
    };

    if (signal) {
      signal.addEventListener("abort", onAbort);
    }

    try {
      const searchInstance = new mapkit.Search({
        limitToCountries: "MX",
        region: new mapkit.CoordinateRegion(
          new mapkit.Coordinate(center.lat, center.lng),
          new mapkit.CoordinateSpan(BIAS_SPAN_DEGREES, BIAS_SPAN_DEGREES)
        ),
        language: "es",
      });

      // Primero intentar autocomplete() para typeahead reactivo rápido
      const handleAutocomplete = (error: Error | null, data: MapKitAutocompleteResponse | null) => {
        if (finished) return;
        if (error || !data) {
          // Si autocomplete falla, intentar fallback a search() directo
          searchDirectly();
          return;
        }

        const rawResults = Array.isArray(data.results)
          ? data.results
          : Array.isArray(data.places)
          ? data.places
          : [];

        if (rawResults.length === 0) {
          searchDirectly();
          return;
        }

        const items: LocationSearchResult[] = [];
        for (const item of rawResults) {
          const displayLines: string[] = Array.isArray(item.displayLines)
            ? item.displayLines
            : [item.name || item.formattedAddress || ""];
          const name = displayLines[0] || item.name || query;
          const subtitle = displayLines.slice(1).join(", ") || (item.formattedAddress !== name ? item.formattedAddress : undefined);
          const fullName = displayLines.join(", ") || item.formattedAddress || name;

          const lat = item.coordinate ? item.coordinate.latitude : NaN;
          const lng = item.coordinate ? item.coordinate.longitude : NaN;
          const countryCode = item.countryCode || (item.structuredAddress && item.structuredAddress.countryCode);

          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            if (esResultadoValido({ lat, lng, countryCode }, center)) {
              const dist = calculateDistanceKm(center.lat, center.lng, lat, lng);
              items.push({
                id: buildDeterministicId(lat, lng, name),
                name,
                fullName,
                lat,
                lng,
                subtitle,
                distanceKm: dist,
                countryCode,
                needsResolution: false,
              });
            }
          } else {
            // Sugerencia sin coordenadas de MapKit (B-4): se marca para resolución al seleccionar
            const pseudoLat = center.lat;
            const pseudoLng = center.lng;
            items.push({
              id: `mk-sug-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`,
              name,
              fullName,
              lat: pseudoLat,
              lng: pseudoLng,
              subtitle,
              distanceKm: undefined,
              countryCode,
              needsResolution: true,
            });
          }

          if (items.length >= limit) break;
        }

        if (items.length > 0) {
          finish(items);
        } else {
          searchDirectly();
        }
      };

      const searchDirectly = () => {
        if (finished) return;
        try {
          searchInstance.search(query, (error, data) => {
            if (finished) return;
            if (error || !data || !Array.isArray(data.places)) {
              finish([]);
              return;
            }

            const items: LocationSearchResult[] = [];
            for (const place of data.places) {
              const lat = place.coordinate?.latitude;
              const lng = place.coordinate?.longitude;
              const countryCode = place.countryCode || (place.structuredAddress && place.structuredAddress.countryCode);

              if (lat !== undefined && lng !== undefined && esResultadoValido({ lat, lng, countryCode }, center)) {
                const dist = calculateDistanceKm(center.lat, center.lng, lat, lng);
                const name = place.name || place.formattedAddress || "Ubicación";
                items.push({
                  id: buildDeterministicId(lat, lng, name),
                  name,
                  fullName: place.formattedAddress || name,
                  lat,
                  lng,
                  subtitle: place.formattedAddress !== name ? place.formattedAddress : undefined,
                  distanceKm: dist,
                  countryCode,
                  needsResolution: false,
                });
              }
              if (items.length >= limit) break;
            }

            items.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
            finish(items);
          });
        } catch {
          finish([]);
        }
      };

      if (typeof searchInstance.autocomplete === "function") {
        searchInstance.autocomplete(query, handleAutocomplete);
      } else {
        searchDirectly();
      }
    } catch {
      finish([]);
    }
  });
}

/**
 * Resuelve las coordenadas precisas de un resultado de autocompletado (B-4).
 * Si la sugerencia ya tiene coordenadas válidas, la retorna inmediatamente.
 * Si necesita resolución, invoca searchInstance.search() con el nombre completo.
 */
export async function resolveLocationCoordinates(
  item: LocationSearchResult,
  center?: { lat: number; lng: number }
): Promise<LocationSearchResult> {
  if (!item.needsResolution && Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
    return item;
  }

  if (typeof window === "undefined" || !window.mapkit) return item;
  const mapkit = window.mapkit;
  if (!mapkit || !mapkit.Search || !mapkit.Coordinate) return item;

  const targetCenter = center || DEFAULT_CENTER;

  return new Promise((resolve) => {
    try {
      const searchInstance = new mapkit.Search({
        limitToCountries: "MX",
        region: new mapkit.CoordinateRegion(
          new mapkit.Coordinate(targetCenter.lat, targetCenter.lng),
          new mapkit.CoordinateSpan(BIAS_SPAN_DEGREES, BIAS_SPAN_DEGREES)
        ),
        language: "es",
      });

      const timer = setTimeout(() => {
        resolve(item);
      }, SEARCH_TIMEOUT_MS);

      searchInstance.search(item.fullName || item.name, (err, data) => {
        clearTimeout(timer);
        if (!err && data && Array.isArray(data.places) && data.places.length > 0 && data.places[0]) {
          const place = data.places[0];
          const lat = place.coordinate?.latitude;
          const lng = place.coordinate?.longitude;
          const countryCode = place.countryCode || (place.structuredAddress && place.structuredAddress.countryCode);

          if (lat !== undefined && lng !== undefined && esResultadoValido({ lat, lng, countryCode }, targetCenter)) {
            const dist = calculateDistanceKm(targetCenter.lat, targetCenter.lng, lat, lng);
            resolve({
              ...item,
              lat,
              lng,
              id: buildDeterministicId(lat, lng, item.name),
              fullName: place.formattedAddress || item.fullName,
              distanceKm: dist,
              needsResolution: false,
            });
            return;
          }
        }
        resolve(item);
      });
    } catch {
      resolve(item);
    }
  });
}

/**
 * Búsqueda principal de ubicaciones:
 * - Mínimo 3 caracteres (P1-3).
 * - Caché de sesión por término normalizado (P1-3).
 * - Límite estricto a México y Puebla (P0-3).
 * - Timeout y cancelación con AbortSignal (P0-2).
 * - Consolidado 100% en Apple MapKit (C-1, sin Nominatim).
 */
export async function searchLocations(
  query: string,
  options?: SearchLocationsOptions
): Promise<LocationSearchResult[]> {
  const trimmed = query.trim();
  // P1-3: Mínimo 3 caracteres para no quemar cuota en cada pulsación inicial
  if (trimmed.length < 3) return [];

  const center =
    options?.center && Number.isFinite(options.center.lat) && Number.isFinite(options.center.lng)
      ? options.center
      : DEFAULT_CENTER;
  const limit = options?.limit ?? 5;

  // Clave de caché normalizada
  const cacheKey = `${trimmed.toLowerCase()}|${center.lat.toFixed(3)}|${center.lng.toFixed(3)}|${limit}`;
  const cached = sessionSearchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const results = await searchWithMapKit(trimmed, center, limit, options?.signal);

  if (results.length > 0) {
    sessionSearchCache.set(cacheKey, results);
  }

  return results;
}
