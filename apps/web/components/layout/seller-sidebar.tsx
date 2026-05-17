"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SellerNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

export const SELLER_NAV_ITEMS: readonly SellerNavItem[] = [
  { href: "/seller", label: "Resumen", icon: LayoutDashboard, exact: true },
  { href: "/seller/listings", label: "Publicaciones", icon: Package },
  { href: "/seller/ventas", label: "Ventas", icon: Handshake },
  { href: "/seller/reviews", label: "Reseñas", icon: Star },
  { href: "/seller/analytics", label: "Estadísticas", icon: BarChart3 },
  { href: "/seller/verificacion", label: "Verificación", icon: ShieldCheck },
  { href: "/seller/cupones", label: "Cupones", icon: Tag },
] as const;

export const SELLER_SETTINGS_ITEM: SellerNavItem = {
  href: "/configuracion",
  label: "Configuración",
  icon: Settings,
};

export function isSellerNavItemActive(item: SellerNavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function SellerSidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex flex-col gap-1.5">
        {NAV_ITEMS.map((item) => {
          const { href, label, icon: Icon } = item;
          const exact = "exact" in item ? item.exact : false;
          const isActive = exact
            ? pathname === href
            : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group relative flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 overflow-hidden",
                isActive
                  ? "bg-brand-50 dark:bg-brand/10 text-brand font-semibold"
                  : "text-muted-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-foreground"
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand rounded-r-md" />
              )}
              <div className="flex items-center gap-3">
                <Icon className={cn("h-4 w-4 transition-transform group-hover:scale-110", isActive && "fill-brand/10")} />
                {label}
              </div>
              {isActive && (
                <ChevronRight className="h-4 w-4 opacity-50" />
              )}
            </Link>
          );
        })}
        <div className="mt-4 pt-4 border-t border-border/40">
          <LogoutButton variant="sidebar" />
        </div>
      </nav>

      {/* Mobile bottom tabs */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-neutral-900 border-t border-border/40 px-2 pb-safe">
        <div className="flex justify-around">
          {NAV_ITEMS.slice(0, 5).map((item) => {
            const { href, label, icon: Icon } = item;
            const exact = "exact" in item ? item.exact : false;
            const isActive = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 px-1 min-w-[56px]",
                  isActive ? "text-brand" : "text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
