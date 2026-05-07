"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatRelativeTime } from "@vicino/shared";
import { hideChat } from "./actions";

interface ChatItemCardProps {
  chat: {
    id: string;
    updated_at: string;
    otherUser: { id: string; nombre: string; foto: string | null } | null;
    unread: number;
    productoTitulo: string | null;
  };
}

export function ChatItemCard({ chat }: ChatItemCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!confirming) {
      setConfirming(true);
      return;
    }

    setDeleting(true);
    const result = await hideChat(chat.id);
    if (result.error) {
      console.error(result.error);
      setDeleting(false);
      setConfirming(false);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="relative group">
      <Link
        href={`/chat/${chat.id}`}
        className={`flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 relative overflow-hidden ${
          chat.unread > 0
            ? "bg-card border-primary/30 shadow-md"
            : "bg-card border-border/40 hover:border-primary/20 hover:shadow-sm"
        }`}
      >
        {chat.unread > 0 && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
        )}

        <UserAvatar
          src={chat.otherUser?.foto}
          name={chat.otherUser?.nombre ?? "?"}
          size="lg"
          className={chat.unread > 0 ? "border-2 border-primary/20" : "border-2 border-background"}
        />

        <div className="flex-1 min-w-0 pr-10">
          <div className="flex items-center justify-between mb-1">
            <span
              className={`font-semibold text-base truncate transition-colors ${
                chat.unread > 0 ? "text-foreground" : "group-hover:text-primary"
              }`}
            >
              {chat.otherUser?.nombre ?? "Usuario"}
            </span>
            <span
              className={`text-xs whitespace-nowrap ml-2 ${
                chat.unread > 0 ? "text-primary font-semibold" : "text-muted-foreground"
              }`}
            >
              {formatRelativeTime(chat.updated_at)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {chat.productoTitulo ? (
              <p
                className={`text-sm truncate ${
                  chat.unread > 0 ? "font-medium text-foreground/90" : "text-muted-foreground"
                }`}
              >
                {chat.productoTitulo}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">Chat general</p>
            )}
          </div>
        </div>

        {chat.unread > 0 && (
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs font-bold shrink-0 shadow-sm shadow-primary/20">
            {chat.unread}
          </div>
        )}
      </Link>

      {/* Botón eliminar con doble confirmación */}
      <button
        onClick={handleDelete}
        onBlur={() => setConfirming(false)}
        disabled={deleting}
        className={`absolute right-3 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
          confirming
            ? "bg-red-600 text-white shadow-md"
            : "opacity-0 group-hover:opacity-100 bg-muted hover:bg-red-100 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600"
        } ${deleting ? "opacity-50 pointer-events-none" : ""}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {confirming && <span>¿Seguro?</span>}
      </button>
    </div>
  );
}
