/**
 * Client-side video thumbnail generation + path-convention helpers.
 *
 * Product media coexists in two stores: `products_services.galeria_imagenes`
 * (TEXT[] denormalized cache, canonical for render today) and `media_assets`
 * (normalized, polymorphic, populated by the upload write path since
 * MP#07 #7-5b). The render switch to media_assets is deferred to
 * MP#07 #7-5c behind a feature flag.
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

import type { CropArea } from "@/lib/crop-image";

// Exported so server actions can reuse the same video detection regex
// when classifying URLs into media_assets.type (image vs video) at insert
// time, matching the same regex parity used in the 5a backfill SQL
// (~* '\.(mp4|webm|mov)(\?.*)?$').
export const VIDEO_EXT_RE = /\.(mp4|webm|mov)(\?[^#]*)?(#.*)?$/i;
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

/**
 * Generate a JPEG thumbnail blob from the first frame of a video file,
 * drawing ONLY the user-selected crop area. This produces a thumbnail
 * that visually matches what the user chose in the cropper.
 *
 * Same error contract as `generateVideoThumbnail` — callers must
 * treat failure as best-effort.
 */
export function generateCroppedVideoThumbnail(
  file: File,
  cropArea: CropArea,
): Promise<Blob> {
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
      try {
        video.currentTime = THUMB_SEEK_TIME_SEC;
      } catch (err) {
        fail(err instanceof Error ? err : new Error("seek failed"));
      }
    });

    video.addEventListener("seeked", () => {
      try {
        const { x, y, width, height } = cropArea;
        if (!width || !height) {
          throw new Error("crop area dimensions invalid");
        }
        const scale = Math.min(1, MAX_THUMB_WIDTH / width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas context unavailable");
        ctx.drawImage(
          video,
          x,
          y,
          width,
          height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
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
        fail(err instanceof Error ? err : new Error("cropped thumbnail draw failed"));
      }
    });

    video.addEventListener("error", () => {
      fail(new Error("video element error event"));
    });

    video.src = objectUrl;
  });
}
