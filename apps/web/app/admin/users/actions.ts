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

  // Pasa por RPC, no por INSERT directo: `authenticated` no tiene privilegio de
  // INSERT sobre user_roles, asi que el insert de antes moria con 42501. La
  // policy "Admin can manage roles" existe, el GRANT nunca se escribio — el
  // mismo olvido que modo_precio, sort_order y sale_confirmations.
  //
  // Y para ESTA tabla el RPC no es solo el arreglo rapido: user_roles reparte
  // admin, asi que la comprobacion de rol vive dentro de la funcion y no depende
  // de que la policy siga en pie. La funcion trata el duplicado como exito
  // idempotente, igual que hacia el `code !== "23505"` de antes.
  const { error } = await supabase.rpc("admin_set_user_role", {
    p_user_id: parsed.data.user_id,
    p_role: parsed.data.role,
    p_grant: true,
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

  // Mismo motivo que en assignRole. El RPC ademas impide que un admin se quite
  // su propio rol: hoy hay 3 y ninguna via de recuperacion si el ultimo lo hace.
  const { error } = await supabase.rpc("admin_set_user_role", {
    p_user_id: parsed.data.user_id,
    p_role: parsed.data.role,
    p_grant: false,
  });
  if (error) return { error: error.message };
  return { success: true };
}
