import type { SupabaseClient } from "@supabase/supabase-js";

const PUBLIC_BUCKET_RE =
  /\/storage\/v1\/object\/public\/product-media\//;

const VIDEO_EXT_RE = /\.(mp4|webm|mov)$/i;

export function extractStoragePath(publicUrl: string): string | null {
  if (typeof publicUrl !== "string") return null;
  const match = publicUrl.match(PUBLIC_BUCKET_RE);
  if (!match) return null;
  const startOfPath = (match.index ?? 0) + match[0].length;
  const tail = publicUrl.slice(startOfPath);
  const queryIdx = tail.indexOf("?");
  const path = queryIdx === -1 ? tail : tail.slice(0, queryIdx);
  return path.length > 0 ? path : null;
}

function derivedThumbnailPath(videoPath: string): string {
  return videoPath.replace(/\.[^.]+$/, "_thumb.jpg");
}

export async function cleanupRemovedMedia(
  supabase: SupabaseClient,
  removedUrls: string[],
): Promise<{ ok: number; failed: number }> {
  if (!Array.isArray(removedUrls) || removedUrls.length === 0) {
    return { ok: 0, failed: 0 };
  }

  const paths: string[] = [];
  for (const url of removedUrls) {
    const path = extractStoragePath(url);
    if (!path) continue;
    paths.push(path);
    if (VIDEO_EXT_RE.test(path.split("?")[0] ?? "")) {
      paths.push(derivedThumbnailPath(path));
    }
  }

  if (paths.length === 0) {
    return { ok: 0, failed: removedUrls.length };
  }

  try {
    const { data, error } = await supabase.storage
      .from("product-media")
      .remove(paths);
    if (error) {
      console.warn("[media-cleanup] storage.remove error:", error.message);
      return { ok: 0, failed: paths.length };
    }
    const okCount = Array.isArray(data) ? data.length : 0;
    return { ok: okCount, failed: paths.length - okCount };
  } catch (err) {
    console.warn("[media-cleanup] storage.remove threw:", err);
    return { ok: 0, failed: paths.length };
  }
}
