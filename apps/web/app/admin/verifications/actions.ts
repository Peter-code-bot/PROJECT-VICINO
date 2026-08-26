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

  // Notificacion fuera del RPC atomico: no es estado canonico mutable, un
  // fallo aqui no causa divergencia. Va por notify_user_as_staff (SECURITY
  // DEFINER, valida admin o moderator con has_role) porque notifications NO
  // tiene policy de INSERT: el insert directo moria con 42501 y el vendedor
  // nunca se enteraba. Migracion: 20260826080000_lock_down_create_notification.
  // supabase-js no lanza en error de PostgREST — el try/catch anterior era
  // codigo muerto, hay que leer `error`.
  const { error: notifError } = await supabase.rpc("notify_user_as_staff", {
    p_user_id: parsed.data.user_id,
    p_tipo: "trust_upgrade",
    p_titulo: "¡Identidad verificada!",
    p_mensaje:
      "Tu identidad ha sido verificada. Ganaste 30 puntos de confianza.",
    p_data: { verification_id: parsed.data.verification_id },
  });

  if (notifError) {
    Sentry.captureException(notifError, {
      tags: { action: "approveVerification", step: "post_rpc_notification" },
      contexts: {
        verification: { id: parsed.data.verification_id },
        supabase: {
          code: (notifError as { code?: string }).code,
          details: (notifError as { details?: string }).details,
        },
      },
    });
    // NO abortar — el approval ya fue atomico en el RPC.
  }

  // audit_log fuera del RPC atomico: rastro legal post-hoc, la prueba canonica
  // de la aprobacion es seller_verification.reviewed_at que escribe el RPC.
  // La policy admins_insert_audit si permite esta escritura, pero supabase-js
  // no lanza en error de PostgREST: sin leer `error` un fallo se perdia entero.
  const { error: auditError } = await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "approve_verification",
    target_type: "verification",
    target_id: parsed.data.verification_id,
    metadata: { userId: parsed.data.user_id },
  });

  if (auditError) {
    Sentry.captureException(auditError, {
      tags: { action: "approveVerification", step: "post_rpc_audit_log" },
      contexts: {
        verification: { id: parsed.data.verification_id },
        supabase: {
          code: (auditError as { code?: string }).code,
          details: (auditError as { details?: string }).details,
        },
      },
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

  // La policy admins_insert_audit permite esta escritura, pero supabase-js no
  // lanza en error de PostgREST: sin leer `error` un fallo se pierde entero.
  const { error: auditError } = await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "reject_verification",
    target_type: "verification",
    target_id: parsed.data.verification_id,
    metadata: { note: parsed.data.note ?? null },
  });

  if (auditError) {
    Sentry.captureException(auditError, {
      tags: { action: "rejectVerification", step: "audit_log" },
      contexts: {
        verification: { id: parsed.data.verification_id },
        supabase: {
          code: (auditError as { code?: string }).code,
          details: (auditError as { details?: string }).details,
        },
      },
    });
    // NO abortar — audit_log es trazabilidad post-hoc, no estado canonico.
  }

  // Avisar al vendedor. Via notify_user_as_staff (SECURITY DEFINER, valida
  // admin o moderator) porque notifications NO tiene policy de INSERT: el
  // insert directo moria con 42501 y el rechazo nunca llegaba a quien lo
  // recibio. Migracion: 20260826080000_lock_down_create_notification.
  if (!ver?.user_id) {
    Sentry.captureException(
      new Error("rejectVerification: verificacion sin user_id, no se notifico"),
      {
        tags: { action: "rejectVerification", step: "notification_skipped" },
        contexts: { verification: { id: parsed.data.verification_id } },
      },
    );
  } else {
    const { error: notifError } = await supabase.rpc("notify_user_as_staff", {
      p_user_id: ver.user_id,
      p_tipo: "trust_upgrade",
      p_titulo: "Verificación rechazada",
      p_mensaje: parsed.data.note
        ? `Tu verificación fue rechazada: ${parsed.data.note}. Puedes intentar de nuevo.`
        : "Tu verificación fue rechazada. Puedes intentar de nuevo.",
      p_data: { verification_id: parsed.data.verification_id },
    });

    if (notifError) {
      Sentry.captureException(notifError, {
        tags: { action: "rejectVerification", step: "notification" },
        contexts: {
          verification: { id: parsed.data.verification_id },
          supabase: {
            code: (notifError as { code?: string }).code,
            details: (notifError as { details?: string }).details,
          },
        },
      });
      // NO abortar — el rechazo ya quedo escrito en seller_verification.
    }
  }

  return { success: true };
}
