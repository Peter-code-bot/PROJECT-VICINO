/**
 * Módulo centralizado de persistencia de ubicación geográfica (P1-6).
 * La cookie `vicino_location` es la FUENTE DE VERDAD (leída por el servidor para el feed).
 * `localStorage` actúa como ESPEJO en cliente: nombre de la zona y radio, con
 * el punto a 3 decimales (los mismos que la cookie) y sin la precisión del GPS
 * (PDF 05: guardar lo mínimo en reposo). La precisión completa de la última
 * selección vive solo en memoria (ver `ultimaSeleccion`).
 *
 * OJO: los «Recientes» de la hoja de ubicación (change-location-sheet.tsx,
 * `vicino_recent_locations`) siguen guardando hasta 5 puntos con precisión
 * completa y `accuracy`, incluidos los del GPS. No se tocaron aquí porque son
 * visibles; reducirlos es una decisión pendiente.
 */
import { mismoPunto } from "./cambios-ubicacion";

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

/**
 * Atributos de las cookies de zona. `Secure` solo bajo https: en
 * http://localhost el navegador descartaría la cookie entera. Las cookies que
 * ya existían lo ganan la próxima vez que cambie la zona (writeLocation solo
 * reescribe cuando cambia el valor).
 */
function atributosCookie(maxAge: number): string {
  let seguro = false;
  try {
    seguro = globalThis.location?.protocol === "https:";
  } catch {
    seguro = false;
  }
  return `path=/; max-age=${maxAge}; SameSite=Lax${seguro ? "; Secure" : ""}`;
}

const UN_ANIO_S = 31536000;

/**
 * La última selección escrita EN ESTA PÁGINA, con su precisión completa, y la
 * marca opaca que se guardó con ella en el espejo.
 *
 * El espejo ya no distingue dos puntos de la misma celda de ~110 m, y
 * updateLocationLabel tiene que seguir sabiendo si una etiqueta tardía es de la
 * selección vigente: el punto exacto se compara aquí, en memoria, y la marca
 * del espejo descubre una selección más nueva hecha en otra pestaña.
 */
let ultimaSeleccion: { lat: number; lng: number; sel: string } | null = null;

