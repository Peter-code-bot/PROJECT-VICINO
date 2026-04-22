"use server";

import { createClient } from "@/lib/supabase/server";

export async function approveVerification(verificationId: string, userId: string) {
  const supabase = await createClient();

  // Update seller_verification
  const { error: verError } = await supabase
    .from("seller_verification")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", verificationId);

  if (verError) return { error: verError.message };

  // Update profile verification status + trust points for INE verification
  await supabase
    .from("profiles")
    .update({
      is_verified: true,
      verified_at: new Date().toISOString(),
      trust_points: 30, // Will be added via trigger if we had one, manually set for now
    })
    .eq("id", userId);

  // Notify seller
  await supabase.from("notifications").insert({
    user_id: userId,
    tipo: "trust_upgrade",
    titulo: "¡Identidad verificada!",
    mensaje: "Tu identidad ha sido verificada. Ganaste 30 puntos de confianza.",
    data: { verification_id: verificationId },
  });

  // Upsert trust_level_verification
  const { data: existing } = await supabase
    .from("trust_level_verification")
    .select("id")
    .eq("user_id", userId)
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
      .eq("user_id", userId);
  } else {
    await supabase.from("trust_level_verification").insert({
      user_id: userId,
      id_verified: true,
      selfie_verified: true,
      selfie_match_verified: true,
      current_level: "verificado",
      level_1_completed_at: new Date().toISOString(),
    });
  }

  return { success: true };
}

export async function rejectVerification(verificationId: string, note: string) {
  const supabase = await createClient();

  // Get user_id from verification
  const { data: ver } = await supabase
    .from("seller_verification")
    .select("user_id")
    .eq("id", verificationId)
    .single();

  const { error } = await supabase
    .from("seller_verification")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewer_note: note || null,
    })
    .eq("id", verificationId);

  if (error) return { error: error.message };

  // Notify seller
  if (ver?.user_id) {
    await supabase.from("notifications").insert({
      user_id: ver.user_id,
      tipo: "trust_upgrade",
      titulo: "Verificación rechazada",
      mensaje: note
        ? `Tu verificación fue rechazada: ${note}. Puedes intentar de nuevo.`
        : "Tu verificación fue rechazada. Puedes intentar de nuevo.",
      data: { verification_id: verificationId },
    });
  }

  return { success: true };
}
