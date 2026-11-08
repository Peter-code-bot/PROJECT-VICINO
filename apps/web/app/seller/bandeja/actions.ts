"use server";

/**
 * Server Actions de la bandeja de WhatsApp del vendedor.
 *
 * responderWhatsApp: preparar (RPC, valida dueno/ventana/largo y deja el
 * mensaje 'pendiente') -> enviar por la API de Meta -> cerrar (RPC, 'enviado'
 * con su wamid o 'fallido' con el error). El token de Meta solo vive en el
 * servidor (lib/whatsapp/config.ts); el cliente nunca lo ve ni habla con Meta.
 *
 * Un envio que NO se pudo confirmar (sin respuesta, tiempo agotado, 2xx sin
 * identificador) se deja 'pendiente' a proposito: Meta pudo haberlo mandado y
 * cerrarlo como 'fallido' invitaria a reenviar un mensaje que ya llego.
 *
 * marcarLeidaWhatsApp: pone a cero los no leidos y, si hay token, manda a Meta
 * la confirmacion de lectura del ultimo mensaje del cliente (mejor esfuerzo).
 */
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { enforce, readHeavyRateLimit, whatsappEnvioRateLimit } from "@/lib/rate-limit";
import { BANDEJA_WHATSAPP_ACTIVA } from "@/lib/whatsapp/bandera";
import { configuracionWhatsApp } from "@/lib/whatsapp/config";
import { enviarTextoWhatsApp, marcarLeidoWhatsApp } from "@/lib/whatsapp/graph";
import {
  CODIGO_RESPUESTA_INESPERADA,
  CODIGO_SIN_CONFIGURAR,
  TEXTO_MAXIMO_WHATSAPP,
  mensajeParaUsuario,
} from "@/lib/whatsapp/presentacion";

const conversacionSchema = z.strictObject({ conversacionId: z.uuid() });

const responderSchema = z.strictObject({
  conversacionId: z.uuid(),
  texto: z
    .string()
    .trim()
    .min(1, "Escribe un mensaje.")
    .max(TEXTO_MAXIMO_WHATSAPP, `El mensaje no puede pasar de ${TEXTO_MAXIMO_WHATSAPP} caracteres.`),
});

const preparadoSchema = z.looseObject({
  mensaje_id: z.uuid(),
  phone_number_id: z.string().regex(/^[0-9]{5,32}$/),
  wa_id: z.string().regex(/^[1-9][0-9]{6,15}$/),
  texto: z.string().min(1).max(TEXTO_MAXIMO_WHATSAPP),
});

export type ResultadoResponder = { ok: true; mensajeId: string } | { ok: false; error: string };

const MENSAJE_GENERICO = "No se pudo enviar el mensaje. Intenta de nuevo en un momento.";

/** Codigos cuyos mensajes escribimos nosotros en SQL, pensados para la persona. */
const CODIGOS_CON_MENSAJE_PROPIO = new Set(["22023", "55000", "P0002"]);

/** Codigos de Meta que son del dia a dia (ventana, destinatario, ritmo): no son incidentes. */
const CODIGOS_ESPERADOS_DE_META = new Set([131047, 131030, 131026, 131056, 131021, 131048, 131049]);

function mensajeDeErrorRpc(error: { code?: string; message?: string }, paso: string): string {
  if (error.code === "42501") return "Necesitas iniciar sesión.";
  if (error.code && CODIGOS_CON_MENSAJE_PROPIO.has(error.code) && error.message) return error.message;
  Sentry.captureException(error, { tags: { action: "responderWhatsApp", paso } });
  return MENSAJE_GENERICO;
}

