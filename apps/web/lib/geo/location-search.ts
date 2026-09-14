export interface LocationSearchResult {
  id: string;
  name: string;
  fullName: string;
  /**
   * OJO: es NaN mientras `needsResolution` sea true. Apple devuelve sugerencias
   * de autocompletado sin coordenadas, y antes aqui se metian las del centro
   * del mapa como relleno. Eso convertia un fallo de resolucion en "el usuario
   * queda en el centro con el nombre del sitio que pidio" —ubicacion mala,
   * etiqueta correcta, imposible de notar. NaN es lo unico que no se puede
   * confundir con una coordenada real.
   */
  lat: number;
  lng: number;
  subtitle?: string;
  distanceKm?: number;
  countryCode?: string;
  /** true = las coordenadas NO son utilizables todavia. Hay que resolver antes de guardar. */
  needsResolution?: boolean;
  /** El sitio existe y Apple lo encontro, pero cae fuera del radio de cobertura. */
  outOfCoverage?: boolean;
  rejectionReason?: MotivoRechazo;
}

import type { MapKitAutocompleteResponse } from "@/hooks/use-mapkit";

export interface SearchLocationsOptions {
  center?: { lat: number; lng: number };
  limit?: number;
  signal?: AbortSignal;
  /** Sobrescribe el radio de cobertura para esta busqueda (km). */
  maxDistanceKm?: number;
}

export interface LocationSearchOutcome {
  results: LocationSearchResult[];
  /**
   * Apple SI devolvio resultados, pero todos cayeron fuera del radio de
   * cobertura. Sin esto la UI pinta una lista vacia identica a la de "no existe
   * ese lugar", y el usuario de Monterrey no tiene forma de saber que el
   * problema es la cobertura y no su forma de escribir.
   */
  outOfCoverage: boolean;
  reason?: MotivoRechazo;
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

/**
 * Radio de cobertura de VICINO, en km, medido contra el centro de la busqueda.
 *
 * Esto NO es una optimizacion, es la decision de producto de hasta donde llega
 * el marketplace, y por eso se configura sin tocar codigo:
 * NEXT_PUBLIC_COVERAGE_RADIUS_KM en Vercel. OJO: al ser NEXT_PUBLIC_ se inlinea
 * en el bundle del cliente durante el build, asi que cambiarla en Vercel exige
 * un redeploy — no basta con guardar la variable.
 *
 * Importa mas de lo que parece porque el centro por defecto es Puebla y un
 * recien instalado todavia no tiene ubicacion: con 200 km, desde Puebla,
 * CDMX (107) entra, pero Veracruz (218), Oaxaca (269), Guadalajara (567),
 * Monterrey (776), Cancun (1209) y Tijuana (2401) quedan fuera. Apple si
 * devuelve esos sitios; el filtro es nuestro. Si la app se descarga desde toda
 * la Republica, subir esto es lo que abre el resto del pais.
 */
const COVERAGE_RADIUS_FALLBACK_KM = 200;

function readCoverageRadius(): number {
  const raw = process.env.NEXT_PUBLIC_COVERAGE_RADIUS_KM;
  if (!raw) return COVERAGE_RADIUS_FALLBACK_KM;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return COVERAGE_RADIUS_FALLBACK_KM;
  return parsed;
}

export const COVERAGE_RADIUS_KM = readCoverageRadius();

// Caché en memoria durante la sesión para términos normalizados (P1-3).
// Acotada: sin tope, una sesion larga de tecleo la deja crecer sin freno, y sin
// caducidad un sitio que cambia de nombre se queda pegado hasta recargar.
const SEARCH_CACHE_MAX_ENTRIES = 50;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const sessionSearchCache = new Map<string, { at: number; outcome: LocationSearchOutcome }>();

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
export type MotivoRechazo = "ok" | "coordenadas" | "fuera-de-mexico" | "fuera-de-cobertura";

/**
 * Variante que dice POR QUE se rechazo. Separar "fuera de cobertura" del resto
 * es lo que permite a la UI distinguir "ese lugar no existe" de "ese lugar
 * existe pero VICINO todavia no llega ahi".
 */
export function clasificarResultado(
  candidate: { lat?: number | null; lng?: number | null; countryCode?: string | null },
  center?: { lat: number; lng: number } | null,
  maxDistanceKm: number = COVERAGE_RADIUS_KM
): MotivoRechazo {
  if (candidate.lat == null || candidate.lng == null) return "coordenadas";
  if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) return "coordenadas";

