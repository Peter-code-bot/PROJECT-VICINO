"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Package,
  Handshake,
  Star,
  BarChart3,
  ShieldCheck,
  Tag,
  Settings,
  ChevronRight,
  MoreHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/seller", label: "Resumen", icon: LayoutDashboard, exact: true },
  { href: "/seller/listings", label: "Publicaciones", icon: Package },
  { href: "/seller/ventas", label: "Ventas", icon: Handshake },
  { href: "/seller/reviews", label: "Reseñas", icon: Star },
  { href: "/seller/analytics", label: "Estadísticas", icon: BarChart3 },
  { href: "/seller/verificacion", label: "Verificación", icon: ShieldCheck },
  { href: "/seller/cupones", label: "Cupones", icon: Tag },
] as const;

const MOBILE_PRIMARY = NAV_ITEMS.slice(0, 4); // Resumen, Publicaciones, Ventas, Reseñas
const MOBILE_MORE = [
  ...NAV_ITEMS.slice(4), // Estadísticas, Verificación, Cupones
  { href: "/configuracion", label: "Configuración", icon: Settings },
] as const;

export function SellerSidebar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const moreHasActive = MOBILE_MORE.some((item) =>
    "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href)
  );

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex flex-col gap-1.5">
        {NAV_ITEMS.map((item) => {
          const { href, label, icon: Icon } = item;
          const exact = "exact" in item ? item.exact : false;
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group relative flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 overflow-hidden",
                active
                  ? "bg-primary/10 dark:bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {active && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-md" />
              )}
              <div className="flex items-center gap-3">
                <Icon className={cn("h-4 w-4 transition-transform group-hover:scale-110", active && "fill-primary/10")} />
                {label}
              </div>
              {active && (
                <ChevronRight className="h-4 w-4 opacity-50" />
              )}
            </Link>
          );
        })}
        <div className="mt-4 pt-4 border-t border-border/40">
          <Link
            href="/configuracion"
            className={cn(
              "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
              isActive("/configuracion")
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Settings className="h-4 w-4" />
            Configuración
          </Link>
        </div>
      </nav>

      {/* Mobile bottom tabs */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border/40 px-2 pb-safe">
        <div className="flex justify-around">
          {MOBILE_PRIMARY.map((item) => {
            const { href, label, icon: Icon } = item;
            const exact = "exact" in item ? item.exact : false;
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 px-1 min-w-[56px]",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{label}</span>
              </Link>
            );
          })}
          {/* "Más" button */}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 px-1 min-w-[56px]",
              moreHasActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="text-[10px] font-medium">Más</span>
          </button>
        </div>
      </nav>

      {/* "Más" bottom sheet */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-card rounded-t-2xl border-t border-border animate-slide-in-bottom pb-safe">
            {/* Handle + header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <h3 className="text-sm font-semibold text-foreground">Más opciones</h3>
              <button
                onClick={() => setMoreOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            {/* Items */}
            <div className="px-3 pb-4 space-y-0.5">
              {MOBILE_MORE.map((item) => {
                const { href, label, icon: Icon } = item;
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                    {active && <ChevronRight className="h-4 w-4 ml-auto opacity-50" />}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
