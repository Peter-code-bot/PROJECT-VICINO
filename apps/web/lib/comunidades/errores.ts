/**
 * Traduce los errores de la base (RPC de comunidades) a un mensaje legible.
 *
 * Las RPC de comunidades lanzan con cuatro ERRCODE fijos y con un texto ya
 * pensado para la persona ("Llegaste al limite de 10 solicitudes en 24
 * horas."). Ese texto se respeta cuando es de los nuestros; lo que se
 * reemplaza es lo que sale del MOTOR (un unique_violation crudo, un
 * "permission denied for column ...", un "function ... does not exist"),
 * que nombra tablas y columnas y no le dice nada a nadie.
 *
 * Es el UNICO sitio que sabe de codigos: los componentes reciben un string.
 */

export interface ErrorDeBase {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/** Codigos que las RPC usan a proposito (cabecera de cada migracion). */
export const CODIGO_CUOTA = "23514";
export const CODIGO_PERMISO = "42501";
export const CODIGO_NO_EXISTE = "P0002";
export const CODIGO_ARGUMENTO = "22023";
export const CODIGO_DUPLICADO = "23505";

const GENERICO_POR_CODIGO: Record<string, string> = {
  [CODIGO_CUOTA]: "Llegaste a un límite por ahora. Intenta más tarde.",
  [CODIGO_PERMISO]: "No tienes permiso para hacer eso.",
  [CODIGO_NO_EXISTE]: "Eso ya no está disponible.",
  [CODIGO_ARGUMENTO]: "Revisa lo que escribiste e intenta de nuevo.",
  [CODIGO_DUPLICADO]: "Ya existe una comunidad con ese nombre por aquí.",
  // PostgREST: la funcion no existe o hay sobrecarga (300). Pasa cuando la
  // migracion no esta aplicada donde apunta el cliente.
  PGRST202: "Esta función todavía no está disponible. Intenta más tarde.",
  PGRST203: "Esta función todavía no está disponible. Intenta más tarde.",
  // Timeout de sentencia.
  "57014": "La operación tardó demasiado. Intenta de nuevo.",
};

export const MENSAJE_GENERICO = "Algo salió mal. Intenta de nuevo.";

/**
 * Un mensaje "del motor" se reconoce por su vocabulario: nombra objetos del
 * esquema o es ingles de Postgres/PostgREST. Los nuestros son frases en
 * espanol sin acentos que terminan en punto.
 */
const HUELLAS_DEL_MOTOR = [
  /violates/i,
  /constraint/i,
  /permission denied/i,
  /does not exist/i,
  /duplicate key/i,
  /invalid input syntax/i,
  /null value in column/i,
  /could not find/i,
  /schema cache/i,
  /syntax error/i,
  /operator does not exist/i,
  /function .* is not unique/i,
];

function pareceDelMotor(mensaje: string): boolean {
  return HUELLAS_DEL_MOTOR.some((re) => re.test(mensaje));
}

/**
 * Devuelve SIEMPRE un string listo para un toast o un banner.
 *
 * - Codigo conocido + texto nuestro -> el texto nuestro (trae los numeros
 *   reales de la cuota).
 * - Codigo conocido + texto del motor -> el generico del codigo.
 * - Cualquier otra cosa -> MENSAJE_GENERICO. Nunca se enseña el mensaje del
 *   motor: nombra columnas y policies.
 */
export function traducirErrorComunidad(error: unknown): string {
  const e = normalizar(error);
  if (!e) return MENSAJE_GENERICO;

  const code = e.code ?? "";
  const message = (e.message ?? "").trim();

  if (code in GENERICO_POR_CODIGO) {
    if (message && !pareceDelMotor(message)) return message;
    return GENERICO_POR_CODIGO[code]!;
  }

  // Rate limit de la app (lib/rate-limit.ts) y errores que ya vienen
  // traducidos por una accion: llegan sin codigo y en espanol.
  if (!code && message && !pareceDelMotor(message)) return message;

  return MENSAJE_GENERICO;
}

/** true si el error es una cuota (23514): la UI puede pintar el tiempo que falta. */
export function esErrorDeCuota(error: unknown): boolean {
  return normalizar(error)?.code === CODIGO_CUOTA;
}

/** true si es un 42501: la UI puede ofrecer unirse o iniciar sesion. */
export function esErrorDePermiso(error: unknown): boolean {
  return normalizar(error)?.code === CODIGO_PERMISO;
}

/** true si es un P0002: la comunidad o la publicacion ya no esta. */
export function esErrorNoDisponible(error: unknown): boolean {
  return normalizar(error)?.code === CODIGO_NO_EXISTE;
}

function normalizar(error: unknown): ErrorDeBase | null {
  if (!error) return null;
  if (typeof error === "string") return { message: error };
  if (error instanceof Error) {
    const conCodigo = error as Error & { code?: unknown };
    return {
      code: typeof conCodigo.code === "string" ? conCodigo.code : null,
      message: error.message,
    };
  }
  if (typeof error === "object") {
    const o = error as Record<string, unknown>;
    return {
      code: typeof o.code === "string" ? o.code : null,
      message: typeof o.message === "string" ? o.message : null,
      details: typeof o.details === "string" ? o.details : null,
    };
  }
  return null;
}

/**
 * Tiempo que falta hasta `hasta` en palabras cortas ("en 3 h", "en 25 min").
 * Para el boton de fundar deshabilitado (decision 10) y para las cuotas con
 * `siguiente_en`. Devuelve null si la fecha ya paso o no se puede leer.
 */
export function tiempoQueFalta(hasta: string | null | undefined, ahora: number = Date.now()): string | null {
  if (!hasta) return null;
  const objetivo = Date.parse(hasta);
  if (Number.isNaN(objetivo)) return null;
  const ms = objetivo - ahora;
  if (ms <= 0) return null;
  const minutos = Math.ceil(ms / 60_000);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas < 24) return resto > 0 ? `${horas} h ${resto} min` : `${horas} h`;
  const dias = Math.floor(horas / 24);
  return `${dias} d ${horas % 24} h`;
}
