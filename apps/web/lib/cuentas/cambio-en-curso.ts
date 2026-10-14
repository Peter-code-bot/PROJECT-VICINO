/**
 * Marca de "estoy cambiando de cuenta a proposito".
 *
 * components/layout/session-data-provider.tsx reacciona a un cambio de usuario
 * en onAuthStateChange con una navegacion DURA (window.location.replace). Eso
 * es correcto cuando la sesion cambia por fuera (otra pestaña cerro sesion, la
 * cookie caduco), pero durante un cambio de cuenta la navegacion la pone quien
 * cambia, y tiene que ser blanda por la carrera de la cookie en iOS
 * (components/auth/oauth-url-listener.tsx). Mientras la marca este puesta, el
 * proveedor no navega.
 *
 * Vive en sessionStorage (muere con la pestaña, no puede quedar pegada entre
 * arranques) con un respaldo en memoria para WebViews sin almacenamiento, y
 * caduca sola: si algo se queda a medias, el comportamiento de siempre vuelve
 * solo. La vigencia cubre con holgura el tope de cada llamada de auth: una
 * marca mas corta que una peticion colgada dejaba que el SIGNED_OUT tardio de
 * un /logout lento navegara a mitad del cambio.
 *
 * Ademas se espeja en localStorage para que las OTRAS pestañas del mismo
 * origen (escritorio) sepan que un cambio esta en curso: auth-js les reenvia
 * el SIGNED_OUT por BroadcastChannel y, sin esta pista, navegaban a /login un
 * instante antes de que la cookie fuera de la cuenta siguiente. Esa pista solo
 * sirve para ESPERAR un poco mas (ver el temporizador diferido del proveedor);
 * la marca que suprime la navegacion sigue siendo la de esta pestaña.
 */

const CLAVE = "vicino_cambio_cuenta";
const CLAVE_GLOBAL = "vicino_cambio_cuenta_global";
export const VIGENCIA_CAMBIO_MS = 60_000;

interface Marca {
  userId: string;
  desde: number;
}

let memoria: Marca | null = null;

function interpretar(crudo: string | null): Marca | null {
  if (!crudo) return null;
  try {
    const dato: unknown = JSON.parse(crudo);
    if (
      typeof dato === "object" &&
      dato !== null &&
      typeof (dato as Marca).userId === "string" &&
      typeof (dato as Marca).desde === "number"
    ) {
      return dato as Marca;
    }
  } catch {
    // JSON corrupto: como si no hubiera marca.
  }
  return null;
}

function vigente(marca: Marca | null, ahora: number): marca is Marca {
  return marca !== null && ahora - marca.desde <= VIGENCIA_CAMBIO_MS && ahora >= marca.desde;
}

function leer(): Marca | null {
  try {
    const marca = interpretar(window.sessionStorage.getItem(CLAVE));
    if (marca) return marca;
  } catch {
    // Sin sessionStorage: queda el respaldo en memoria.
  }
  return memoria;
}

export function marcarCambioEnCurso(userId: string, ahora: number = Date.now()): void {
  const marca: Marca = { userId, desde: ahora };
  memoria = marca;
  const serializada = JSON.stringify(marca);
  try {
    window.sessionStorage.setItem(CLAVE, serializada);
  } catch {
    // Respaldo en memoria ya puesto.
  }
  try {
    window.localStorage.setItem(CLAVE_GLOBAL, serializada);
  } catch {
    // Sin pista para otras pestañas: solo pierden el compas extra.
  }
}

export function desmarcarCambioEnCurso(): void {
  memoria = null;
  try {
    window.sessionStorage.removeItem(CLAVE);
  } catch {
    // Nada que borrar.
  }
  try {
    window.localStorage.removeItem(CLAVE_GLOBAL);
  } catch {
    // Nada que borrar.
  }
}

/** El userId que se espera encontrar tras el cambio, o null si no hay cambio vigente EN ESTA PESTAÑA. */
export function cambioEnCurso(ahora: number = Date.now()): string | null {
  const marca = leer();
  if (!marca) return null;
  if (!vigente(marca, ahora)) {
    desmarcarCambioEnCurso();
    return null;
  }
  return marca.userId;
}

export function hayCambioEnCurso(ahora: number = Date.now()): boolean {
  return cambioEnCurso(ahora) !== null;
}

/** Si ALGUNA pestaña de este origen tiene un cambio en curso vigente. Solo lectura. */
export function hayCambioEnCursoEnAlgunaPestana(ahora: number = Date.now()): boolean {
  try {
    return vigente(interpretar(window.localStorage.getItem(CLAVE_GLOBAL)), ahora);
  } catch {
    return false;
  }
}
