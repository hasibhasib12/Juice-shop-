export type ProductImageType = { mime: "image/jpeg" | "image/png" | "image/webp"; extension: "jpg" | "png" | "webp" };
export function detectProductImageType(bytes: Uint8Array): ProductImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: "image/png", extension: "png" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", extension: "webp" };
  return null;
}

export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGE_MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export function isImageUploadRequestSizeAllowed(contentLength: string | null, maxFileBytes: number): boolean {
  if (contentLength === null) return true;
  const parsed = Number(contentLength);
  return Number.isSafeInteger(parsed)
    && parsed >= 0
    && parsed <= maxFileBytes + MAX_PRODUCT_IMAGE_MULTIPART_OVERHEAD_BYTES;
}

export function isProductImageRequestSizeAllowed(contentLength: string | null): boolean {
  return isImageUploadRequestSizeAllowed(contentLength, MAX_PRODUCT_IMAGE_BYTES);
}
