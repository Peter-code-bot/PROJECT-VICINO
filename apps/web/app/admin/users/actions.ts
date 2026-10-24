"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { assignRoleSchema, removeRoleSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { comprobarClaveDeSeguridad } from "@/lib/admin/clave-de-seguridad";
import { createAdminClient } from "@/lib/supabase/admin";

export async function assignRole(userId: string, role: string, claveDeSeguridad?: string) {
  const { user } = await requireAdmin();

  // La clave va PRIMERO, antes de la cuota de escritura y de la validacion:
  // repartir el rol de admin es el movimiento mas caro del panel y no puede
  // depender de un clic suelto en una sesion abierta. Ver
  // lib/admin/clave-de-seguridad.ts.
  const clave = await comprobarClaveDeSeguridad(user.id, claveDeSeguridad);
  if (!clave.ok) return { error: clave.error };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = assignRoleSchema.safeParse({ user_id: userId, role });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  // El cliente privilegiado se crea sólo después de autenticar, comprobar
  // la segunda clave y validar los datos. El actor nunca viene del cliente;
  // el RPC vuelve a comprobar su rol actual dentro de la transacción.
  const { error } = await createAdminClient().rpc("admin_set_user_role_secure", {
    p_actor_id: user.id,
    p_user_id: parsed.data.user_id,
    p_role: parsed.data.role,
    p_grant: true,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function removeRole(userId: string, role: string, claveDeSeguridad?: string) {
  const { user } = await requireAdmin();

  const clave = await comprobarClaveDeSeguridad(user.id, claveDeSeguridad);
  if (!clave.ok) return { error: clave.error };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = removeRoleSchema.safeParse({ user_id: userId, role });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  // Mismo canal exclusivo de servidor; conserva el bloqueo del auto-retiro.
  const { error } = await createAdminClient().rpc("admin_set_user_role_secure", {
    p_actor_id: user.id,
    p_user_id: parsed.data.user_id,
    p_role: parsed.data.role,
    p_grant: false,
  });
  if (error) return { error: error.message };
  return { success: true };
}
