"use server";

import { createClient } from "@/lib/supabase/server";
import type { FeedProduct } from "@/types/feed";
import { parseFeedCursor, makeFeedCursor } from "@/lib/feed-cursor";
import { enforce, getClientIp, readHeavyRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";

/**
 * A5.2: cursor-based load-more for the home "Mas productos" flat section.
 *
 * Returns products strictly OLDER than `cursor` (ISO timestamp of the
 * boundary item -- typically the oldest of the initial 150 fetched by
 * the home Server Component), ordered DESC so the call-site can append
 * directly. `nextCursor` is the OLDEST returned `created_at` (the last
 * item, since DESC) when the page filled; null otherwise.
 *
 * The SELECT shape mirrors the initial 150 fetch in
 * apps/web/app/(marketplace)/page.tsx so the result feeds ProductCard
 * via the same normalizeCardCategories helper.
 *
 * Out of scope by design:
 *  - No filtering by user / category here -- this is the global Para ti
 *    flat feed. The carousels above already do the grouping work on the
 *    initial 150; pages 2..N are intentionally flat and ordered by
 *    recency. See proposal.md Constraint and design.md Option C.
 *  - No rate limit guard -- this is a READ. RLS does not gate visibility
 *    of `estatus = disponible` products beyond what the public home
 *    already exposes server-side.
 */
export async function getMoreFeedProducts(
  cursor: string,
  limit: number = 30,
  lat?: number,
  lng?: number,
): Promise<{
  items: FeedProduct[];
  nextCursor: string | null;
  error?: string;
}> {
  const parsedCursor = parseFeedCursor(cursor);
  if (!parsedCursor.ok) {
    return { items: [], nextCursor: null, error: "Cursor invalido" };
  }

  // Rate Limiting con Fail-Open
  try {
    const ip = getClientIp(await headers());
    const rateCheck = enforce(readHeavyRateLimit, `feed:${ip}`);
    const timeout = new Promise<{ok: true}>((resolve) => setTimeout(() => resolve({ ok: true }), 800));
    const rate = await Promise.race([rateCheck, timeout]);
    if (!rate.ok) {
      // Si el rate limiter falla intencionalmente (too many requests), reportamos pero dejamos pasar para no romper ventas
      Sentry.captureMessage("Feed rate limit exceeded", { level: "warning" });
    }
  } catch (e) {
    Sentry.captureException(e);
  }

  // CODEX H2 fix: clamp limit. The default is 30; cap at 50 so a
  // direct caller cannot request thousands of rows with joined
  // profiles + product_categories embeds.
  const safeLimit = Math.min(Math.max(1, limit), 50);

  const supabase = await createClient();

  let data = null;
  let error = null;

  if (lat !== undefined && lng !== undefined) {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return { items: [], nextCursor: null, error: "Coordenadas inválidas" };
    }
    const res = await supabase.rpc("search_nearby_products_v4", {
      user_lat: lat,
      user_lng: lng,
      radius_meters: 50000,
      cursor_time: parsedCursor.cursor.createdAt,
      cursor_id: parsedCursor.cursor.id,
      result_limit: safeLimit,
      sort_by_distance: false,
    });
    data = res.data;
    error = res.error;
  } else {
    // Fallback no-geo
    const res = await supabase
      .from("products_services")
      .select(`
        id, titulo, precio, imagen_principal, categoria, slug, created_at, precio_negociable,
        profiles!inner(nombre, trust_level, average_rating, reviews_count),
        product_categories(is_primary, categories(slug, nombre))
      `)
      .eq("estatus", "disponible")
      .or(`created_at.lt.${parsedCursor.cursor.createdAt},and(created_at.eq.${parsedCursor.cursor.createdAt},id.lt.${parsedCursor.cursor.id})`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(safeLimit);
    data = res.data;
    error = res.error;
  }

  if (error) return { items: [], nextCursor: null, error: error.message };

  const items = (data ?? []) as FeedProduct[];

  const nextCursor =
    items.length === safeLimit 
      ? makeFeedCursor(items[items.length - 1]!.created_at, items[items.length - 1]!.id)
      : null;
  return { items, nextCursor };
}
