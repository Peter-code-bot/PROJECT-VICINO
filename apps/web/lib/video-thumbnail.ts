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


// Exported so server actions can reuse the same video detection regex
// when classifying URLs into media_assets.type (image vs video) at insert
// time, matching the same regex parity used in the 5a backfill SQL
// (~* '\.(mp4|webm|mov)(\?.*)?$').
export const VIDEO_EXT_RE = /\.(mp4|webm|mov)(\?[^#]*)?(#.*)?$/i;
const MAX_THUMB_WIDTH = 1080;
/**
 * Instante por defecto del que se saca la portada de un video.
 *
 * 0,1 s y no 0 a proposito: en el fotograma cero muchos codecs devuelven negro
 * o basura porque el decodificador aun no tiene datos.
 *
 * Es solo el DEFECTO. Desde el selector de portada el vendedor elige el
 * instante: antes no podia, y se quedaba con la portada que saliera.
 */
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
 * Whether a stored media URL points at a video. Single source of truth for
 * the render layer — VIDEO_EXT_RE already tolerates `?query` and `#frag`,
 * so callers must NOT pre-strip the query string.
 */
export function isVideoUrl(url: string): boolean {
  return VIDEO_EXT_RE.test(url);
}

/**
 * URL de imagen segura para <Image>: el poster si es video, la propia URL si no.
 *
 * `derivedThumbnailUrl` ya es idempotente sobre imágenes — el .replace no
 * matchea y devuelve el string intacto. El wrapper existe por claridad en el
 * call site, no por lógica: donde se lee `posterUrl(x)` queda explícito que
 * ese destino solo sabe pintar imágenes.
 *
 * Caveat: para videos sin `_thumb.jpg` (legacy pre-Phase 8, o generación que
 * falló/expiró) la URL devuelta 404ea. Eso NO es una regresión — hoy esas
 * superficies reciben el .mp4 crudo y también fallan. Superficies que puedan
 * degradar a <video> deben usar `isVideoUrl` en vez de esto.
 */
export function posterUrl(url: string): string {
  return derivedThumbnailUrl(url);
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
export function generateVideoThumbnail(
  file: File,
  /** Segundo del que sacar la portada. Se acota a la duracion real del video. */
  segundo: number = THUMB_SEEK_TIME_SEC,
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
      // Seek to a slightly-non-zero timestamp because some codecs return
      // a black frame at exactly 0s.
      try {
        // Acotado a la duracion real: pedir un instante mas alla del final
        // deja el evento "seeked" sin disparar y la promesa colgada para
        // siempre. El isFinite cubre los videos cuya duracion llega como NaN
        // mientras el navegador aun no la sabe.
        const dur = Number.isFinite(video.duration) ? video.duration : 0;
        video.currentTime =
          dur > 0
            ? Math.min(Math.max(segundo, 0), Math.max(dur - 0.05, 0))
            : THUMB_SEEK_TIME_SEC;
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