function nuevaMarca(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch {
    // crypto no disponible: se usa el respaldo
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Un espejo escrito por versiones anteriores guarda el punto con la precisión
 * completa del GPS y su `accuracy`. readLocation ya no los devuelve, pero
 * mientras la cookie siga en la misma celda nadie reescribe el espejo
 * (writeLocation y updateLocationLabel solo corren al cambiar de zona o de
 * etiqueta) y localStorage no caduca: sin depurarlo, el dato completo se
 * quedaría en el dispositivo de quien ya usaba la app (PDF 05).
 */
function esEspejoHeredado(candidato: { lat: number; lng: number }): boolean {
  return "accuracy" in candidato
    || candidato.lat !== Number(candidato.lat.toFixed(3))
    || candidato.lng !== Number(candidato.lng.toFixed(3));
}

/**
 * Reescribe un espejo heredado sin `accuracy` y con el punto a 3 decimales.
 * Conserva lo demás, incluida la marca de selección, para no romper una
 * etiqueta en curso. Se depura una sola vez: lo reescrito ya no es heredado.
 */
function depurarEspejo(espejo: Omit<GeoPosition, "accuracy"> & { sel?: string }): void {
  const depurado = {
    lat: Number(espejo.lat.toFixed(3)),
    lng: Number(espejo.lng.toFixed(3)),
    radius: espejo.radius,
    name: espejo.name,
    fullName: espejo.fullName,
    sel: espejo.sel,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(depurado));
  } catch {
    // quota or private mode: se vuelve a intentar en la próxima lectura
  }
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
    let mirrorHeredado = false;
    let mirrorSel: string | undefined;
    let mirrorRadius: number | undefined;
    try {
      const rawMirror = localStorage.getItem(STORAGE_KEY);
      if (rawMirror) {
        const candidate = JSON.parse(rawMirror) as GeoPosition & { sel?: unknown };
        if (candidate && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng) && Math.abs(candidate.lat) <= 90 && Math.abs(candidate.lng) <= 180) {
          // Solo los campos que se usan: ni la marca de selección ni la
          // `accuracy` de un espejo viejo salen de aquí.
          mirror = { lat: candidate.lat, lng: candidate.lng, name: typeof candidate.name === "string" ? candidate.name : undefined, fullName: typeof candidate.fullName === "string" ? candidate.fullName : undefined };
          mirrorHeredado = esEspejoHeredado(candidate);
          mirrorSel = typeof candidate.sel === "string" ? candidate.sel : undefined;
          mirrorRadius = typeof candidate.radius === "number" && isValidRadius(candidate.radius) ? candidate.radius : undefined;
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
        if (mirrorHeredado) {
          depurarEspejo({ ...mirror, lat: cookieCoords.lat, lng: cookieCoords.lng, radius: radiusVal, sel: mirrorSel });
        }
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

    // A mirror alone never establishes an applied server location. Aun así, un
    // espejo heredado sin cookie (caducada o ilegible) también se depura: nadie
    // lo lee, pero seguiría guardando el punto completo en el dispositivo.
    if (mirror && mirrorHeredado) depurarEspejo({ ...mirror, radius: mirrorRadius, sel: mirrorSel });
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
      document.cookie = `${key}=${value ?? ""}; ${atributosCookie(value === null ? 0 : UN_ANIO_S)}`;
    }
  };

  try {
    // 1. Fuente de verdad: Cookie accesible al servidor (SameSite=Lax, 1 año; Secure en https)
    if (changed) {
      document.cookie = `${COOKIE_LOCATION}=${location}; ${atributosCookie(UN_ANIO_S)}`;
      document.cookie = `${COOKIE_RADIUS}=${radius}; ${atributosCookie(UN_ANIO_S)}`;
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
  // El espejo y el aviso llevan lo mismo que la cookie (3 decimales) y nunca
  // la precisión del GPS; el punto exacto queda solo en memoria.
  const mirror: GeoPosition = {
    lat: Number(lat3),
    lng: Number(lng3),
    radius,
    name: pos.name,
    fullName: pos.fullName,
  };
  const sel = nuevaMarca();
  ultimaSeleccion = { lat: pos.lat, lng: pos.lng, sel };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...mirror, sel }));
  } catch { /* quota or private mode */ }

  // Listo can repeat the confirmed apply without refreshing the feed twice.
  if (changed) {
    window.dispatchEvent(
      new CustomEvent("vicino_location_updated", { detail: mirror })
    );
  }
  return true;
}

/** Enrich only the point already applied; labels never invalidate nearby feeds. */
export function updateLocationLabel(
  expected: { lat: number; lng: number },
  label: { name: string; fullName: string },
): boolean {
  const current = readLocation();
  // Contra la cookie, la identidad es la de su celda (mismoPunto, 3 decimales).
  if (!current || !mismoPunto(current, expected)) return false;
  // A newer selection in the same cookie grid must also keep its own name. El
  // espejo ya no tiene la precisión completa, así que mismoPunto no basta: el
  // punto exacto se compara contra la última selección de esta página y la
  // marca del espejo descarta una selección más nueva hecha en otra pestaña.
  const seleccion = ultimaSeleccion;
  if (!seleccion || seleccion.lat !== expected.lat || seleccion.lng !== expected.lng) return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const mirror = raw ? JSON.parse(raw) as { sel?: unknown } | null : null;
    if (!mirror || mirror.sel !== seleccion.sel) return false;
    const etiquetado: GeoPosition & { sel: string } = {
      lat: current.lat, lng: current.lng, radius: current.radius, name: label.name, fullName: label.fullName, sel: seleccion.sel,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(etiquetado));
  } catch { return false; }
  window.dispatchEvent(new CustomEvent("vicino_location_label_updated", { detail: { ...current, ...label } }));
  return true;
}

/**
 * Limpia la ubicación de cookies y almacenamiento local.
 */
export function clearLocation(): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${COOKIE_LOCATION}=; ${atributosCookie(0)}`;
    document.cookie = `${COOKIE_RADIUS}=; ${atributosCookie(0)}`;
    if (cookieValue(COOKIE_LOCATION) !== null || cookieValue(COOKIE_RADIUS) !== null) return;
  } catch {
    // ignore
    return;
  }
  ultimaSeleccion = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* mirror only */ }
  window.dispatchEvent(new CustomEvent("vicino_location_updated", { detail: null }));
}
