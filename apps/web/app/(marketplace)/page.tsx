import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProductCarousel } from "@/components/home/product-carousel";
import { RankingsHomeStripSection } from "@/components/rankings/rankings-home-strip";
import { LocationBar } from "@/components/shared/location-bar";
import { ZoneCard } from "@/components/home/zone-card";
import { CATEGORIES, TrustLevel } from "@vicino/shared";
import { HomeTabs } from "@/components/home/home-tabs";
import { FollowingRail, FollowedStore } from "@/components/home/following-rail";
import { StorePost } from "@/components/home/store-post";
import { FollowButton } from "@/components/shared/follow-button";
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
  Heart,
  Store,
  type LucideIcon,
} from "lucide-react";

export const dynamic = "force-dynamic";

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

interface Props {
  searchParams: Promise<{ feed?: string }>;
}

export default async function HomePage({ searchParams }: Props) {
  const { feed: feedParam } = await searchParams;
  const feed = feedParam === "following" ? "following" : "parati";

  const supabase = await createClient();

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

  // Fetch "Para ti" data
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
      precio_negociable,
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

  // Fetch "Siguiendo" data
  let followingPosts: any[] = [];
  let followedStoresData: FollowedStore[] = [];
  let noFollows = false;
  let nearbyStores: any[] = [];

  if (feed === "following" && user) {
    const { data: follows } = await supabase
      .from("store_follows")
      .select("store_id, profiles!store_id(id, nombre, foto)")
      .eq("follower_id", user.id);
      
    if (!follows || follows.length === 0) {
      noFollows = true;
      // Fetch some suggestions
      const { data: suggestions } = await supabase
        .from("profiles")
        .select("id, nombre, foto, trust_level")
        .eq("es_vendedor", true)
        .limit(3);
      nearbyStores = suggestions ?? [];
    } else {
      const storeIds = follows.map((f) => f.store_id);
      
      const { data: posts } = await supabase
        .from("products_services")
        .select(`
          id,
          creador_id,
          titulo,
          precio,
          imagen_principal,
          categoria,
          slug,
          created_at,
          precio_negociable,
          profiles!inner(id, nombre, foto, trust_level, average_rating, reviews_count)
        `)
        .eq("estatus", "disponible")
        .in("creador_id", storeIds)
        .order("created_at", { ascending: false })
        .limit(50);
        
      followingPosts = posts ?? [];
      
      followedStoresData = follows.map((f: any) => {
        const store = f.profiles;
        const hasPosts = followingPosts.some((p) => p.creador_id === store.id);
        return {
          id: store.id,
          name: store.nombre,
          letter: store.nombre.charAt(0).toUpperCase(),
          imgUrl: store.foto,
          hasRecentPosts: hasPosts,
        };
      });
    }
  }

  return (
    <div className="w-full min-w-0 min-h-screen">
      <HomeTabs active={feed} />

      {feed === "parati" ? (
        <>
          {/* ─── ZONE + SEARCH (app-style hero) ───────────────── */}
          <section className="px-4 pt-8 pb-4">
            <div className="max-w-7xl mx-auto space-y-4">
              <ZoneCard />
              <h1 className="font-heading text-3xl font-bold leading-[1.1] tracking-tight text-[color:var(--fg)]">
                Descubre lo mejor{" "}
                <span className="text-[color:var(--brand-hi)]">cerca de ti</span>
              </h1>
              <Link
                href="/buscar"
                id="home-search"
                className="flex items-center gap-3 rounded-2xl bg-[color:var(--card-2)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
              >
                <Search className="h-[17px] w-[17px] text-[color:var(--brand-hi)]" strokeWidth={2} />
                <span className="flex-1 text-sm text-[color:var(--fg-dim)]">
                  ¿Qué buscas hoy?
                </span>
                <span className="h-4 w-px bg-[color:var(--border-strong)]" aria-hidden />
                <span className="text-xs font-semibold text-[color:var(--fg-muted)]">
                  Filtros
                </span>
              </Link>
            </div>
          </section>

          {/* ─── CATEGORIES ─────────────────────────────────────── */}
          <section className="px-4 pb-6">
            <div className="max-w-7xl mx-auto">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-heading text-lg font-semibold text-[color:var(--fg)]">
                  Categorías
                </h2>
                <Link
                  href="/buscar"
                  id="home-see-all-categories"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--brand-hi)] transition-colors hover:text-[color:var(--brand)]"
                >
                  Ver todas
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>

              <div className="-mx-4 -my-3 flex gap-3 overflow-x-auto px-4 py-3 scrollbar-hide">
                {CATEGORIES.filter((c) => !c.hidden_in_form).map((cat, i) => {
                  const IconComponent = CATEGORY_ICONS[cat.slug] || MoreHorizontal;
                  const isFeatured = i === 0;

                  return (
                    <Link
                      key={cat.id}
                      href={`/buscar?category=${cat.slug}`}
                      id={`cat-${cat.slug}`}
                      className="group flex min-w-[72px] flex-col items-center gap-1.5 text-center"
                    >
                      <div
                        className={
                          isFeatured
                            ? "flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] transition-all duration-200 group-hover:-translate-y-0.5"
                            : "flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--card)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
                        }
                      >
                        <IconComponent className="h-6 w-6" strokeWidth={1.8} />
                      </div>
                      <span className="text-[11px] font-medium text-[color:var(--fg-muted)] transition-colors group-hover:text-[color:var(--fg)]">
                        {cat.name}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ─── RANKING STRIP ─────────────────────────────────── */}
          <Suspense fallback={null}>
            <RankingsHomeStripSection />
          </Suspense>

          {/* ─── CERCA DE TI (geo island) ───────────────────────── */}
          <section className="px-4 pb-6 mt-2">
            <div className="max-w-7xl mx-auto">
              <LocationBar />
            </div>
          </section>

          {/* ─── PRODUCT CAROUSELS ──────────────────────────────── */}
          {all.length > 0 ? (
            <div className="space-y-8 px-4 pb-8">
              {/* Recientes */}
              <section>
                <div className="mb-3">
                  <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--brand-hi)]">
                    Publicados hoy
                  </div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <h2 className="font-heading text-xl font-bold text-[color:var(--fg)]">
                      Recientes
                    </h2>
                    <Link
                      href="/buscar"
                      id="home-see-all-products"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--brand-hi)] transition-colors hover:text-[color:var(--brand)]"
                    >
                      Ver más
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
                <ProductCarousel products={all.slice(0, 20)} />
              </section>

              {/* Per-category carousels */}
              {categoryCarousels.map(([slug, ps]) => {
                const label = CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
                return (
                  <section key={slug}>
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="font-heading text-xl font-bold text-[color:var(--fg)]">
                        {label}
                      </h2>
                      <Link
                        href={`/buscar?category=${slug}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--brand-hi)] transition-colors hover:text-[color:var(--brand)]"
                      >
                        Ver más
                        <ArrowRight className="h-3 w-3" />
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
              <div className="px-4 py-20 text-center">
                <div className="mx-auto max-w-sm">
                  <div className="relative mx-auto mb-6 h-24 w-24">
                    <div className="absolute inset-0 rotate-6 rounded-3xl bg-[color:var(--brand-tint)]" />
                    <div className="absolute inset-0 -rotate-3 rounded-3xl bg-[color:var(--brand-tint)]" />
                    <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-[color:var(--brand-tint-strong)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
                      <span className="text-4xl">🏪</span>
                    </div>
                  </div>
                  <h3 className="mb-2 font-heading text-xl font-bold text-[color:var(--fg)]">
                    Bienvenido a VICINO
                  </h3>
                  <p className="mb-6 text-sm leading-relaxed text-[color:var(--fg-muted)]">
                    Tu mercado de confianza. Aún no hay productos publicados.
                    ¡Sé el primero en vender!
                  </p>
                  {viewerIsVendedor && (
                    <Link
                      href="/vender"
                      id="cta-publish"
                      className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--brand)] px-6 py-3 font-semibold text-white shadow-[var(--shadow-glow)] transition-all duration-200 hover:bg-[color:var(--brand-dark)] active:scale-[0.97]"
                    >
                      Publicar producto
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      ) : (
        /* ─── SIGUIENDO FEED ─────────────────────────────── */
        <div className="max-w-lg mx-auto pb-12">
          {!user ? (
            <div className="px-4 py-20 text-center">
              <div className="mx-auto max-w-sm">
                <div className="relative mx-auto mb-6 h-20 w-20">
                  <div className="absolute inset-0 rotate-6 rounded-[20px] bg-[color:var(--brand-tint)]" />
                  <div className="absolute inset-0 -rotate-3 rounded-[20px] bg-[color:var(--brand-tint)]" />
                  <div className="relative flex h-20 w-20 items-center justify-center rounded-[20px] bg-[color:var(--brand-tint-strong)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] text-[color:var(--brand-hi)]">
                    <Store className="w-8 h-8" />
                  </div>
                </div>
                <h3 className="mb-2 font-heading text-xl font-bold text-[color:var(--fg)]">
                  Sigue a tus tiendas favoritas
                </h3>
                <p className="mb-6 text-[14.5px] leading-relaxed text-[color:var(--fg-muted)]">
                  Inicia sesión para ver las novedades de las tiendas que sigues, todo en un solo lugar.
                </p>
                <div className="flex flex-col gap-3">
                  <Link
                    href="/ingresar"
                    className="flex items-center justify-center h-12 rounded-xl bg-[color:var(--brand)] font-semibold text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)]"
                  >
                    Iniciar sesión
                  </Link>
                  <Link
                    href="/registro"
                    className="flex items-center justify-center h-12 rounded-xl bg-[color:var(--card-2)] font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
                  >
                    Crear cuenta
                  </Link>
                </div>
                <Link
                  href="/"
                  className="inline-block mt-6 text-sm font-medium text-[color:var(--brand-hi)] hover:text-[color:var(--brand)] transition-colors"
                >
                  Explorar sin cuenta <ArrowRight className="w-3.5 h-3.5 inline ml-1 -mt-0.5" />
                </Link>
              </div>
            </div>
          ) : noFollows ? (
            <div className="px-4 pt-12 pb-6">
              <div className="text-center mb-10">
                <div className="relative mx-auto mb-5 h-16 w-16">
                  <div className="absolute inset-0 rotate-[10deg] rounded-[18px] bg-[color:var(--brand-tint)]" />
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-[18px] bg-[color:var(--brand-tint-strong)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] text-[color:var(--brand-hi)]">
                    <Heart className="w-7 h-7" />
                  </div>
                </div>
                <h3 className="mb-2 font-heading text-[22px] font-bold text-[color:var(--fg)]">
                  Aún no sigues a nadie
                </h3>
                <p className="text-[14.5px] leading-relaxed text-[color:var(--fg-muted)]">
                  Cuando sigas tiendas, sus nuevas publicaciones aparecerán aquí, ordenadas por lo más reciente.
                </p>
                <Link
                  href="/buscar"
                  className="mt-6 inline-flex items-center justify-center h-11 px-6 rounded-full bg-[color:var(--brand)] text-[14.5px] font-semibold text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)]"
                >
                  <Search className="w-4 h-4 mr-2" />
                  Descubrir tiendas
                </Link>
              </div>

              {nearbyStores.length > 0 && (
                <div className="space-y-4">
                  <h4 className="font-heading font-semibold text-[15px] text-[color:var(--fg)] px-2">
                    Te sugerimos seguir
                  </h4>
                  <div className="bg-[color:var(--card)] rounded-[20px] shadow-[inset_0_0_0_1px_var(--border)] overflow-hidden divide-y divide-[color:var(--border)]">
                    {nearbyStores.map((store) => (
                      <div key={store.id} className="flex items-center gap-3 p-4">
                        <div className="w-12 h-12 rounded-xl bg-[color:var(--bg-elev-2)] flex items-center justify-center overflow-hidden shrink-0">
                          {store.foto ? (
                            <img src={store.foto} alt={store.nombre} className="w-full h-full object-cover" />
                          ) : (
                            <span className="font-bold text-[color:var(--fg-muted)]">{store.nombre.charAt(0)}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <Link href={`/vendedor/${store.id}`} className="font-medium text-[color:var(--fg)] truncate block">
                            {store.nombre}
                          </Link>
                          <div className="text-[13px] text-[color:var(--fg-muted)] mt-0.5">A 2 km de ti</div>
                        </div>
                        <FollowButton storeId={store.id} following={false} size="sm" full={false} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <FollowingRail stores={followedStoresData} />
              
              <div className="px-2 sm:px-4 space-y-4">
                {followingPosts.map((post) => {
                  const now = new Date();
                  const created = new Date(post.created_at);
                  const diffHours = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60));
                  const when = diffHours < 1 ? "hace poco" : diffHours < 24 ? `hace ${diffHours} h` : `hace ${Math.floor(diffHours/24)} d`;
                  
                  return (
                    <StorePost
                      key={post.id}
                      id={post.id}
                      storeId={post.creador_id}
                      store={post.profiles.nombre}
                      letter={post.profiles.nombre.charAt(0).toUpperCase()}
                      tier={(post.profiles.trust_level as TrustLevel) ?? "nuevo"}
                      cat={CATEGORIES.find((c) => c.slug === post.categoria)?.name ?? "Otro"}
                      when={when}
                      title={post.titulo}
                      price={post.precio}
                      distance="A 2.5 km"
                      rating={post.profiles.average_rating ?? 0}
                      count={post.profiles.reviews_count ?? 0}
                      imgUrl={post.imagen_principal}
                      imgLabel={post.titulo}
                    />
                  );
                })}
              </div>

              {followingPosts.length === 0 && (
                <div className="py-12 text-center text-[14.5px] font-medium text-[color:var(--fg-muted)] flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[color:var(--brand-hi)]" />
                  Estás al día · nada nuevo por ahora
                </div>
              )}
              {followingPosts.length > 0 && (
                <div className="py-8 text-center text-[14px] text-[color:var(--fg-muted)]">
                  Estás al día · nada nuevo por ahora
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
