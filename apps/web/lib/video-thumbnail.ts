/**
 * Client-side video thumbnail generation + path-convention helpers.
 *
 * The marketplace stores product media as plain public URLs in
 * `products_services.galeria_imagenes` (TEXT[]). The polymorphic
 * `media_assets` table exists in the schema but is not wired up in
 * apps/web yet — wireup is tracked in MP#07 backlog.
 *
 * Until then, we associate a video at
 *   `${user}/${ts}-${i}.mp4`
 * with its thumbnail at
 *   `${user}/${ts}-${i}_thumb.jpg`
 * by pure path derivation. The display layer asks for that thumb URL
 * via <img>; if the thumb doesn't exist (legacy videos uploaded before
 * Phase 8), the <img>'s onError swaps to a `<video src="...#t=0.1">`
 * fallback so the user still sees the first frame.
 */

const VIDEO_EXT_RE = /\.(mp4|webm|mov)(\?[^#]*)?(#.*)?$/i;
const MAX_THUMB_WIDTH = 1080;
const THUMB_SEEK_TIME_SEC = 0.1;
const THUMB_JPEG_QUALITY = 0.85;

/**
 * Derive the thumbnail URL from a video URL using the path convention.
 * Preserves any query string and fragment for defensive URL handling.
 *
 *   path/file.mp4               -> path/file_thumb.jpg
 *   path/file.webm?v=2          -> path/file_thumb.jpg?v=2
 *   path/file.mov#t=10          -> path/file_thumb.jpg#t=10
 */
export function derivedThumbnailUrl(videoUrl: string): string {
  return videoUrl.replace(VIDEO_EXT_RE, "_thumb.jpg$2$3");
}

/**
 * Generate a JPEG thumbnail blob from the first frame of a video file
 * using a hidden <video> + <canvas>. Resolves with the blob; rejects on
 * any failure (canvas tainted, codec unsupported, decode error, etc.).
 *
 * Callers must wrap this in try/catch and treat failure as best-effort —
 * the upload should proceed even when thumbnail generation fails, and
 * the display falls back to <video #t=0.1> for the missing thumb.
 *
 * Limits the canvas to MAX_THUMB_WIDTH (1080) preserving aspect ratio
 * to keep memory reasonable on 4K source videos.
 */
export function generateVideoThumbnail(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    function cleanup() {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
    }

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }

    function done(blob: Blob) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(blob);
    }

    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    video.addEventListener("loadeddata", () => {
      // Seek to a slightly-non-zero timestamp because some codecs return
      // a black frame at exactly 0s.
      try {
        video.currentTime = THUMB_SEEK_TIME_SEC;
      } catch (err) {
        fail(err instanceof Error ? err : new Error("seek failed"));
      }
    });

    video.addEventListener("seeked", () => {
      try {
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        if (!sourceWidth || !sourceHeight) {
          throw new Error("video dimensions unavailable");
        }
        const scale = Math.min(1, MAX_THUMB_WIDTH / sourceWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(sourceWidth * scale);
        canvas.height = Math.round(sourceHeight * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas context unavailable");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              done(blob);
            } else {
              fail(new Error("toBlob returned null"));
            }
          },
          "image/jpeg",
          THUMB_JPEG_QUALITY,
        );
      } catch (err) {
        fail(err instanceof Error ? err : new Error("thumbnail draw failed"));
      }
    });

    video.addEventListener("error", () => {
      fail(new Error("video element error event"));
    });

    video.src = objectUrl;
  });
}
