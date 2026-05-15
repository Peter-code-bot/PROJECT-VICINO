"use server";

import { requireAdmin } from "@/lib/auth/require-admin";

export async function assignRole(userId: string, role: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("user_roles").insert({
    user_id: userId,
    role,
  });
  if (error && error.code !== "23505") return { error: error.message };
  return { success: true };
}

export async function removeRole(userId: string, role: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role", role);
  if (error) return { error: error.message };
  return { success: true };
}
