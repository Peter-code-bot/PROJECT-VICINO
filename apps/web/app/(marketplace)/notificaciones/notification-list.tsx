"use client";

import { useTransition } from "react";
import { markAsRead, markAllAsRead } from "./actions";
import { formatRelativeTime } from "@vicino/shared";
import {
  MessageCircle,
  Handshake,
  Star,
  Award,
  AlertTriangle,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<string, typeof Bell> = {
  message: MessageCircle,
  sale_confirmation: Handshake,
  sale_completed: Handshake,
  review_reminder: Star,
  trust_upgrade: Award,
  dispute: AlertTriangle,
};

interface NotificationListProps {
  notifications: Array<{
    id: string;
    tipo: string;
    titulo: string;
    mensaje: string;
    leida: boolean;
    created_at: string;
  }>;
}

export function NotificationList({ notifications }: NotificationListProps) {
  const [isPending, startTransition] = useTransition();

  function handleMarkRead(id: string) {
    startTransition(async () => {
      await markAsRead(id);
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllAsRead();
    });
  }

  const hasUnread = notifications.some((n) => !n.leida);

  return (
    <div className="space-y-2">
      {hasUnread && (
        <button
          onClick={handleMarkAllRead}
          disabled={isPending}
          className="text-xs text-terracotta font-medium hover:underline mb-2 disabled:opacity-50"
        >
          Marcar todo como leído
        </button>
      )}

      {notifications.map((n) => {
        const Icon = TYPE_ICONS[n.tipo] ?? Bell;
        return (
          <button
            key={n.id}
            onClick={() => !n.leida && handleMarkRead(n.id)}
            disabled={isPending}
            className={cn(
              "w-full text-left flex items-start gap-3 rounded-xl p-4 transition-colors",
              n.leida
                ? "bg-transparent"
                : "bg-terracotta/5 dark:bg-terracotta/10 hover:bg-terracotta/10 dark:hover:bg-terracotta/15"
            )}
          >
            <div
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                n.leida
                  ? "bg-neutral-100 dark:bg-neutral-800 text-muted-foreground"
                  : "bg-terracotta/10 text-terracotta"
              )}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className={cn("text-sm", !n.leida && "font-semibold")}>{n.titulo}</p>
                {!n.leida && (
                  <span className="w-2 h-2 rounded-full bg-terracotta shrink-0" />
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{n.mensaje}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                {formatRelativeTime(n.created_at)}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
