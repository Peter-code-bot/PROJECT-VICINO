/**
 * Cliente minimo de la Cloud API de WhatsApp (Graph API de Meta) para lo que
 * usa la bandeja: mandar un texto y confirmar lectura.
 *
 * Fuentes (consultadas el 8-nov-2026):
 *   - Referencia Messages: POST /{version}/{phone_number_id}/messages con
 *     Authorization: Bearer <token>; respuesta {messages: [{id}]}.
 *   - Text messages: text.body hasta 4096 caracteres; preview_url opcional.
 *   - Mark as read: mismo endpoint con {status: "read", message_id}.
 *   - Formato de `to`: Meta recomienda SIEMPRE el "+" y la lada; sin "+"
 *     puede anteponer la lada del numero del negocio y entregar a otro
 *     numero. Los webhooks traen wa_id SIN "+", asi que aqui se antepone.
 *   - Errores: {error: {message, type, code, error_subcode, error_data:
 *     {details}, fbtrace_id}}; Meta pide decidir por `code` y `details`.
 *
 * Solo servidor: recibe el token como parametro y nunca lo registra. Las
 * frases para la persona viven en presentacion.ts, que si puede ir al cliente.
 */
import "server-only";

import { MENSAJE_SIN_CONFIRMAR, TEXTO_MAXIMO_WHATSAPP, mensajeParaUsuario } from "./presentacion";

export { TEXTO_MAXIMO_WHATSAPP, mensajeParaUsuario };

export interface ClienteGraph {
  token: string;
  version: string;
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type ResultadoEnvioWhatsApp =
  | { ok: true; wamid: string }
  | {
      ok: false;
      codigo: number | null;
      detalle: string;
      mensajeUsuario: string;
      /**
       * true cuando NO se sabe si el mensaje salio (sin respuesta, tiempo
       * agotado, o Meta respondio 2xx sin un identificador usable). En ese
       * caso el mensaje debe quedar 'pendiente', nunca 'fallido': reenviarlo
       * podria duplicarlo en el telefono del cliente.
       */
      sinConfirmar: boolean;
    };

export interface EnvioTexto {
  phoneNumberId: string;
  /** Numero del cliente como lo da Meta (digitos con lada, sin "+"). */
  waId: string;
  texto: string;
  /** wamid del mensaje al que se responde, si se quiere citar. */
  respondeA?: string | null;
}

const RE_PHONE_NUMBER_ID = /^[0-9]{5,32}$/;
const RE_WA_ID = /^[1-9][0-9]{6,15}$/;
const RE_WAMID = /^[A-Za-z0-9._+/=-]{10,200}$/;
const TIMEOUT_POR_DEFECTO_MS = 15_000;

interface ErrorGraph {
  message?: unknown;
  code?: unknown;
  error_data?: { details?: unknown } | null;
  fbtrace_id?: unknown;
}

function leerError(json: unknown): { codigo: number | null; detalle: string } {
  const error = (json as { error?: ErrorGraph } | null)?.error;
  const codigo = typeof error?.code === "number" && Number.isInteger(error.code) ? error.code : null;
  const partes = [
    typeof error?.message === "string" ? error.message : null,
    typeof error?.error_data?.details === "string" ? error.error_data.details : null,
    typeof error?.fbtrace_id === "string" ? `fbtrace ${error.fbtrace_id}` : null,
  ].filter((p): p is string => Boolean(p));
  return { codigo, detalle: (partes.join(" | ") || "respuesta sin detalle").slice(0, 500) };
}

type RespuestaGraph = { status: number; json: unknown; red?: undefined } | { status: 0; json: null; red: string };

async function llamar(cliente: ClienteGraph, phoneNumberId: string, cuerpo: Record<string, unknown>): Promise<RespuestaGraph> {
  const hacerFetch = cliente.fetch ?? fetch;
  const url = `${cliente.baseUrl}/${cliente.version}/${phoneNumberId}/messages`;
  try {
    const respuesta = await hacerFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cliente.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(cliente.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS),
      cache: "no-store",
    });
    let json: unknown = null;
    try {
      json = await respuesta.json();
    } catch {
      json = null;
    }
    return { status: respuesta.status, json };
  } catch (error) {
    const nombre = error instanceof Error ? error.name : "Error";
    return { status: 0, json: null, red: nombre === "TimeoutError" ? "tiempo de espera agotado" : "sin respuesta de la red" };
  }
}

