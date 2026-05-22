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
          className={`h-full w-full flex flex-col items-center justify-center gap-1 text-white text-xs font-semibold transition-[filter,background-color] duration-200 ${
            confirming
              ? "bg-[color:var(--danger)] brightness-90"
              : "bg-[color:var(--danger)] active:brightness-90"
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
          className={`relative flex items-center gap-4 overflow-hidden rounded-2xl p-4 transition-all duration-300 ${
            chat.unread > 0
              ? "bg-[color:var(--card)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong),var(--shadow-glow)]"
              : "bg-[color:var(--card)] shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
          }`}
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
      </motion.div>
    </div>
  );
}
