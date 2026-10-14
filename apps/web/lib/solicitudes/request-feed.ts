import { publicProfileName } from "@vicino/shared";
import type { Database } from "@/types/database.types";
import type { RequestCardData } from "@/components/solicitudes/request-card";

export type RequestFeedRow = Database["public"]["Functions"]["feed_nearby_requests"]["Returns"][number];
export type RequestCursor = { created_at: string; id: string };
export const REQUEST_PAGE_SIZE = 12;

export function requestFromRow(row: RequestFeedRow): RequestCardData | null {
  const profile = row.buyer_profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || typeof profile.nombre !== "string") return null;
  const categories = (Array.isArray(row.categories) ? row.categories : []).flatMap(category => {
    if (!category || typeof category !== "object" || Array.isArray(category)) return [];
    return typeof category.slug === "string" && typeof category.nombre === "string" ? [{ slug: category.slug, nombre: category.nombre }] : [];
  });
  return { ...row, categories, buyer_profile: { nombre: publicProfileName(profile), avatar_url: typeof profile.avatar_url === "string" ? profile.avatar_url : null } };
}

/** Cursor follows the last raw record, even when a malformed DTO is discarded. */
export function decodeRequestPage(rows: RequestFeedRow[]) {
  const visible = rows.slice(0, REQUEST_PAGE_SIZE);
  const last = visible.at(-1);
  return {
    requests: visible.flatMap(row => requestFromRow(row) ?? []),
    cursor: last ? { created_at: last.created_at, id: last.id } : null,
    hasMore: rows.length > REQUEST_PAGE_SIZE,
  };
}

export function appendRequestPage(previous: RequestCardData[], next: RequestCardData[]) {
  return [...new Map([...previous, ...next].map(request => [request.id, request])).values()];
}