function fallo(codigo: number | null, detalle: string, mensajeUsuario: string, sinConfirmar = false): ResultadoEnvioWhatsApp {
  return { ok: false, codigo, detalle, mensajeUsuario, sinConfirmar };
}

export async function enviarTextoWhatsApp(cliente: ClienteGraph, envio: EnvioTexto): Promise<ResultadoEnvioWhatsApp> {
  const texto = envio.texto.trim();
  if (!RE_PHONE_NUMBER_ID.test(envio.phoneNumberId)) {
    return fallo(null, "phone_number_id invalido", "El número del negocio no está bien configurado.");
  }
  if (!RE_WA_ID.test(envio.waId)) {
    return fallo(null, "wa_id invalido", "El número del cliente no es válido.");
  }
  if (texto.length === 0 || texto.length > TEXTO_MAXIMO_WHATSAPP) {
    return fallo(null, "texto fuera de rango", `El mensaje debe tener entre 1 y ${TEXTO_MAXIMO_WHATSAPP} caracteres.`);
  }

  const cuerpo: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: `+${envio.waId}`,
    type: "text",
    text: { preview_url: false, body: texto },
  };
  if (envio.respondeA && RE_WAMID.test(envio.respondeA)) {
    cuerpo.context = { message_id: envio.respondeA };
  }

  const r = await llamar(cliente, envio.phoneNumberId, cuerpo);

  // Sin respuesta o tiempo agotado: la peticion pudo haber llegado a Meta.
  if (r.red !== undefined) {
    return fallo(null, r.red, MENSAJE_SIN_CONFIRMAR, true);
  }

  if (r.status >= 200 && r.status < 300) {
    const wamid = (r.json as { messages?: Array<{ id?: unknown }> } | null)?.messages?.[0]?.id;
    if (typeof wamid === "string" && RE_WAMID.test(wamid)) {
      return { ok: true, wamid };
    }
    // Meta acepto el mensaje pero no devolvio un identificador que podamos
    // guardar: salio, pero no se puede confirmar ni seguir sus estados.
    return fallo(
      null,
      `HTTP ${r.status}: respuesta sin identificador de mensaje usable`,
      "WhatsApp aceptó el mensaje pero no devolvió su identificador; no se puede confirmar. No lo reenvíes todavía.",
      true,
    );
  }

  const { codigo, detalle } = leerError(r.json);
  if (codigo === null && r.status >= 500) {
    return fallo(null, `HTTP ${r.status}: ${detalle}`, `WhatsApp no está disponible en este momento (HTTP ${r.status}). Intenta en unos minutos.`);
  }
  return fallo(codigo, `HTTP ${r.status}: ${detalle}`, codigo === null ? `Meta rechazó la solicitud (HTTP ${r.status}).` : mensajeParaUsuario(codigo));
}

/** Confirmacion de lectura del ultimo mensaje del cliente. Mejor esfuerzo. */
export async function marcarLeidoWhatsApp(
  cliente: ClienteGraph,
  datos: { phoneNumberId: string; wamid: string },
): Promise<{ ok: boolean; codigo: number | null; detalle: string | null }> {
  if (!RE_PHONE_NUMBER_ID.test(datos.phoneNumberId) || !RE_WAMID.test(datos.wamid)) {
    return { ok: false, codigo: null, detalle: "datos invalidos" };
  }
  const r = await llamar(cliente, datos.phoneNumberId, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: datos.wamid,
  });
  if (r.red !== undefined) return { ok: false, codigo: null, detalle: r.red };
  if (r.status >= 200 && r.status < 300) return { ok: true, codigo: null, detalle: null };
  const { codigo, detalle } = leerError(r.json);
  return { ok: false, codigo, detalle: `HTTP ${r.status}: ${detalle}` };
}
