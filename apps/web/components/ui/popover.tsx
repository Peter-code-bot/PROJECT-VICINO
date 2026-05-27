"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type PopoverCtx = {
  open: boolean;
  setOpen: (next: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
};

const Ctx = createContext<PopoverCtx | null>(null);

function usePopover() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Popover children must be inside <Popover>");
  return ctx;
}

interface PopoverProps {
  children: ReactNode;
  defaultOpen?: boolean;
}

export function Popover({ children, defaultOpen = false }: PopoverProps) {
  const [open, setOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const value = useMemo<PopoverCtx>(
    () => ({ open, setOpen, triggerRef, contentRef }),
    [open],
  );

  return (
    <Ctx.Provider value={value}>
      <div className="relative inline-block">{children}</div>
    </Ctx.Provider>
  );
}

interface PopoverTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function PopoverTrigger({
  children,
  onClick,
  className,
  ...rest
}: PopoverTriggerProps) {
  const { open, setOpen, triggerRef } = usePopover();
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-expanded={open}
      aria-haspopup="dialog"
      className={className}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) setOpen(!open);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

interface PopoverContentProps extends HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end" | "center";
  sideOffset?: number;
  children: ReactNode;
}

export function PopoverContent({
  align = "start",
  sideOffset = 8,
  className,
  children,
  ...rest
}: PopoverContentProps) {
  const { open, setOpen, contentRef, triggerRef } = usePopover();

  const handleOutside = useCallback(
    (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (contentRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    },
    [contentRef, triggerRef, setOpen],
  );

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    },
    [setOpen],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, handleOutside, handleKey]);

  if (!open) return null;

  const alignClass =
    align === "end"
      ? "right-0"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "left-0";

  return (
    <div
      ref={contentRef}
      role="dialog"
      style={{ marginTop: sideOffset }}
      className={cn(
        "absolute top-full z-50 min-w-[10rem] rounded-xl border border-border bg-popover text-popover-foreground p-1 shadow-[var(--shadow-md)] animate-scale-in",
        alignClass,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
