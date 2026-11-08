/**
 * Ambito de zona para las entradas del inicio en la cache de sesion.
 *
 * El feed del inicio depende de dos cookies (`vicino_location` y
 * `vicino_radius`). Cambiar de zona tiene que cambiar la clave en memoria,
 * para que la zona anterior nunca preste su feed a la nueva. La misma funcion
 * la usan el cliente (con `document.cookie`) y el servidor (con `cookies()`),
 * para que la semilla del render coincida con la clave que el consumidor
 * calcula tras hidratar.
 *
 * La clave ya no lleva la cookie literal: viajaba en la semilla del HTML con
 * las coordenadas de la persona (PDF 05, sin coordenadas en las respuestas del
 * feed). Ahora es una huella de la zona NORMALIZADA con el mismo interprete que
 * usa el servidor para armar el feed (lib/geo/zona-guardada.ts): dos cookies
 * que el servidor lee igual dan la misma clave aunque se escriban distinto
 * (4 decimales, codificadas con encodeURIComponent), y antes no coincidian.
 *
 * OJO, NO ES ANONIMIZACION. Dentro del area del mapa hay del orden de 6·10^8
 * puntos de 3 decimales: recorrerlos y comparar huellas es cuestion de
 * segundos. Solo evita que la coordenada viaje en claro. Si algun dia hace
 * falta privacidad de verdad, la clave tendria que ser un token aleatorio de
 * zona guardado junto a la cookie.
 *
 * Valores especiales que NO se tocan: "" (no hay cookies de zona) y
 * "unhydrated" (el getServerSnapshot de useLocationScope, que session-cache y
 * useSessionData reconocen por su sufijo).
 */
import { interpretarZonaGuardada } from "./geo/zona-guardada";

const COOKIE_UBICACION = "vicino_location";
const COOKIE_RADIO = "vicino_radius";

/**
 * FNV-1a de 32 bits. Dos pasadas con bases distintas dan 64 bits: con 32, dos
 * zonas de la misma persona podrian chocar y compartir feed.
 */
function fnv1a(texto: string, base: number): string {
  let huella = base >>> 0;
  for (let i = 0; i < texto.length; i++) {
    huella ^= texto.charCodeAt(i);
    huella = Math.imul(huella, 0x01000193) >>> 0;
  }
  return huella.toString(16).padStart(8, "0");
}

function huellaDeZona(texto: string): string {
  return fnv1a(texto, 0x811c9dc5) + fnv1a(texto, 0x050c5d1f);
}

/**
 * Recibe los pares YA decodificados (como los da `cookies().getAll()` de Next).
 * Con nombres repetidos gana el ultimo, que es lo que hace el parser de Next.
 */
export function locationScopeFromPairs(pairs: ReadonlyArray<{ name: string; value: string }>): string {
  let ubicacion: string | undefined;
  let radio: string | undefined;
  let hayCookieDeZona = false;
  for (const pair of pairs) {
    if (pair.name === COOKIE_UBICACION) { ubicacion = pair.value; hayCookieDeZona = true; }
    else if (pair.name === COOKIE_RADIO) { radio = pair.value; hayCookieDeZona = true; }
  }
  if (!hayCookieDeZona) return "";
  const zona = interpretarZonaGuardada(ubicacion, radio);
  // Ausente e invalida pintan lo mismo (sin zona) y se distinguen igual: el
  // estado entra en la huella para no depender de esa coincidencia.
  const punto = zona.punto ? `${zona.punto.lat.toFixed(3)},${zona.punto.lng.toFixed(3)}` : "";
  return `zona:${huellaDeZona(`${zona.estado}|${punto}|${zona.radio}`)}`;
}

/**
 * Lo mismo desde `document.cookie`, con las reglas del parser de Next para que
 * las dos capas vean los mismos valores: un par sin "=" vale "true" y un valor
 * que no se puede decodificar se descarta. Solo se decodifican las dos cookies
 * de zona: esto corre en cada render (getSnapshot de useLocationScope) y las de
 * sesion son largas.
 */
export function locationScopeFromDocumentCookie(cookie: string): string {
  const pairs: Array<{ name: string; value: string }> = [];
  for (const part of cookie.split(";")) {
    const limpia = part.trim();
    const separator = limpia.indexOf("=");
    const name = separator < 0 ? limpia : limpia.slice(0, separator);
    if (name !== COOKIE_UBICACION && name !== COOKIE_RADIO) continue;
    if (separator < 0) {
      pairs.push({ name, value: "true" });
      continue;
    }
    try {
      pairs.push({ name, value: decodeURIComponent(limpia.slice(separator + 1)) });
    } catch {
      // Valor mal codificado: Next lo descarta, aqui tambien.
    }
  }
  return locationScopeFromPairs(pairs);
}

/** Los cuatro feeds del inicio. Cualquier otra cosa es «Para ti». */
const FEEDS = ["parati", "following", "solicitudes", "comunidades"] as const;

/**
 * Clave del inicio en la memoria de sesion.
 *
 * El `feed` se NORMALIZA aqui, y por eso la misma funcion sirve al servidor
 * (que ya validó el parametro) y al cliente (que lee el crudo de la URL): con
 * `?feed=xyz` los dos producen la clave de «Para ti», que es lo que las dos
 * capas pintan. Sin normalizar, la semilla del servidor quedaba bajo una clave
 * que nadie leia y el cliente pedia a la API un feed que ella rechaza con 400.
 */
export function homeSessionKey(feed: string | null | undefined, scope: string): string {
  const params = new URLSearchParams();
  const normalizado = FEEDS.find(nombre => nombre === feed);
  if (normalizado && normalizado !== "parati") params.set("feed", normalizado);
  return `/api/session/home?${params}#${scope}`;
}
