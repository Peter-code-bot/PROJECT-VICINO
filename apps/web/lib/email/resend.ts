/**
 * Wrapper de Resend para emails transaccionales de moderación.
 *
 * En MVP/Closed Testing solo se usa para alertas al admin. La cuenta de
 * Resend se configura por separado (ver docs/moderation-setup.md). Si
 * RESEND_API_KEY no está configurado, sendAdminEmail registra el evento
 * y NO falla — esto evita que un report nunca se inserte por falta de
 * config de email durante development.
 *
 * sendAdminEmail nunca lanza, pero SÍ reporta: cada fallo va a Sentry antes
 * del return y se devuelve al llamador como { sent: false, reason, detail }
 * para que decida si el fallo es tolerable o hay que escalarlo.
 */

import * as Sentry from "@sentry/nextjs";
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@vicinomarket.com";
const FROM_NORMAL = process.env.RESEND_FROM_NORMAL ?? "VICINO Moderation <moderation@vicinomarket.com>";
const FROM_URGENT = process.env.RESEND_FROM_URGENT ?? "VICINO Alerts <alerts@vicinomarket.com>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

/**
 * Resultado del envío. `sent: false` no es una excepción — el llamador decide
 * si el fallo es tolerable (email normal) o hay que escalarlo (child_safety).
 */
export type SendAdminEmailResult =
  | { sent: true }
  | {
      sent: false;
      reason: "not_configured" | "provider_error" | "exception";
      detail: string;
    };

export interface AdminEmailPayload {
  subject: string;
  html: string;
  urgent?: boolean;
}

export async function sendAdminEmail({
  subject,
  html,
  urgent = false,
}: AdminEmailPayload): Promise<SendAdminEmailResult> {
  if (!resend) {
    console.warn(
      "[moderation/email] RESEND_API_KEY no configurado — email NO enviado",
      JSON.stringify({ subject, urgent, timestamp: new Date().toISOString() })
    );
    Sentry.captureMessage(
      "[moderation/email] RESEND_API_KEY no configurado — email NO enviado",
      {
        level: urgent ? "error" : "warning",
        tags: {
          source: "moderation-email",
          failure: "not_configured",
          urgent: String(urgent),
        },
        contexts: { email: { subject, urgent } },
      }
    );
    return {
      sent: false,
      reason: "not_configured",
      detail: "RESEND_API_KEY no configurado",
    };
  }

  try {
    const { error } = await resend.emails.send({
      from: urgent ? FROM_URGENT : FROM_NORMAL,
      to: ADMIN_EMAIL,
      subject,
      html,
    });

    if (error) {
      console.error(
        "[moderation/email] Resend error",
        JSON.stringify({ error, subject, urgent })
      );
      // Sentry antes del return: `error.name` es el código con el que Resend
      // nombra el rechazo (dominio sin verificar, rate limit, api key inválida)
      // y es lo único que separa un fallo de config de uno transitorio.
      Sentry.captureMessage("[moderation/email] Resend rechazó el envío", {
        level: urgent ? "error" : "warning",
        tags: {
          source: "moderation-email",
          failure: "provider_error",
          resend_error: error.name,
          urgent: String(urgent),
        },
        contexts: {
          email: {
            subject,
            urgent,
            error_name: error.name,
            error_message: error.message,
          },
        },
      });
      return {
        sent: false,
        reason: "provider_error",
        detail: `${error.name}: ${error.message}`,
      };
    }

    return { sent: true };
  } catch (err) {
    // Nunca propagar errores de email al webhook — el reporte ya está en DB
    console.error(
      "[moderation/email] envío falló",
      JSON.stringify({ message: err instanceof Error ? err.message : String(err), subject })
    );
    Sentry.captureException(err, {
      tags: {
        source: "moderation-email",
        failure: "exception",
        urgent: String(urgent),
      },
      contexts: { email: { subject, urgent } },
    });
    return {
      sent: false,
      reason: "exception",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Escape mínimo de HTML para evitar XSS en bodies de email. */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
