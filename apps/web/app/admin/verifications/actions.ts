"use server";

import * as Sentry from "@sentry/nextjs";
import { requireAdmin } from "@/lib/auth/require-admin";
import { approveVerificationSchema, rejectVerificationSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function approveVerification(verificationId: string, userId: string) {
  const { supabase, user } = await requireAdmin();

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = approveVerificationSchema.safeParse({
    verification_id: verificationId,
    user_id: userId,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // MP#07 Fase 4 + MP#08 #6: atomic approve verification via RPC.
  // Replaces the 3 separate writes (seller_verification UPDATE +
  // profiles UPDATE + trust_level_verification upsert) with a single
  // SECURITY DEFINER function that runs them in one implicit
  // transaction. Migration: 20260528000003_rpc_approve_verification_atomic.
  const { error: rpcError } = await supabase.rpc(
    "approve_verification_atomic",
    {
      p_verification_id: parsed.data.verification_id,
      p_user_id: parsed.data.user_id,
    },
  );

  if (rpcError) {
    Sentry.captureException(rpcError, {
      tags: { action: "approveVerification", step: "rpc_call" },
      contexts: {
        verification: { id: parsed.data.verification_id },
        supabase: { code: (rpcError as { code?: string }).code },
      },
    });
    return { error: rpcError.message ?? "Error al aprobar verificacion" };
  }

  // Notification INSERT outside the atomic RPC: not part of canonical
  // mutable state, failure here does not cause divergence. Wrap in
  // try/catch so a notifications-table outage cannot mask a successful
  // verification approval (caveat P4 of the playbook).
  try {
    await supabase.from("notifications").insert({
      user_id: parsed.data.user_id,
      tipo: "trust_upgrade",
      titulo: "¡Identidad verificada!",
      mensaje: "Tu identidad ha sido verificada. Ganaste 30 puntos de confianza.",
      data: { verification_id: parsed.data.verification_id },
    });
  } catch (notifError) {
    Sentry.captureException(notifError, {
      tags: { action: "approveVerification", step: "post_rpc_notification" },
      contexts: { verification: { id: parsed.data.verification_id } },
    });
    // NO abortar — el approval ya fue atomico en el RPC.
  }

  // audit_log INSERT outside the atomic RPC: legal trail post-hoc, the
  // canonical proof of approval is seller_verification.reviewed_at written
  // by the RPC. A failure here is observable via Sentry without rolling
  // back the verification approval.
  try {
    await supabase.from("audit_log").insert({
      actor_id: user.id,
      action: "approve_verification",
      target_type: "verification",
      target_id: verificationId,
      metadata: { userId },
    });
  } catch (auditError) {
    Sentry.captureException(auditError, {
      tags: { action: "approveVerification", step: "post_rpc_audit_log" },
      contexts: { verification: { id: parsed.data.verification_id } },
    });
    // NO abortar — audit_log es trazabilidad post-hoc, no estado canonico.
  }

  return { success: true };
}

export async function rejectVerification(verificationId: string, note: string) {
  const { supabase, user } = await requireAdmin();

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = rejectVerificationSchema.safeParse({
    verification_id: verificationId,
    note: note ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // Get user_id from verification
  const { data: ver } = await supabase
    .from("seller_verification")
    .select("user_id")
    .eq("id", parsed.data.verification_id)
    .single();

  const { error } = await supabase
    .from("seller_verification")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewer_note: parsed.data.note || null,
    })
    .eq("id", parsed.data.verification_id);

  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "reject_verification",
    target_type: "verification",
    target_id: parsed.data.verification_id,
    metadata: { note: parsed.data.note ?? null },
  });

  // Notify seller
  if (ver?.user_id) {
    await supabase.from("notifications").insert({
      user_id: ver.user_id,
      tipo: "trust_upgrade",
      titulo: "Verificación rechazada",
      mensaje: parsed.data.note
        ? `Tu verificación fue rechazada: ${parsed.data.note}. Puedes intentar de nuevo.`
        : "Tu verificación fue rechazada. Puedes intentar de nuevo.",
      data: { verification_id: parsed.data.verification_id },
    });
  }

  return { success: true };
}
