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
    <nav className="flex flex-col gap-1.5">
      {SELLER_NAV_ITEMS.map((item) => {
        const { href, label, icon: Icon } = item;
        const active = isSellerNavItemActive(item, pathname);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "group relative flex items-center justify-between overflow-hidden rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200",
              active
                ? "bg-[color:var(--fg)] font-semibold text-[color:var(--bg)] shadow-sm"
                : "text-[color:var(--fg-muted)] hover:bg-[color:var(--sidebar-bg)] hover:text-[color:var(--fg)]"
            )}
          >
            <div className="flex items-center gap-3">
              <Icon className="h-4 w-4 transition-transform group-hover:scale-110" />
              {label}
            </div>
            {active && <ChevronRight className="h-4 w-4 opacity-60" />}
          </Link>
        );
      })}
      <div className="mt-4 pt-4 shadow-[inset_0_1px_0_0_var(--border)]">
        <Link
          href={SELLER_SETTINGS_ITEM.href}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
            pathname.startsWith(SELLER_SETTINGS_ITEM.href)
              ? "bg-[color:var(--fg)] font-semibold text-[color:var(--bg)] shadow-sm"
              : "text-[color:var(--fg-muted)] hover:bg-[color:var(--sidebar-bg)] hover:text-[color:var(--fg)]"
          )}
        >
          <SELLER_SETTINGS_ITEM.icon className="h-4 w-4" />
          {SELLER_SETTINGS_ITEM.label}
        </Link>
      </div>
    </nav>
  );
}
