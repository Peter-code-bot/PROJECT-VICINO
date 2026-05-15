"use server";

import { requireAdmin } from "@/lib/auth/require-admin";

export async function resolveDispute(disputeId: string, resolution: string) {
  const { supabase, user } = await requireAdmin();

  const { error } = await supabase
    .from("disputes")
    .update({
      status: resolution,
      resolucion: resolution,
      admin_id: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", disputeId);

  if (error) return { error: error.message };
  return { success: true };
}
