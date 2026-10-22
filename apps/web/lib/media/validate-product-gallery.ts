import { readStoredMedia } from "./read-stored-media";
import { validateImageOutput } from "./validate-image-output.server";
import { z } from "zod";
import { readProductImageMetadata } from "./prepare-product-image";
import { IMAGE_OUTPUT_MAX_BYTES, MAX_PRODUCT_MEDIA, VIDEO_OUTPUT_MAX_BYTES } from "./product-media-policy";

const gallerySchema = z.array(z.string().min(1).max(2048)).max(MAX_PRODUCT_MEDIA)
  .refine(values => new Set(values).size === values.length, "La galería contiene archivos repetidos");

export function parseProductGallery(raw: FormDataEntryValue | null): string[] {
  if (raw === null || raw === "") return [];
  if (typeof raw !== "string" || raw.length > 12_000) throw new Error("La galería no es válida");
  try { return gallerySchema.parse(JSON.parse(raw)); }
  catch { throw new Error("La galería debe contener hasta 5 archivos válidos, sin repetir"); }
}

/** Compare canonical URLs, never a startsWith host or a decoded path prefix. */
export function ownedProductMediaPath(value: string, ownerId: string, baseUrl: string): string | null {
  try {
    const base = new URL(baseUrl);
    const url = new URL(value);
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) return null;
    const prefix = `/storage/v1/object/public/product-media/${ownerId}/`;
    if (!url.pathname.startsWith(prefix)) return null;
    const path = url.pathname.slice("/storage/v1/object/public/product-media/".length);
    if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) return null;
    // Worker outputs are provisional and may be collected. The client publishes
    // its own verified copy with the chosen cover, never the provisional URL.
    if (path.split("/")[1] === "processed") return null;
    // URL normalizes dot segments. Reject the noncanonical original as well.
    if (value !== `${url.origin}${url.pathname}`) return null;
    return path;
  } catch { return null; }
}

export async function validateProductGallery(args: {
  urls: string[]; ownerId: string; baseUrl: string; existing?: readonly string[];
  request?: typeof fetch;
}): Promise<void> {
  gallerySchema.parse(args.urls);
  const existing = new Set(args.existing ?? []);
  // Existing URLs were read from THIS authenticated owner's listing. Preserve
  // historical galleries without downloading/rejecting every legacy file.
  for (const url of args.urls) {
    if (existing.has(url)) continue;
    const path = ownedProductMediaPath(url, args.ownerId, args.baseUrl);
    if (!path) throw new Error("Uno de los archivos no pertenece a tu publicación.");
    const video = /\.(mp4|webm|mov)$/i.test(path);
    const blob = await readStoredMedia(url, video ? VIDEO_OUTPUT_MAX_BYTES : IMAGE_OUTPUT_MAX_BYTES, args.request);
    if (video) {
      const { readProductVideoMetadata } = await import("./video-metadata");
      await readProductVideoMetadata(blob);
    } else {
      const metadata = await readProductImageMetadata(blob);
      const extension = path.split(".").pop()?.toLowerCase();
      const expected = metadata.type === "image/jpeg" ? ["jpg", "jpeg"] : [metadata.type.slice(6)];
      if (!expected.includes(extension ?? "") || blob.type !== metadata.type) throw new Error("El formato de una foto no coincide con su contenido.");
      await validateImageOutput(blob);
    }
  }
}
