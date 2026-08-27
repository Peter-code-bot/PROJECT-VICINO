"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fuzzCoordinate, fuzzDistance } from "./fuzz";
import { enforce, getClientIp, readHeavyRateLimit } from "@/lib/rate-limit";

/**
 * Lectores para el JSONB que devuelve el RPC del feed.
 *
 * Las columnas `profiles` y `product_categories` de search_nearby_products_v4
 * son JSONB construido dentro de la funcion, asi que el codegen las declara
 * como `Json`: puede ser objeto, array, cadena, numero o nulo. Leerles un
 * campo directamente exige afirmar una forma que la base no garantiza.
 */
function leerObjeto(valor: unknown): Record<string, unknown> | null {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return null;
  return valor as Record<string, unknown>;
}

function leerTexto(obj: Record<string, unknown> | null, campo: string): string | null {
  const v = obj?.[campo];
  return typeof v === "string" && v !== "" ? v : null;
}

function leerNumero(obj: Record<string, unknown> | null, campo: string): number | null {
  const v = obj?.[campo];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // Postgres devuelve numeric como cadena en JSON; average_rating es numeric.
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export interface NearbyProduct {
  id: string;
  titulo: string;
  slug: string;
  precio: number | null;
  modo_precio: string | null;
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
    result_limit: limit,
    sort_by_distance: true,
  });

  if (error) return { products: [], error: error.message };

  // Mapeamos el output de V4 (profiles JSONB) a NearbyProduct.
  //
  // Aqui habia un `(p: any)`. El tipo generado para este RPC existe y es
  // exacto, asi que el any no simplificaba nada: tapaba. Si la funcion cambia
  // una columna de nombre, con `any` esto sigue compilando y el feed se pinta
  // con el campo vacio, que es como se pierde media hora buscando en el sitio
  // equivocado. Con el tipo generado deja de compilar, que es lo que se quiere.
  const products: NearbyProduct[] = (data ?? []).map((p) => {
    // `profiles` viene declarado como Json, porque en la funcion es un JSONB
    // construido a mano. Json puede ser objeto, array, cadena o nulo, asi que
    // se comprueba antes de leerle campos en vez de afirmar que es un objeto.
    const vendedor = leerObjeto(p.profiles);
    return {
      id: p.id,
      titulo: p.titulo,
      slug: p.slug,
      precio: p.precio,
      modo_precio: p.modo_precio ?? null,
      imagen_principal: p.imagen_principal,
      categoria: p.categoria,
      tipo_entrega: p.tipo_entrega,
      distance_meters: fuzzDistance(p.distance_meters),
      vendedor_nombre: leerTexto(vendedor, "nombre") ?? "",
      vendedor_trust: leerTexto(vendedor, "trust_level") ?? "new",
      vendedor_rating: leerNumero(vendedor, "average_rating") ?? 0,
      vendedor_reviews: leerNumero(vendedor, "reviews_count") ?? 0,
    };
  });

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
  // count_nearby_vendors devuelve un entero. Antes se pedian hasta CIEN filas
  // completas al RPC del feed —cada una con su objeto de perfil y su agregado
  // de categorias— para contar en el cliente, y ademas se contaba por NOMBRE:
  // dos vendedores homonimos contaban como uno, y con mas de cien productos en
  // el radio la cuenta se quedaba corta en silencio. El RPC del feed no
  // devuelve el identificador del vendedor, asi que desde aqui no habia forma
  // de contarlo bien: era la herramienta equivocada.
  const { data, error } = await supabase.rpc("count_nearby_vendors", {
    user_lat: snapped.lat,
    user_lng: snapped.lng,
    radius_meters: snappedRadius,
  });

  if (error) return { count: 0, error: error.message };

  return { count: typeof data === "number" ? data : 0 };
}
