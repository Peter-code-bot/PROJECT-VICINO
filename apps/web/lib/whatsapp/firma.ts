import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma de los webhooks de Meta: cabecera `X-Hub-Signature-256` con el valor
 * `sha256=<HMAC-SHA256 hex del cuerpo crudo, con el App Secret como llave>`.
 * Fuente: developers.facebook.com/documentation/business-messaging/whatsapp/
 * webhooks/create-webhook-endpoint (consultada el 8-nov-2026).
 *
 * Se firma el cuerpo TAL CUAL llego (Meta escapa lo no ASCII como \uXXXX y
 * firma ese texto); reserializar el JSON rompe la firma.
 */
// Mismo criterio que el RPC ingerir_webhook_whatsapp (lower + btrim): prefijo
// y hex en cualquier caja. Si se cambia aqui, se cambia alla.
const RE_CABECERA = /^\s*sha256=([0-9a-fA-F]{64})\s*$/i;

export function firmarCuerpoWebhook(cuerpo: string, secreto: string): string {
  return "sha256=" + createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex");
}

export function firmaWebhookValida(
  cuerpo: string,
  cabecera: string | null | undefined,
  secreto: string | null | undefined,
): boolean {
  if (!cabecera || !secreto) return false;
  const m = RE_CABECERA.exec(cabecera);
  const hex = m?.[1];
  if (!hex) return false;
  const esperada = createHmac("sha256", secreto).update(cuerpo, "utf8").digest();
  const recibida = Buffer.from(hex, "hex");
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

/** Comparacion en tiempo constante para el hub.verify_token del GET. */
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    // Se compara igual algo del mismo largo para no delatar el largo por tiempo.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}
