"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import {
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
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

const DELETE_BTN_WIDTH = 80;
const SNAP_THRESHOLD = 40;
const VELOCITY_THRESHOLD = 300;

export function ChatItemCard({ chat }: ChatItemCardProps) {
  const [swiped, setSwiped] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  // Ref to the draggable div for imperative touch-action management
  const cardRef = useRef<HTMLDivElement>(null);

  const x = useMotionValue(0);
  const deleteOpacity = useTransform(x, [-DELETE_BTN_WIDTH, -20, 0], [1, 0.5, 0]);

  const onDragEnd = useCallback((_: unknown, info: PanInfo) => {
    // Restore touch-action so vertical scroll works again after the gesture
    if (cardRef.current) cardRef.current.style.touchAction = "";

    const shouldOpen =
      info.offset.x < -SNAP_THRESHOLD ||
      info.velocity.x < -VELOCITY_THRESHOLD;

    if (shouldOpen) {
      setSwiped(true);
      setConfirming(false);
    } else {
      setSwiped(false);
      setConfirming(false);
    }
  }, []);

  const handleCardTap = useCallback(() => {
    if (swiped) {
      setSwiped(false);
      setConfirming(false);
    }
  }, [swiped]);

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
    <div className="relative overflow-hidden rounded-2xl" data-no-page-swipe>
      {/* ── Delete button (behind the card) ──────────────── */}
      {/* Fix P2: pointerEvents:none when not swiped — invisible AND unclickable on desktop */}
      <motion.div
        className="absolute right-0 inset-y-0 flex items-center justify-center"
        style={{
          width: DELETE_BTN_WIDTH,
          opacity: deleteOpacity,
          pointerEvents: swiped ? "auto" : "none",
        }}
      >
        <button
          onClick={handleDelete}
          disabled={deleting}
          className={`h-full w-full flex flex-col items-center justify-center gap-1 text-white text-xs font-semibold transition-colors duration-200 ${
            confirming
              ? "bg-red-700"
              : "bg-red-600 active:bg-red-700"
          } ${deleting ? "opacity-50 pointer-events-none" : ""}`}
        >
          <Trash2 className="h-5 w-5" />
          <span>{deleting ? "..." : confirming ? "¿Seguro?" : "Eliminar"}</span>
        </button>
      </motion.div>

      {/* ── Draggable chat card ──────────────────────────── */}
      {/* Fix P1: removed touch-pan-y class; touch-action managed imperatively via ref
          so the browser doesn't intercept horizontal gestures before framer-motion */}
      <motion.div
        ref={cardRef}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -DELETE_BTN_WIDTH, right: 0 }}
        dragElastic={{ left: 0.15, right: 0 }}
        onDragEnd={onDragEnd}
        animate={{ x: swiped ? -DELETE_BTN_WIDTH : 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 400 }}
        style={{ x }}
        className="relative z-[1]"
        onTap={handleCardTap}
        onPointerDown={(e) => {
          // Stop event from bubbling to PageSwipeWrapper's drag handler
          e.stopPropagation();
          // Override browser touch-action so framer-motion owns this gesture.
          // Restored in onPointerUp/Cancel/DragEnd so vertical scroll resumes.
          if (cardRef.current) cardRef.current.style.touchAction = "none";
        }}
        onPointerUp={() => {
          if (cardRef.current) cardRef.current.style.touchAction = "";
        }}
        onPointerCancel={() => {
          if (cardRef.current) cardRef.current.style.touchAction = "";
        }}
      >
        <Link
          href={`/chat/${chat.id}`}
          onClick={(e) => {
            // Prevent navigation when the card is swiped open
            if (swiped) e.preventDefault();
          }}
          className={`flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 relative overflow-hidden ${
            chat.unread > 0
              ? "bg-card border-primary/30 shadow-md"
              : "bg-card border-border/40 hover:border-primary/20 hover:shadow-sm"
          }`}
          draggable={false}
        >
          {chat.unread > 0 && (
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
          )}

          <div className="relative shrink-0">
            <UserAvatar
              src={chat.otherUser?.foto}
              name={chat.otherUser?.nombre ?? "?"}
              size="lg"
              className="border-2 border-background"
            />
            {chat.unread > 0 && (
              <span className="absolute -bottom-0.5 -right-0.5 min-w-[18px] h-[18px] bg-primary text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none shadow-sm">
                {chat.unread > 99 ? "99+" : chat.unread}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span
                className={`text-base truncate transition-colors ${
                  chat.unread > 0
                    ? "font-semibold text-foreground"
                    : "font-medium group-hover:text-primary"
                }`}
              >
                {chat.otherUser?.nombre ?? "Usuario"}
              </span>
              <span className="text-xs whitespace-nowrap ml-2 text-muted-foreground">
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

        </Link>
      </motion.div>
    </div>
  );
}
