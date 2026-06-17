"use server";

import { createClient } from "@/lib/supabase/server";
import type { FeedProduct } from "@/types/feed";

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
  // CODEX M4 fix: validate the cursor ISO timestamp before the query
  // to avoid leaking a verbose Postgres cast error to the client when a
  // hostile / buggy caller passes a malformed cursor.
  if (Number.isNaN(Date.parse(cursor))) {
    return { items: [], nextCursor: null, error: "Cursor invalido" };
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
    const res = await supabase.rpc("feed_nearby_products", {
      user_lat: lat,
      user_lng: lng,
      radius_meters: 25000,
      cursor_time: cursor,
      result_limit: safeLimit,
    });
    data = res.data;
    error = res.error;
  } else {
    const res = await supabase
      .from("products_services")
      .select(
        `
        id,
        titulo,
        precio,
        imagen_principal,
        categoria,
        slug,
        created_at,
        precio_negociable,
        profiles!inner(nombre, trust_level, average_rating, reviews_count),
        product_categories(is_primary, categories(slug, nombre))
      `,
      )
      .eq("estatus", "disponible")
      .lt("created_at", cursor)
      .order("created_at", { ascending: false })
      .limit(safeLimit);
    data = res.data;
    error = res.error;
  }

  if (error) return { items: [], nextCursor: null, error: error.message };

  const items = (data ?? []) as FeedProduct[];

  // DESC order: the last (and oldest) item is the next cursor boundary.
  const nextCursor =
    items.length === safeLimit ? items[items.length - 1]!.created_at : null;
  return { items, nextCursor };
}
