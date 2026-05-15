"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { moderateReviewSchema } from "@vicino/shared";

export async function hideReview(reviewId: string) {
  const { supabase } = await requireAdmin();

  const parsed = moderateReviewSchema.safeParse({ review_id: reviewId });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Reseña inválida" };
  }

  const { error } = await supabase
    .from("reviews")
    .update({ visible: false })
    .eq("id", parsed.data.review_id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function approveReview(reviewId: string) {
  const { supabase } = await requireAdmin();

  const parsed = moderateReviewSchema.safeParse({ review_id: reviewId });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Reseña inválida" };
  }

  const { error } = await supabase
    .from("reviews")
    .update({ reportada: false, visible: true })
    .eq("id", parsed.data.review_id);
  if (error) return { error: error.message };
  return { success: true };
}
