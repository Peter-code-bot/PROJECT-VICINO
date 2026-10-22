import "server-only";
import sharp from "sharp";
import { IMAGE_MAX_SIDE } from "./product-media-policy";

/** Fully decode the small delivery image; header checks alone are insufficient. */
export async function validateImageOutput(blob: Blob): Promise<void> {
  const input = Buffer.from(await blob.arrayBuffer());
  const image = sharp(input, { limitInputPixels: IMAGE_MAX_SIDE ** 2, failOn: "warning" });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width > IMAGE_MAX_SIDE || metadata.height > IMAGE_MAX_SIDE ||
      metadata.pages && metadata.pages !== 1 || metadata.exif || metadata.xmp || metadata.iptc) {
    throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
  }
  // Forces entropy/frame decoding as well as header parsing. Memory is bounded
  // to at most 1200x1200 pixels and inputs are capped at 2 MiB by the caller.
  await image.raw().toBuffer();
}
