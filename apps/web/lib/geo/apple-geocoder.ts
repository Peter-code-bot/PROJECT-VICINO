/**
 * Geocodificador inverso cliente basado en Apple MapKit JS (P1-1).
 * Reemplaza llamadas directas de navegador a OSM Nominatim.
 */

export interface ReverseGeocodeResult {
  name: string;
  fullName: string;
  locality?: string;
  subLocality?: string;
  postalCode?: string;
}

const REVERSE_TIMEOUT_MS = 4000;
const geocodeCache = new Map<string, ReverseGeocodeResult>();

export async function reverseGeocodeWithApple(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<ReverseGeocodeResult | null> {
  if (typeof window === "undefined" || !window.mapkit) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (signal?.aborted) return null;

  // Caché espacial en memoria (~110m de radio, 3 decimales)
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const mapkit = window.mapkit;
  if (!mapkit || !mapkit.Geocoder || !mapkit.Coordinate) return null;

  return new Promise((resolve) => {
    let finished = false;
    const cleanup = () => {
      finished = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    const finish = (result: ReverseGeocodeResult | null) => {
      if (finished) return;
      cleanup();
      if (result) {
        geocodeCache.set(cacheKey, result);
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish(null);
    }, REVERSE_TIMEOUT_MS);

    const onAbort = () => {
      finish(null);
    };

    if (signal) {
      signal.addEventListener("abort", onAbort);
    }

    try {
      const geocoder = new mapkit.Geocoder({ language: "es" });
      const coord = new mapkit.Coordinate(lat, lng);

      geocoder.reverseLookup(coord, (error, data) => {
        if (finished) return;
        if (error || !data || !Array.isArray(data.results) || data.results.length === 0 || !data.results[0]) {
          finish(null);
          return;
        }

        const place = data.results[0];
        const subLocality = place.subLocality || place.subThoroughfare;
        const locality = place.locality || place.administrativeArea;
        const postalCode = place.postCode || place.postalCode;
        const formatted = place.formattedAddress || "";

        let name = "";
        if (subLocality && locality) {
          name = `${subLocality}, ${locality}`;
        } else if (subLocality) {
          name = subLocality;
        } else if (locality) {
          name = locality;
        } else if (place.name) {
          name = place.name;
        } else {
          name = formatted || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }

        const fullName =
          postalCode && !name.includes(postalCode)
            ? `${name}, CP ${postalCode}`
            : formatted || name;

        finish({
          name,
          fullName,
          locality,
          subLocality,
          postalCode,
        });
      });
    } catch {
      finish(null);
    }
  });
}
