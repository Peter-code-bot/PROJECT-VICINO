"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { requireAdminOrModerator } from "@/lib/auth/require-admin-or-moderator";
import { moderateReviewSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function hideReview(reviewId: string) {
  const { supabase, user } = await requireAdmin();

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = moderateReviewSchema.safeParse({ review_id: reviewId });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Reseña inválida" };
  }

  const { error } = await supabase
    .from("reviews")
    .update({ visible: false })
    .eq("id", parsed.data.review_id);
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "hide_review",
    target_type: "review",
    target_id: reviewId,
    metadata: {},
  });

  revalidatePath("/admin/moderation");
  return { success: true };
}

export async function approveReview(reviewId: string) {
  const { supabase, user } = await requireAdmin();

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = moderateReviewSchema.safeParse({ review_id: reviewId });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Reseña inválida" };
  }

  const { error } = await supabase
    .from("reviews")
    .update({ reportada: false, visible: true })
    .eq("id", parsed.data.review_id);
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: user.id,
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
  const { user: admin } = await requireAdmin();
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
  const { user: admin } = await requireAdmin();
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
  const { user: admin } = await requireAdmin();
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
