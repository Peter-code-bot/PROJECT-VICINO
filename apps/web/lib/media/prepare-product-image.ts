import { IMAGE_INPUT_MAX_BYTES, IMAGE_MAX_PIXELS, IMAGE_OUTPUT_MAX_BYTES, IMAGE_TARGET_BYTES } from "./product-media-policy";

type ImageHeader = { type: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number };

/** Read dimensions before handing untrusted bytes to a browser decoder. */
export function readProductImageHeader(bytes: Uint8Array): ImageHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length >= 24 && text(0, 8) === "\x89PNG\r\n\x1a\n" && text(12, 4) === "IHDR") {
    return { type: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 30 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    const chunk = text(12, 4);
    if (chunk === "VP8X") return { type: "image/webp", width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16), height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16) };
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) return { type: "image/webp", width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { type: "image/webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x00 || marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2) break;
      if (marker !== undefined && [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length >= 7 && offset + 7 <= bytes.length) {
          return { type: "image/jpeg", width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
        }
        break;
      }
      if (offset + length > bytes.length) break;
      offset += length;
    }
  }
  throw new Error("No pudimos leer la imagen. Elige un JPG, PNG o WebP válido.");
}

export function checkImageDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > IMAGE_MAX_PIXELS) {
    throw new Error("La foto supera el límite de 100 megapíxeles o tiene dimensiones inválidas.");
  }
}

/** Signature and dimensions only; safe for server-side validation of stored blobs. */
export async function readProductImageMetadata(file: Blob): Promise<ImageHeader> {
  const header = readProductImageHeader(new Uint8Array(await file.slice(0, 8 * 1024 * 1024).arrayBuffer()));
  checkImageDimensions(header.width, header.height);
  return header;
}

function concatUint8Arrays(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return out;
}

/**
 * Strip APP1 (EXIF/XMP), APP3-APP15 (including APP13 IPTC), and COM segments
 * that iOS WKWebView/Safari ImageIO injects during canvas.toBlob("image/jpeg").
 */
export function stripJpegMetadataSegments(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return concatUint8Arrays([bytes]);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  let stripped = false;
  while (offset + 4 <= bytes.length) {
    const segmentStart = offset;
    if (bytes[offset++] !== 0xff) {
      chunks.push(bytes.subarray(segmentStart));
      return concatUint8Arrays(stripped ? chunks : [bytes]);
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++]!;
    if (marker === 0xda || marker === 0xd9) {
      chunks.push(bytes.subarray(segmentStart));
      return concatUint8Arrays(stripped ? chunks : [bytes]);
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      chunks.push(bytes.subarray(segmentStart, offset));
      continue;
    }
    if (offset + 2 > bytes.length) {
      chunks.push(bytes.subarray(segmentStart));
      return concatUint8Arrays(stripped ? chunks : [bytes]);
    }
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) {
      chunks.push(bytes.subarray(segmentStart));
      return concatUint8Arrays(stripped ? chunks : [bytes]);
    }
    const segmentEnd = offset + length;
    const isMetadata = marker === 0xe1 || (marker >= 0xe3 && marker <= 0xef) || marker === 0xfe;
    if (isMetadata) {
      stripped = true;
    } else {
      chunks.push(bytes.subarray(segmentStart, segmentEnd));
    }
    offset = segmentEnd;
  }
  if (offset < bytes.length) chunks.push(bytes.subarray(offset));
  return concatUint8Arrays(stripped ? chunks : [bytes]);
}

export function abortImageWork(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Preparación cancelada", "AbortError");
}

export function canvasJpeg(canvas: HTMLCanvasElement, quality: number, signal?: AbortSignal): Promise<Blob> {
  abortImageWork(signal);
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, blob?: Blob) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error); else if (blob) resolve(blob);
    };
    const aborted = () => finish(new DOMException("Preparación cancelada", "AbortError"));
    const timer = setTimeout(() => finish(new Error("La preparación de la foto tardó demasiado.")), 25000);
    signal?.addEventListener("abort", aborted, { once: true });
    canvas.toBlob(rawBlob => {
      if (!rawBlob) { finish(new Error("No pudimos preparar la foto.")); return; }
      rawBlob.arrayBuffer().then(
        buffer => finish(undefined, new Blob([stripJpegMetadataSegments(new Uint8Array(buffer))], { type: "image/jpeg" })),
        () => finish(new Error("No pudimos preparar la foto.")),
      );
    }, "image/jpeg", quality);
  });
}

