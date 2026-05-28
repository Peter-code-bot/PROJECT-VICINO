"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { markNotificationReadSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

const uuidSchema = z.string().uuid();

export async function markAsRead(notificationId: string) {
  if (!uuidSchema.safeParse(notificationId).success) return { error: "ID inválido" };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = markNotificationReadSchema.safeParse({ notification_id: notificationId });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Notificación inválida" };
  }

  await supabase
    .from("notifications")
    .update({ leida: true })
    .eq("id", parsed.data.notification_id)
    .eq("user_id", user.id);

  revalidatePath("/notificaciones");
  return { success: true };
}

export async function markAllAsRead() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  await supabase
    .from("notifications")
    .update({ leida: true })
    .eq("user_id", user.id)
    .eq("leida", false);

  revalidatePath("/notificaciones");
  return { success: true };
}

export async function getTotalUnreadNotifications(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("leida", false)
    .neq("tipo", "message");

  return count ?? 0;
}
