"use client";

import useEmblaCarousel from "embla-carousel-react";
import { ProductCard } from "@/components/product/product-card";
import { normalizeCardCategories } from "@vicino/shared";
import type { TrustLevel } from "@vicino/shared";

interface CarouselProduct {
  id: string;
  titulo: string;
  precio: number;
  imagen_principal: string | null;
  categoria: string;
  slug: string | null;
  precio_negociable?: boolean | null;
  profiles:
    | { nombre: string; trust_level: string; average_rating: number; reviews_count: number }
    | { nombre: string; trust_level: string; average_rating: number; reviews_count: number }[]
    | null;
  // MP#08 #5c-4: embed opcional product_categories(is_primary, categories(slug,
  // nombre)). El callsite hidrata desde (marketplace)/page.tsx; el carousel
  // pasa la data por normalizeCardCategories antes de cablear a ProductCard.
  product_categories?: unknown;
}

interface ProductCarouselProps {
  products: CarouselProduct[];
  // A3 sub-fase 3.3: cuando true, marca la PRIMERA card del carousel como
  // priority (LCP). Solo el caller que sabe que es el carousel above-fold
  // debe pasarlo (ej. home /parati "Recientes"). Default false.
  priorityFirstItem?: boolean;
}

export function ProductCarousel({ products, priorityFirstItem = false }: ProductCarouselProps) {
  const [emblaRef] = useEmblaCarousel({ align: "start", dragFree: true });

  return (
    <div className="overflow-hidden -mx-4 px-4" ref={emblaRef} data-no-page-swipe>
      <div className="flex gap-3">
        {products.map((p, index) => {
          const profile = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles;
          return (
            <div key={p.id} className="shrink-0 w-40 sm:w-48">
              <ProductCard
                id={p.id}
                titulo={p.titulo}
                precio={Number(p.precio)}
                imagen={p.imagen_principal}
                categoria={p.categoria}
                slug={p.slug ?? p.id}
                vendedor={{
                  nombre: profile?.nombre ?? "Vendedor",
                  trust_level: (profile?.trust_level as TrustLevel) ?? "nuevo",
                }}
                rating={Number(profile?.average_rating ?? 0)}
                reviewsCount={Number(profile?.reviews_count ?? 0)}
                precioNegociable={p.precio_negociable ?? false}
                categories={normalizeCardCategories(p.product_categories)}
                priority={priorityFirstItem && index === 0}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
