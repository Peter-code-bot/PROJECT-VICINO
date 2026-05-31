"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";
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

  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Solo permitir touch o clic izquierdo
    if (e.button !== 0 && e.pointerType === "mouse") return;
    
    touchStartRef.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = setTimeout(async () => {
      try {
        const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
        await Haptics.impact({ style: ImpactStyle.Heavy });
      } catch {
        if ("vibrate" in navigator) navigator.vibrate(50);
      }
      setMenuOpen(true);
      setConfirming(false);
    }, 1500);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!touchStartRef.current || !longPressTimer.current) return;
      const dx = Math.abs(e.clientX - touchStartRef.current.x);
      const dy = Math.abs(e.clientY - touchStartRef.current.y);
      // Cancelar si se mueve mucho (scroll o swipe de pantalla)
      if (dx > 10 || dy > 10) {
        clearLongPress();
      }
    },
    [clearLongPress]
  );

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

  // Prevenir que un long-press active el enlace si el menú se acaba de abrir
  const handleLinkClick = (e: React.MouseEvent) => {
    if (menuOpen) {
      e.preventDefault();
    }
  };

  return (
    <DropdownMenu open={menuOpen} onOpenChange={(open) => {
      setMenuOpen(open);
      if (!open) setConfirming(false);
    }}>
      <DropdownMenuTrigger asChild>
        <div 
          className="relative overflow-hidden rounded-2xl cursor-pointer"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          // Previene el context menu nativo en dispositivos táctiles para que funcione el nuestro
          onContextMenu={(e) => {
            // TEMP type bridge (emergency build fix, not original author) -- pointerType
            // exists at runtime on React's synthetic event; @Javier confirm preferred typing.
            const pt = (e as unknown as React.PointerEvent).pointerType;
            if (pt === "touch" || !pt) e.preventDefault();
          }}
        >
          <Link
            href={`/chat/${chat.id}`}
            onClick={handleLinkClick}
            className={`relative flex items-center gap-4 overflow-hidden rounded-2xl p-4 transition-all duration-300 ${
              chat.unread > 0
                ? "bg-[color:var(--card)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong),var(--shadow-glow)]"
                : "bg-[color:var(--card)] shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            } ${menuOpen ? "scale-[0.98] opacity-90" : ""}`}
            draggable={false}
          >
            {chat.unread > 0 && (
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-[color:var(--brand)]" />
            )}

            <div className="relative shrink-0">
              <UserAvatar
                src={chat.otherUser?.foto}
                name={chat.otherUser?.nombre ?? "?"}
                size="lg"
                className="shadow-[0_0_0_2px_var(--card)]"
              />
              {chat.unread > 0 && (
                <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[color:var(--brand)] px-1 text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--card)]">
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
                      : "font-medium text-[color:var(--fg)] group-hover:text-[color:var(--brand-hi)]"
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
        </div>
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
  );
}

