/**
 * Marca de "estoy cambiando de cuenta a proposito".
 *
 * components/layout/session-data-provider.tsx reacciona a un cambio de usuario
 * en onAuthStateChange con una navegacion DURA (window.location.replace). Eso
 * es correcto cuando la sesion cambia por fuera (otra pestaña cerro sesion, la
 * cookie caduco), pero durante un cambio de cuenta la navegacion la pone quien
 * cambia, y tiene que ser blanda por la carrera de la cookie en iOS
 * (components/auth/oauth-url-listener.tsx). Mientras la marca este puesta, el
 * proveedor solo vacia su memoria.
 *
 * Vive en sessionStorage (muere con la pestaña, no puede quedar pegada entre
 * arranques) con un respaldo en memoria para WebViews sin almacenamiento, y
 * caduca sola a los 10 s: si algo se queda a medias, el comportamiento de
 * siempre vuelve solo.
 */

const CLAVE = "vicino_cambio_cuenta";
export const VIGENCIA_CAMBIO_MS = 10_000;

interface Marca {
  userId: string;
  desde: number;
}

let memoria: Marca | null = null;

function leer(): Marca | null {
  try {
    const crudo = window.sessionStorage.getItem(CLAVE);
    if (crudo) {
      const dato: unknown = JSON.parse(crudo);
      if (
        typeof dato === "object" &&
        dato !== null &&
        typeof (dato as Marca).userId === "string" &&
        typeof (dato as Marca).desde === "number"
      ) {
        return dato as Marca;
      }
    }
  } catch {
    // Sin sessionStorage: queda el respaldo en memoria.
  }
  return memoria;
}

export function marcarCambioEnCurso(userId: string, ahora: number = Date.now()): void {
  const marca: Marca = { userId, desde: ahora };
  memoria = marca;
  try {
    window.sessionStorage.setItem(CLAVE, JSON.stringify(marca));
  } catch {
    // Respaldo en memoria ya puesto.
  }
}

export function desmarcarCambioEnCurso(): void {
  memoria = null;
  try {
    window.sessionStorage.removeItem(CLAVE);
  } catch {
    // Nada que borrar.
  }
}

/** El userId que se espera encontrar tras el cambio, o null si no hay cambio vigente. */
export function cambioEnCurso(ahora: number = Date.now()): string | null {
  const marca = leer();
  if (!marca) return null;
  if (ahora - marca.desde > VIGENCIA_CAMBIO_MS || ahora < marca.desde) {
    desmarcarCambioEnCurso();
    return null;
  }
  return marca.userId;
}

export function hayCambioEnCurso(ahora: number = Date.now()): boolean {
  return cambioEnCurso(ahora) !== null;
}
