import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProductCarousel } from "@/components/home/product-carousel";
import { CATEGORIES } from "@vicino/shared";
import {
  UtensilsCrossed,
  Shirt,
  Smartphone,
  Home,
  Sparkles,
  HeartPulse,
  GraduationCap,
  Car,
  PartyPopper,
  PawPrint,
  Briefcase,
  MoreHorizontal,
  ArrowRight,
  MapPin,
  Search,
  Dumbbell,
  Baby,
  BookOpen,
  Gamepad2,
  Palette,
  Armchair,
  Wrench,
  Truck,
  Code,
  Stethoscope,
  Camera,
  Building,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

/* ─── Category icon mapping ─────────────────────────────── */

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  comida: UtensilsCrossed,
  ropa: Shirt,
  tecnologia: Smartphone,
  hogar: Home,
  belleza: Sparkles,
  salud: HeartPulse,
  deportes: Dumbbell,
  mascotas: PawPrint,
  bebes: Baby,
  vehiculos: Car,
  libros: BookOpen,
  juguetes: Gamepad2,
  arte: Palette,
  muebles: Armchair,
  "servicios-hogar": Wrench,
  educacion: GraduationCap,
  eventos: PartyPopper,
  transporte: Truck,
  "diseno-tech": Code,
  "salud-terapias": Stethoscope,
  fotografia: Camera,
  inmuebles: Building,
  "proveedores-mayoreo": Warehouse,
  empleos: Briefcase,
  otros: MoreHorizontal,
};

export default async function HomePage() {
  const supabase = await createClient();

  // Phase 9: fetch the viewer's seller status so the empty-state "Publicar
  // producto" CTA is hidden for non-sellers (clicking it would otherwise just
  // bounce off the middleware to /perfil/editar).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let viewerIsVendedor = false;
  if (user) {
    const { data: viewerProfile } = await supabase
      .from("profiles")
      .select("es_vendedor")
      .eq("id", user.id)
      .single();
    viewerIsVendedor = viewerProfile?.es_vendedor ?? false;
  }

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
      created_at,
      profiles!inner(nombre, trust_level, average_rating, reviews_count)
    `
    )
    .eq("estatus", "disponible")
    .order("created_at", { ascending: false })
    .limit(150);

  const all = products ?? [];

  const byCategory = all.reduce<Record<string, typeof all>>((acc, p) => {
    if (!p.categoria) return acc;
    (acc[p.categoria] ??= []).push(p);
    return acc;
  }, {});

  const categoryCarousels = Object.entries(byCategory)
    .filter(([, ps]) => ps.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15);

  return (
    <div className="w-full min-w-0 min-h-screen">
      {/* ─── HERO SECTION (mini — app-style, not landing) ─── */}
      <section className="py-6 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Welcome + Search */}
          <div className="mb-6">
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs text-muted-foreground font-medium">
                Tu zona
              </span>
            </div>
            <h1 className="font-heading font-bold text-2xl sm:text-3xl mb-4">
              Descubre lo mejor{" "}
              <span className="text-primary">cerca de ti</span>
            </h1>

            {/* Search Bar */}
            <Link
              href="/buscar"
              className="flex items-center gap-3 w-full rounded-2xl bg-card border border-border/40 px-4 py-3 shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-200"
              id="home-search"
            >
              <Search className="h-5 w-5 text-primary/50" />
              <span className="text-sm text-muted-foreground">
                ¿Qué estás buscando?
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ─── CATEGORIES ─────────────────────────────────────── */}
      <section className="px-4 pb-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading font-semibold text-lg">Categorías</h2>
            <Link
              href="/buscar"
              className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 group transition-colors"
              id="home-see-all-categories"
            >
              Ver todas
              <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2 py-3 -my-3 scrollbar-hide -mx-4 px-4">
            {CATEGORIES.map((cat) => {
              const IconComponent = CATEGORY_ICONS[cat.slug] || MoreHorizontal;

              return (
                <Link
                  key={cat.id}
                  href={`/buscar?category=${cat.slug}`}
                  className="flex flex-col items-center gap-1.5 min-w-[72px] text-center group"
                  id={`cat-${cat.slug}`}
                >
                  <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-muted transition-all duration-200 group-hover:scale-110 group-hover:-translate-y-0.5 group-hover:shadow-md group-hover:bg-accent">
                    <IconComponent className="w-6 h-6 text-foreground/70" />
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

      {/* ─── PRODUCT CAROUSELS ──────────────────────────────── */}
      {all.length > 0 ? (
        <div className="space-y-8 px-4 pb-8">
          {/* Recientes */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-heading font-semibold text-lg">Recientes</h2>
              <Link
                href="/buscar"
                className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 group transition-colors"
                id="home-see-all-products"
              >
                Ver más
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>
            <ProductCarousel products={all.slice(0, 20)} />
          </section>

          {/* Per-category carousels */}
          {categoryCarousels.map(([slug, ps]) => {
            const label = CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
            return (
              <section key={slug}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-heading font-semibold text-lg">{label}</h2>
                  <Link
                    href={`/buscar?category=${slug}`}
                    className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 group transition-colors"
                  >
                    Ver más
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
                <ProductCarousel products={ps.slice(0, 20)} />
              </section>
            );
          })}
        </div>
      ) : (
        /* ─── EMPTY STATE ─────────────────────────────── */
        <section className="px-4 pb-8">
          <div className="text-center py-20 px-4">
            <div className="max-w-sm mx-auto">
              <div className="relative w-24 h-24 mx-auto mb-6">
                <div className="absolute inset-0 rounded-3xl bg-primary/8 rotate-6" />
                <div className="absolute inset-0 rounded-3xl bg-primary/5 -rotate-3" />
                <div className="relative w-24 h-24 rounded-3xl bg-primary/10 dark:bg-primary/10 flex items-center justify-center">
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
              {viewerIsVendedor && (
                <Link
                  href="/vender"
                  className="inline-flex items-center gap-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 py-3 transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.97]"
                  id="cta-publish"
                >
                  Publicar producto
                  <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
