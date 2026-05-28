"use client";

import { useState } from "react";
import Link from "next/link";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { usePathname, useRouter } from "next/navigation";
import { CATEGORIES } from "@vicino/shared";
import { cn } from "@/lib/utils";
import { useChatUnread } from "@/components/layout/chat-unread-provider";
import { useNotificationUnread } from "@/components/layout/notification-unread-provider";
import {
  Home,
  Search,
  Grid3X3,
  PlusCircle,
  MessageCircle,
  Heart,
  Calendar,
  Bell,
  User,
  Store,
  ShieldAlert,
  Settings,
  LogIn,
  Trophy,
  ChevronDown,
  ChevronRight,
  UtensilsCrossed,
  Shirt,
  Smartphone,
  Sparkles,
  HeartPulse,
  Dumbbell,
  PawPrint,
  Baby,
  Car,
  BookOpen,
  Gamepad2,
  Palette,
  Armchair,
  Wrench,
  GraduationCap,
  PartyPopper,
  Truck,
  Code,
  Stethoscope,
  Camera,
  Building,
  Briefcase,
  MoreHorizontal,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  comida: UtensilsCrossed, ropa: Shirt, tecnologia: Smartphone, hogar: Home,
  belleza: Sparkles, salud: HeartPulse, deportes: Dumbbell, mascotas: PawPrint,
  bebes: Baby, vehiculos: Car, libros: BookOpen, juguetes: Gamepad2,
  "proveedores-mayoreo": Warehouse,
  arte: Palette, muebles: Armchair, "servicios-hogar": Wrench,
  educacion: GraduationCap, eventos: PartyPopper, transporte: Truck,
  "diseno-tech": Code, "salud-terapias": Stethoscope, fotografia: Camera,
  inmuebles: Building, empleos: Briefcase, otros: MoreHorizontal,
};

interface SidebarProps {
  user: { id: string } | null;
  profile: {
    nombre: string;
    foto: string | null;
    es_vendedor: boolean;
  } | null;
  isAdmin: boolean;
}

