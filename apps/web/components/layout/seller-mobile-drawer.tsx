"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import {
  SELLER_NAV_ITEMS,
  SELLER_SETTINGS_ITEM,
  isSellerNavItemActive,
} from "./seller-sidebar";

interface SellerMobileDrawerProps {
  storeName: string;
}

export function SellerMobileDrawer({ storeName }: SellerMobileDrawerProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer when route changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional drawer-close-on-route-change; setOpen runs on navigation pathname change, not on render
    setOpen(false);
  }, [pathname]);

  useBodyScrollLock(open);

  // A4 sub-fase 4.2 (codex follow-up): Escape listener para el smart back
  // button del APK (dispatch sintetico cuando data-modal-open="true").
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      {/* Hamburger trigger — mobile only */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-card text-foreground transition-colors hover:bg-[color:var(--bg-elev-2)] md:hidden"
        aria-label="Abrir menú de tienda"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Drawer + backdrop */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" data-modal-open="true">
          <div
            className="absolute inset-0 animate-fade-in bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-0 left-0 top-0 flex w-[85vw] max-w-sm animate-slide-in-left flex-col bg-[color:var(--bg-elev-1)] shadow-[inset_-1px_0_0_0_var(--border)]">
            {/* Header */}
            <div className="flex items-start justify-between px-5 pb-4 pt-5 shadow-[inset_0_-1px_0_0_var(--border)]">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold text-[color:var(--fg)]">{storeName}</h2>
                <p className="mt-0.5 text-xs text-[color:var(--fg-muted)]">
                  Resumen de tu actividad y métricas de ventas
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="ml-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--card-2)] text-[color:var(--fg-muted)] transition-colors hover:text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)]"
                aria-label="Cerrar menú"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Nav items */}
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {SELLER_NAV_ITEMS.map((item) => {
                const { href, label, icon: Icon } = item;
                const active = isSellerNavItemActive(item, pathname);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "relative flex items-center justify-between overflow-hidden rounded-full px-5 py-3 text-sm font-medium transition-all duration-200",
                      active
                        ? "bg-gradient-to-r from-[#EAF5EF] to-[#DDF0E6] dark:from-emerald-950/50 dark:to-emerald-900/30 shadow-[0_6px_20px_rgba(46,135,115,0.25),0_2px_4px_rgba(0,0,0,0.06)] text-foreground font-semibold"
                        : "text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)]"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={cn("h-5 w-5 shrink-0", active ? "text-emerald-700 dark:text-emerald-400" : "text-foreground")} />
                      <span className={cn(active ? "text-foreground font-semibold" : "")}>{label}</span>
                    </div>
                    {active && <ChevronRight className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />}
                  </Link>
                );
              })}

              <div className="my-3 h-px bg-[color:var(--border)]" />

              <Link
                href={SELLER_SETTINGS_ITEM.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-full px-5 py-3 text-sm font-medium transition-all duration-200",
                  pathname.startsWith(SELLER_SETTINGS_ITEM.href)
                    ? "bg-gradient-to-r from-[#EAF5EF] to-[#DDF0E6] dark:from-emerald-950/50 dark:to-emerald-900/30 shadow-[0_6px_20px_rgba(46,135,115,0.25),0_2px_4px_rgba(0,0,0,0.06)] text-foreground font-semibold"
                    : "text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)]"
                )}
              >
                <SELLER_SETTINGS_ITEM.icon
                  className={cn(
                    "h-5 w-5 shrink-0",
                    pathname.startsWith(SELLER_SETTINGS_ITEM.href)
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-foreground"
                  )}
                />
                <span>{SELLER_SETTINGS_ITEM.label}</span>
              </Link>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
