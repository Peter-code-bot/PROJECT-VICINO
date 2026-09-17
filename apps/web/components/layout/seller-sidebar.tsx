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
  // Cupones se esconde del panel, NO se borra.
  //
  // La tabla `coupons` tiene 0 filas (consultado el 5-sep-2026), asi que no hay
  // nada que migrar ni nadie a quien avisar: esconder la entrada hoy no le
  // quita a ningun vendedor un cupon que ya estuviera usando.
  //
  // Se esconde solo el punto de entrada y a proposito: la ruta /seller/cupones,
  // sus server actions y la tabla siguen exactamente donde estaban, y el
  // detalle de producto sigue leyendo y pintando cupones si algun dia hay
  // filas. Volver a encenderlo es descomentar esta linea y su icono `Tag` en el
  // import de arriba — no reconstruir la feature.
  // { href: "/seller/cupones", label: "Cupones", icon: Tag },
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
              "group relative flex items-center justify-between overflow-hidden rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-200",
              active
                ? "bg-gradient-to-r from-[#EAF5EF] to-[#DDF0E6] dark:from-emerald-950/50 dark:to-emerald-900/30 shadow-[0_4px_14px_rgba(46,135,115,0.18)] text-foreground font-semibold"
                : "text-[color:var(--fg-muted)] hover:bg-[color:var(--sidebar-bg)] hover:text-[color:var(--fg)]"
            )}
          >
            <div className="flex items-center gap-3">
              <Icon className={cn("h-4 w-4 transition-transform group-hover:scale-110", active ? "text-emerald-700 dark:text-emerald-400" : "")} />
              {label}
            </div>
            {active && <ChevronRight className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />}
          </Link>
        );
      })}
      <div className="mt-4 pt-4 shadow-[inset_0_1px_0_0_var(--border)]">
        <Link
          href={SELLER_SETTINGS_ITEM.href}
          className={cn(
            "flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-200",
            pathname.startsWith(SELLER_SETTINGS_ITEM.href)
              ? "bg-gradient-to-r from-[#EAF5EF] to-[#DDF0E6] dark:from-emerald-950/50 dark:to-emerald-900/30 shadow-[0_4px_14px_rgba(46,135,115,0.18)] text-foreground font-semibold"
              : "text-[color:var(--fg-muted)] hover:bg-[color:var(--sidebar-bg)] hover:text-[color:var(--fg)]"
          )}
        >
          <SELLER_SETTINGS_ITEM.icon
            className={cn(
              "h-4 w-4",
              pathname.startsWith(SELLER_SETTINGS_ITEM.href) ? "text-emerald-700 dark:text-emerald-400" : ""
            )}
          />
          {SELLER_SETTINGS_ITEM.label}
        </Link>
      </div>
    </nav>
  );
}
