"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function requireAdminOrModerator() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  if (isAdmin) return { user, role: "admin" as const };
  const { data: isModerator } = await supabase.rpc("has_role", {
    _user_id: user.id,
    _role: "moderator",
  });
  if (isModerator) return { user, role: "moderator" as const };
  return null;
}

async function requireAdmin() {
  const ctx = await requireAdminOrModerator();
  return ctx?.role === "admin" ? ctx.user : null;
}

// =============================================================================
// Acciones LEGACY sobre tabla `reviews` — mantenidas para backward-compat.
// Se eliminan en una migración futura junto con las columnas reviews.reportada
// y reviews.visible. Ver supabase/migrations/20260429120000_moderation_reports.sql
// =============================================================================

export async function hideReview(reviewId: string) {
  const ctx = await requireAdminOrModerator();
  if (!ctx) return { error: "No autorizado" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("reviews")
    .update({ is_hidden: true })
    .eq("id", reviewId);
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: ctx.user.id,
    action: "hide_review",
    target_type: "review",
    target_id: reviewId,
    metadata: {},
  });

  revalidatePath("/admin/moderation");
  return { success: true };
}

export async function approveReview(reviewId: string) {
  const ctx = await requireAdminOrModerator();
  if (!ctx) return { error: "No autorizado" };

  const supabase = await createClient();
  // Marca la review como no oculta. NO toca el flag legacy `reportada`
  // (eso lo hace dismissReportsForTarget abajo).
  const { error } = await supabase
    .from("reviews")
    .update({ is_hidden: false })
    .eq("id", reviewId);
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: ctx.user.id,
    action: "approve_review",
    target_type: "review",
    target_id: reviewId,
    metadata: {},
  });

  revalidatePath("/admin/moderation");
  return { success: true };
}

// =============================================================================
// Acciones sobre tabla `reports`
// =============================================================================

/**
 * Marca un reporte como resuelto. Si hideTarget=true, también oculta el target
 * (útil para casos donde el reporte es válido y el contenido debe desaparecer).
 */
export async function resolveReport(
  reportId: string,
  options: { hideTarget?: boolean; notes?: string } = {},
) {
  const ctx = await requireAdminOrModerator();
  if (!ctx) return { error: "No autorizado" };

  const supabase = await createClient();
  const { data: report, error: fetchError } = await supabase
    .from("reports")
    .select("id, target_type, target_id")
    .eq("id", reportId)
    .single();

  if (fetchError || !report) return { error: "Reporte no encontrado" };

  if (options.hideTarget) {
    if (report.target_type === "listing") {
      await supabase.from("products_services").update({ is_hidden: true }).eq("id", report.target_id);
    } else if (report.target_type === "review") {
      await supabase.from("reviews").update({ is_hidden: true }).eq("id", report.target_id);
    } else if (report.target_type === "message") {
      await supabase.from("messages").update({ is_hidden: true }).eq("id", report.target_id);
    } else if (report.target_type === "user") {
      await supabase.from("profiles").update({ is_hidden: true }).eq("id", report.target_id);
    }
  }

  const { error } = await supabase
    .from("reports")
    .update({
      status: "resolved",
      reviewed_by: ctx.user.id,
      reviewed_at: new Date().toISOString(),
      resolution_notes: options.notes ?? null,
    })
    .eq("id", reportId);

  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: ctx.user.id,
    action: "resolve_report",
    target_type: "report",
    target_id: reportId,
    metadata: {
      hide_target: options.hideTarget ?? false,
      target_type: report.target_type,
      target_id: report.target_id,
      notes: options.notes ?? null,
    },
  });

  revalidatePath("/admin/moderation");
  return { success: true };
}

/**
 * Desestima un reporte sin tocar el target. Para casos donde el reporte
 * fue inválido (false-positive, abuso del sistema de reportes, etc).
 */
export async function dismissReport(reportId: string, notes?: string) {
  const ctx = await requireAdminOrModerator();
  if (!ctx) return { error: "No autorizado" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({
      status: "dismissed",
      reviewed_by: ctx.user.id,
      reviewed_at: new Date().toISOString(),
      resolution_notes: notes ?? null,
    })
    .eq("id", reportId);

  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: ctx.user.id,
    action: "dismiss_report",
    target_type: "report",
    target_id: reportId,
    metadata: { notes: notes ?? null },
  });

  revalidatePath("/admin/moderation");
  return { success: true };
}

/**
 * Marca todos los reportes pendientes de un target como dismissed.
 * Útil cuando el admin determina que el contenido es OK tras la primera revisión.
 */
export async function dismissReportsForTarget(
  targetType: "listing" | "user" | "message" | "review",
  targetId: string,
) {
  const ctx = await requireAdminOrModerator();
  if (!ctx) return { error: "No autorizado" };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("reports")
    .update(
      {
        status: "dismissed",
        reviewed_by: ctx.user.id,
        reviewed_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .in("status", ["pending", "reviewed"]);

  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: ctx.user.id,
    action: "dismiss_reports_bulk",
    target_type: targetType,
    target_id: targetId,
    metadata: { dismissed_count: count ?? 0 },
  });

  revalidatePath("/admin/moderation");
  return { success: true };
}

// =============================================================================
// Acciones de target (suspender/restaurar)
// =============================================================================

export async function suspendUser(userId: string) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Solo admin puede suspender usuarios" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_hidden: true })
    .eq("id", userId);

  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: admin.id,
    action: "suspend_user",
    target_type: "user",
    target_id: userId,
    metadata: {},
  });

  revalidatePath("/admin/moderation");
  return { success: true };
}

export async function unsuspendUser(userId: string) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Solo admin puede restaurar usuarios" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_hidden: false })
    .eq("id", userId);

  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: admin.id,
    action: "unsuspend_user",
    target_type: "user",
    target_id: userId,
    metadata: {},
  });

  revalidatePath("/admin/moderation");
  return { success: true };
}

export async function unhideListing(listingId: string) {
  const ctx = await requireAdminOrModerator();
  if (!ctx) return { error: "No autorizado" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("products_services")
    .update({ is_hidden: false })
    .eq("id", listingId);

  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: ctx.user.id,
    action: "unhide_listing",
    target_type: "listing",
    target_id: listingId,
    metadata: {},
  });

  revalidatePath("/admin/moderation");
  return { success: true };
}

// =============================================================================
// CSAM / critical_reports
// =============================================================================

export async function markAuthorityNotified(
  criticalReportId: string,
  reference: string,
  notes?: string,
) {
  const admin = await requireAdmin();
  if (!admin) return { error: "Solo admin" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("critical_reports")
    .update({
      authority_notified_at: new Date().toISOString(),
      authority_notification_reference: reference,
      notes: notes ?? null,
    })
    .eq("id", criticalReportId);

  if (error) return { error: error.message };

  // CRÍTICO: este audit log es prueba legal de la notificación a autoridad
  // mexicana competente (FGR / Policía Cibernética). Retención mínima 5 años
  // según docs/moderation-setup.md.
  await supabase.from("audit_log").insert({
    actor_id: admin.id,
    action: "notify_authority",
    target_type: "critical_report",
    target_id: criticalReportId,
    metadata: {
      authority_reference: reference,
      notes: notes ?? null,
      notified_at: new Date().toISOString(),
    },
  });

  revalidatePath("/admin/moderation/critical");
  return { success: true };
}
