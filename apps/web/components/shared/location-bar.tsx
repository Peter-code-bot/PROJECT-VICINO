"use client";

import Link from "next/link";
import { MapPin, Loader2, Navigation } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useNearbyProducts } from "@/hooks/useNearbyProducts";
import { ProductCard } from "@/components/product/product-card";
import type { TrustLevel } from "@vicino/shared";
import { cn } from "@/lib/utils";

export function LocationBar() {
  const { state, request } = useGeolocation();
  const position = state.status === "success" ? state.position : null;

  const { products, loading } = useNearbyProducts({
    position,
    radiusMeters: 5000,
  });

  return (
    <div className="space-y-4">
      {/* Pill de ubicación */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={request}
          disabled={state.status === "loading"}
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200 disabled:opacity-60",
            "bg-[color:var(--card-2)] text-[color:var(--fg)]",
            "shadow-[inset_0_0_0_1px_var(--border)]",
            "hover:bg-[color:var(--brand-tint)] hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
          )}
        >
          {state.status === "loading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--brand-hi)]" />
          ) : (
            <Navigation className="h-3.5 w-3.5 text-[color:var(--brand-hi)]" />
          )}
          {state.status === "success"
            ? "Actualizar ubicación"
            : state.status === "loading"
              ? "Obteniendo ubicación..."
              : "Usar mi ubicación"}
        </button>
        {state.status === "error" && (
          <span className="text-xs text-[color:var(--fg-muted)]">{state.message}</span>
        )}
      </div>

      {/* Grid de productos cercanos — solo visible cuando hay posición */}
      {position && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[color:var(--brand-hi)]" />
            <h2 className="font-heading text-lg font-semibold">Cerca de ti</h2>
            {loading && (
              <Loader2 className="h-4 w-4 animate-spin text-[color:var(--fg-muted)]" />
            )}
          </div>

          {products.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  id={p.id}
                  titulo={p.titulo}
                  precio={p.precio}
                  imagen={p.imagen_principal}
                  categoria={p.categoria}
                  slug={p.slug}
                  vendedor={{
                    nombre: p.vendedor_nombre,
                    trust_level: p.vendedor_trust as TrustLevel,
                  }}
                  rating={p.vendedor_rating}
                  reviewsCount={p.vendedor_reviews}
                />
              ))}
            </div>
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
