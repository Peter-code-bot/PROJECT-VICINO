"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function cancelAppointment(appointmentId: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "No autenticado" };

  // Misma cubeta `write:` que el resto de escrituras, NO un identificador
  // propio: en Upstash la clave es prefijo + identificador, asi que inventar
  // uno nuevo aqui no compartiria cuota, abriria una paralela y subiria el
  // techo real por usuario sin que nadie lo decidiera. Es el fallo que ya
  // tiene `follow:`.
  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { ok: false, message: rate.error };

  const { data: cita } = await supabase
    .from("appointments")
    .select("id, buyer_id, seller_id, status, appointment_date, appointment_start")
    .eq("id", appointmentId)
    .single();

  if (!cita) return { ok: false, message: "Cita no encontrada" };
  if (cita.buyer_id !== user.id && cita.seller_id !== user.id) {
    return { ok: false, message: "No tienes permiso" };
  }
  if (cita.status === "cancelled") {
    return { ok: false, message: "La cita ya está cancelada" };
  }
  if (cita.status === "completed") {
    return { ok: false, message: "No puedes cancelar una cita completada" };
  }

  const now = new Date();
  const apptDateTime = new Date(`${cita.appointment_date}T${cita.appointment_start}`);
  if (apptDateTime <= now) {
    return { ok: false, message: "No puedes cancelar una cita pasada" };
  }

  const { error } = await supabase
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", appointmentId);

  if (error) return { ok: false, message: error.message };

  revalidatePath("/citas");
  revalidatePath(`/citas/${appointmentId}`);

  return { ok: true };
}
