"use client";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { HomeCategoryOrder } from "@/components/home/home-category-order";
import Link from "next/link";
import { ProductCarousel } from "@/components/home/product-carousel";
import { MasProductos } from "@/components/home/mas-productos";
import { LocationBar } from "@/components/shared/location-bar";
import { ZoneCard } from "@/components/home/zone-card";
import { CATEGORIES, TrustLevel, primaryCategorySlug, primaryCategoryFull } from "@vicino/shared";
import { HomeTabs } from "@/components/home/home-tabs";
import { FollowingRail } from "@/components/home/following-rail";
import { StorePost } from "@/components/home/store-post";
import { SolicitudesFeed } from "@/components/solicitudes/solicitudes-feed";
import { UNIVERSITY_COLORS, getContrastYIQ } from "@/lib/utils";
import { FollowButton } from "@/components/shared/follow-button";
import { catalogFailure } from "@/lib/catalogo/estado-consulta";
import { CatalogQueryState } from "@/components/shared/catalog-query-state";
import {
  GraduationCap,
  ArrowRight,
  Search,
  Heart,
  Store,
  MapPin,
} from "lucide-react";

import { ComunidadesFeed } from "@/components/comunidades/comunidades-feed";
import { leerEstadoCuota } from "@/lib/comunidades/tipos";
import { SessionScroll, useSessionData, useLocationScope, DataRetry } from "@/components/layout/session-data-provider";
import type { getHomeSession } from "@/lib/home-session-data";
type Data = Awaited<ReturnType<typeof getHomeSession>>["value"];
export function HomeSession({ ranking }: { ranking: ReactNode }) {
  const search = useSearchParams();
  const params = new URLSearchParams();
  for (const name of ["feed"]) { const value = search.get(name); if (value) params.set(name, value); }
  const zone = useLocationScope();
  const key = `/api/session/home?${params}#${zone}`;
  const { data, error, retry, updatedAt } = useSessionData<Data>(key);
  if (!data) return <div className="px-4 py-6">{error ? <DataRetry error={error} retry={retry} /> : <p role="status">Cargando publicaciones…</p>}</div>;
  const { feed, userLat, userLng, validRadius, hasLocation, viewerIsVendedor, viewerUniversity, universityProducts, all, categoryCarousels, masProductosInitialCursor, feedRpcFailed, feedResultado, cercaDeTiResultado, showGeoEmptyState, followingPosts, followedStoresData, noFollows, nearbyStores, comunidades, user } = data;
  const subTabComunidades = search.get("tab") === "mias" ? "mias" : search.get("tab") === "descubrir" ? "descubrir" : "muro";
  const firstSelectedCategory = (search.get("cats") ?? "").split(",").find(slug => categoryCarousels.some(([available]) => available === slug));
  return (
    <div data-navigation-kind="home" data-navigation-ready={`home:${search.toString()}:${updatedAt}`} className="w-full min-w-0 min-h-screen">
      <SessionScroll route="/" scope={`${key}:${search.toString()}`} />
      <HomeTabs active={feed} />
      <DataRetry error={error} retry={retry} />

      {feed === "parati" ? (
        <>
          {/* ─── ZONE + SEARCH (app-style hero) ───────────────── */}
          <section className="px-4 pt-4 pb-4">
            <div className="max-w-7xl mx-auto space-y-3">
              <h1 className="font-heading text-3xl font-bold leading-[1.1] tracking-tight text-[color:var(--fg)]">
                Descubre lo mejor{" "}
                <span className="text-[color:var(--brand-hi)]">cerca de ti</span>
              </h1>
              <Link
                href="/buscar"
                id="home-search"
                className="flex items-center gap-3 rounded-2xl product-card-custom px-4 py-3 transition-colors hover:opacity-90"
              >
                <Search className="h-[17px] w-[17px] product-card-muted" strokeWidth={2} />
                <span className="flex-1 text-sm product-card-muted">
                  ¿Qué buscas hoy?
                </span>
              </Link>
              <div>
                {/* `hasLocation` sale de la cookie vicino_location, que esta
                    pagina ya leyo arriba para armar el feed. Pasarlo evita que
                    la pildora entre diciendo «Activa ubicacion» y cambie sola
                    despues de hidratar. */}
                <ZoneCard hayUbicacionEnServidor={hasLocation} />
              </div>
            </div>
          </section>

          <HomeCategoryOrder
            rows={categoryCarousels.map(([slug, ps]) => ({
              slug,
              name: CATEGORIES.find(c => c.slug === slug)?.name ?? slug,
              content: (
                  <section key={slug}>
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="font-heading text-xl font-bold text-[color:var(--fg)]">
                        {CATEGORIES.find(c => c.slug === slug)?.name ?? slug}
                      </h2>
                      <Link
                        href={`/buscar?category=${slug}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--brand-hi)] transition-colors hover:text-[color:var(--brand)]"
                      >
                        Ver más
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                    <ProductCarousel products={ps.slice(0, 20)} priorityFirstItem={slug === firstSelectedCategory} />
                  </section>
              ),
            }))}
            intro={<>
          {/* ─── RANKING STRIP ─────────────────────────────────── */}
          {ranking}

          {/* ─── TU UNIVERSIDAD (Exclusivo) ───────────────────────── */}
          {viewerUniversity && universityProducts.length > 0 && (
            <section className="px-4 pb-4 mt-4">
              <div 
                className="max-w-7xl mx-auto rounded-[var(--r-xl)] border p-4 shadow-sm"
                style={{ 
                  backgroundColor: UNIVERSITY_COLORS[viewerUniversity] || "#0ea5e9",
                  borderColor: UNIVERSITY_COLORS[viewerUniversity] || "#0ea5e9"
                }}
              >
                <div className="mb-3">
                  <div 
                    className="text-[10.5px] font-bold uppercase tracking-[0.12em] flex items-center gap-1.5 opacity-90"
                    style={{ color: getContrastYIQ(UNIVERSITY_COLORS[viewerUniversity] || "#0ea5e9") }}
                  >
                    <GraduationCap className="w-3.5 h-3.5" /> Comunidad Universitaria
                  </div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <h2 
                      className="font-heading text-xl font-bold"
                      style={{ color: getContrastYIQ(UNIVERSITY_COLORS[viewerUniversity] || "#0ea5e9") }}
                    >
                      Lo mejor en tu universidad
                    </h2>
                  </div>
                </div>
                <ProductCarousel products={universityProducts} />
              </div>
            </section>
          )}

          {/* ─── CERCA DE TI (geo island) ───────────────────────── */}
          <section className="px-4 pb-6 mt-2">
            <div className="max-w-7xl mx-auto">
              <LocationBar
                productosIniciales={cercaDeTiResultado.products}
                  initialFailure={cercaDeTiResultado.error ? catalogFailure(cercaDeTiResultado) : null}
                hayUbicacionEnServidor={hasLocation}
                managed
              />
            </div>
          </section>

            </>}
            recent={<>
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
                {/* P5.1: priorityFirstItem activa el priority/fetchPriority=high
                    en la primera card del carousel Recientes (infra de A3.3).
                    Es el candidato LCP del feed Para ti -- las cards arriba
                    (ZoneCard + Categories + RankingsStrip + ...) son texto/SVG.
                    Cero costo si el LCP termina siendo otro elemento. */}
                <ProductCarousel products={all.slice(0, 20)} priorityFirstItem={!firstSelectedCategory} />
              </section>

            </>}
            tail={
              <MasProductos
                key={masProductosInitialCursor ?? "empty"}
                initialCursor={masProductosInitialCursor}
                lat={!feedRpcFailed ? (userLat ?? undefined) : undefined}
                lng={!feedRpcFailed ? (userLng ?? undefined) : undefined}
              />
            }
            empty={feedResultado.failure ? (
              <section className="px-4 pb-8"><CatalogQueryState failure={feedResultado.failure} section="los productos" /></section>
            ) : showGeoEmptyState ? (
            /* ─── EMPTY STATE GEO ─────────────────────────────── */
            <section className="px-4 pb-8">
              <div className="px-4 py-20 text-center">
                <div className="mx-auto max-w-sm">
                  <div className="relative mx-auto mb-6 h-24 w-24">
                    <div className="absolute inset-0 rotate-6 rounded-3xl bg-muted" />
                    <div className="absolute inset-0 -rotate-3 rounded-3xl bg-muted" />
                    <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-foreground text-background">
                      <MapPin className="w-10 h-10" />
                    </div>
                  </div>
                  <h3 className="mb-2 font-heading text-xl font-bold text-[color:var(--fg)]">
                    No hay vendedores cerca de ti
                  </h3>
                  <p className="mb-6 text-sm leading-relaxed text-[color:var(--fg-muted)]">
                    Cambia tu ubicación para explorar otras zonas con más actividad.
                  </p>
                  <Link
                    href="/buscar"
                    className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--brand)] px-6 py-3 font-semibold text-white shadow-[var(--shadow-glow)] transition-all duration-200 hover:bg-[color:var(--brand-dark)] active:scale-[0.97]"
                  >
                    Explorar mapa
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </section>
          ) : (
            /* ─── EMPTY STATE ─────────────────────────────── */
            <section className="px-4 pb-8">
              <div className="px-4 py-20 text-center">
                <div className="mx-auto max-w-sm">
                  <div className="relative mx-auto mb-6 h-24 w-24">
                    <div className="absolute inset-0 rotate-6 rounded-3xl bg-muted" />
                    <div className="absolute inset-0 -rotate-3 rounded-3xl bg-muted" />
                    <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-foreground">
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
          />
        </>
      ) : feed === "solicitudes" ? (
        /* ─── SOLICITUDES FEED ─────────────────────────────── */
        <div className="pt-4">
          <SolicitudesFeed
            userLat={userLat}
            userLng={userLng}
            radiusMeters={validRadius}
            userId={user?.id ?? null}
          />
        </div>
      ) : feed === "comunidades" ? (
        /* ─── COMUNIDADES FEED ─────────────────────────────── */
        <div className="pt-3">
          <ComunidadesFeed
            user={comunidades?.user ?? null}
            userLat={userLat}
            userLng={userLng}
            initialTab={subTabComunidades}
            muro={comunidades?.muro ?? { posts: [], cursor: null }}
            mias={comunidades?.mias ?? []}
            misSolicitudes={comunidades?.misSolicitudes ?? []}
            cercanas={comunidades?.cercanas ?? null}
            cuota={comunidades?.cuota ?? leerEstadoCuota(null)}
            errores={comunidades?.errores}
          />
        </div>
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
                    // Era "/ingresar", que NO EXISTE: 404 comprobado en
                    // produccion. La ruta es /login. Lleva ?next= para volver
                    // aqui, que es donde la persona queria estar.
                    href="/login?next=%2F"
                    className="flex items-center justify-center h-12 rounded-xl bg-[color:var(--brand)] font-semibold text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)]"
                  >
                    Iniciar sesión
                  </Link>
                  <Link
                    // Era "/registro", que tampoco existe. Es /register.
                    href="/register?next=%2F"
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
                {followingPosts.map((post, index) => {
                  const now = new Date();
                  // created_at admite NULL en la base. Sin fecha no hay
                  // antiguedad que anunciar, asi que la linea "hace X" se
                  // queda vacia: new Date(null) daria el epoch y el post
                  // aparecería como "hace 20000 d".
                  const created = post.created_at ? new Date(post.created_at) : null;
                  const diffHours = created
                    ? Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60))
                    : null;
                  const when = diffHours === null ? "" : diffHours < 1 ? "hace poco" : diffHours < 24 ? `hace ${diffHours} h` : `hace ${Math.floor(diffHours/24)} d`;

                  return (
                    <StorePost
                      key={post.id}
                      id={post.id}
                      // La ruta del detalle se arma AQUI, que es donde estan el
                      // slug y la categoria primaria. La tarjeta enlazaba a
                      // /producto/<id>, que no existe: 404 en los TRES enlaces
                      // de cada post. Y sin slug no se enlaza nada, porque el
                      // detalle resuelve solo por slug.
                      href={
                        post.slug
                          ? `/${primaryCategorySlug(post.product_categories) ?? post.categoria}/${post.slug}`
                          : null
                      }
                      storeId={post.creador_id}
                      store={post.profiles.nombre}
                      storeAvatar={post.profiles.foto}
                      letter={post.profiles.nombre.charAt(0).toUpperCase()}
                      tier={(post.profiles.trust_level as TrustLevel) ?? "nuevo"}
                      cat={
                        // MP#08 #4 Fase 1A: nombre de la primary del pivote.
                        // Fallback al lookup legacy de CATEGORIES por slug TEXT
                        // (sigue vivo hasta Fase 1C/2). "Otro" si nada existe.
                        primaryCategoryFull(post.product_categories)?.nombre
                        ?? CATEGORIES.find((c) => c.slug === post.categoria)?.name
                        ?? "Otro"
                      }
                      when={when}
                      title={post.titulo}
                      price={post.precio}
                      modoPrecio={post.modo_precio}
                      distance="A 2.5 km"
                      rating={post.profiles.average_rating ?? 0}
                      count={post.profiles.reviews_count ?? 0}
                      imgUrl={
                        // imagen_principal es nullable; StorePost expresa la
                        // ausencia de imagen como undefined y ya tiene su
                        // propio placeholder para ese caso.
                        post.imagen_principal ?? undefined
                      }
                      imgLabel={post.titulo}
                      priority={index === 0}
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
