"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fuzzCoordinate, fuzzDistance } from "./fuzz";
import { enforce, getClientIp, readHeavyRateLimit } from "@/lib/rate-limit";

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

  // Throttle by IP — this is an unauthenticated heavy read, so the rate limit
  // protects against scraping the proximity surface. 60/min is well above
  // any reasonable UI cadence.
  const ip = getClientIp(await headers());
  const rate = await enforce(readHeavyRateLimit, `read:${ip}`);
  if (!rate.ok) return { products: [], error: rate.error };

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
  const { data, error } = await supabase.rpc("search_nearby_products_v4", {
    user_lat: snapped.lat,
    user_lng: snapped.lng,
    radius_meters: snappedRadius,
    search_term: params.categoryFilter ?? null,
    result_limit: limit,
    sort_by_distance: true,
  });

  if (error) return { products: [], error: error.message };

  // Mapeamos el output de V4 (profiles JSONB) a NearbyProduct
  const products: NearbyProduct[] = (data ?? []).map((p: any) => ({
    id: p.id,
    titulo: p.titulo,
    slug: p.slug,
    precio: p.precio,
    imagen_principal: p.imagen_principal,
    categoria: p.categoria,
    tipo_entrega: p.tipo_entrega,
    distance_meters: fuzzDistance(p.distance_meters),
    vendedor_nombre: p.profiles?.nombre || "",
    vendedor_trust: p.profiles?.trust_level || "new",
    vendedor_rating: p.profiles?.average_rating || 0,
    vendedor_reviews: p.profiles?.reviews_count || 0,
  }));

  return { products };
}

interface GetNearbyVendorCountParams {
  lat: number;
  lng: number;
  radiusMeters?: number;
}

interface GetNearbyVendorCountResult {
  count: number;
  error?: string;
}

export async function getNearbyVendorCount(
  params: GetNearbyVendorCountParams,
): Promise<GetNearbyVendorCountResult> {
  if (!Number.isFinite(params.lat) || !Number.isFinite(params.lng)) {
    return { count: 0, error: "Coordenadas inválidas" };
  }
  if (Math.abs(params.lat) > 90 || Math.abs(params.lng) > 180) {
    return { count: 0, error: "Coordenadas fuera de rango" };
  }

  const ip = getClientIp(await headers());
  const rate = await enforce(readHeavyRateLimit, `read:${ip}`);
  if (!rate.ok) return { count: 0, error: rate.error };

  const radius = Math.min(Math.max(params.radiusMeters ?? 5000, 100), 50_000);
  const snapped = fuzzCoordinate(params.lat, params.lng);
  const snappedRadius = Math.ceil(radius / 100) * 100 + 100;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_nearby_products_v4", {
    user_lat: snapped.lat,
    user_lng: snapped.lng,
    radius_meters: snappedRadius,
    result_limit: 100,
    sort_by_distance: true,
  });

  if (error) return { count: 0, error: error.message };

  const names = new Set(
    (data ?? []).map((p: any) => p.profiles?.nombre).filter(Boolean)
  );
  return { count: names.size };
}
