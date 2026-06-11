"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { assignRoleSchema, removeRoleSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function assignRole(userId: string, role: string) {
  const { supabase, user } = await requireAdmin();

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = assignRoleSchema.safeParse({ user_id: userId, role });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // Direct writes on user_roles are revoked (P0 #1). Route through the
  // admin-guarded SECURITY DEFINER RPC; it does ON CONFLICT DO NOTHING, so a
  // re-assign is idempotent (no 23505 to special-case anymore).
  const { error } = await supabase.rpc("manage_user_role", {
    p_user_id: parsed.data.user_id,
    p_role: parsed.data.role,
    p_action: "assign",
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function removeRole(userId: string, role: string) {
  const { supabase, user } = await requireAdmin();

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = removeRoleSchema.safeParse({ user_id: userId, role });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // Direct writes on user_roles are revoked (P0 #1). The RPC enforces admin and
  // protects the last admin; propagate its message to the UI.
  const { error } = await supabase.rpc("manage_user_role", {
    p_user_id: parsed.data.user_id,
    p_role: parsed.data.role,
    p_action: "remove",
  });
  if (error) return { error: error.message };
  return { success: true };
}
