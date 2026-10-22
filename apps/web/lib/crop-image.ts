import { IMAGE_MAX_SIDE } from "./media/product-media-policy";
import { compressProductCanvas } from "./media/prepare-product-image";

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function getCroppedBlob(
  imageSrc: string,
  cropArea: CropArea,
  maxSize = 512
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  const scale = Math.min(1, maxSize / cropArea.width);
  canvas.width = cropArea.width * scale;
  canvas.height = cropArea.height * scale;

  ctx.drawImage(
    image,
    cropArea.x,
    cropArea.y,
    cropArea.width,
    cropArea.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.92
    );
  });
}

/**
 * Product-grade crop — higher resolution (1200px) and quality (0.90)
 * than the avatar variant (512px / 0.92). Used by product-media-cropper
 * to produce the final image blob that gets uploaded to product-media.
 */
export async function getCroppedProductBlob(
  imageSrc: string,
  cropArea: CropArea,
  options: { signal?: AbortSignal } = {},
): Promise<Blob> {
  const image = await loadImage(imageSrc, options.signal);
  const canvas = document.createElement("canvas");
  try {
    if (![cropArea.x, cropArea.y, cropArea.width, cropArea.height].every(Number.isFinite) || cropArea.width <= 0 || cropArea.height <= 0) throw new Error("Recorte inválido");
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(cropArea.width, cropArea.height));
    canvas.width = Math.max(1, Math.round(cropArea.width * scale));
    canvas.height = Math.max(1, Math.round(cropArea.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas context");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, cropArea.x, cropArea.y, cropArea.width, cropArea.height, 0, 0, canvas.width, canvas.height);
    return await compressProductCanvas(canvas, options.signal);
  } finally {
    image.src = "";
    canvas.width = canvas.height = 0;
  }
}

function loadImage(src: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (signal?.aborted) { reject(new DOMException("Cancelado", "AbortError")); return; }
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", aborted); img.onload = img.onerror = null; };
    const aborted = () => { cleanup(); img.src = ""; reject(new DOMException("Cancelado", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); img.src = ""; reject(new Error("La imagen tardó demasiado en abrirse.")); }, 15000);
    signal?.addEventListener("abort", aborted, { once: true });
    img.crossOrigin = "anonymous";
    img.onload = () => { cleanup(); resolve(img); };
    img.onerror = () => { cleanup(); reject(new Error("No pudimos abrir la imagen.")); };
    img.src = src;
  });
}

export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
