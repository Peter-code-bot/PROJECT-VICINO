import type { createClient } from "@/lib/supabase/server";
import { HISTORIAL_PAGE_SIZE, type HistorialLocation } from "./navigation";

type Client = Awaited<ReturnType<typeof createClient>>;

async function loadPage(client: Client, userId: string, role: "seller_id" | "buyer_id", requestedPage: number) {
  const query = (page: number) => client.from("sale_confirmations").select(`
    id, precio_acordado, cantidad, status, created_at, completed_at,
    buyer_id, seller_id,
    products_services(id, titulo, imagen_principal),
    buyer:profiles!buyer_id(nombre, trust_level),
    seller:profiles!seller_id(nombre, trust_level)
  `, { count: "exact" }).eq(role, userId)
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range((page - 1) * HISTORIAL_PAGE_SIZE, page * HISTORIAL_PAGE_SIZE - 1);
  try {
    let result = await query(requestedPage);
    // PostgREST returns 416 without a usable count for an obsolete page.
    // Fetch page one to recover the current total before clamping the URL.
    if (requestedPage > 1 && result.error?.code === "PGRST103") result = await query(1);
    if (result.error || result.count === null || !result.data) throw new Error("Historial unavailable");
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(result.count / HISTORIAL_PAGE_SIZE)));
    if (page !== requestedPage) result = await query(page);
    if (result.error || result.count === null || !result.data) throw new Error("Historial unavailable");
    return { items: result.data, total: result.count, page, error: false };
  } catch {
    return { items: [], total: null, page: requestedPage, error: true };
  }
}

async function loadStats(client: Client, userId: string, now: Date) {
  const count = () => client.from("sale_confirmations").select("id", { count: "exact", head: true }).eq("seller_id", userId);
  try {
    const results = await Promise.all([
      count().eq("status", "pending_confirmation"),
      count().eq("status", "completed"),
      count().gte("created_at", new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()).lte("created_at", now.toISOString()),
    ]);
    if (results.some(r => r.error || r.count === null)) return null;
    return { enCurso: results[0]!.count!, completadas: results[1]!.count!, ultimosSieteDias: results[2]!.count! };
  } catch { return null; }
}

export async function loadHistorial(client: Client, userId: string, location: HistorialLocation, now = new Date()) {
  const [ventas, compras, stats] = await Promise.all([
    loadPage(client, userId, "seller_id", location.ventasPage),
    loadPage(client, userId, "buyer_id", location.comprasPage),
    loadStats(client, userId, now),
  ]);
  const ids = [...new Set([...ventas.items, ...compras.items].map(item => item.id))];
  const reviewedSales: string[] = [];
  let reviewsError = false;
  if (ids.length) {
    try {
      const result = await client.from("reviews").select("sale_confirmation_id, review_type")
        .eq("reviewer_id", userId).in("sale_confirmation_id", ids);
      if (result.error || !result.data) reviewsError = true;
      else reviewedSales.push(...result.data.map(r => `${r.sale_confirmation_id}-${r.review_type}`));
    } catch { reviewsError = true; }
  }
  return { ventas, compras, stats, reviewedSales, reviewsError };
}

export type HistorialData = Awaited<ReturnType<typeof loadHistorial>>;
