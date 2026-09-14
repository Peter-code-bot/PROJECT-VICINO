"use client";

import { useState, useEffect, startTransition } from "react";
import { getNearbyProducts } from "@/lib/geo/actions";
import { esFalloDeRed } from "@/lib/net/fallo-de-red";
import { catalogFailure, type CatalogFailure } from "@/lib/catalogo/estado-consulta";
import type { NearbyProduct } from "@/lib/geo/consulta-cercanos";
import type { GeoPosition } from "./useGeolocation";

export type { NearbyProduct };

interface Options {
  position: GeoPosition | null;
  radiusMeters?: number;
  limit?: number;
}

export function useNearbyProducts({
  position,
  radiusMeters = 5000,
  limit = 20,
}: Options) {
  const [products, setProducts] = useState<NearbyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<CatalogFailure | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (!position) return;

    let cancelled = false;
    startTransition(() => {
      setLoading(true);
      setError(null);
      setFailure(null);
    });

    getNearbyProducts({
      lat: position.lat,
      lng: position.lng,
      radiusMeters,
      limit,
    }).then(
      (result) => {
        if (cancelled) return;
        if (result.error) {
          setError(result.error);
          setFailure(catalogFailure(result));
        } else {
          setProducts(result.products);
          setHasLoaded(true);
          setFailure(null);
        }
        setLoading(false);
      },
      (err: unknown) => {
        // La server action es un fetch: sin este brazo, quedarse sin senal
        // dejaba `loading` en true para siempre (el spinner de "Cerca de ti"
        // no paraba nunca) y el rechazo salia por onunhandledrejection.
        if (cancelled) return;
        setLoading(false);
        // Sin red nos quedamos con los productos que ya trajo el servidor.
        setError(esFalloDeRed(err)
          ? "No hay conexión para cargar los productos cercanos."
          : "No se pudieron cargar los productos cercanos.");
        setFailure(catalogFailure(err));
      },
    );

    return () => {
      cancelled = true;
    };
  }, [position?.lat, position?.lng, radiusMeters, limit]);

  return { products, loading, error, failure, hasLoaded };
}
