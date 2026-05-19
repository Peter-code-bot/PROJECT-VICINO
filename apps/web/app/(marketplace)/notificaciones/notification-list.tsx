"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAsRead, markAllAsRead } from "./actions";
import { formatRelativeTime } from "@vicino/shared";
import {
  MessageCircle,
  Handshake,
  Star,
  Award,
  AlertTriangle,
  Bell,
  ChevronRight,
  CalendarCheck,
  Calendar,
  BellRing,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TipoConfig {
  icon: typeof Bell;
  iconBg: string;
  iconColor: string;
  tag: string | null;
  tagBg?: string;
  tagColor?: string;
  accent: boolean;
}

const TIPO_CONFIG: Record<string, TipoConfig> = {
  cita_agendada: {
    icon: CalendarCheck,
    iconBg: "bg-primary/15",
    iconColor: "text-primary",
    tag: "Cita",
    tagBg: "bg-primary/15",
    tagColor: "text-primary",
    accent: true,
  },
  recordatorio_cita_1d: {
    icon: Calendar,
    iconBg: "bg-primary/15",
    iconColor: "text-primary",
    tag: "Recordatorio",
    tagBg: "bg-primary/15",
    tagColor: "text-primary",
    accent: true,
  },
  recordatorio_cita_1h: {
    icon: BellRing,
    iconBg: "bg-primary/15",
    iconColor: "text-primary",
    tag: "En 1 hora",
    tagBg: "bg-primary/15",
    tagColor: "text-primary",
    accent: true,
  },
  message: {
    icon: MessageCircle,
    iconBg: "bg-muted",
    iconColor: "text-muted-foreground",
    tag: null,
    accent: false,
  },
  sale_confirmation: {
    icon: Handshake,
    iconBg: "bg-muted",
    iconColor: "text-muted-foreground",
    tag: null,
    accent: false,
  },
  sale_completed: {
    icon: Handshake,
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-500",
    tag: null,
    accent: false,
  },
  review_reminder: {
    icon: Star,
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-500",
    tag: null,
    accent: false,
  },
  trust_upgrade: {
    icon: Award,
    iconBg: "bg-muted",
    iconColor: "text-muted-foreground",
    tag: null,
    accent: false,
  },
  dispute: {
    icon: AlertTriangle,
    iconBg: "bg-destructive/15",
    iconColor: "text-destructive",
    tag: null,
    accent: false,
  },
};

function getNotificationHref(tipo: string, data: Record<string, unknown>): string | null {
  switch (tipo) {
    case "cita_agendada":
    case "recordatorio_cita_1d":
    case "recordatorio_cita_1h":
      return data.appointment_id ? `/citas/${data.appointment_id}` : "/citas";
    case "message":
      return data.chat_id ? `/chat/${data.chat_id}` : "/chat";
    case "sale_confirmation":
      return data.chat_id ? `/chat/${data.chat_id}` : "/chat";
    case "sale_completed":
      return "/historial";
    case "review_reminder":
      return "/seller/reviews";
    case "trust_upgrade":
      return "/perfil";
    case "dispute":
      return "/historial";
    default:
      return null;
  }
}

interface NotificationListProps {
  notifications: Array<{
    id: string;
    tipo: string;
    titulo: string;
    mensaje: string;
    leida: boolean;
    created_at: string;
    data: Record<string, unknown>;
  }>;
}

export function NotificationList({ notifications }: NotificationListProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick(n: NotificationListProps["notifications"][number]) {
    const href = getNotificationHref(n.tipo, n.data ?? {});
    startTransition(async () => {
      if (!n.leida) await markAsRead(n.id);
      if (href) router.push(href);
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
          className="text-xs text-primary font-medium hover:underline mb-2 disabled:opacity-50"
        >
          Marcar todo como leído
        </button>
      )}

      {notifications.map((n) => {
        const config = TIPO_CONFIG[n.tipo] ?? TIPO_CONFIG.message!;
        const Icon = config.icon;
        const href = getNotificationHref(n.tipo, n.data ?? {});

        return (
          <button
            key={n.id}
            onClick={() => handleClick(n)}
            disabled={isPending}
            className={cn(
              "w-full text-left flex items-start gap-3 rounded-xl p-4 transition-colors cursor-pointer border",
              n.leida
                ? "bg-transparent hover:bg-muted/50 border-transparent"
                : "bg-primary/5 dark:bg-primary/10 hover:bg-primary/10 dark:hover:bg-primary/15 border-transparent",
              config.accent && "border-primary/30",
            )}
          >
            <div
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                config.iconBg,
                config.iconColor,
              )}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <p className={cn("text-sm", !n.leida && "font-semibold")}>{n.titulo}</p>
                {config.tag && (
                  <span
                    className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold",
                      config.tagBg,
                      config.tagColor,
                    )}
                  >
                    {config.tag}
                  </span>
                )}
                {!n.leida && (
                  <span className="w-2 h-2 rounded-full bg-primary shrink-0" aria-label="No leída" />
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{n.mensaje}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                {formatRelativeTime(n.created_at)}
              </p>
            </div>
            {href && (
              <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />
            )}
          </button>
        );
      })}
    </div>
  );
}
