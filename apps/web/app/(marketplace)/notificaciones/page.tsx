import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NotificationList } from "./notification-list";
import { WeeklyAppointmentsWidget } from "@/components/appointments/weekly-widget";
import { Bell } from "lucide-react";

export const metadata = { title: "Notificaciones — VICINO" };

export default async function NotificacionesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/notificaciones");

  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .neq("tipo", "message")
    .order("created_at", { ascending: false })
    .limit(50);

  const unreadCount = notifications?.filter((n) => !n.leida).length ?? 0;

  return (
    <div className="flex gap-6 max-w-7xl mx-auto px-4 py-6">
      <main className="min-w-0 flex-1">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--brand-hi)]">
              Actividad
            </div>
            <h1 className="font-heading text-2xl font-bold text-[color:var(--fg)]">
              Notificaciones
            </h1>
          </div>
          {unreadCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-[color:var(--fg)] px-3 py-1 text-xs font-semibold text-[color:var(--bg)] shadow-sm">
              {unreadCount} sin leer
            </span>
          )}
        </div>

        {notifications && notifications.length > 0 ? (
          <NotificationList notifications={notifications} />
        ) : (
          <div className="py-20 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl product-card-custom">
              <Bell className="h-7 w-7 text-[color:var(--fg)]" />
            </div>
            <h2 className="mb-2 font-heading text-lg font-bold text-[color:var(--fg)]">
              Sin notificaciones
            </h2>
            <p className="text-sm text-[color:var(--fg-muted)]">
              Cuando tengas actividad, las notificaciones aparecerán aquí
            </p>
          </div>
        )}
      </main>

      <WeeklyAppointmentsWidget />
    </div>
  );
}