  // 1. Filtro estricto por código de país si viene informado por MapKit
  if (candidate.countryCode && candidate.countryCode.trim().toUpperCase() !== "MX") {
    return "fuera-de-mexico";
  }

  // 2. Bounding box de México
  if (
    candidate.lat < MEXICO_BBOX.minLat ||
    candidate.lat > MEXICO_BBOX.maxLat ||
    candidate.lng < MEXICO_BBOX.minLng ||
    candidate.lng > MEXICO_BBOX.maxLng
  ) {
    return "fuera-de-mexico";
  }

  // 3. Límite de distancia al centro de referencia
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
    const dist = calculateDistanceKm(center.lat, center.lng, candidate.lat, candidate.lng);
    if (dist > maxDistanceKm) {
      return "fuera-de-cobertura";
    }
  }

  return "ok";
}

export function esResultadoValido(
  candidate: { lat?: number | null; lng?: number | null; countryCode?: string | null },
  center?: { lat: number; lng: number } | null,
  maxDistanceKm: number = COVERAGE_RADIUS_KM
): boolean {
  return clasificarResultado(candidate, center, maxDistanceKm) === "ok";
}

/**
 * Realiza la búsqueda inicial typeahead con autocomplete() de Apple MapKit JS (B-4, P0-3).
 * Protegido con timeout de 4 segundos y soporte para AbortSignal (P0-2).
 */
