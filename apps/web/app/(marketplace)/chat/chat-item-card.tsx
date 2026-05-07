"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const pointerStartPos = useRef<{ x: number; y: number } | null>(null);

  // ── Long-press detection ──────────────────────────────────
  const LONG_PRESS_MS = 500;
  const MOVE_THRESHOLD = 10; // px — cancel if finger moves too much (scrolling)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (menuOpen) return;
      didLongPress.current = false;
      pointerStartPos.current = { x: e.clientX, y: e.clientY };

      timerRef.current = setTimeout(() => {
        didLongPress.current = true;
        setMenuOpen(true);
        // Haptic feedback on supported devices
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate(50);
        }
      }, LONG_PRESS_MS);
    },
    [menuOpen],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointerStartPos.current || !timerRef.current) return;
      const dx = e.clientX - pointerStartPos.current.x;
      const dy = e.clientY - pointerStartPos.current.y;
      if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
        clearTimer();
      }
    },
    [clearTimer],
  );

  const onPointerUp = useCallback(() => {
    clearTimer();
    pointerStartPos.current = null;
  }, [clearTimer]);

  const handleCardClick = useCallback(() => {
    // If long-press just triggered, don't navigate
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    router.push(`/chat/${chat.id}`);
  }, [chat.id, router]);

  // ── Delete flow ───────────────────────────────────────────
  async function handleDelete() {
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

  function closeMenu() {
    setMenuOpen(false);
    setConfirming(false);
    setDeleting(false);
  }

  // ── Prevent native context menu on long-press ─────────────
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return (
    <>
      {/* ── Chat card ─────────────────────────────────────── */}
      <div
        role="link"
        tabIndex={0}
        onClick={handleCardClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        onContextMenu={onContextMenu}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(`/chat/${chat.id}`);
        }}
        className={`flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 relative overflow-hidden cursor-pointer select-none ${
          chat.unread > 0
            ? "bg-card border-primary/30 shadow-md"
            : "bg-card border-border/40 hover:border-primary/20 hover:shadow-sm"
        } ${menuOpen ? "scale-[0.97] ring-2 ring-primary/30" : ""}`}
        style={{ WebkitTouchCallout: "none", touchAction: "pan-y" }}
      >
        {chat.unread > 0 && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
        )}

        <UserAvatar
          src={chat.otherUser?.foto}
          name={chat.otherUser?.nombre ?? "?"}
          size="lg"
          className={
            chat.unread > 0
              ? "border-2 border-primary/20"
              : "border-2 border-background"
          }
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span
              className={`font-semibold text-base truncate transition-colors ${
                chat.unread > 0 ? "text-foreground" : "hover:text-primary"
              }`}
            >
              {chat.otherUser?.nombre ?? "Usuario"}
            </span>
            <span
              className={`text-xs whitespace-nowrap ml-2 ${
                chat.unread > 0
                  ? "text-primary font-semibold"
                  : "text-muted-foreground"
              }`}
            >
              {formatRelativeTime(chat.updated_at)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {chat.productoTitulo ? (
              <p
                className={`text-sm truncate ${
                  chat.unread > 0
                    ? "font-medium text-foreground/90"
                    : "text-muted-foreground"
                }`}
              >
                {chat.productoTitulo}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">
                Chat general
              </p>
            )}
          </div>
        </div>

        {chat.unread > 0 && (
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs font-bold shrink-0 shadow-sm shadow-primary/20">
            {chat.unread}
          </div>
        )}
      </div>

      {/* ── iOS-style context menu ────────────────────────── */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-50 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={closeMenu}
            />

            {/* Menu card */}
            <motion.div
              className="relative z-10 w-72 rounded-2xl bg-card border border-border/60 shadow-2xl overflow-hidden"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{
                scale: 1,
                opacity: 1,
                transition: { type: "spring", damping: 25, stiffness: 350 },
              }}
              exit={{
                scale: 0.9,
                opacity: 0,
                transition: { duration: 0.15, ease: "easeOut" },
              }}
            >
              {/* Header — who the chat is with */}
              <div className="px-4 py-3 border-b border-border/40">
                <div className="flex items-center gap-3">
                  <UserAvatar
                    src={chat.otherUser?.foto}
                    name={chat.otherUser?.nombre ?? "?"}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {chat.otherUser?.nombre ?? "Usuario"}
                    </p>
                    {chat.productoTitulo && (
                      <p className="text-xs text-muted-foreground truncate">
                        {chat.productoTitulo}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="p-1.5">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                    confirming
                      ? "bg-red-600 text-white"
                      : "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  } ${deleting ? "opacity-50 pointer-events-none" : ""}`}
                >
                  <Trash2 className="h-4 w-4 shrink-0" />
                  <span>
                    {deleting
                      ? "Eliminando..."
                      : confirming
                        ? "¿Seguro? Pulsa para confirmar"
                        : "Eliminar chat"}
                  </span>
                </button>

                <button
                  onClick={closeMenu}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4 shrink-0" />
                  <span>Cancelar</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
