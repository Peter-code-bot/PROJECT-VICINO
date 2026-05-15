"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { assignRoleSchema, removeRoleSchema } from "@vicino/shared";

export async function assignRole(userId: string, role: string) {
  const { supabase } = await requireAdmin();

  const parsed = assignRoleSchema.safeParse({ user_id: userId, role });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  const { error } = await supabase.from("user_roles").insert({
    user_id: parsed.data.user_id,
    role: parsed.data.role,
  });
  if (error && error.code !== "23505") return { error: error.message };
  return { success: true };
}

export async function removeRole(userId: string, role: string) {
  const { supabase } = await requireAdmin();

  const parsed = removeRoleSchema.safeParse({ user_id: userId, role });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  const { error } = await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", parsed.data.user_id)
    .eq("role", parsed.data.role);
  if (error) return { error: error.message };
  return { success: true };
}
