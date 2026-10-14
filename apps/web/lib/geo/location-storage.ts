/**
 * Módulo centralizado de persistencia de ubicación geográfica (P1-6).
 * La cookie `vicino_location` es la FUENTE DE VERDAD (leída por el servidor para el feed).
 * `localStorage` actúa como ESPEJO enriquecido en cliente (nombres, precisión, etc.).
 */

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy?: number;
  radius?: number;
  name?: string;
  fullName?: string;
}

export const STORAGE_KEY = "vicino_last_location";
export const COOKIE_LOCATION = "vicino_location";
export const COOKIE_RADIUS = "vicino_radius";

export function isValidRadius(radius: number): boolean {
  return Number.isFinite(radius) && radius >= 500 && radius <= 50000;
}

function cookieValue(key: string): string | null {
  const entry = document.cookie.split(/;\s*/).find((c) => c.startsWith(`${key}=`));
  return entry ? entry.slice(key.length + 1) : null;
}

export function parseCoordinates(val: string): { lat: number; lng: number } | null {
  const parts = val.split(",").map((p) => p.trim() ? Number(p.trim()) : NaN);
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && Math.abs(parts[0]!) <= 90 && Math.abs(parts[1]!) <= 180) {
    return { lat: parts[0]!, lng: parts[1]! };
  }
  return null;
}

/**
 * Lee la ubicación actual.
 * Prioridad: Cookie `vicino_location` (servidor/fuente de verdad), enriquecida con `localStorage` (espejo).
 */
export function readLocation(): GeoPosition | null {
  if (typeof document === "undefined") return null;

  try {
    const cookies = document.cookie ? document.cookie.split(/;\s*/) : [];
    const locationCookie = cookies.find((c) => c.startsWith(`${COOKIE_LOCATION}=`));
    const radiusCookie = cookies.find((c) => c.startsWith(`${COOKIE_RADIUS}=`));

    const rawLocValue = locationCookie ? locationCookie.split("=")[1] : null;
    const cookieCoords = rawLocValue ? parseCoordinates(decodeURIComponent(rawLocValue)) : null;

    let mirror: GeoPosition | null = null;
    try {
      const rawMirror = localStorage.getItem(STORAGE_KEY);
      if (rawMirror) {
        const candidate = JSON.parse(rawMirror) as GeoPosition;
        if (candidate && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng) && Math.abs(candidate.lat) <= 90 && Math.abs(candidate.lng) <= 180) {
          mirror = { ...candidate, name: typeof candidate.name === "string" ? candidate.name : undefined, fullName: typeof candidate.fullName === "string" ? candidate.fullName : undefined };
        }
      }
    } catch {
      mirror = null;
    }

    if (cookieCoords) {
      const candidateRadius = radiusCookie ? Number(radiusCookie.split("=")[1]) : 10000;
      const radiusVal = isValidRadius(candidateRadius) ? candidateRadius : 10000;

      // Cookie and mirror must identify the same stored point (cookie precision: 3 decimals).
      if (
        mirror &&
        mirror.lat.toFixed(3) === cookieCoords.lat.toFixed(3) &&
        mirror.lng.toFixed(3) === cookieCoords.lng.toFixed(3)
      ) {
        return {
          ...mirror,
          lat: cookieCoords.lat,
          lng: cookieCoords.lng,
          radius: radiusVal,
        };
      }

      // Si no coincide el espejo, la cookie manda
      const pos: GeoPosition = {
        lat: cookieCoords.lat,
        lng: cookieCoords.lng,
        radius: radiusVal,
      };

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
      } catch {
        // storage quota
      }
      return pos;
    }

    // A mirror alone never establishes an applied server location.
    return null;
  } catch {
    return null;
  }
}

/**
 * Escribe la ubicación geográfica sincronizando primero la cookie (fuente de verdad)
 * y luego el espejo en localStorage.
 */
export function writeLocation(pos: GeoPosition): boolean {
  if (typeof document === "undefined") return false;

  if (
    !Number.isFinite(pos.lat) ||
    !Number.isFinite(pos.lng) ||
    Math.abs(pos.lat) > 90 ||
    Math.abs(pos.lng) > 180
  ) {
    return false;
  }

  const lat3 = pos.lat.toFixed(3);
  const lng3 = pos.lng.toFixed(3);
  const radius = pos.radius ?? 10000;
  if (!isValidRadius(radius)) return false;
  const location = `${lat3},${lng3}`;
  let previousLocation: string | null, previousRadius: string | null;
  try {
    previousLocation = cookieValue(COOKIE_LOCATION);
    previousRadius = cookieValue(COOKIE_RADIUS);
  } catch { return false; }
  const changed = previousLocation !== location || previousRadius !== String(radius);

  const restore = () => {
    for (const [key, value] of [[COOKIE_LOCATION, previousLocation], [COOKIE_RADIUS, previousRadius]]) {
      document.cookie = `${key}=${value ?? ""}; path=/; max-age=${value === null ? 0 : 31536000}; SameSite=Lax`;
    }
  };

  try {
    // 1. Fuente de verdad: Cookie accesible al servidor (SameSite=Lax, 1 año)
    if (changed) {
      document.cookie = `${COOKIE_LOCATION}=${location}; path=/; max-age=31536000; SameSite=Lax`;
      document.cookie = `${COOKIE_RADIUS}=${radius}; path=/; max-age=31536000; SameSite=Lax`;
    }
    if (cookieValue(COOKIE_LOCATION) !== location || cookieValue(COOKIE_RADIUS) !== String(radius)) {
      restore();
      return false;
    }
  } catch {
    try { restore(); } catch { /* Cookie access may be blocked entirely. */ }
    return false;
  }

  // Mirror failure must not suppress a confirmed canonical update.
  const mirror: GeoPosition = {
    lat: Number(lat3),
    lng: Number(lng3),
    radius,
    accuracy: pos.accuracy,
    name: pos.name,
    fullName: pos.fullName,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...mirror, lat: pos.lat, lng: pos.lng }));
  } catch { /* quota or private mode */ }

  // Listo can repeat the confirmed apply without refreshing the feed twice.
  if (changed) {
    window.dispatchEvent(
      new CustomEvent("vicino_location_updated", { detail: mirror })
    );
  }
  return true;
}

/**
 * Limpia la ubicación de cookies y almacenamiento local.
 */
export function clearLocation(): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${COOKIE_LOCATION}=; path=/; max-age=0; SameSite=Lax`;
    document.cookie = `${COOKIE_RADIUS}=; path=/; max-age=0; SameSite=Lax`;
    if (cookieValue(COOKIE_LOCATION) !== null || cookieValue(COOKIE_RADIUS) !== null) return;
  } catch {
    // ignore
    return;
  }
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* mirror only */ }
  window.dispatchEvent(new CustomEvent("vicino_location_updated", { detail: null }));
}
