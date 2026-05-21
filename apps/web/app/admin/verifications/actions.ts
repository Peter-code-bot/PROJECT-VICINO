"use server";

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

  // Update seller_verification
  const { error: verError } = await supabase
    .from("seller_verification")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.verification_id);

  if (verError) return { error: verError.message };

  // Update profile verification status + trust points for INE verification
  await supabase
    .from("profiles")
    .update({
      is_verified: true,
      verified_at: new Date().toISOString(),
      trust_points: 30, // Will be added via trigger if we had one, manually set for now
    })
    .eq("id", parsed.data.user_id);

  // Notify seller
  await supabase.from("notifications").insert({
    user_id: parsed.data.user_id,
    tipo: "trust_upgrade",
    titulo: "¡Identidad verificada!",
    mensaje: "Tu identidad ha sido verificada. Ganaste 30 puntos de confianza.",
    data: { verification_id: parsed.data.verification_id },
  });

  // Upsert trust_level_verification
  const { data: existing } = await supabase
    .from("trust_level_verification")
    .select("id")
    .eq("user_id", parsed.data.user_id)
    .single();

  if (existing) {
    await supabase
      .from("trust_level_verification")
      .update({
        id_verified: true,
        selfie_verified: true,
        selfie_match_verified: true,
        current_level: "verificado",
        level_1_completed_at: new Date().toISOString(),
      })
      .eq("user_id", parsed.data.user_id);
  } else {
    await supabase.from("trust_level_verification").insert({
      user_id: parsed.data.user_id,
      id_verified: true,
      selfie_verified: true,
      selfie_match_verified: true,
      current_level: "verificado",
      level_1_completed_at: new Date().toISOString(),
    });
  }

  await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "approve_verification",
    target_type: "verification",
    target_id: verificationId,
    metadata: { userId },
  });

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
