import type { SupabaseClient } from "@supabase/supabase-js";
import { comprimirFoto } from "@/lib/chat/attachments";

/** Separate private bucket; post/comment storage permissions are untouched. */
export const COMMUNITY_PHOTO_BUCKET = "community-photos";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function readCommunityPhotoPath(path: unknown, communityId: string): string | null {
  if (typeof path !== "string" || path.length > 512 || !UUID_PATTERN.test(communityId)) return null;
  const [group, user, file, extra] = path.split("/");
  return extra === undefined && group === communityId && UUID_PATTERN.test(user ?? "") &&
    file?.endsWith(".webp") && UUID_PATTERN.test(file.slice(0, -5)) ? path : null;
}

export function isCommunityPhotoPath(path: string, communityId: string, userId: string): boolean {
  return readCommunityPhotoPath(path, communityId) !== null && path.split("/")[1] === userId;
}

export async function uploadCommunityPhoto(supabase: SupabaseClient, communityId: string, userId: string, file: File) {
  const { blob } = await comprimirFoto(file);
  const path = `${communityId}/${userId}/${crypto.randomUUID()}.webp`;
  try {
    const { error } = await supabase.storage.from(COMMUNITY_PHOTO_BUCKET).upload(path, blob, { contentType: "image/webp", cacheControl: "60", upsert: false });
    if (error) throw error;
    return path;
  } catch (error) {
    // An upload can land before its response is lost. No identity call has run
    // yet, so clean this new object; storage also protects referenced photos.
    await removeCommunityPhoto(supabase, path);
    throw error;
  }
}

export async function removeCommunityPhoto(supabase: SupabaseClient, path: string) {
  try { await supabase.storage.from(COMMUNITY_PHOTO_BUCKET).remove([path]); } catch { /* best effort; original error remains actionable */ }
}

/** On an uncertain identity response, re-read before deleting any staged file. */
export async function cleanupUnreferencedCommunityPhoto(supabase: SupabaseClient, communityId: string, path: string) {
  try {
    const { data, error } = await supabase.rpc("detalle_comunidad", { p_community_id: communityId });
    const row: unknown = Array.isArray(data) ? data[0] : null;
    if (error || !row || typeof row !== "object" || !("id" in row) || row.id !== communityId || !("mi_rol" in row) || row.mi_rol !== "owner" || !("foto_path" in row) || (row.foto_path !== null && typeof row.foto_path !== "string")) return;
    if (row.foto_path !== path) await removeCommunityPhoto(supabase, path);
  } catch { /* Keep the file when commit status cannot be verified. */ }
}

/** Sign using the caller's session. Storage RLS hides private photos from outsiders. */
export async function withCommunityPhotos<T extends { id: string; foto_path?: string | null }>(supabase: SupabaseClient, items: T[]): Promise<(T & { foto_url: string | null })[]> {
  const validPath = (item: T) => readCommunityPhotoPath(item.foto_path, item.id);
  const paths = [...new Set(items.flatMap(item => { const path = validPath(item); return path ? [path] : []; }))];
  if (!paths.length) return items.map(item => ({ ...item, foto_url: null }));
  try {
    const { data } = await supabase.storage.from(COMMUNITY_PHOTO_BUCKET).createSignedUrls(paths, 600);
    const urls = new Map(data?.filter(item => item.path && item.signedUrl).map(item => [item.path, item.signedUrl]) ?? []);
    return items.map(item => { const path = validPath(item); return { ...item, foto_url: path ? urls.get(path) ?? null : null }; });
  } catch { return items.map(item => ({ ...item, foto_url: null })); }
}