/** Re-encoding strips EXIF; bounded quality/size attempts never return an oversized original. */
export async function compressProductCanvas(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<Blob> {
  for (let sizeAttempt = 0; sizeAttempt < 4; sizeAttempt++) {
    let last: Blob | null = null;
    for (const quality of [0.9, 0.8, 0.7, 0.6]) {
      last = await canvasJpeg(canvas, quality, signal);
      if (last.size <= IMAGE_TARGET_BYTES) return last;
    }
    if (last && last.size <= IMAGE_OUTPUT_MAX_BYTES) return last;
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(1, Math.floor(canvas.width * 0.8));
    smaller.height = Math.max(1, Math.floor(canvas.height * 0.8));
    const context = smaller.getContext("2d");
    if (!context) throw new Error("No pudimos preparar la foto.");
    context.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    canvas.width = smaller.width;
    canvas.height = smaller.height;
    canvas.getContext("2d")!.drawImage(smaller, 0, 0);
    smaller.width = smaller.height = 0;
  }
  throw new Error("No pudimos reducir la foto a 2 MB. Elige otra imagen.");
}

/** One image at a time. Preview pixels are bounded before the crop modal mounts. */
export async function prepareProductImage(file: File, options: { signal?: AbortSignal } = {}): Promise<Blob> {
  const { signal } = options;
  abortImageWork(signal);
  if (!file.size || file.size > IMAGE_INPUT_MAX_BYTES) throw new Error("Elige una foto de hasta 150 MB.");
  const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  const normalizedType = file.type.trim().toLowerCase();
  const isStandardWebType = ["image/jpeg", "image/png", "image/webp"].includes(normalizedType);
  let header: ImageHeader | null = null;
  if (!isHeic) {
    try {
      header = await readProductImageMetadata(file);
    } catch (error) {
      if (isStandardWebType || !normalizedType.startsWith("image/")) throw error;
    }
    if (header && isStandardWebType && normalizedType !== header.type) {
      throw new Error("El formato de la foto no coincide con su contenido.");
    }
    if (!header && !normalizedType.startsWith("image/")) {
      throw new Error("Elige una foto JPG, PNG o WebP.");
    }
  }
  abortImageWork(signal);
  const maxPreviewSide = 2400;
  let bitmap: ImageBitmap | undefined;
  let fallback: HTMLImageElement | undefined;
  let url: string | undefined;
  const canvas = document.createElement("canvas");
  try {
    if (typeof createImageBitmap === "function") {
      // EXIF orientation is applied by the decoder; never use imageOrientation:none.
      let expired = false;
      const bitmapOptions: ImageBitmapOptions | undefined = header
        ? {
            resizeWidth: Math.max(1, Math.round(Math.min(header.width, header.height) * Math.min(1, maxPreviewSide / Math.max(header.width, header.height)))),
            resizeQuality: "high",
          }
        : undefined;
      // Specify only one side to preserve aspect ratio after EXIF rotation.
      const decoding = createImageBitmap(file, bitmapOptions).then(value => {
        if (expired || signal?.aborted) { value.close(); throw new Error("Preparación cancelada o agotada."); }
        return value;
      });
      try { bitmap = await boundedDecode(decoding, signal); } catch (error) {
        expired = true;
        // A timed-out bitmap may still be decoding: do not start a second decoder alongside it.
        if (signal?.aborted || (error instanceof Error && error.name === "TimeoutError")) throw error;
      }
    }
    if (!bitmap) {
      url = URL.createObjectURL(file);
      fallback = new Image();
      fallback.src = url;
      await boundedDecode(fallback.decode(), signal);
    }
    abortImageWork(signal);
    const source = bitmap ?? fallback!;
    const width = bitmap?.width ?? fallback!.naturalWidth;
    const height = bitmap?.height ?? fallback!.naturalHeight;
    checkImageDimensions(width, height);
    const outputScale = Math.min(1, maxPreviewSide / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * outputScale));
    canvas.height = Math.max(1, Math.round(height * outputScale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No pudimos preparar la foto.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return await canvasJpeg(canvas, 0.94, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (isHeic) throw new Error("Esta foto es HEIC/HEIF. Expórtala como JPG para publicarla.");
    if (error instanceof Error && /100 megap/.test(error.message)) throw error;
    throw new Error("No pudimos decodificar esta foto. Prueba con otro JPG, PNG o WebP.");
  } finally {
    bitmap?.close();
    if (fallback) fallback.src = "";
    if (url) URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}

function boundedDecode<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  abortImageWork(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", aborted); };
    const aborted = () => { cleanup(); reject(new DOMException("Preparación cancelada", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new DOMException("La foto tardó demasiado en abrirse.", "TimeoutError")); }, 25000);
    signal?.addEventListener("abort", aborted, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
