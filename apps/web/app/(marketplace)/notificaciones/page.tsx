import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime } from "@vicino/shared";
import { NotificationList } from "./notification-list";
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
    .order("created_at", { ascending: false })
    .limit(50);

  const unreadCount = notifications?.filter((n) => !n.leida).length ?? 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
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
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <Bell className="w-8 h-8 text-neutral-300" />
          </div>
          <h2 className="font-heading font-bold text-lg mb-2">Sin notificaciones</h2>
          <p className="text-sm text-muted-foreground">
            Cuando tengas actividad, las notificaciones aparecerán aquí
          </p>
        </div>
      )}
    </div>
  );
}
