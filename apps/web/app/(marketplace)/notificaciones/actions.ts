"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
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

  const { data: updated, error: updateErr } = await supabase
    .from("notifications")
    .update({ leida: true })
    .eq("id", parsed.data.notification_id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (updateErr) {
    // Sentry SIEMPRE primero: el `details` de Postgres es donde el motor nombra
    // la columna o la policy que rechazo. Sin esto el fallo era invisible y el
    // badge volvia al refrescar sin dejar ninguna pista de por que.
    Sentry.captureException(updateErr, {
      tags: { action: "markAsRead" },
      contexts: {
        notification: { id: parsed.data.notification_id },
        supabase: { code: updateErr.code },
      },
    });
    return { error: "No se pudo marcar como leída. Intenta de nuevo." };
  }

  // Un UPDATE de 0 filas no es un error en PostgREST (204 sin cuerpo): si el id
  // no existe o es de otro usuario, sin este chequeo devolveriamos exito igual.
  if (!updated) {
    return { error: "Esta notificación ya no existe." };
  }

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

  const { error: updateErr } = await supabase
    .from("notifications")
    .update({ leida: true })
    .eq("user_id", user.id)
    .eq("leida", false);

  if (updateErr) {
    Sentry.captureException(updateErr, {
      tags: { action: "markAllAsRead" },
      contexts: { supabase: { code: updateErr.code } },
    });
    return { error: "No se pudieron marcar como leídas. Intenta de nuevo." };
  }

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
