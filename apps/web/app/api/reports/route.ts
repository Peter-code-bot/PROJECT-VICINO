/**
 * POST /api/reports — crear un reporte de contenido user-generated.
 *
 * Flujo:
 *   1. Rate limit aplicado por middleware.ts (10/hora/IP).
 *   2. Verifica sesión autenticada.
 *   3. Valida payload con zod.
 *   4. Verifica que no es self-report (lookup en tabla del target).
 *   5. INSERT en public.reports con auth.uid() como reporter_id.
 *   6. La RLS users_can_create_reports valida que reporter_id = auth.uid().
 *   7. Trigger trg_reports_auto_hide auto-oculta el target a 3+ reports.
 *   8. Trigger trg_reports_child_safety oculta + audit-trail si CSAM.
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
