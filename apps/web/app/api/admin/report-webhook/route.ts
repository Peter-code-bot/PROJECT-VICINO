/**
 * Webhook handler de Supabase Database Webhook para tabla `reports`.
 *
 * Recibe POST con payload { type, table, record, old_record } cuando
 * Supabase detecta INSERT/UPDATE/DELETE en public.reports. Aquí solo
 * actuamos sobre INSERT.
 *
 * Behavior:
 *   - Verifica header x-webhook-secret contra SUPABASE_WEBHOOK_SECRET.
 *   - Si reason === 'child_safety' → email URGENTE inmediato (no digest).
 *   - Si recientemente (5 min) ya se enviaron >5 emails → coalesce:
 *     1 email "burst" y los siguientes en la ventana se omiten.
 *   - Resto → email normal inmediato.
 *
 * Limitaciones:
 *   - El estado del burst es in-memory por isolate. Distintos isolates
 *     tienen contadores independientes. Aceptable a escala MVP.
 *   - Header secret simple (no HMAC). TODO post-MVP migrar a HMAC con
 *     timing-safe compare. Ver docs/moderation-setup.md.
 *
 * Configuración del webhook en Supabase Dashboard:
 *   Database > Webhooks > Create:
 *     - Name: report-notifier
 *     - Table: public.reports
 *     - Events: Insert
 *     - Method: POST
 *     - URL: https://<vercel-domain>/api/admin/report-webhook
 *     - HTTP Headers: x-webhook-secret: <SUPABASE_WEBHOOK_SECRET>
 */

import { NextResponse } from "next/server";
import { sendAdminEmail, escapeHtml } from "@/lib/email/resend";

interface SupabaseWebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: ReportRecord | null;
  old_record: ReportRecord | null;
}

interface ReportRecord {
  id: string;
  reporter_id: string;
  target_type: "listing" | "user" | "message" | "review";
  target_id: string;
  reason: string;
  description: string | null;
  status: string;
  created_at: string;
}

// In-memory burst tracker — per isolate
const recentEmails: number[] = []; // timestamps en ms
const DIGEST_THRESHOLD = 5;
const DIGEST_WINDOW_MS = 5 * 60 * 1000;

