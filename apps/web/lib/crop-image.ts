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
): Promise<Blob> {
  return getCroppedBlob(imageSrc, cropArea, 1200);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
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
