"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { assignRoleSchema, removeRoleSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  return isAdmin ? user : null;
}

export async function assignRole(userId: string, role: string) {
  const { supabase, user } = await requireAdmin();

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

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
  const { supabase, user } = await requireAdmin();

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

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
