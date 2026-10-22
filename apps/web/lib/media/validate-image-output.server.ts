import "server-only";
import { IMAGE_MAX_SIDE } from "./product-media-policy";
import { readProductImageHeader } from "./prepare-product-image";

const FORBIDDEN_EXIF_TAGS = new Set([
  0x010f, // Make
  0x0110, // Model
  0x0131, // Software
  0x013b, // Artist
  0x8298, // Copyright
  0x8825, // GPSInfoIFDPointer
  0x9003, // DateTimeOriginal
  0x9004, // DateTimeDigitized
  0x9286, // UserComment
  0xa430, // CameraOwnerName
  0xa431, // BodySerialNumber
  0xa433, // LensMake
  0xa434, // LensModel
  0xa435, // LensSerialNumber
]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (start < 0 || start + length > bytes.length) return "";
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[start + i]!);
  return out;
}

function validateExifTiff(tiff: Uint8Array): void {
  if (tiff.length < 8) throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
  const endian = ascii(tiff, 0, 2);
  if (endian !== "II" && endian !== "MM") {
    throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
  }
  const little = endian === "II";
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, little) !== 0x002a) {
    throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
  }
  const visited = new Set<number>();
  const scanIfd = (ifdOffset: number) => {
    if (ifdOffset <= 0 || ifdOffset + 2 > tiff.length || visited.has(ifdOffset)) return;
    visited.add(ifdOffset);
    const count = view.getUint16(ifdOffset, little);
    const entriesEnd = ifdOffset + 2 + count * 12;
    if (entriesEnd > tiff.length) {
      throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
    }
    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      const tag = view.getUint16(entry, little);
      const type = view.getUint16(entry + 2, little);
      const valueCount = view.getUint32(entry + 4, little);
      if (FORBIDDEN_EXIF_TAGS.has(tag)) {
        throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
      }
      if (tag === 0x0112) {
        const orientation = type === 3 && valueCount === 1
          ? view.getUint16(entry + 8, little)
          : view.getUint32(entry + 8, little);
        if (orientation !== 1) {
          throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
        }
      }
      if (tag === 0x8769 && (type === 4 || type === 3) && valueCount === 1) {
        const subIfd = type === 3 ? view.getUint16(entry + 8, little) : view.getUint32(entry + 8, little);
        scanIfd(subIfd);
      }
    }
  };
  scanIfd(view.getUint32(4, little));
}

function validateJpegContainer(bytes: Uint8Array): void {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("La imagen está incompleta o dañada.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let foundSof = false;
  let scanDataStart = 0;
  while (offset + 2 <= bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error("La imagen está incompleta o dañada.");
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) throw new Error("La imagen está incompleta o dañada.");
    const marker = bytes[offset++]!;
    if (marker === 0xd9) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) throw new Error("La imagen está incompleta o dañada.");
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) {
      throw new Error("La imagen está incompleta o dañada.");
    }
    if (marker === 0xed) {
      throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
    }
    if (marker === 0xe1) {
      const payload = bytes.subarray(offset + 2, offset + length);
      if (ascii(payload, 0, 6) === "Exif\0\0") {
        validateExifTiff(payload.subarray(6));
      } else if (ascii(payload, 0, 29) === "http://ns.adobe.com/xap/1.0/\0") {
        const xmp = ascii(payload, 29, payload.length - 29);
        if (/exif:GPS|tiff:Make|tiff:Model|photoshop:|tiff:Orientation\s*=\s*["']?[2-9]|<tiff:Orientation>[2-9]/i.test(xmp)) {
          throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
        }
      }
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) throw new Error("La imagen está incompleta o dañada.");
      const height = view.getUint16(offset + 3);
      const width = view.getUint16(offset + 5);
      if (width <= 0 || height <= 0 || width > IMAGE_MAX_SIDE || height > IMAGE_MAX_SIDE) {
        throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
      }
      foundSof = true;
    }
    if (marker === 0xda) {
      scanDataStart = offset + length;
      break;
    }
    offset += length;
  }
  if (!foundSof || scanDataStart <= 0 || bytes.length < scanDataStart + 4) {
    throw new Error("La imagen está incompleta o dañada.");
  }
  let end = bytes.length;
  while (end > scanDataStart + 2 && (bytes[end - 1] === 0x00 || bytes[end - 1] === 0xff)) {
    if (bytes[end - 2] === 0xff && bytes[end - 1] === 0xd9) break;
    end--;
  }
  if (bytes[end - 2] !== 0xff || bytes[end - 1] !== 0xd9) {
    throw new Error("La imagen está incompleta o dañada.");
  }
}

function validatePngContainer(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let hasIhdr = false;
  let hasIdat = false;
  let hasIend = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new Error("La imagen está incompleta o dañada.");
    if (type === "acTL" || type === "eXIf") {
      throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
    }
    if (type === "IHDR") hasIhdr = true;
    if (type === "IDAT" && length > 0) hasIdat = true;
    if (type === "IEND") {
      hasIend = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }
  if (!hasIhdr || !hasIdat || !hasIend || offset !== bytes.length) {
    throw new Error("La imagen está incompleta o dañada.");
  }
}

function validateWebpContainer(bytes: Uint8Array): void {
  if (bytes.length < 20) throw new Error("La imagen está incompleta o dañada.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true) + 8;
  if (riffSize > bytes.length) throw new Error("La imagen está incompleta o dañada.");
  let offset = 12;
  while (offset + 8 <= riffSize) {
    const fourCC = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const paddedSize = chunkSize + (chunkSize & 1);
    if (offset + 8 + chunkSize > riffSize) throw new Error("La imagen está incompleta o dañada.");
    if (fourCC === "ANIM" || fourCC === "ANMF" || fourCC === "EXIF") {
      throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
    }
    if (fourCC === "VP8X" && chunkSize >= 10 && (bytes[offset + 8]! & 0x02) !== 0) {
      throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
    }
    offset += 8 + paddedSize;
  }
}

/** Validate container completeness, dimensions <= IMAGE_MAX_SIDE, and absence of personal/un-normalized EXIF. */
export async function validateImageOutput(blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = readProductImageHeader(bytes);
  if (header.width <= 0 || header.height <= 0 || header.width > IMAGE_MAX_SIDE || header.height > IMAGE_MAX_SIDE) {
    throw new Error("La imagen debe estar optimizada y sin metadatos personales.");
  }
  if (header.type === "image/jpeg") {
    validateJpegContainer(bytes);
  } else if (header.type === "image/png") {
    validatePngContainer(bytes);
  } else {
    validateWebpContainer(bytes);
  }
}
