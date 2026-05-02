/**
 * Wrapper de Resend para emails transaccionales de moderación.
 *
 * En MVP/Closed Testing solo se usa para alertas al admin. La cuenta de
 * Resend se configura por separado (ver docs/moderation-setup.md). Si
 * RESEND_API_KEY no está configurado, sendAdminEmail registra el evento
 * y NO falla — esto evita que un report nunca se inserte por falta de
 * config de email durante development.
 */

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@vicinomarket.com";
const FROM_NORMAL = process.env.RESEND_FROM_NORMAL ?? "VICINO Moderation <moderation@vicinomarket.com>";
const FROM_URGENT = process.env.RESEND_FROM_URGENT ?? "VICINO Alerts <alerts@vicinomarket.com>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export interface AdminEmailPayload {
  subject: string;
  html: string;
  urgent?: boolean;
}

export async function sendAdminEmail({
  subject,
  html,
  urgent = false,
}: AdminEmailPayload): Promise<void> {
  if (!resend) {
    console.warn(
      "[moderation/email] RESEND_API_KEY no configurado — email NO enviado",
      JSON.stringify({ subject, urgent, timestamp: new Date().toISOString() })
    );
    return;
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
    }
  } catch (err) {
    // Nunca propagar errores de email al webhook — el reporte ya está en DB
    console.error(
      "[moderation/email] envío falló",
      JSON.stringify({ message: err instanceof Error ? err.message : String(err), subject })
    );
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
