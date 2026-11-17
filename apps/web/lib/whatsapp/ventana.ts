/**
 * Ventana de atencion de WhatsApp ("customer service window"): desde el
 * ultimo mensaje del cliente hay 24 horas para responderle con texto libre;
 * cada mensaje suyo la reinicia. Fuera de ella solo se pueden mandar
 * plantillas aprobadas, y el piloto no tiene plantillas.
 *
 * Fuente: developers.facebook.com/documentation/business-messaging/whatsapp
 * (About the platform y Pricing, consultadas el 8-nov-2026). El RPC
 * preparar_envio_whatsapp aplica la misma regla en la base; esto es para que
 * la pantalla lo diga ANTES de que la persona escriba.
 *
 * Todo es relativo ("quedan 2 h") a proposito: el servidor pinta en UTC y la
 * persona esta en Mexico; una hora absoluta saldria mal en el primer render.
 */
export const VENTANA_WHATSAPP_MS = 24 * 60 * 60 * 1000;

export interface EstadoVentana {
  abierta: boolean;
  /** Milisegundos que faltan para que cierre; 0 si ya cerro o nunca abrio. */
  restanteMs: number;
}

export function ventanaWhatsApp(
  ultimoEntranteAt: string | Date | null | undefined,
  ahora: number | Date = Date.now(),
): EstadoVentana {
  if (!ultimoEntranteAt) return { abierta: false, restanteMs: 0 };
  const inicio = new Date(ultimoEntranteAt).getTime();
  const ahoraMs = typeof ahora === "number" ? ahora : ahora.getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(ahoraMs)) return { abierta: false, restanteMs: 0 };
  const restanteMs = inicio + VENTANA_WHATSAPP_MS - ahoraMs;
  if (restanteMs <= 0) return { abierta: false, restanteMs: 0 };
  return { abierta: true, restanteMs };
}

/** "23 h 59 min", "45 min", "menos de un minuto". */
export function duracionCorta(ms: number): string {
  const minutos = Math.floor(ms / 60_000);
  if (minutos < 1) return "menos de un minuto";
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  if (resto === 0) return `${horas} h`;
  return `${horas} h ${resto} min`;
}

export function etiquetaVentana(estado: EstadoVentana): string {
  if (!estado.abierta) {
    return "La ventana de 24 horas cerró. WhatsApp solo permite responder con texto libre dentro de las 24 horas siguientes al último mensaje del cliente; cuando te vuelva a escribir podrás contestar.";
  }
  return `Puedes responder durante ${duracionCorta(estado.restanteMs)} más (ventana de 24 horas de WhatsApp).`;
}
