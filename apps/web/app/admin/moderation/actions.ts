"use server";

import { requireAdmin } from "@/lib/auth/require-admin";

export async function hideReview(reviewId: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("reviews")
    .update({ visible: false })
    .eq("id", reviewId);
  if (error) return { error: error.message };
  return { success: true };
}

export async function approveReview(reviewId: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("reviews")
    .update({ reportada: false, visible: true })
    .eq("id", reviewId);
  if (error) return { error: error.message };
  return { success: true };
}
