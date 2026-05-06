"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
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

  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  return (
    <>
      {/* Hamburger trigger — mobile only */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden w-10 h-10 rounded-xl hover:bg-muted active:bg-muted flex items-center justify-center transition-colors"
        aria-label="Abrir menú de tienda"
      >
        <Menu className="w-5 h-5 text-foreground" />
      </button>

      {/* Drawer + backdrop */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 animate-fade-in"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-[85vw] max-w-sm bg-background border-r border-border flex flex-col animate-slide-in-left">
            {/* Header */}
            <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border">
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-foreground truncate">{storeName}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Resumen de tu actividad y métricas de ventas
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center shrink-0 ml-2"
                aria-label="Cerrar menú"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Nav items */}
            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
              {SELLER_NAV_ITEMS.map((item) => {
                const { href, label, icon: Icon } = item;
                const active = isSellerNavItemActive(item, pathname);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "relative flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-colors overflow-hidden",
                      active
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-foreground hover:bg-muted"
                    )}
                  >
                    {active && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-md" />
                    )}
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 shrink-0" />
                      {label}
                    </div>
                    {active && <ChevronRight className="h-4 w-4 opacity-50" />}
                  </Link>
                );
              })}

              <div className="my-3 h-px bg-border/40" />

              <Link
                href={SELLER_SETTINGS_ITEM.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors",
                  pathname.startsWith(SELLER_SETTINGS_ITEM.href)
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-foreground hover:bg-muted"
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
