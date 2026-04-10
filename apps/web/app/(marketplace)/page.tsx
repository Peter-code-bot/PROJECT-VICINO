import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProductCard } from "@/components/product/product-card";
import { LocationBar } from "@/components/shared/location-bar";
import { CATEGORIES } from "@vicino/shared";
import type { TrustLevel } from "@vicino/shared";
import {
  UtensilsCrossed,
  Shirt,
  Laptop,
  Home,
  Sparkles,
  Heart,
  GraduationCap,
  Car,
  PartyPopper,
  PawPrint,
  Briefcase,
  MoreHorizontal,
  ArrowRight,
  ShieldCheck,
  MapPin,
  Search,
  type LucideIcon,
} from "lucide-react";

/* ─── Category icon mapping ─────────────────────────────── */

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  comida: UtensilsCrossed,
  ropa: Shirt,
  tecnologia: Laptop,
  hogar: Home,
  belleza: Sparkles,
  salud: Heart,
  educacion: GraduationCap,
  transporte: Car,
  eventos: PartyPopper,
  mascotas: PawPrint,
  "servicios-profesionales": Briefcase,
  otros: MoreHorizontal,
};

const CATEGORY_COLORS: Record<string, string> = {
  comida: "#C45B3F",
  ropa: "#D4A853",
  tecnologia: "#4A90D9",
  hogar: "#2D8F6F",
  belleza: "#E8983E",
  salud: "#DC4545",
  educacion: "#6366F1",
  transporte: "#57534E",
  eventos: "#EF4444",
  mascotas: "#F59E0B",
  "servicios-profesionales": "#78716C",
  otros: "#A8A29E",
};

export default async function HomePage() {
  const supabase = await createClient();

  const { data: products } = await supabase
    .from("products_services")
    .select(
      `
      id,
      titulo,
      precio,
      imagen_principal,
      categoria,
      slug,
      creador_id,
      profiles!inner(nombre, trust_level, average_rating_as_seller, reviews_count_as_seller)
    `
    )
    .eq("estatus", "disponible")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="min-h-screen">
      {/* ─── HERO SECTION (mini — app-style, not landing) ─── */}
      <section className="relative py-6 px-4">
        {/* Subtle background accent */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-terracotta/5 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-48 h-48 rounded-full bg-emerald-trust/5 blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto">
          {/* Welcome + Search */}
          <div className="mb-6">
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin className="w-3.5 h-3.5 text-terracotta" />
              <span className="text-xs text-muted-foreground font-medium">
                Tu zona
              </span>
            </div>
            <h1 className="font-heading font-bold text-2xl sm:text-3xl mb-4">
              Descubre lo mejor{" "}
              <span className="text-terracotta">cerca de ti</span>
            </h1>

            {/* Search Bar */}
            <Link
              href="/buscar"
              className="flex items-center gap-3 w-full rounded-2xl bg-white dark:bg-neutral-900 border border-border/40 px-4 py-3 shadow-sm hover:shadow-md hover:border-terracotta/20 transition-all duration-200"
              id="home-search"
            >
              <Search className="h-5 w-5 text-terracotta/50" />
              <span className="text-sm text-muted-foreground">
                ¿Qué estás buscando?
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ─── CERCA DE TI (geo island) ───────────────────────── */}
      <section className="px-4 pb-6">
        <div className="max-w-7xl mx-auto">
          <LocationBar />
        </div>
      </section>

      {/* ─── CATEGORIES ─────────────────────────────────────── */}
      <section className="px-4 pb-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-semibold text-lg">Categorías</h2>
            <Link
              href="/buscar"
              className="text-xs font-medium text-terracotta hover:text-terracotta-dark flex items-center gap-1 group transition-colors"
              id="home-see-all-categories"
            >
              Ver todas
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4">
            {CATEGORIES.map((cat) => {
              const IconComponent = CATEGORY_ICONS[cat.slug] || MoreHorizontal;
              const color = CATEGORY_COLORS[cat.slug] || "#A8A29E";

              return (
                <Link
                  key={cat.id}
                  href={`/buscar?category=${cat.slug}`}
                  className="flex flex-col items-center gap-1.5 min-w-[72px] text-center group"
                  id={`cat-${cat.slug}`}
                >
                  <div
                    className="flex items-center justify-center w-14 h-14 rounded-2xl transition-all duration-200 group-hover:scale-110 group-hover:-translate-y-0.5 group-hover:shadow-md"
                    style={{ backgroundColor: `${color}14` }}
                  >
                    <IconComponent
                      className="w-6 h-6 transition-colors"
                      style={{ color }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground font-medium group-hover:text-foreground transition-colors">
                    {cat.name}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── TRUST BANNER ───────────────────────────────────── */}
      <section className="px-4 pb-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-trust/5 dark:bg-emerald-trust/10 border border-emerald-trust/10">
            <div className="w-9 h-9 rounded-xl bg-emerald-trust/15 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-trust" />
            </div>
            <div>
              <p className="text-sm font-semibold">Vendedores verificados</p>
              <p className="text-xs text-muted-foreground">
                Todos los vendedores confirman su identidad antes de vender
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── PRODUCTS GRID ──────────────────────────────────── */}
      <section className="px-4 pb-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading font-semibold text-lg">
              Recientes
            </h2>
            <Link
              href="/buscar"
              className="text-xs font-medium text-terracotta hover:text-terracotta-dark flex items-center gap-1 group transition-colors"
              id="home-see-all-products"
            >
              Ver más
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>

          {products && products.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 stagger">
              {products.map((product) => {
                const profile = Array.isArray(product.profiles)
                  ? product.profiles[0]
                  : product.profiles;
                return (
                  <ProductCard
                    key={product.id}
                    id={product.id}
                    titulo={product.titulo}
                    precio={Number(product.precio)}
                    imagen={product.imagen_principal}
                    categoria={product.categoria}
                    slug={product.slug ?? product.id}
                    vendedor={{
                      nombre: profile?.nombre ?? "Vendedor",
                      trust_level:
                        (profile?.trust_level as TrustLevel) ?? "nuevo",
                    }}
                    rating={Number(profile?.average_rating_as_seller ?? 0)}
                    reviewsCount={Number(
                      profile?.reviews_count_as_seller ?? 0
                    )}
                  />
                );
              })}
            </div>
          ) : (
            /* ─── EMPTY STATE ─────────────────────────────── */
            <div className="text-center py-20 px-4">
              <div className="max-w-sm mx-auto">
                {/* Decorative illustration */}
                <div className="relative w-24 h-24 mx-auto mb-6">
                  <div className="absolute inset-0 rounded-3xl bg-terracotta/8 rotate-6" />
                  <div className="absolute inset-0 rounded-3xl bg-terracotta/5 -rotate-3" />
                  <div className="relative w-24 h-24 rounded-3xl bg-terracotta-50 dark:bg-terracotta/10 flex items-center justify-center">
                    <span className="text-4xl">🏪</span>
                  </div>
                </div>

                <h3 className="font-heading font-bold text-xl mb-2">
                  Bienvenido a VICINO
                </h3>
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                  Tu mercado de confianza. Aún no hay productos publicados.
                  ¡Sé el primero en vender!
                </p>

                <Link
                  href="/vender"
                  className="inline-flex items-center gap-2 rounded-xl bg-terracotta hover:bg-terracotta-dark text-white font-semibold px-6 py-3 transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.97]"
                  id="cta-publish"
                >
                  Publicar producto
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
