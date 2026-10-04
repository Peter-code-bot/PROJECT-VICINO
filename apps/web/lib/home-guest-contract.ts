import { z } from "zod";
import type { Database } from "@/types/database.types";
import type { CatalogFailure } from "@/lib/catalogo/estado-consulta";

type Functions = Database["public"]["Functions"];
export type GuestRequestPreview = Functions["home_guest_requests_preview"]["Returns"][number];
export type GuestCommunityPreview = Functions["home_guest_communities_preview"]["Returns"][number];
export type GuestPostPreview = Functions["home_guest_posts_preview"]["Returns"][number];

export const HOME_GUEST_PREVIEW_LIMIT = 12;
const id = z.string().uuid();
const date = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative();

/** Free text can contain contact/location data even when the DTO has no such
 * columns. This redaction belongs only to the guest preview, never to stored
 * content or authenticated reads. Each field is bounded before it is parsed.
 */
export function redactGuestPreviewText(value: string): string {
  // A literal percent elsewhere (e.g. "20%") must not prevent decoding a
  // map's valid escapes. Keep malformed UTF-8 escape runs as ordinary text.
  let text = value.replace(/(?:%[0-9a-f]{2})+/gi, escaped => {
    try { return decodeURIComponent(escaped); } catch { return escaped; }
  });
  text = text.replace(/\b[A-Z0-9._%+-]+(?:@|%40)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[correo oculto]");
  // Maps commonly encode latitude/longitude in separate query parameters.
  // Redact their values even when unrelated parameters separate the pair.
  text = text.replace(/([?&](?:m?lat(?:itude)?|m?lon(?:gitude)?|lng)=)([-+]?\d{1,3}(?:\.\d+)?)(?=[&#\s]|$)/gi, (match, key: string, coordinate: string) =>
    Math.abs(Number(coordinate)) <= (/lat/i.test(key) ? 90 : 180) ? `${key}[ubicación oculta]` : match);
  text = text.replace(/(?:lat(?:itud)?\s*[:=]\s*)?([-+]?\d{1,2}\.\d+)\s*(?:[,;]|\s+(?:lng|lon(?:gitud)?)\s*[:=])\s*([-+]?\d{1,3}\.\d+)/gi, (match, lat: string, lng: string) =>
    Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180 ? "[ubicación oculta]" : match);
  text = text.replace(/(?<![\p{L}\p{N}])\+?\d[\d\s().-]{5,}\d(?![\p{L}\p{N}])/gu, match => {
    const digits = match.replace(/\D/g, "").length;
    // An ISO date is useful preview text, not a telephone number.
    return digits >= 7 && digits <= 15 && !/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(match)
      ? "[teléfono oculto]" : match;
  });
  return text;
}
// PostgreSQL char_length/left count Unicode codepoints; JS string.length counts
// UTF-16 units. Bound the units first, then match SQL without splitting emoji.
const previewText = (max: number) => z.string().max(max * 2)
  .refine(value => value.length <= max * 2 && Array.from(value).length <= max, "Preview text exceeds its character limit")
  .transform(value => Array.from(redactGuestPreviewText(value)).slice(0, max).join(""));

// Explicit allowlists are used before the server serializes a row. An extra
// column in a future RPC must not silently enter the RSC payload or API.
const requestSchema = z.object({
  id, titulo: previewText(120).refine(value => value.length > 0), descripcion: previewText(240).nullable(),
  presupuesto_max: z.number().nonnegative().nullable(), categoria: z.string().max(100).regex(/^[a-z0-9_-]+$/).nullable(),
  created_at: date.nullable(),
});
const communitySchema = z.object({
  id, nombre: previewText(100).refine(value => value.length > 0), descripcion: previewText(240).nullable(),
  miembros_count: count, publicaciones_count: count, ultima_publicacion_at: date.nullable(),
});
const postSchema = z.object({
  id, community_id: id, community_nombre: previewText(100).refine(value => value.length > 0),
  contenido: previewText(240).refine(value => value.length > 0), created_at: date,
  likes_count: count, comentarios_count: count,
});

export function parseGuestRequests(value: unknown): GuestRequestPreview[] {
  return z.array(requestSchema).max(HOME_GUEST_PREVIEW_LIMIT).parse(value);
}
export function parseGuestCommunities(value: unknown): GuestCommunityPreview[] {
  return z.array(communitySchema).max(HOME_GUEST_PREVIEW_LIMIT).parse(value);
}
export function parseGuestPosts(value: unknown): GuestPostPreview[] {
  return z.array(postSchema).max(HOME_GUEST_PREVIEW_LIMIT).parse(value);
}

export type HomeGuestPreview = {
  kind: "solicitudes";
  requests: GuestRequestPreview[];
  failure: CatalogFailure | null;
} | {
  kind: "comunidades";
  communities: GuestCommunityPreview[];
  posts: GuestPostPreview[];
  communityFailure: CatalogFailure | null;
  postFailure: CatalogFailure | null;
};