function revalidarBandeja(conversacionId: string) {
  revalidatePath("/seller/bandeja");
  revalidatePath(`/seller/bandeja/${conversacionId}`);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Cierra el envio y deja rastro si la base no lo acepto. Devuelve lo que dijo el RPC. */
async function cerrar(
  supabase: Supabase,
  args: { p_mensaje_id: string; p_wamid?: string; p_error_codigo?: number; p_error_detalle?: string },
  paso: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("cerrar_envio_whatsapp", args);
  if (error) {
    Sentry.captureException(error, { tags: { action: "responderWhatsApp", paso } });
    return false;
  }
  if (data !== true) {
    // Ya estaba cerrado (o no era suyo): no deberia pasar en este flujo.
    Sentry.captureMessage("cerrar_envio_whatsapp no encontro el mensaje pendiente", {
      level: "warning",
      tags: { action: "responderWhatsApp", paso },
    });
    return false;
  }
  return true;
}

export async function responderWhatsApp(input: unknown): Promise<ResultadoResponder> {
  if (!BANDEJA_WHATSAPP_ACTIVA) return { ok: false, error: "La bandeja de WhatsApp no está disponible." };

  const parsed = responderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Necesitas iniciar sesión." };

  const freno = await enforce(whatsappEnvioRateLimit, `wa-envio:${user.id}`);
  if (!freno.ok) return { ok: false, error: freno.error };

  const { data: preparadoCrudo, error: errorPreparar } = await supabase.rpc("preparar_envio_whatsapp", {
    p_conversacion_id: parsed.data.conversacionId,
    p_texto: parsed.data.texto,
  });
  if (errorPreparar) return { ok: false, error: mensajeDeErrorRpc(errorPreparar, "preparar") };

  const preparado = preparadoSchema.safeParse(preparadoCrudo);
  if (!preparado.success) {
    Sentry.captureMessage("preparar_envio_whatsapp devolvio una forma inesperada", {
      level: "error",
      tags: { action: "responderWhatsApp", paso: "preparar" },
    });
    // Si al menos hay un id de mensaje, no se deja 'pendiente' para siempre.
    const posibleId = z.object({ mensaje_id: z.uuid() }).loose().safeParse(preparadoCrudo);
    if (posibleId.success) {
      await cerrar(
        supabase,
        { p_mensaje_id: posibleId.data.mensaje_id, p_error_codigo: CODIGO_RESPUESTA_INESPERADA, p_error_detalle: "preparar_envio_whatsapp devolvio una forma inesperada" },
        "cerrar-inesperado",
      );
      revalidarBandeja(parsed.data.conversacionId);
    }
    return { ok: false, error: mensajeParaUsuario(CODIGO_RESPUESTA_INESPERADA) };
  }
  const { mensaje_id: mensajeId, phone_number_id: phoneNumberId, wa_id: waId, texto } = preparado.data;

  const config = configuracionWhatsApp();
  if (!config) {
    // Se deja constancia del fallo en el mensaje (queda 'fallido', no 'pendiente').
    await cerrar(
      supabase,
      { p_mensaje_id: mensajeId, p_error_codigo: CODIGO_SIN_CONFIGURAR, p_error_detalle: "Servidor sin WHATSAPP_ACCESS_TOKEN" },
      "cerrar-sin-config",
    );
    Sentry.captureMessage("Bandeja de WhatsApp: falta WHATSAPP_ACCESS_TOKEN en el servidor", {
      level: "error",
      tags: { action: "responderWhatsApp" },
    });
    revalidarBandeja(parsed.data.conversacionId);
    return { ok: false, error: mensajeParaUsuario(CODIGO_SIN_CONFIGURAR) };
  }

  const envio = await enviarTextoWhatsApp(config, { phoneNumberId, waId, texto });

  if (!envio.ok && envio.sinConfirmar) {
    // No se sabe si salio: queda 'pendiente' (la bandeja lo pinta como
    // "Enviando") y NO se invita a reenviar. Si Meta lo mando, sus estados
    // llegaran por webhook... sin fila que casar hasta que alguien lo cierre;
    // por eso se avisa a Sentry para mirarlo.
    Sentry.captureMessage(`WhatsApp: envio sin confirmar (${envio.detalle})`, {
      level: "warning",
      tags: { action: "responderWhatsApp", paso: "enviar" },
      extra: { mensajeId },
    });
    revalidarBandeja(parsed.data.conversacionId);
    return { ok: false, error: envio.mensajeUsuario };
  }

  const cerrado = await cerrar(
    supabase,
    envio.ok
      ? { p_mensaje_id: mensajeId, p_wamid: envio.wamid }
      : { p_mensaje_id: mensajeId, p_error_codigo: envio.codigo ?? undefined, p_error_detalle: envio.detalle },
    "cerrar",
  );

  revalidarBandeja(parsed.data.conversacionId);

  if (!envio.ok) {
    if (envio.codigo === null || !CODIGOS_ESPERADOS_DE_META.has(envio.codigo)) {
      Sentry.captureMessage(`WhatsApp rechazo un envio (${envio.codigo ?? "sin codigo"})`, {
        level: "warning",
        tags: { action: "responderWhatsApp", codigo: String(envio.codigo ?? "sin-codigo") },
        extra: { detalle: envio.detalle },
      });
    }
    return { ok: false, error: envio.mensajeUsuario };
  }

  if (!cerrado) {
    // El mensaje SI salio en Meta; lo que no quedo es el registro. Se dice la
    // verdad: salio, y la bandeja lo mostrara como pendiente hasta que la
    // base se recupere (Sentry ya tiene el error).
    return { ok: true, mensajeId };
  }

  return { ok: true, mensajeId };
}

export async function marcarLeidaWhatsApp(input: unknown): Promise<{ ok: boolean }> {
  if (!BANDEJA_WHATSAPP_ACTIVA) return { ok: false };

  const parsed = conversacionSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const freno = await enforce(readHeavyRateLimit, `wa-leida:${user.id}`);
  if (!freno.ok) return { ok: false };

  const { data: wamid, error } = await supabase.rpc("marcar_leida_conversacion_whatsapp", {
    p_conversacion_id: parsed.data.conversacionId,
  });
  if (error) {
    if (error.code !== "42501") Sentry.captureException(error, { tags: { action: "marcarLeidaWhatsApp" } });
    return { ok: false };
  }

  revalidatePath("/seller/bandeja");

  // Palomitas azules para el cliente: mejor esfuerzo, sin bloquear la pantalla
  // si Meta no responde. Hace falta el numero del negocio, que esta en su canal.
  const config = configuracionWhatsApp();
  if (wamid && config) {
    const { data: canal } = await supabase
      .from("canales_whatsapp")
      .select("phone_number_id")
      .eq("negocio_id", user.id)
      .maybeSingle();
    if (canal?.phone_number_id) {
      const lectura = await marcarLeidoWhatsApp(config, { phoneNumberId: canal.phone_number_id, wamid });
      if (!lectura.ok && lectura.codigo !== null && [0, 190, 3, 10, 200].includes(lectura.codigo)) {
        Sentry.captureMessage(`WhatsApp rechazo la confirmacion de lectura (${lectura.codigo})`, {
          level: "warning",
          tags: { action: "marcarLeidaWhatsApp", codigo: String(lectura.codigo) },
        });
      }
    }
  }

  return { ok: true };
}
