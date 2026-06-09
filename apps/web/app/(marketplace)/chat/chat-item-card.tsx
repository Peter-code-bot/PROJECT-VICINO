"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2, MoreVertical } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatRelativeTime } from "@vicino/shared";
import { hideChat } from "./actions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

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
  const [menuOpen, setMenuOpen] = useState(false);
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
      setMenuOpen(false);
      router.refresh();
    }
  }

  const handleMenuClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(true);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl group">
      <Link
        href={`/chat/${chat.id}`}
        className={`relative flex items-center gap-4 overflow-hidden rounded-2xl p-4 pr-12 transition-all duration-300 ${
          chat.unread > 0
            ? "bg-[color:var(--sidebar-bg)] shadow-sm"
            : "bg-[color:var(--sidebar-bg)] hover:opacity-90"
        } ${menuOpen ? "scale-[0.98] opacity-90" : ""}`}
        draggable={false}
      >
        {chat.unread > 0 && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-white" />
        )}

        <div className="relative shrink-0">
          <UserAvatar
            src={chat.otherUser?.foto}
            name={chat.otherUser?.nombre ?? "?"}
            size="lg"
            className="shadow-[0_0_0_2px_#121212]"
          />
          {chat.unread > 0 && (
            <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold leading-none text-black shadow-[0_0_0_2px_#121212]">
              {chat.unread > 99 ? "99+" : chat.unread}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between">
            <span
              className={`truncate text-base transition-colors ${
                chat.unread > 0
                  ? "font-semibold text-[color:var(--fg)]"
                  : "font-medium text-[color:var(--fg)] group-hover:opacity-70"
              }`}
            >
              {chat.otherUser?.nombre ?? "Usuario"}
            </span>
            <span className="ml-2 whitespace-nowrap text-xs text-[color:var(--fg-dim)]">
              {formatRelativeTime(chat.updated_at)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {chat.productoTitulo ? (
              <p
                className={`truncate text-sm ${
                  chat.unread > 0
                    ? "font-medium text-[color:var(--fg)]"
                    : "text-[color:var(--fg-muted)]"
                }`}
              >
                {chat.productoTitulo}
              </p>
            ) : (
              <p className="text-sm italic text-[color:var(--fg-dim)]">
                Chat general
              </p>
            )}
          </div>
        </div>
      </Link>

      <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">
        <DropdownMenu open={menuOpen} onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) setConfirming(false);
        }}>
          <DropdownMenuTrigger asChild>
            <button
              onClick={handleMenuClick}
              className="flex h-10 w-10 items-center justify-center rounded-full text-[color:var(--fg-muted)] transition-colors hover:bg-black/5 hover:text-[color:var(--fg)] dark:hover:bg-white/10"
              aria-label="Opciones del chat"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 p-2 rounded-xl">
            <DropdownMenuItem
              onClick={handleDelete}
              disabled={deleting}
              className={`flex items-center gap-2 px-3 py-3 rounded-lg font-medium transition-colors ${
                confirming
                  ? "bg-[color:var(--danger)] text-white focus:bg-[color:var(--danger)] focus:text-white"
                  : "text-[color:var(--danger)] focus:bg-red-50 focus:text-[color:var(--danger)] dark:focus:bg-red-950/30"
              } ${deleting ? "opacity-50" : "cursor-pointer"}`}
            >
              <Trash2 className="h-4 w-4" />
              <span>{deleting ? "Eliminando..." : confirming ? "¿Estás seguro?" : "Eliminar chat"}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
