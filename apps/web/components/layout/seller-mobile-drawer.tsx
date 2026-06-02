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
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] md:hidden"
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
                className="ml-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--card-2)] text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:text-[color:var(--fg)]"
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
                      "relative flex items-center justify-between overflow-hidden rounded-xl px-4 py-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-[color:var(--brand-tint-strong)] font-semibold text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
                        : "text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)]"
                    )}
                  >
                    {active && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-md bg-[color:var(--brand)]" />
                    )}
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 shrink-0" />
                      {label}
                    </div>
                    {active && <ChevronRight className="h-4 w-4 opacity-60" />}
                  </Link>
                );
              })}

              <div className="my-3 h-px bg-[color:var(--border)]" />

              <Link
                href={SELLER_SETTINGS_ITEM.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors",
                  pathname.startsWith(SELLER_SETTINGS_ITEM.href)
                    ? "bg-[color:var(--brand-tint-strong)] font-semibold text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
                    : "text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)]"
                )}
              >
                <SELLER_SETTINGS_ITEM.icon className="h-5 w-5 shrink-0" />
                {SELLER_SETTINGS_ITEM.label}
              </Link>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
