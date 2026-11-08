/**
 * Webhook de WhatsApp Cloud API (Meta) — fase 2 de INT-CRM-20261104.
 *
 *   GET   verificacion del endpoint: Meta manda hub.mode=subscribe,
 *         hub.verify_token y hub.challenge; si el token coincide con
 *         WHATSAPP_VERIFY_TOKEN se responde 200 con el challenge tal cual.
 *   POST  un aviso (mensajes entrantes y estados de los nuestros), firmado con
 *         X-Hub-Signature-256 = sha256=HMAC(cuerpo, App Secret).
 *
 * DOS VERIFICACIONES DE LA MISMA FIRMA, A PROPOSITO:
 *   1. Aqui, con WHATSAPP_APP_SECRET (obligatorio): lo forjado muere en Vercel
 *      sin gastar un HMAC de hasta 3 MB ni una lectura del Vault en Postgres.
 *   2. En el RPC ingerir_webhook_whatsapp, con el App Secret del Vault: es la
 *      que manda, porque el RPC es ejecutable con la llave anon y cualquiera
 *      podria llamarlo sin pasar por aqui. Si pasa la 1 y falla la 2, los dos
 *      secretos divergen (alguien rotó uno): se reporta SIEMPRE a Sentry.
 *
 * Por que el cuerpo crudo: la firma es de esos bytes exactos. Meta escapa lo
 * no ASCII como \uXXXX; reserializar el JSON cambiaria el texto y la firma.
 *
 * Respuestas: 200 si se proceso (o si ya se habia procesado: Meta reintenta
 * hasta 7 dias cuando no ve un 200 y los reintentos deben ser inocuos), 401
 * firma ausente o invalida, 400 cuerpo que no es un webhook, 413 demasiado
 * grande (Meta documenta 3 MB como maximo), 429 freno por IP, 503 falta
 * configurar (verify token o app secret en Vercel, o el secreto en el Vault),
 * 500 fallo de la base (Meta reintentara, que es lo que queremos en una caida).
 */
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { createClientSinSesion } from "@/lib/supabase/sin-sesion";
import { check, getClientIp, webhookWhatsAppRateLimit } from "@/lib/rate-limit";
import { cubetaPorIp } from "@/lib/cubeta-ip";
import { secretoAppWhatsApp, tokenVerificacionWebhook } from "@/lib/whatsapp/config";
import { firmaWebhookValida, igualesEnTiempoConstante } from "@/lib/whatsapp/firma";
import { OBJETO_WHATSAPP, cuerpoWebhookMetaSchema, resumenIngestaSchema } from "@/lib/whatsapp/webhook-schema";
import { LIMITE_CUERPO_WEBHOOK_BYTES as LIMITE_CUERPO_BYTES } from "@/lib/whatsapp/presentacion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RE_CHALLENGE = /^[A-Za-z0-9_-]{1,128}$/;
const SIN_CACHE = { "Cache-Control": "no-store" };
const TAGS = { route: "webhooks/whatsapp" } as const;

function json(cuerpo: Record<string, unknown>, status: number) {
  return NextResponse.json(cuerpo, { status, headers: SIN_CACHE });
}

export async function GET(request: Request) {
  const esperado = tokenVerificacionWebhook();
  if (!esperado) {
    return new Response("Webhook sin configurar", { status: 503, headers: SIN_CACHE });
  }

  const url = new URL(request.url);
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const reto = url.searchParams.get("hub.challenge");

  if (modo !== "subscribe" || !token || !reto || !RE_CHALLENGE.test(reto) || !igualesEnTiempoConstante(token, esperado)) {
    return new Response("Forbidden", { status: 403, headers: SIN_CACHE });
  }

  // Meta exige el challenge tal cual, en el cuerpo, con 200.
  return new Response(reto, {
    status: 200,
    headers: { ...SIN_CACHE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const ip = getClientIp(request.headers);
  const freno = await check(webhookWhatsAppRateLimit, cubetaPorIp("wa-webhook", ip));
  if (!freno.success) return json({ error: "Demasiadas solicitudes" }, 429);

  const firma = request.headers.get("x-hub-signature-256");
  if (!firma) return json({ error: "Falta la firma" }, 401);

  const secreto = secretoAppWhatsApp();
  if (!secreto) {
    Sentry.captureMessage("Webhook de WhatsApp: falta WHATSAPP_APP_SECRET en el servidor", { level: "error", tags: TAGS });
    return json({ error: "Webhook sin configurar" }, 503);
  }

  const declarado = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declarado) && declarado > LIMITE_CUERPO_BYTES) {
    return json({ error: "Cuerpo demasiado grande" }, 413);
  }
  const cuerpo = await request.text();
  if (Buffer.byteLength(cuerpo, "utf8") > LIMITE_CUERPO_BYTES) {
    return json({ error: "Cuerpo demasiado grande" }, 413);
  }

  if (!firmaWebhookValida(cuerpo, firma, secreto)) {
    return json({ error: "Firma invalida" }, 401);
  }

  let parseado: unknown;
  try {
    parseado = JSON.parse(cuerpo);
  } catch {
    return json({ error: "JSON invalido" }, 400);
  }
  const forma = cuerpoWebhookMetaSchema.safeParse(parseado);
  if (!forma.success) return json({ error: "Forma invalida" }, 400);

  // Un aviso de otro producto de Meta (si alguien suscribe mas campos) no es
  // un error: se contesta 200 para que Meta no lo reintente.
  if (forma.data.object !== OBJETO_WHATSAPP) return json({ ok: true, ignorado: true }, 200);

  const supabase = createClientSinSesion();
  const { data, error } = await supabase.rpc("ingerir_webhook_whatsapp", { p_firma: firma, p_cuerpo: cuerpo });

  if (error) {
    switch (error.code) {
      case "P0401":
        // La firma paso aqui con WHATSAPP_APP_SECRET y no en la base con el
        // secreto del Vault: no es un atacante, es que los dos secretos ya no
        // son el mismo. Si no se avisa, Meta reintenta 7 dias y luego descarta.
        Sentry.captureMessage("Webhook de WhatsApp: la firma paso en Vercel pero no en el Vault (secretos distintos)", {
          level: "error",
          tags: TAGS,
        });
        return json({ error: "Firma invalida" }, 401);
      case "22023":
        // La ruta ya valido JSON y forma: si el RPC lo rechaza, Meta mando
        // algo que no esperabamos y hay que verlo.
        Sentry.captureMessage("Webhook de WhatsApp: el RPC rechazo un cuerpo que la ruta ya habia validado", {
          level: "error",
          tags: TAGS,
          extra: { detalle: error.message },
        });
        return json({ error: "Cuerpo invalido" }, 400);
      case "55000":
        Sentry.captureMessage("Webhook de WhatsApp: falta el secreto whatsapp_app_secret en el Vault", { level: "error", tags: TAGS });
        return json({ error: "Webhook sin configurar" }, 503);
      default:
        // Incluye 42501: aqui ya no significa "firma invalida" sino que la
        // funcion perdio privilegios (Vault, pgcrypto). 500 para que Meta
        // reintente y alguien lo vea.
        Sentry.captureException(error, { tags: { ...TAGS, codigo: error.code ?? "sin-codigo" } });
        return json({ error: "Error interno" }, 500);
    }
  }

  const resumen = resumenIngestaSchema.safeParse(data);
  if (!resumen.success) {
    Sentry.captureMessage("Webhook de WhatsApp: el RPC devolvio una forma inesperada", { level: "warning", tags: TAGS });
    return json({ ok: true }, 200);
  }

  return json({ ok: true, ...resumen.data }, 200);
}
