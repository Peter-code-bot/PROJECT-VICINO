"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

type Side = "bottom" | "right";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  side?: Side;
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  zIndex?: number;
}

const PANEL_BY_SIDE: Record<Side, string> = {
  bottom:
    "left-0 right-0 bottom-0 max-h-[85vh] rounded-t-[var(--r-lg)] border-t border-border",
  right:
    "right-0 top-0 bottom-0 w-[min(480px,92vw)] border-l border-border",
};

const ENTER_BY_SIDE: Record<Side, { hidden: string; visible: string }> = {
  bottom: {
    hidden: "translate-y-full",
    visible: "translate-y-0",
  },
  right: {
    hidden: "translate-x-full",
    visible: "translate-x-0",
  },
};

export function BottomSheet({
  open,
  onClose,
  title,
  side = "bottom",
  ariaLabel,
  children,
  className,
  zIndex = 50,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useBodyScrollLock(mounted);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    setEntered(false);
    const timeout = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    closeButtonRef.current?.focus();
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  const enter = ENTER_BY_SIDE[side];

  return (
    <div className="fixed inset-0" style={{ zIndex }}>
      <button
        type="button"
        aria-label="Cerrar"
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          "absolute inset-0 cursor-default bg-black/60 transition-opacity duration-200",
          entered ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title ?? "Hoja modal"}
        className={cn(
          "absolute flex flex-col bg-background shadow-[var(--shadow-lg)] transition-transform duration-200 ease-out",
          PANEL_BY_SIDE[side],
          entered ? enter.visible : enter.hidden,
          className,
        )}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h2 className="flex-1 font-display text-base font-semibold text-fg">
            {title ?? ""}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:bg-card-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          className={cn(
            "flex-1 overflow-y-auto px-4 py-4",
            side === "bottom" && "pb-[calc(env(safe-area-inset-bottom)_+_1.5rem)]",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
