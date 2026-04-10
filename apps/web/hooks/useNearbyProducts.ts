"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { GeoPosition } from "./useGeolocation";

export interface NearbyProduct {
  id: string;
  titulo: string;
  slug: string;
  precio: number;
  imagen_principal: string | null;
  categoria: string;
  tipo_entrega: string;
  distance_meters: number;
  vendedor_nombre: string;
  vendedor_trust: string;
  vendedor_rating: number;
  vendedor_reviews: number;
}

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
    setLoading(true);
    setError(null);

    const supabase = createClient();
    supabase
      .rpc("nearby_products", {
        user_lat: position.lat,
        user_lng: position.lng,
        radius_meters: radiusMeters,
        category_filter: categoryFilter,
        result_limit: limit,
      })
      .then(({ data, error: rpcError }) => {
        if (cancelled) return;
        if (rpcError) {
          setError(rpcError.message);
        } else {
          setProducts((data as NearbyProduct[]) ?? []);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [position?.lat, position?.lng, radiusMeters, categoryFilter, limit]);

  return { products, loading, error };
}
