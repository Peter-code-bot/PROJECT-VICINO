"use client";

import { useState, useEffect, startTransition } from "react";
import { getNearbyProducts, type NearbyProduct } from "@/lib/geo/actions";
import type { GeoPosition } from "./useGeolocation";

export type { NearbyProduct };

interface Options {
  position: GeoPosition | null;
  radiusMeters?: number;
  categoryFilter?: string | null;
  limit?: number;
}

export function useNearbyProducts({
  position,
  radiusMeters = 5000,
  categoryFilter = null,
  limit = 20,
}: Options) {
  const [products, setProducts] = useState<NearbyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!position) return;

    let cancelled = false;
    startTransition(() => {
      setLoading(true);
      setError(null);
    });

    getNearbyProducts({
      lat: position.lat,
      lng: position.lng,
      radiusMeters,
      categoryFilter,
      limit,
    }).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
      } else {
        setProducts(result.products);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [position?.lat, position?.lng, radiusMeters, categoryFilter, limit]);

  return { products, loading, error };
}