function pruneRecent(now: number): void {
  while (recentEmails.length > 0 && recentEmails[0]! < now - DIGEST_WINDOW_MS) {
    recentEmails.shift();
  }
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vicinomarket.com";

function adminLink(reportId: string): string {
  return `${SITE_URL}/admin/moderation?focus=${encodeURIComponent(reportId)}`;
}

function renderNormalEmail(record: ReportRecord): { subject: string; html: string } {
  return {
    subject: `[VICINO] Nuevo reporte: ${record.target_type} — ${record.reason}`,
    html: `
      <h2>Nuevo reporte recibido</h2>
      <ul>
        <li><strong>Target:</strong> ${escapeHtml(record.target_type)} / <code>${escapeHtml(record.target_id)}</code></li>
        <li><strong>Razón:</strong> ${escapeHtml(record.reason)}</li>
        <li><strong>Reporter:</strong> <code>${escapeHtml(record.reporter_id)}</code></li>
        <li><strong>Descripción:</strong> ${escapeHtml(record.description) || "<em>(sin descripción)</em>"}</li>
        <li><strong>Fecha:</strong> ${escapeHtml(record.created_at)}</li>
      </ul>
      <p><a href="${adminLink(record.id)}">Ver en panel admin →</a></p>
      <hr/>
      <p style="font-size: 12px; color: #666;">Este email se envió automáticamente. Para mensajes (target_type=message), accede al panel admin para leer el contenido completo — la conversación NO se incluye en este email por privacidad.</p>
    `,
  };
}

function renderUrgentEmail(record: ReportRecord): { subject: string; html: string } {
  return {
    subject: `[VICINO][🚨 CRÍTICO] Reporte de seguridad infantil — ${record.target_type}`,
    html: `
      <h1 style="color: #c00;">⚠️ ACCIÓN INMEDIATA REQUERIDA</h1>
      <p>Se recibió un reporte con motivo <strong>child_safety</strong>.</p>
      <ul>
        <li><strong>Target:</strong> ${escapeHtml(record.target_type)} / <code>${escapeHtml(record.target_id)}</code></li>
        <li><strong>Reporter:</strong> <code>${escapeHtml(record.reporter_id)}</code></li>
        <li><strong>Descripción:</strong> ${escapeHtml(record.description) || "<em>(sin descripción)</em>"}</li>
        <li><strong>Fecha:</strong> ${escapeHtml(record.created_at)}</li>
      </ul>
      <p><strong>El target ya fue auto-ocultado por trigger de DB.</strong></p>
      <p>Conforme a T&C sección 14 y Aviso de Privacidad sección 8, este reporte
      requiere denuncia ante <strong>Policía Cibernética / FGR</strong>.
      Una vez presentada la denuncia, registra <code>authority_notified_at</code> y
      <code>authority_notification_reference</code> en la tabla
      <code>critical_reports</code> vía panel admin.</p>
      <p><a href="${adminLink(record.id)}">Ver en panel admin →</a></p>
    `,
  };
}

function renderBurstEmail(record: ReportRecord, count: number): { subject: string; html: string } {
  return {
    subject: `[VICINO][⚠️] Ráfaga de reportes detectada (${count}+ en 5 min)`,
    html: `
      <h2>Ráfaga de reportes detectada</h2>
      <p>Se han recibido <strong>${count} reportes en los últimos 5 minutos</strong>.
      Para evitar saturación de tu inbox, los siguientes reportes en esta ventana
      se omiten temporalmente — revisa el panel admin.</p>
      <p>Último reporte:</p>
      <ul>
        <li><strong>Target:</strong> ${escapeHtml(record.target_type)} / <code>${escapeHtml(record.target_id)}</code></li>
        <li><strong>Razón:</strong> ${escapeHtml(record.reason)}</li>
      </ul>
      <p><a href="${SITE_URL}/admin/moderation">Ver todos los reportes pendientes →</a></p>
    `,
  };
}

export async function POST(request: Request): Promise<Response> {
  // 1. Verificar secret
  const expectedSecret = process.env.SUPABASE_WEBHOOK_SECRET;
  const providedSecret = request.headers.get("x-webhook-secret");

  if (!expectedSecret) {
    // Config rota: log y respondemos 200 para no exponer detalle
    console.error("[report-webhook] SUPABASE_WEBHOOK_SECRET no configurado");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (providedSecret !== expectedSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // 2. Parsear payload
  let payload: SupabaseWebhookPayload;
  try {
    payload = (await request.json()) as SupabaseWebhookPayload;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  if (
    payload.type !== "INSERT" ||
    payload.table !== "reports" ||
    !payload.record
  ) {
    return NextResponse.json({ ok: true, skipped: true }, { status: 200 });
  }

  const record = payload.record;

  // 3. CSAM siempre dispara email URGENTE (no se incluye en burst dedup)
  if (record.reason === "child_safety") {
    await sendAdminEmail({ ...renderUrgentEmail(record), urgent: true });
    return NextResponse.json({ ok: true, urgent: true }, { status: 200 });
  }

  // 4. Burst dedup
  const now = Date.now();
  pruneRecent(now);

  if (recentEmails.length === DIGEST_THRESHOLD) {
    // Justo cruzamos el umbral: enviamos UN email "burst" y omitimos siguientes
    recentEmails.push(now);
    await sendAdminEmail(renderBurstEmail(record, DIGEST_THRESHOLD + 1));
    return NextResponse.json({ ok: true, burst: true }, { status: 200 });
  }

  if (recentEmails.length > DIGEST_THRESHOLD) {
    // Ya en modo burst: omitir email, incrementar contador
    recentEmails.push(now);
    return NextResponse.json({ ok: true, suppressed: true }, { status: 200 });
  }

  // 5. Modo normal
  recentEmails.push(now);
  await sendAdminEmail(renderNormalEmail(record));
  return NextResponse.json({ ok: true }, { status: 200 });
}
