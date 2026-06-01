import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  // Defense in depth (mirror recompute-rankings/index.ts:25-39): pg_cron drives
  // this every 30 minutes from supabase/migrations/20260531000001_pg_cron_schedules.sql,
  // but reject any request without the shared CRON_SECRET bearer to block
  // direct public invocation.
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) {
    return new Response(
      JSON.stringify({ ok: false, error: "CRON_SECRET not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return new Response(
      JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();
  const notifications: Record<string, unknown>[] = [];
  const update1d: string[] = [];
  const update1h: string[] = [];

  // 1-day reminders: appointments starting in 23-25 hours
  const in23h = new Date(now.getTime() + 23 * 3600000).toISOString().split("T")[0];
  const in25h = new Date(now.getTime() + 25 * 3600000).toISOString().split("T")[0];

  const { data: oneDayDue } = await supabase
    .from("appointments")
    .select("id, buyer_id, seller_id, appointment_date, appointment_start, products_services(titulo)")
    .gte("appointment_date", in23h)
    .lte("appointment_date", in25h)
    .eq("reminder_1d_sent", false)
    .eq("status", "confirmed");

  for (const a of oneDayDue ?? []) {
    const prod = Array.isArray(a.products_services) ? a.products_services[0] : a.products_services;
    const titulo = (prod as { titulo?: string })?.titulo ?? "Servicio";
    const body = `Recordatorio: "${titulo}" mañana a las ${a.appointment_start?.slice(0, 5)}`;
    notifications.push(
      { user_id: a.buyer_id, tipo: "review_reminder", titulo: "Cita mañana", mensaje: body, data: {} },
      { user_id: a.seller_id, tipo: "review_reminder", titulo: "Cita mañana", mensaje: body, data: {} }
    );
    update1d.push(a.id);
  }

  // 1-hour reminders: appointments starting in 45-75 minutes
  const nowDate = now.toISOString().split("T")[0];
  const { data: oneHourDue } = await supabase
    .from("appointments")
    .select("id, buyer_id, seller_id, appointment_date, appointment_start, products_services(titulo)")
    .eq("appointment_date", nowDate)
    .eq("reminder_1h_sent", false)
    .eq("status", "confirmed");

  for (const a of oneHourDue ?? []) {
    const [h, m] = (a.appointment_start ?? "00:00").split(":").map(Number);
    const apptTime = new Date(now);
    apptTime.setHours(h ?? 0, m ?? 0, 0, 0);
    const diffMin = (apptTime.getTime() - now.getTime()) / 60000;
    if (diffMin >= 45 && diffMin < 75) {
      const prod = Array.isArray(a.products_services) ? a.products_services[0] : a.products_services;
      const titulo = (prod as { titulo?: string })?.titulo ?? "Servicio";
      const body = `Tu cita "${titulo}" es en 1 hora (${a.appointment_start?.slice(0, 5)})`;
      notifications.push(
        { user_id: a.buyer_id, tipo: "review_reminder", titulo: "Cita en 1 hora", mensaje: body, data: {} },
        { user_id: a.seller_id, tipo: "review_reminder", titulo: "Cita en 1 hora", mensaje: body, data: {} }
      );
      update1h.push(a.id);
    }
  }

  if (notifications.length > 0) {
    await supabase.from("notifications").insert(notifications);
  }
  if (update1d.length > 0) {
    await supabase.from("appointments").update({ reminder_1d_sent: true }).in("id", update1d);
  }
  if (update1h.length > 0) {
    await supabase.from("appointments").update({ reminder_1h_sent: true }).in("id", update1h);
  }

  return new Response(
    JSON.stringify({ ok: true, reminders_1d: update1d.length, reminders_1h: update1h.length }),
    { headers: { "Content-Type": "application/json" } }
  );
});
