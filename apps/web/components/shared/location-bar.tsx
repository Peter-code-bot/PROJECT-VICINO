"use client";

import { MapPin, Loader2, Navigation } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useNearbyProducts } from "@/hooks/useNearbyProducts";
import { ProductCard } from "@/components/product/product-card";
import type { TrustLevel } from "@vicino/shared";

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
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={request}
          disabled={state.status === "loading"}
          className="flex items-center gap-2 rounded-full border border-border/50 bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:border-brand/40 hover:bg-brand/5 transition-all duration-200 disabled:opacity-60"
        >
          {state.status === "loading" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
          ) : (
            <Navigation className="w-3.5 h-3.5 text-brand" />
          )}
          {state.status === "success"
            ? "Actualizar ubicación"
            : state.status === "loading"
              ? "Obteniendo ubicación..."
              : "Usar mi ubicación"}
        </button>
        {state.status === "error" && (
          <span className="text-xs text-muted-foreground">{state.message}</span>
        )}
      </div>

      {/* Grid de productos cercanos — solo visible cuando hay posición */}
      {position && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-4 h-4 text-brand" />
            <h2 className="font-heading font-semibold text-lg">Cerca de ti</h2>
            {loading && (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {products.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
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
            <p className="text-sm text-muted-foreground py-4">
              Sin publicaciones en un radio de 5 km.{" "}
              <a href="/buscar" className="text-brand font-medium hover:underline">
                Explorar todo
              </a>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
