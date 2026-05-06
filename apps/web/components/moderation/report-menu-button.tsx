"use client";

import { useState, useRef, useEffect } from "react";
import { MoreVertical, Flag, UserX, Loader2 } from "lucide-react";
import type { ReportTargetType } from "@vicino/shared";
import { ReportModal } from "./report-modal";
import { useBlockUser } from "@/lib/moderation/use-block-user";

interface ReportMenuButtonProps {
  targetType: ReportTargetType;
  targetId: string;
  targetLabel?: string;
  /** Si true, no se renderiza nada (oculta el botón en contenido propio). */
  hidden?: boolean;
  /** Para target_type='user': habilita "Bloquear usuario". */
  blockableUserId?: string;
  /** Callback opcional al bloquear. Útil para refrescar el feed. */
  onBlocked?: () => void;
  /** Tamaño del icono. Default 18. */
  iconSize?: number;
  /** Clase adicional para el botón disparador. */
  className?: string;
  /** Aria-label custom (default "Más opciones"). */
  ariaLabel?: string;
}

export function ReportMenuButton({
  targetType,
  targetId,
  targetLabel,
  hidden = false,
  blockableUserId,
  onBlocked,
  iconSize = 18,
  className = "",
  ariaLabel = "Más opciones",
}: ReportMenuButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const blockUser = useBlockUser();

  // Cerrar menú al click fuera o tecla Escape
  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  if (hidden) return null;

  const targetWord =
    targetType === "listing"
      ? "este producto"
      : targetType === "user"
        ? "usuario"
        : targetType === "message"
          ? "mensaje"
          : "reseña";

  function openReportModal() {
    setMenuOpen(false);
    setReportModalOpen(true);
  }

  async function handleBlock() {
    if (!blockableUserId || blocking) return;
    setMenuOpen(false);
    setBlocking(true);
    const ok = await blockUser(blockableUserId);
    setBlocking(false);
    if (ok && onBlocked) onBlocked();
  }

  return (
    <>
      <div ref={wrapperRef} className="relative inline-block">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`p-1.5 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${className}`}
          disabled={blocking}
        >
          {blocking ? (
            <Loader2 size={iconSize} className="animate-spin" aria-hidden="true" />
          ) : (
            <MoreVertical size={iconSize} aria-hidden="true" />
          )}
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-xl border border-border bg-card shadow-lg overflow-hidden"
          >
            <button
              type="button"
              role="menuitem"
              onClick={openReportModal}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted text-left"
            >
              <Flag size={14} aria-hidden="true" />
              Reportar {targetWord}
            </button>

            {targetType === "user" && blockableUserId && (
              <button
                type="button"
                role="menuitem"
                onClick={handleBlock}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 text-left border-t border-border/60"
              >
                <UserX size={14} aria-hidden="true" />
                Bloquear usuario
              </button>
            )}
          </div>
        )}
      </div>

      <ReportModal
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        targetType={targetType}
        targetId={targetId}
        targetLabel={targetLabel}
      />
    </>
  );
}
