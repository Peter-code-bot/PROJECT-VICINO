"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { ProductCard } from "@/components/product/product-card";
import { useInfiniteCursor } from "@/hooks/use-infinite-cursor";
import { getMoreFeedProducts } from "@/app/(marketplace)/actions";
import { normalizeCardCategories, type TrustLevel } from "@vicino/shared";

/**
 * A5.2: flat "Mas productos" infinite-scroll section. Mounted at the
 * BOTTOM of the home Para ti feed (after the 15 category carousels).
 *
 * Option C of the design: the carousels above stay frozen on the
 * initial 150 products (grouping is server-side, deterministic, never
 * re-shuffles under the user's finger). This component owns
 * everything BEYOND those 150, ordered strictly by created_at DESC,
 * in a flat responsive grid.
 *
 * Cursor boundary: page.tsx passes initialCursor = the OLDEST
 * created_at of the initial 150. The Server Action filters
 * created_at < cursor, so by construction this component CANNOT show
 * a product that any carousel above is also rendering.
 *
 * Less-than-150 catalog: page.tsx passes initialCursor === null when
 * the initial fetch returned fewer than 150 items. The component then
 * renders nothing -- no sentinel, no IntersectionObserver, no fetch
 * (mirrors the chat <50 messages case in A5.1).
 *
 * Realtime / revalidatePath: this surface does NOT subscribe to
 * Realtime. Freshness is delegated to revalidatePath('/') which
 * re-runs the home Server Component on next navigation, recomputing
 * the initial 150 AND the initialCursor handed to this component.
 * The Server Component re-render unmounts and re-mounts this
 * component with the fresh boundary, so a newly-published product
 * naturally appears either in the carousels (if it lands in the new
 * 150) or in the first page below (if the catalog had pushed it out).
 */

interface MasProductosProduct {
  id: string;
  titulo: string;
  precio: number;
  imagen_principal: string | null;
  categoria: string;
  slug: string | null;
  created_at: string;
  precio_negociable: boolean | null;
  profiles: unknown;
  product_categories: unknown;
}

interface MasProductosProps {
  initialCursor: string | null;
  lat?: number;
  lng?: number;
}

export function MasProductos({ initialCursor, lat, lng }: MasProductosProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { items, isLoading, hasMore, error, loadMore } = useInfiniteCursor<
    MasProductosProduct,
    string
  >({
    action: async ({ cursor, limit }) => {
      // The hook gates loadMore on cursor !== null (hasMore guard).
      const result = await getMoreFeedProducts(cursor as string, limit, lat, lng);
      return {
        items: result.items as MasProductosProduct[],
        nextCursor: result.nextCursor,
        error: result.error,
      };
    },
    initialItems: [],
    initialCursor,
    limit: 30,
    prepend: false,
  });

  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    // No container ref needed: the home scrolls on the window itself
    // (the page layout does not wrap content in an overflow-y-auto
    // container), so root: null defaults to the viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (isLoading) return;
        void loadMore();
      },
      { rootMargin: "200px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, loadMore]);

  // Catalog smaller than the initial 150 -> nothing to load. Render
  // nothing (no header, no sentinel) to match the visual contract:
  // "Mas productos" only appears when there ARE more products.
  if (initialCursor === null) return null;

  return (
    <section className="px-4 pb-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-3">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--brand-hi)]">
            Sigue explorando
          </div>
          <h2 className="font-heading text-xl font-bold text-[color:var(--fg)]">
            Más productos
          </h2>
        </div>

        {items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map((p) => {
              const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
              const profileShape = profile as
                | {
                    nombre?: string;
                    trust_level?: string;
                    average_rating?: number;
                    reviews_count?: number;
                  }
                | null
                | undefined;
              return (
                <ProductCard
                  key={p.id}
                  id={p.id}
                  titulo={p.titulo}
                  precio={Number(p.precio)}
                  imagen={p.imagen_principal}
                  categoria={p.categoria}
                  slug={p.slug ?? p.id}
                  vendedor={{
                    nombre: profileShape?.nombre ?? "Vendedor",
                    trust_level: (profileShape?.trust_level as TrustLevel) ?? "nuevo",
                  }}
                  rating={Number(profileShape?.average_rating ?? 0)}
                  reviewsCount={Number(profileShape?.reviews_count ?? 0)}
                  precioNegociable={p.precio_negociable ?? false}
                  categories={normalizeCardCategories(p.product_categories)}
                />
              );
            })}
          </div>
        )}

        {/* Sentinel: 1px, observed only while hasMore. The rootMargin
            of 200px primes the next fetch BEFORE the user reaches the
            visual end of the grid -- the load feels seamless rather
            than gated on hitting an empty space. */}
        {hasMore && <div ref={sentinelRef} className="h-px" aria-hidden="true" />}

        {isLoading && (
          <div className="flex justify-center py-6 text-[color:var(--fg-muted)]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {error && (
          <p className="px-2 py-3 text-center text-xs text-[color:var(--danger)]">
            {error}
          </p>
        )}

        {!hasMore && items.length > 0 && (
          <div className="py-8 text-center text-[13px] text-[color:var(--fg-muted)]">
            No hay más productos por ahora
          </div>
        )}
      </div>
    </section>
  );
}