export function Sidebar({ user, profile, isAdmin }: SidebarProps) {
  const unreadChatMessages = useChatUnread();
  const { count: unreadNotifications } = useNotificationUnread();
  const pathname = usePathname();
  const router = useRouter();
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname.startsWith(href);

  const productCategories = CATEGORIES.filter((c) => c.type === "producto");
  const serviceCategories = CATEGORIES.filter((c) => c.type === "servicio");
  const otherCategories = CATEGORIES.filter((c) => c.type === "otro");

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-[color:var(--bg-elev-1)] shadow-[inset_-1px_0_0_0_var(--border)] md:flex">
      {/* Logo */}
      <div className="px-5 py-5 shadow-[inset_0_-1px_0_0_var(--border)]">
        <Link href="/" className="group flex items-center gap-2.5">
          <div className="flex flex-col leading-none">
            <span className="font-heading text-2xl font-bold tracking-tight text-[color:var(--fg)]">VICINO</span>
            <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[color:var(--fg-dim)]">
              Confianza Local
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {/* Main nav */}
        <NavItem href="/" icon={Home} label="Inicio" active={isActive("/", true)} />
        <NavItem href="/buscar" icon={Search} label="Buscar" active={isActive("/buscar")} />
        <NavItem href="/rankings" icon={Trophy} label="Rankings" active={isActive("/rankings")} />

        {/* Categories expandable */}
        <button
          onClick={() => setCategoriesOpen(!categoriesOpen)}
          className={cn(
            "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
            categoriesOpen
              ? "bg-[color:var(--bg-elev-2)] text-[color:var(--fg)]"
              : "text-[color:var(--fg-muted)] hover:bg-[color:var(--bg-elev-2)] hover:text-[color:var(--fg)]"
          )}
        >
          <span className="flex items-center gap-3">
            <Grid3X3 className="h-5 w-5" />
            Categorías
          </span>
          {categoriesOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {categoriesOpen && (
          <div className="ml-4 pl-4 border-l border-border/30 space-y-0.5 py-1">
            <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--brand-hi)]">Productos</p>
            {productCategories.map((cat) => {
              const Icon = CATEGORY_ICON_MAP[cat.slug] ?? MoreHorizontal;
              return (
                <Link key={cat.slug} href={`/buscar?category=${cat.slug}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs text-[color:var(--fg-muted)] transition-colors hover:bg-[color:var(--bg-elev-2)] hover:text-[color:var(--fg)]">
                  <Icon className="h-3.5 w-3.5" />
                  {cat.name}
                </Link>
              );
            })}
            <p className="mt-2 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--brand-hi)]">Servicios</p>
            {serviceCategories.map((cat) => {
              const Icon = CATEGORY_ICON_MAP[cat.slug] ?? MoreHorizontal;
              return (
                <Link key={cat.slug} href={`/buscar?category=${cat.slug}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs text-[color:var(--fg-muted)] transition-colors hover:bg-[color:var(--bg-elev-2)] hover:text-[color:var(--fg)]">
                  <Icon className="h-3.5 w-3.5" />
                  {cat.name}
                </Link>
              );
            })}
            {otherCategories.map((cat) => {
              const Icon = CATEGORY_ICON_MAP[cat.slug] ?? MoreHorizontal;
              return (
                <Link key={cat.slug} href={`/buscar?category=${cat.slug}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs text-[color:var(--fg-muted)] transition-colors hover:bg-[color:var(--bg-elev-2)] hover:text-[color:var(--fg)]">
                  <Icon className="h-3.5 w-3.5" />
                  {cat.name}
                </Link>
              );
            })}
          </div>
        )}

        <div className="my-2 h-px bg-[color:var(--border)]" />

        {/* Auth-required items */}
        {user ? (
          <>
            {profile?.es_vendedor && (
              <NavItem href="/vender" icon={PlusCircle} label="Vender" active={isActive("/vender")} highlight />
            )}
            <NavItem href="/chat" icon={MessageCircle} label="Chat" active={isActive("/chat")} badge={unreadChatMessages} />
            <NavItem href="/favoritos" icon={Heart} label="Favoritos" active={isActive("/favoritos")} />
            <NavItem href="/citas" icon={Calendar} label="Mis citas" active={isActive("/citas")} />
            <NavItem href="/notificaciones" icon={Bell} label="Notificaciones" active={isActive("/notificaciones")} badge={unreadNotifications} />

            <div className="my-2 h-px bg-[color:var(--border)]" />

            {/* Profile */}
            <Link
              href="/perfil"
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive("/perfil")
                  ? "bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
                  : "text-[color:var(--fg-muted)] hover:bg-[color:var(--bg-elev-2)] hover:text-[color:var(--fg)]"
              )}
            >
              <UserAvatar src={profile?.foto} name={profile?.nombre ?? "?"} size="xs" />
              <span className="truncate">{profile?.nombre || "Mi Perfil"}</span>
            </Link>

            {profile?.es_vendedor && (
              <NavItem href="/seller" icon={Store} label="Mi Tienda" active={isActive("/seller")} />
            )}
            {isAdmin && (
              <NavItem href="/admin" icon={ShieldAlert} label="Admin" active={isActive("/admin")} />
            )}

            <div className="my-2 h-px bg-[color:var(--border)]" />

            <ThemeToggle />

            <NavItem href="/configuracion" icon={Settings} label="Configuración" active={isActive("/configuracion")} />
          </>
        ) : (
          <>
            <NavItem href="/vender" icon={PlusCircle} label="Vender" active={false} disabled />
            <NavItem href="/chat" icon={MessageCircle} label="Chat" active={false} disabled />
            <NavItem href="/favoritos" icon={Heart} label="Favoritos" active={false} disabled />

            <div className="my-2 h-px bg-[color:var(--border)]" />

            <Link
              href="/login"
              className="inline-flex items-center gap-3 rounded-xl bg-[color:var(--brand)] px-3 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)]"
            >
              <LogIn className="h-5 w-5" />
              Iniciar sesión
            </Link>
          </>
        )}
      </nav>
    </aside>
  );
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
  highlight,
  badge,
  disabled,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  highlight?: boolean;
  badge?: number;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[color:var(--fg-dim)]" title="Inicia sesión para usar esta función">
        <Icon className="h-5 w-5" />
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-[color:var(--brand-tint-strong)] font-semibold text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
          : highlight
            ? "text-[color:var(--brand-hi)] hover:bg-[color:var(--brand-tint)]"
            : "text-[color:var(--fg-muted)] hover:bg-[color:var(--bg-elev-2)] hover:text-[color:var(--fg)]"
      )}
    >
      <Icon className="h-5 w-5" />
      {label}
      {badge && badge > 0 ? (
        <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-[color:var(--brand)] px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--bg-elev-1)]">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}
