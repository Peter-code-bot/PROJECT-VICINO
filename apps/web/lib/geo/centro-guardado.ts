/**
 * El centro de la zona guardada, leido de la cookie EN EL CLIENTE, como fuente
 * para `useSyncExternalStore`.
 *
 * Existe para que la semilla del inicio deje de llevar las coordenadas de la
 * persona (PDF 05): el servidor solo dice si hay zona y la vista previa del
 * mapa toma el centro de aqui.
 *
 * No usa readLocation() a proposito: getSnapshot se llama en cada render y
 * tiene que ser pura y estable. readLocation devuelve un objeto nuevo en cada
 * llamada (bucle de renders) y puede escribir en localStorage. Aqui se lee solo
 * la cookie, con el mismo parseo que readLocation (primera aparicion,
 * decodeURIComponent y parseCoordinates), y se devuelve el MISMO objeto
 * mientras el valor crudo no cambie.
 */
import { COOKIE_LOCATION, parseCoordinates } from "./location-storage";

export type CentroGuardado = { lat: number; lng: number };

/** Evento que writeLocation y clearLocation emiten DESPUES de confirmar la cookie. */
const EVENTO_ZONA = "vicino_location_updated";

let crudoAnterior: string | null | undefined;
let centroAnterior: CentroGuardado | null = null;

function valorCrudo(cookie: string): string | null {
  for (const parte of cookie.split(";")) {
    const limpia = parte.trim();
    if (limpia.startsWith(`${COOKIE_LOCATION}=`)) return limpia.slice(COOKIE_LOCATION.length + 1);
  }
  return null;
}

function decodificar(crudo: string): CentroGuardado | null {
  try {
    return parseCoordinates(decodeURIComponent(crudo));
  } catch {
    return null;
  }
}

/** Centro de una cadena `document.cookie`; estable mientras el valor crudo no cambie. */
export function centroDesdeCookie(cookie: string): CentroGuardado | null {
  const crudo = valorCrudo(cookie);
  if (crudo === crudoAnterior) return centroAnterior;
  crudoAnterior = crudo;
  centroAnterior = crudo === null || crudo === "" ? null : decodificar(crudo);
  return centroAnterior;
}

/** getSnapshot: el centro guardado ahora, o null si no hay (o no se puede leer). */
export function leerCentroGuardado(): CentroGuardado | null {
  if (typeof document === "undefined") return null;
  try {
    return centroDesdeCookie(document.cookie);
  } catch {
    // Cookies bloqueadas por completo: lo mismo que sin zona.
    return null;
  }
}

/** getServerSnapshot: en el servidor y al hidratar el centro todavia no se conoce. */
export function centroGuardadoSinLeer(): CentroGuardado | null | undefined {
  return undefined;
}

/** subscribe: la cookie de zona solo la cambian writeLocation y clearLocation, que avisan. */
export function suscribirCentroGuardado(aviso: () => void): () => void {
  window.addEventListener(EVENTO_ZONA, aviso);
  return () => window.removeEventListener(EVENTO_ZONA, aviso);
}
