"use server";

import { createClient } from "@/lib/supabase/server";
import { fuzzCoordinate, fuzzDistance } from "./fuzz";

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

  // Snap inputs to a 100m grid before the proximity filter runs.
  // Without this, an attacker can binary-search the exact distance to a
  // known listing by varying radiusMeters / lat / lng across calls and
  // observing inclusion in the result set — bucketing the output alone
  // does not stop that probe attack.
  //
  // The radius is rounded UP (ceil) and inflated by one extra 100m bucket
  // so that snapping the caller's coords (up to ~80m drift in this region)
  // cannot exclude listings that were inside the originally requested
  // radius. Probe granularity is still 100m, but no false negatives.
  const snapped = fuzzCoordinate(params.lat, params.lng);
  const snappedRadius = Math.ceil(radius / 100) * 100 + 100;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("nearby_products", {
    user_lat: snapped.lat,
    user_lng: snapped.lng,
    radius_meters: snappedRadius,
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
