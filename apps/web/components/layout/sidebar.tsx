"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES } from "@vicino/shared";
import { cn } from "@/lib/utils";
import {
  Home,
  Search,
  Grid3X3,
  PlusCircle,
  MessageCircle,
  Heart,
  Bell,
  User,
  Store,
  ShieldAlert,
  LogOut,
  LogIn,
  ChevronDown,
  ChevronRight,
  MapPin,
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
  type LucideIcon,
} from "lucide-react";

const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  comida: UtensilsCrossed, ropa: Shirt, tecnologia: Smartphone, hogar: Home,
  belleza: Sparkles, salud: HeartPulse, deportes: Dumbbell, mascotas: PawPrint,
  bebes: Baby, vehiculos: Car, libros: BookOpen, juguetes: Gamepad2,
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
  unreadNotifications: number;
}

export function Sidebar({ user, profile, isAdmin, unreadNotifications }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname.startsWith(href);

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const productCategories = CATEGORIES.filter((c) => c.type === "producto");
  const serviceCategories = CATEGORIES.filter((c) => c.type === "servicio");
  const otherCategories = CATEGORIES.filter((c) => c.type === "otro");

  return (
    <aside className="hidden md:flex flex-col w-64 h-screen sticky top-0 bg-white dark:bg-neutral-900 border-r border-border/40 overflow-y-auto shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border/20">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-terracotta flex items-center justify-center shadow-sm">
            <MapPin className="w-4.5 h-4.5 text-white" />
          </div>
          <span className="font-heading font-bold text-lg">VICINO</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {/* Main nav */}
        <NavItem href="/" icon={Home} label="Inicio" active={isActive("/", true)} />
        <NavItem href="/buscar" icon={Search} label="Buscar" active={isActive("/buscar")} />

        {/* Categories expandable */}
        <button
          onClick={() => setCategoriesOpen(!categoriesOpen)}
          className={cn(
            "flex items-center justify-between w-full rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
            categoriesOpen
              ? "bg-neutral-100 dark:bg-neutral-800 text-foreground"
              : "text-muted-foreground hover:bg-neutral-50 dark:hover:bg-neutral-800/50 hover:text-foreground"
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
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-3 py-1">Productos</p>
            {productCategories.map((cat) => {
              const Icon = CATEGORY_ICON_MAP[cat.slug] ?? MoreHorizontal;
              return (
                <Link key={cat.slug} href={`/buscar?category=${cat.slug}`}
                  className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-neutral-50 dark:hover:bg-neutral-800/50 rounded-lg transition-colors">
                  <Icon className="h-3.5 w-3.5" />
                  {cat.name}
                </Link>
              );
            })}
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-3 py-1 mt-2">Servicios</p>
            {serviceCategories.map((cat) => {
              const Icon = CATEGORY_ICON_MAP[cat.slug] ?? MoreHorizontal;
              return (
                <Link key={cat.slug} href={`/buscar?category=${cat.slug}`}
                  className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-neutral-50 dark:hover:bg-neutral-800/50 rounded-lg transition-colors">
                  <Icon className="h-3.5 w-3.5" />
                  {cat.name}
                </Link>
              );
            })}
            {otherCategories.map((cat) => {
              const Icon = CATEGORY_ICON_MAP[cat.slug] ?? MoreHorizontal;
              return (
                <Link key={cat.slug} href={`/buscar?category=${cat.slug}`}
                  className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-neutral-50 dark:hover:bg-neutral-800/50 rounded-lg transition-colors">
                  <Icon className="h-3.5 w-3.5" />
                  {cat.name}
                </Link>
              );
            })}
          </div>
        )}

        <div className="h-px bg-border/30 my-2" />

        {/* Auth-required items */}
        {user ? (
          <>
            <NavItem href="/vender" icon={PlusCircle} label="Vender" active={isActive("/vender")} highlight />
            <NavItem href="/chat" icon={MessageCircle} label="Chat" active={isActive("/chat")} />
            <NavItem href="/favoritos" icon={Heart} label="Favoritos" active={isActive("/favoritos")} />
            <NavItem href="/notificaciones" icon={Bell} label="Notificaciones" active={isActive("/notificaciones")} badge={unreadNotifications} />

            <div className="h-px bg-border/30 my-2" />

            {/* Profile */}
            <Link
              href="/perfil"
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive("/perfil")
                  ? "bg-terracotta/10 text-terracotta"
                  : "text-muted-foreground hover:bg-neutral-50 dark:hover:bg-neutral-800/50 hover:text-foreground"
              )}
            >
              <div className="w-6 h-6 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden shrink-0">
                {profile?.foto ? (
                  <Image src={profile.foto} alt="" width={24} height={24} className="object-cover w-full h-full" />
                ) : (
                  <User className="w-full h-full p-1 text-muted-foreground" />
                )}
              </div>
              <span className="truncate">{profile?.nombre || "Mi Perfil"}</span>
            </Link>

            {profile?.es_vendedor && (
              <NavItem href="/seller" icon={Store} label="Mi Tienda" active={isActive("/seller")} />
            )}
            {isAdmin && (
              <NavItem href="/admin" icon={ShieldAlert} label="Admin" active={isActive("/admin")} />
            )}

            <div className="h-px bg-border/30 my-2" />

            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50"
            >
              <LogOut className="h-5 w-5" />
              {loggingOut ? "Cerrando..." : "Cerrar sesión"}
            </button>
          </>
        ) : (
          <>
            <NavItem href="/vender" icon={PlusCircle} label="Vender" active={false} disabled />
            <NavItem href="/chat" icon={MessageCircle} label="Chat" active={false} disabled />
            <NavItem href="/favoritos" icon={Heart} label="Favoritos" active={false} disabled />

            <div className="h-px bg-border/30 my-2" />

            <Link
              href="/login"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold bg-terracotta text-white hover:bg-terracotta/90 transition-colors"
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
      <span className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground/40 cursor-not-allowed" title="Inicia sesión para usar esta función">
        <Icon className="h-5 w-5" />
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors relative",
        active
          ? "bg-terracotta/10 text-terracotta font-semibold"
          : highlight
            ? "text-terracotta hover:bg-terracotta/5"
            : "text-muted-foreground hover:bg-neutral-50 dark:hover:bg-neutral-800/50 hover:text-foreground"
      )}
    >
      <Icon className="h-5 w-5" />
      {label}
      {badge && badge > 0 ? (
        <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}
