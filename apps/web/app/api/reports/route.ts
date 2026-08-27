/**
 * POST /api/reports — crear un reporte de contenido user-generated.
 *
 * Flujo:
 *   1. Verifica sesión autenticada.
 *   2. Rate limit: 10/hora por cuenta y 30/hora por IP, aplicado AQUÍ.
 *      Antes esta línea decía "aplicado por middleware.ts" y era falso: en
 *      Next 16 el middleware es proxy.ts, y proxy.ts solo cubre
 *      /auth/callback-server. La ruta llevaba desde su primer día sin ningún
 *      límite, con el comentario asegurando que sí lo tenía.
 *   3. Valida payload con zod.
 *   4. Verifica que no es self-report (lookup en tabla del target).
 *   5. INSERT en public.reports con auth.uid() como reporter_id.
 *   6. La RLS users_can_create_reports valida que reporter_id = auth.uid().
 *   7. Trigger trg_reports_auto_hide auto-oculta el target a 3+ reports.
 *   8. Trigger trg_reports_child_safety: si es CSAM, oculta el CONTENIDO
 *      (anuncio, reseña o mensaje) al primer reporte y encola en
 *      critical_reports. No oculta perfiles enteros, y deja de auto-ocultar
 *      a partir del cuarto reporte de la misma cuenta en 24h — encolando
 *      igual, para que ninguna denuncia se pierda.
 *   9. Database Webhook dispara el email al admin (si configurado).
 *
 * Errors:
 *   401 — sin autenticación
 *   400 — payload inválido
 *   403 — self-report
 *   409 — ya reportaste este contenido (UNIQUE constraint)
 *   500 — otro error
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { enforce, getClientIp, reportRateLimit, reportIpRateLimit } from "@/lib/rate-limit";

const REPORT_TARGET_TYPES = ["listing", "user", "message", "review"] as const;

const REPORT_REASONS = [
  "spam",
  "inappropriate_content",
  "fraud_or_scam",
  "harassment",
  "fake_profile",
  "illegal_product",
  "copyright_violation",
  "child_safety",
  "other",
] as const;

const reportSchema = z.object({
  target_type: z.enum(REPORT_TARGET_TYPES),
  target_id: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  description: z.string().max(500).optional().nullable(),
});

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Debes iniciar sesión para reportar contenido." },
      { status: 401 }
    );
  }

  // El limite de peticiones, que hasta hoy solo existia en el docstring de
  // arriba. Decia "aplicado por middleware.ts (10/hora/IP)" y no habia tal:
  // middleware.ts no existe en Next 16 (es proxy.ts) y proxy.ts solo protege
  // /auth/callback-server. Se aplica aqui, en la propia ruta, que es donde no
  // se puede perder de vista.
  //
  // Va DESPUES de comprobar la sesion a proposito: sin sesion se sale con 401
  // sin gastar cuota, asi que nadie puede agotarle el cupo a otro.
  const ip = getClientIp(request.headers);
  const porCuenta = await enforce(reportRateLimit, `report:${user.id}`);
  const porIp = await enforce(reportIpRateLimit, `report-ip:${ip}`);
  if (!porCuenta.ok || !porIp.ok) {
    return NextResponse.json(
      { error: "Has enviado demasiados reportes. Espera un momento e intenta de nuevo." },
      { status: 429 }
    );
  }

  // Parse + validate
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Payload inválido." },
      { status: 400 }
    );
  }

  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { target_type, target_id, reason, description } = parsed.data;

  // Self-report check
  const isSelfReport = await checkSelfReport(supabase, user.id, target_type, target_id);
  if (isSelfReport === "self") {
    return NextResponse.json(
      { error: "No puedes reportar tu propio contenido." },
      { status: 403 }
    );
  }
  if (isSelfReport === "not_found") {
    return NextResponse.json(
      { error: "El contenido reportado no existe o fue eliminado." },
      { status: 404 }
    );
  }

  // Insert
  const { data, error } = await supabase
    .from("reports")
    .insert({
      reporter_id: user.id,
      target_type,
      target_id,
      reason,
      description: description ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // UNIQUE constraint → ya reportó este contenido
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya reportaste este contenido. Lo revisaremos pronto." },
        { status: 409 }
      );
    }
    // FK violation u otros
    console.error("[/api/reports] insert error", { code: error.code, message: error.message });
    return NextResponse.json(
      { error: "No pudimos guardar tu reporte. Intenta de nuevo." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

type SelfReportCheck = "ok" | "self" | "not_found";

async function checkSelfReport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reporterId: string,
  targetType: (typeof REPORT_TARGET_TYPES)[number],
  targetId: string
): Promise<SelfReportCheck> {
  if (targetType === "user") {
    if (targetId === reporterId) return "self";
    return "ok";
  }

  if (targetType === "listing") {
    const { data, error } = await supabase
      .from("products_services")
      .select("creador_id")
      .eq("id", targetId)
      .maybeSingle();
    if (error) return "ok"; // si la lookup falla, dejamos pasar; DB tiene defensa
    if (!data) return "not_found";
    return data.creador_id === reporterId ? "self" : "ok";
  }

  if (targetType === "review") {
    const { data, error } = await supabase
      .from("reviews")
      .select("reviewer_id")
      .eq("id", targetId)
      .maybeSingle();
    if (error) return "ok";
    if (!data) return "not_found";
    return data.reviewer_id === reporterId ? "self" : "ok";
  }

  if (targetType === "message") {
    const { data, error } = await supabase
      .from("messages")
      .select("autor_id")
      .eq("id", targetId)
      .maybeSingle();
    if (error) return "ok";
    if (!data) return "not_found";
    return data.autor_id === reporterId ? "self" : "ok";
  }

  return "ok";
}
