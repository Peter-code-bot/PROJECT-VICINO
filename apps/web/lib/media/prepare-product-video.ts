import { createClient } from "@/lib/supabase/client";
import { compressNativeVideo } from "./native-video";
import { VIDEO_INPUT_MAX_BYTES, VIDEO_OUTPUT_MAX_BYTES } from "./product-media-policy";
import { readProductVideoMetadata } from "./video-metadata";
import { beginProductVideoProcessing, queueProductVideoProcessing, getProductVideoProcessing, cancelProductVideoProcessing } from "./video-processing-actions";

type Options = { signal?: AbortSignal; onProgress?: (progress: number) => void };
const keys = new WeakMap<File, string>();
const uploadLocations = new Map<string, string>();

function abort(signal?: AbortSignal) { signal?.throwIfAborted(); }
function wait(ms: number, signal?: AbortSignal) {
  abort(signal);
  return new Promise<void>((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", stop); resolve(); };
    const timer = setTimeout(finish, ms);
    const stop = () => { clearTimeout(timer); signal?.removeEventListener("abort", stop); reject(signal?.reason); };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** TUS uses bounded chunks and resumes a lost PATCH response via HEAD. */
export async function uploadVideoResumable(file: File, path: string, options: Options = {}) {
  abort(options.signal);
  const client = createClient();
  const session = await client.auth.getSession();
  if (!session.data.session) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
  const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const endpoint = new URL("/storage/v1/upload/resumable", base);
  const headers = { Authorization: `Bearer ${session.data.session.access_token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "Tus-Resumable": "1.0.0" };
  const metadata = Object.entries({ bucketName: "media-processing", objectName: path, contentType: file.type, cacheControl: "0" })
    .map(([key, value]) => `${key} ${btoa(value)}`).join(",");
  const request = (url: URL, init: RequestInit) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(options.signal ? [options.signal] : [])]) });
  let location = uploadLocations.get(path);
  if (!location) {
    const created = await request(endpoint, { method: "POST", headers: { ...headers, "Upload-Length": String(file.size), "Upload-Metadata": metadata } });
    if (!created.ok) throw new Error("No pudimos iniciar la subida del video.");
    location = created.headers.get("location") ?? undefined;
    if (!location) throw new Error("No pudimos iniciar la subida del video.");
  }
  const uploadUrl = new URL(location, endpoint);
  if (uploadUrl.origin !== base.origin || !uploadUrl.pathname.startsWith("/storage/v1/upload/resumable/")) throw new Error("La dirección de subida no es válida.");
  let offset = 0;
  if (uploadLocations.has(path)) {
    const state = await request(uploadUrl, { method: "HEAD", headers });
    if (!state.ok) { uploadLocations.delete(path); throw new Error("La subida anterior expiró. Inténtalo de nuevo."); }
    offset = Number(state.headers.get("Upload-Offset"));
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) throw new Error("El progreso de subida no es válido.");
  }
  if (uploadLocations.size >= 10 && !uploadLocations.has(path)) uploadLocations.delete(uploadLocations.keys().next().value!);
  uploadLocations.set(path, uploadUrl.href);
  let attempts = 0;
  while (offset < file.size) {
    abort(options.signal);
    try {
      const response = await request(uploadUrl, { method: "PATCH", headers: { ...headers, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" }, body: file.slice(offset, offset + 6 * 1024 * 1024) });
      if (!response.ok) throw new Error("No pudimos subir el video.");
      const next = Number(response.headers.get("Upload-Offset"));
      if (!Number.isSafeInteger(next) || next <= offset || next > file.size) throw new Error("El progreso de subida no es válido.");
      offset = next; attempts = 0;
      options.onProgress?.(offset / file.size);
    } catch (error) {
      abort(options.signal);
      if (++attempts > 3) throw error;
      await wait(500 * attempts, options.signal);
      const state = await request(uploadUrl, { method: "HEAD", headers });
      if (!state.ok) throw new Error("No pudimos reanudar la subida.");
      const next = Number(state.headers.get("Upload-Offset"));
      if (!Number.isSafeInteger(next) || next < 0 || next > file.size) throw new Error("El progreso de subida no es válido.");
      offset = next;
    }
  }
}

export async function prepareProductVideo(file: File, options: Options = {}): Promise<File> {
  abort(options.signal);
  if (!file.size || file.size > VIDEO_INPUT_MAX_BYTES) throw new Error("Elige un video de hasta 200 MB.");
  if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type)) throw new Error("Elige un video MP4, MOV o WebM.");
  options.onProgress?.(0);
  let nativeError: unknown;
  try {
    const optimized = await compressNativeVideo(file, options);
    if (optimized) { await readProductVideoMetadata(optimized); return optimized; }
  } catch (error) { abort(options.signal); nativeError = error; }
  if (typeof window !== "undefined" && typeof VideoEncoder === "function" && typeof VideoDecoder === "function") {
    try {
      const { compressBrowserVideo } = await import("./browser-video");
      const optimized = await compressBrowserVideo(file, options);
      if (optimized) return optimized;
    } catch (error) {
      abort(options.signal);
      if (error instanceof Error && error.name === "VideoValidationError") throw error;
      nativeError = nativeError ?? error;
    }
  }
  // Re-encode every selected source when a transcoder is available: a compact
  // original can still retain GPS, unsupported audio, HDR or dimensions outside
  // the delivery policy.
  const key = keys.get(file) ?? crypto.randomUUID();
  keys.set(file, key);
  const started = await beginProductVideoProcessing({ key, size: file.size, mime: file.type });
  if (!started.job) {
    if (!nativeError && file.type === "video/mp4" && file.size <= VIDEO_OUTPUT_MAX_BYTES) {
      const meta = await readProductVideoMetadata(file);
      if (typeof meta?.duration === "number" && meta.duration > 0) {
        options.onProgress?.(1);
        return file;
      }
    }
    throw new Error(started.error ?? (nativeError ? "No pudimos optimizar este video." : "La optimización no está disponible."));
  }
  const job = started.job;
  try {
    if (job.status === "uploading") {
      await uploadVideoResumable(file, job.path, { ...options, onProgress: value => options.onProgress?.(value * 0.7) });
      const queued = await queueProductVideoProcessing(job.id);
      if (queued.error) throw new Error(queued.error);
    }
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      abort(options.signal);
      const status = await getProductVideoProcessing(job.id);
      if (!status.job) throw new Error(status.error);
      if (status.job.status === "failed" || status.job.status === "cancelled") { keys.delete(file); uploadLocations.delete(job.path); throw new Error("No pudimos convertir este video. Vuelve a seleccionarlo para reintentar."); }
      if (status.job.status === "ready" && status.job.url) {
        // Use the same bounded streaming reader as final server validation.
        const { readStoredMedia } = await import("./read-stored-media");
        const blob = await readStoredMedia(status.job.url, VIDEO_OUTPUT_MAX_BYTES, (url, init) => fetch(url, {
          ...init,
          signal: options.signal && init?.signal ? AbortSignal.any([options.signal, init.signal]) : options.signal ?? init?.signal,
        }));
        await readProductVideoMetadata(blob);
        uploadLocations.delete(job.path);
        options.onProgress?.(1);
        return new File([blob], "optimized.mp4", { type: "video/mp4" });
      }
      await wait(1500, options.signal);
    }
    throw new Error("El video sigue procesándose. Inténtalo de nuevo en unos minutos.");
  } catch (error) {
    if (options.signal?.aborted) { await cancelProductVideoProcessing(job.id); keys.delete(file); }
    throw error;
  }
}
