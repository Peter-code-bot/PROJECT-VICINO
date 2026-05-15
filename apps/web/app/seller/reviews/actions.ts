"use server";

import { createClient } from "@/lib/supabase/server";
import { respondReviewSchema } from "@vicino/shared";

export async function respondToReview(reviewId: string, respuesta: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const parsed = respondReviewSchema.safeParse({ review_id: reviewId, respuesta });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  const { error } = await supabase
    .from("reviews")
    .update({
      respuesta: parsed.data.respuesta,
      respuesta_fecha: new Date().toISOString(),
    })
    .eq("id", parsed.data.review_id)
    .eq("reviewed_id", user.id);

  if (error) return { error: error.message };
  return { success: true };
}
