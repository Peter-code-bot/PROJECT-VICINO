"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, ShieldCheck, AlertTriangle, Flag, Settings, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin", label: "Panel", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Usuarios", icon: Users },
  { href: "/admin/verifications", label: "Verificaciones", icon: ShieldCheck },
  { href: "/admin/disputes", label: "Disputas", icon: AlertTriangle },
  { href: "/admin/moderation", label: "Moderación", icon: Flag },
] as const;

export function AdminSidebar() {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS;

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden flex-col gap-1.5 md:flex">
        {visibleItems.map((item) => {
          const { href, label, icon: Icon } = item;
          const exact = "exact" in item ? item.exact : false;
          const isActive = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group relative flex items-center justify-between overflow-hidden rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-[color:var(--brand-tint-strong)] font-semibold text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
                  : "text-[color:var(--fg-muted)] hover:bg-[color:var(--bg-elev-2)] hover:text-[color:var(--fg)]"
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-md bg-[color:var(--brand)]" />
              )}
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 transition-transform group-hover:scale-110" />
                {label}
              </div>
              {isActive && (
                <ChevronRight className="h-4 w-4 opacity-60" />
              )}
            </Link>
          );
        })}
        <div className="mt-4 pt-4 shadow-[inset_0_1px_0_0_var(--border)]">
          <Link
            href="/configuracion"
            className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-[color:var(--fg-muted)] transition-colors hover:bg-[color:var(--bg-elev-2)] hover:text-[color:var(--fg)]"
          >
            <Settings className="h-4 w-4" />
            Configuración
          </Link>
        </div>
      </nav>

      {/* Mobile bottom tabs */}
      <nav className="pb-safe fixed bottom-0 left-0 right-0 z-50 bg-[color:var(--bg-elev-1)] px-2 shadow-[inset_0_1px_0_0_var(--border)] md:hidden">
        <div className="flex justify-around">
          {visibleItems.map((item) => {
            const { href, label, icon: Icon } = item;
            const exact = "exact" in item ? item.exact : false;
            const isActive = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex min-w-[56px] flex-col items-center gap-0.5 px-1 py-2 transition-colors",
                  isActive
                    ? "text-[color:var(--brand-hi)]"
                    : "text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
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
