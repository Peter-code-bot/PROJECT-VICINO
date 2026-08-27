"use client";

import { useState } from "react";
import { iconoDeCategoria } from "@/lib/categories/icons";
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
  Store,
  ShieldAlert,
  Settings,
  LogIn,
  Trophy,
  ChevronDown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";



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

  const productCategories = CATEGORIES.filter((c) => c.type === "producto" && !c.hidden_in_form);
  const serviceCategories = CATEGORIES.filter((c) => c.type === "servicio" && !c.hidden_in_form);
  const otherCategories = CATEGORIES.filter((c) => c.type === "otro" && !c.hidden_in_form);

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-[color:var(--sidebar-bg)] shadow-[inset_-1px_0_0_0_var(--border)] md:flex">
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
              : "text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)]"
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
              const Icon = iconoDeCategoria(cat.slug);
              return (
                <Link key={cat.slug} href={`/buscar?category=${cat.slug}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs text-[color:var(--fg)] transition-colors hover:bg-[color:var(--bg-elev-2)]">
                  <Icon className="h-3.5 w-3.5" />
                  {cat.name}
                </Link>
              );
            })}
            <p className="mt-2 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--brand-hi)]">Servicios</p>
            {serviceCategories.map((cat) => {
              const Icon = iconoDeCategoria(cat.slug);
              return (
                <Link key={cat.slug} href={`/buscar?category=${cat.slug}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs text-[color:var(--fg)] transition-colors hover:bg-[color:var(--bg-elev-2)]">
                  <Icon className="h-3.5 w-3.5" />
                  {cat.name}
                </Link>
              );
            })}
            {otherCategories.map((cat) => {
              const Icon = iconoDeCategoria(cat.slug);
              return (
                <Link key={cat.slug} href={`/buscar?category=${cat.slug}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs text-[color:var(--fg)] transition-colors hover:bg-[color:var(--bg-elev-2)]">
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
                  ? "category-tile-selected"
                  : "text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)]"
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
              // Conserva la pagina actual. Antes era "/login" pelado: quien
              // pulsaba desde una publicacion iniciaba sesion y aterrizaba en la
              // portada, sin la publicacion. Lo destapo la prueba E2E nueva.
              href={`/login?next=${encodeURIComponent(pathname)}`}
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
  // Sin sesion, estos items NO se apagan: llevan a identificarse y vuelven
  // aqui. Antes eran un <span> gris con un title, o sea un callejon sin
  // salida: la regla de producto que pidio Alejandro es que cualquier
  // interaccion mande a inicio de sesion o registro, y un texto que no se
  // puede pulsar no manda a ningun sitio. Las otras siete puertas del
  // middleware ya hacen exactamente esto.
  if (disabled) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(href)}`}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[color:var(--fg-dim)] transition-colors hover:bg-[color:var(--bg-elev-2)] hover:text-[color:var(--fg)]"
        title="Inicia sesión para usar esta función"
      >
        <Icon className="h-5 w-5" />
        {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "category-tile-selected font-semibold"
          : highlight
            ? "text-[color:var(--brand-hi)] hover:bg-[color:var(--brand-tint)]"
            : "text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)]"
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
