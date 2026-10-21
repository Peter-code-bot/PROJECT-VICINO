/**
 * Texto para la persona a partir del error de una RPC de lealtad.
 *
 * Las RPC hablan con ERRCODE + HINT (PT409/sellos_insuficientes, etc.). El
 * `message` de Postgres esta escrito para quien lee logs, asi que nunca se
 * reenvia tal cual. Sentry recibe el error completo ANTES de llegar aqui.
 */
export interface ErrorRpc {
  code?: string | null;
  hint?: string | null;
  message?: string | null;
}

const POR_PISTA: Record<string, string> = {
  sellos_insuficientes: "Aún no hay sellos suficientes para este premio.",
  codigo_expirado: "Ese código ya venció. Pide al cliente que genere uno nuevo.",
  codigo_no_encontrado: "No hay un canje pendiente con ese código.",
  canje_cerrado: "Ese canje ya no está pendiente.",
  propio_programa: "No puedes unirte a tu propio programa.",
  programa_inactivo: "El programa está en pausa. Vuelve a intentarlo cuando el negocio lo reactive.",
  transicion_invalida: "Ese cambio de estado no es posible.",
  revocada: "Esta tarjeta fue revocada por el negocio.",
  ya_revertido: "Ese movimiento ya fue revertido.",
  no_reversible: "Ese movimiento no se puede revertir.",
  ya_canjeado: "Esos sellos ya se canjearon por un premio. Resuélvelo con el cliente antes de revertir.",
  saldo_insuficiente: "La tarjeta no tiene sellos suficientes para ese movimiento.",
  reintentar: "No se pudo generar el código. Inténtalo de nuevo.",
};

const POR_CODIGO: Record<string, string> = {
  "42501": "Necesitas iniciar sesión o no tienes permiso para esto.",
  "22023": "Revisa los datos e inténtalo de nuevo.",
  PT404: "No encontramos lo que buscas. Actualiza la página.",
  PT409: "La operación chocó con el estado actual. Actualiza la página e inténtalo de nuevo.",
  "23505": "Ya existe un registro igual.",
};

export const MENSAJE_GENERICO = "No se pudo completar. Revisa tu conexión e inténtalo de nuevo.";

export function mensajeDeErrorLealtad(error: ErrorRpc | null | undefined): string {
  if (!error) return MENSAJE_GENERICO;
  const porPista = error.hint ? POR_PISTA[error.hint] : undefined;
  if (porPista) return porPista;
  const porCodigo = error.code ? POR_CODIGO[error.code] : undefined;
  if (porCodigo) return porCodigo;
  return MENSAJE_GENERICO;
}
