"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { markNotificationReadSchema } from "@vicino/shared";

export async function markAsRead(notificationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

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

  await supabase
    .from("notifications")
    .update({ leida: true })
    .eq("user_id", user.id)
    .eq("leida", false);

  revalidatePath("/notificaciones");
  return { success: true };
}