async function searchWithMapKit(
  query: string,
  center: { lat: number; lng: number },
  limit: number,
  maxDistanceKm: number,
  signal?: AbortSignal
): Promise<LocationSearchOutcome> {
  const vacio: LocationSearchOutcome = { results: [], outOfCoverage: false };
  if (typeof window === "undefined" || !window.mapkit) return vacio;
  if (signal?.aborted) return vacio;

  const mapkit = window.mapkit;
  if (!mapkit || !mapkit.Search || !mapkit.Coordinate) return vacio;

  return new Promise((resolve) => {
    let finished = false;
    const cleanup = () => {
      finished = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    // Se acumula a lo largo de autocomplete() Y del fallback search(): si el
    // unico motivo por el que la lista quedo vacia fue la distancia, la UI tiene
    // que poder decirlo en vez de fingir que el sitio no existe.
    let huboFueraDeCobertura = false;
    let huboFueraDeMexico = false;

    const finish = (results: LocationSearchResult[]) => {
      if (finished) return;
      cleanup();
      resolve({
        results,
        outOfCoverage: results.length === 0 && huboFueraDeCobertura,
        reason: results.length > 0 ? undefined
          : huboFueraDeCobertura ? "fuera-de-cobertura"
          : huboFueraDeMexico ? "fuera-de-mexico" : undefined,
      });
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
            const motivo = clasificarResultado({ lat, lng, countryCode }, center, maxDistanceKm);
            if (motivo === "fuera-de-cobertura") huboFueraDeCobertura = true;
            if (motivo === "fuera-de-mexico") huboFueraDeMexico = true;
            if (motivo === "ok") {
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
            // Sugerencia sin coordenadas de MapKit (B-4): se marca para resolución
            // al seleccionar. Las coordenadas van en NaN A PROPOSITO —ver el
            // comentario de LocationSearchResult.lat: rellenarlas con el centro
            // hacia que un fallo de resolucion guardara el centro en silencio.
            items.push({
              id: `mk-sug-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`,
              name,
              fullName,
              lat: Number.NaN,
              lng: Number.NaN,
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

              const motivo = clasificarResultado({ lat, lng, countryCode }, center, maxDistanceKm);
              if (motivo === "fuera-de-cobertura") huboFueraDeCobertura = true;
              if (motivo === "fuera-de-mexico") huboFueraDeMexico = true;
              if (lat !== undefined && lng !== undefined && motivo === "ok") {
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
  center?: { lat: number; lng: number },
  maxDistanceKm: number = COVERAGE_RADIUS_KM
): Promise<LocationSearchResult> {
  // CONTRATO: si vuelve con needsResolution true, las coordenadas NO sirven y
  // quien llama NO debe guardarlas. Todas las salidas de fallo de aqui abajo lo
  // respetan; antes devolvian `item` tal cual, que traia las coordenadas del
  // centro y se guardaban como si fueran buenas.
  const fallo = (extra?: Partial<LocationSearchResult>): LocationSearchResult => ({
    ...item,
    needsResolution: true,
    ...extra,
  });

  if (!item.needsResolution && Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
    return item;
  }

  if (typeof window === "undefined" || !window.mapkit) return fallo();
  const mapkit = window.mapkit;
  if (!mapkit || !mapkit.Search || !mapkit.Coordinate) return fallo();

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
        resolve(fallo());
      }, SEARCH_TIMEOUT_MS);

      searchInstance.search(item.fullName || item.name, (err, data) => {
        clearTimeout(timer);
        if (!err && data && Array.isArray(data.places) && data.places.length > 0 && data.places[0]) {
          const place = data.places[0];
          const lat = place.coordinate?.latitude;
          const lng = place.coordinate?.longitude;
          const countryCode = place.countryCode || (place.structuredAddress && place.structuredAddress.countryCode);
          const motivo = clasificarResultado({ lat, lng, countryCode }, targetCenter, maxDistanceKm);

          if (lat !== undefined && lng !== undefined && motivo === "ok") {
            const dist = calculateDistanceKm(targetCenter.lat, targetCenter.lng, lat, lng);
            resolve({
              ...item,
              lat,
              lng,
              id: buildDeterministicId(lat, lng, item.name),
              fullName: place.formattedAddress || item.fullName,
              distanceKm: dist,
              needsResolution: false,
              outOfCoverage: false,
            });
            return;
          }

          // El sitio existe, solo esta lejos: eso se le dice al usuario.
          resolve(fallo({ outOfCoverage: motivo === "fuera-de-cobertura", rejectionReason: motivo }));
          return;
        }
        resolve(fallo());
      });
    } catch {
      resolve(fallo());
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
): Promise<LocationSearchOutcome> {
  const trimmed = query.trim();
  // P1-3: Mínimo 3 caracteres para no quemar cuota en cada pulsación inicial
  if (trimmed.length < 3) return { results: [], outOfCoverage: false };

  const center =
    options?.center && Number.isFinite(options.center.lat) && Number.isFinite(options.center.lng)
      ? options.center
      : DEFAULT_CENTER;
  const limit = options?.limit ?? 5;
  const maxDistanceKm =
    options?.maxDistanceKm && Number.isFinite(options.maxDistanceKm) && options.maxDistanceKm > 0
      ? options.maxDistanceKm
      : COVERAGE_RADIUS_KM;

  // Clave de caché normalizada
  const cacheKey = `${trimmed.toLowerCase()}|${center.lat.toFixed(3)}|${center.lng.toFixed(3)}|${limit}|${maxDistanceKm}`;
  const cached = sessionSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) {
    return cached.outcome;
  }
  if (cached) sessionSearchCache.delete(cacheKey);

  const outcome = await searchWithMapKit(trimmed, center, limit, maxDistanceKm, options?.signal);

  // Se cachea tambien el "fuera de cobertura": es una respuesta estable de Apple
  // y repetir la consulta no la va a cambiar.
  if (outcome.results.length > 0 || outcome.outOfCoverage) {
    if (sessionSearchCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = sessionSearchCache.keys().next();
      if (!oldest.done) sessionSearchCache.delete(oldest.value);
    }
    sessionSearchCache.set(cacheKey, { at: Date.now(), outcome });
  }

  return outcome;
}
