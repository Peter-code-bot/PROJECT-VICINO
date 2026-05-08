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
    .not("tipo", "in", '("message","sale_confirmation")')
    .order("created_at", { ascending: false })
    .limit(50);

  const unreadCount = notifications?.filter((n) => !n.leida).length ?? 0;

  return (
    <div className="flex gap-6 max-w-7xl mx-auto px-4 py-6">
      <main className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-heading font-bold">Notificaciones</h1>
          {unreadCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {unreadCount} sin leer
            </span>
          )}
        </div>

        {notifications && notifications.length > 0 ? (
          <NotificationList notifications={notifications} />
        ) : (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted flex items-center justify-center">
              <Bell className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="font-heading font-bold text-lg mb-2">Sin notificaciones</h2>
            <p className="text-sm text-muted-foreground">
              Cuando tengas actividad, las notificaciones aparecerán aquí
            </p>
          </div>
        )}
      </main>

      <WeeklyAppointmentsWidget />
    </div>
  );
}
