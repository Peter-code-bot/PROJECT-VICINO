"use server";

import { createClient } from "@/lib/supabase/server";
import { fuzzDistance } from "./fuzz";

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

interface GetNearbyParams {
  lat: number;
  lng: number;
  radiusMeters?: number;
  categoryFilter?: string | null;
  limit?: number;
}

interface GetNearbyResult {
  products: NearbyProduct[];
  error?: string;
}

export async function getNearbyProducts(
  params: GetNearbyParams,
): Promise<GetNearbyResult> {
  if (!Number.isFinite(params.lat) || !Number.isFinite(params.lng)) {
    return { products: [], error: "Coordenadas inválidas" };
  }
  if (Math.abs(params.lat) > 90 || Math.abs(params.lng) > 180) {
    return { products: [], error: "Coordenadas fuera de rango" };
  }

  const radius = Math.min(Math.max(params.radiusMeters ?? 5000, 100), 50_000);
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("nearby_products", {
    user_lat: params.lat,
    user_lng: params.lng,
    radius_meters: radius,
    category_filter: params.categoryFilter ?? null,
    result_limit: limit,
  });

  if (error) return { products: [], error: error.message };

  // Bucket distance to 100m before exposing to the client. The RPC itself does
  // NOT yet fuzz internally — see supabase/migrations/20260515000001_fuzz_nearby_products.sql
  // for the pending DB-side defense in depth.
  const products = ((data ?? []) as NearbyProduct[]).map((p) => ({
    ...p,
    distance_meters: fuzzDistance(p.distance_meters),
  }));

  return { products };
}
