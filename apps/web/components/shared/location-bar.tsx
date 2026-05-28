"use client";

import Link from "next/link";
import { MapPin, Loader2 } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useNearbyProducts } from "@/hooks/useNearbyProducts";
import { ProductCarousel } from "@/components/home/product-carousel";
import type { TrustLevel } from "@vicino/shared";

export function LocationBar() {
  const { state } = useGeolocation();
  const position = state.status === "success" ? state.position : null;

  const { products, loading } = useNearbyProducts({
    position,
    radiusMeters: 5000,
  });

  return (
    <div className="space-y-4">
      {/* Grid de productos cercanos — solo visible cuando hay posición */}
      {position && (
        <div>
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[color:var(--brand-hi)]" />
              <h2 className="font-heading text-xl font-bold text-[color:var(--fg)]">Cerca de ti</h2>
              {loading && (
                <Loader2 className="h-4 w-4 animate-spin text-[color:var(--fg-muted)]" />
              )}
            </div>
            {products.length > 0 && (
              <div className="mt-1 flex justify-end">
                <Link
                  href="/buscar"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--brand-hi)] transition-colors hover:text-[color:var(--brand)]"
                >
                  Ver más
                </Link>
              </div>
            )}
          </div>

          {products.length > 0 ? (
            <ProductCarousel
              products={products.map((p) => ({
                id: p.id,
                titulo: p.titulo,
                precio: p.precio,
                imagen_principal: p.imagen,
                categoria: p.categoria,
                slug: p.slug,
                profiles: {
                  nombre: p.vendedor_nombre,
                  trust_level: p.vendedor_trust,
                  average_rating: p.vendedor_rating,
                  reviews_count: p.vendedor_reviews,
                },
              }))}
            />
          ) : !loading ? (
            <p className="py-4 text-sm text-[color:var(--fg-muted)]">
              Sin publicaciones en un radio de 5 km.{" "}
              <Link
                href="/buscar"
                className="font-medium text-[color:var(--brand-hi)] hover:underline"
              >
                Explorar todo
              </Link>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
