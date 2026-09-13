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

export function parseCoordinates(val: string): { lat: number; lng: number } | null {
  const parts = val.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
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
    const cookies = document.cookie ? document.cookie.split("; ") : [];
    const locationCookie = cookies.find((c) => c.startsWith(`${COOKIE_LOCATION}=`));
    const radiusCookie = cookies.find((c) => c.startsWith(`${COOKIE_RADIUS}=`));

    const rawLocValue = locationCookie ? locationCookie.split("=")[1] : null;
    const cookieCoords = rawLocValue ? parseCoordinates(decodeURIComponent(rawLocValue)) : null;

    let mirror: GeoPosition | null = null;
    try {
      const rawMirror = localStorage.getItem(STORAGE_KEY);
      if (rawMirror) {
        mirror = JSON.parse(rawMirror) as GeoPosition;
      }
    } catch {
      mirror = null;
    }

    if (cookieCoords) {
      const radiusVal = radiusCookie ? parseFloat(radiusCookie.split("=")[1] || "10000") : mirror?.radius ?? 10000;

      // Si el espejo coincide con la cookie (hasta 2 decimales ~1km), usar los nombres cacheados
      if (
        mirror &&
        Math.abs(mirror.lat - cookieCoords.lat) < 0.01 &&
        Math.abs(mirror.lng - cookieCoords.lng) < 0.01
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
        name: mirror?.name,
        fullName: mirror?.fullName,
      };

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
      } catch {
        // storage quota
      }
      return pos;
    }

    // Si no hay cookie pero hay espejo local (ej. primera visita tras limpieza parcial), sincronizar cookie
    if (mirror && Number.isFinite(mirror.lat) && Number.isFinite(mirror.lng)) {
      writeLocation(mirror);
      return mirror;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Escribe la ubicación geográfica sincronizando primero la cookie (fuente de verdad)
 * y luego el espejo en localStorage.
 */
export function writeLocation(pos: GeoPosition): void {
  if (typeof document === "undefined") return;

  if (
    !Number.isFinite(pos.lat) ||
    !Number.isFinite(pos.lng) ||
    Math.abs(pos.lat) > 90 ||
    Math.abs(pos.lng) > 180
  ) {
    return;
  }

  const lat3 = pos.lat.toFixed(3);
  const lng3 = pos.lng.toFixed(3);
  const radius = pos.radius ?? 10000;

  try {
    // 1. Fuente de verdad: Cookie accesible al servidor (SameSite=Lax, 1 año)
    document.cookie = `${COOKIE_LOCATION}=${lat3},${lng3}; path=/; max-age=31536000; SameSite=Lax`;
    document.cookie = `${COOKIE_RADIUS}=${radius}; path=/; max-age=31536000; SameSite=Lax`;

    // 2. Espejo en cliente
    const mirror: GeoPosition = {
      lat: pos.lat,
      lng: pos.lng,
      radius,
      accuracy: pos.accuracy,
      name: pos.name,
      fullName: pos.fullName,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mirror));

    // 3. Notificar a otros listeners en la misma pestaña
    window.dispatchEvent(
      new CustomEvent("vicino_location_updated", { detail: mirror })
    );
  } catch {
    // Quota exceeded o modo privado
  }
}

/**
 * Limpia la ubicación de cookies y almacenamiento local.
 */
export function clearLocation(): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${COOKIE_LOCATION}=; path=/; max-age=0; SameSite=Lax`;
    document.cookie = `${COOKIE_RADIUS}=; path=/; max-age=0; SameSite=Lax`;
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("vicino_location_updated", { detail: null }));
  } catch {
    // ignore
  }
}
