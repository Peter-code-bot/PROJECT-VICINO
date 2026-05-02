"use client";

import useEmblaCarousel from "embla-carousel-react";
import { ProductCard } from "@/components/product/product-card";
import type { TrustLevel } from "@vicino/shared";

interface CarouselProduct {
  id: string;
  titulo: string;
  precio: number;
  imagen_principal: string | null;
  categoria: string;
  slug: string | null;
  profiles:
    | { nombre: string; trust_level: string; average_rating: number; reviews_count: number }
    | { nombre: string; trust_level: string; average_rating: number; reviews_count: number }[]
    | null;
}

interface ProductCarouselProps {
  products: CarouselProduct[];
}

export function ProductCarousel({ products }: ProductCarouselProps) {
  const [emblaRef] = useEmblaCarousel({ align: "start", dragFree: true });

  return (
    <div className="overflow-hidden -mx-4 px-4" ref={emblaRef}>
      <div className="flex gap-3">
        {products.map((p) => {
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
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
