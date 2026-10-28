/**
 * Smaller copies of pictures for storage and sync: phone photos of receipts and the previews of PDF invoices.
 * Returns null when the picture cannot be read here (e.g. HEIC in some browsers) or would not get smaller –
 * then the caller keeps what it has.
 */
export async function shrinkImage(bytes: Uint8Array, mime: string, maxSide: number, quality: number): Promise<{ bytes: Uint8Array; mime: string; width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const width = Math.max(1, Math.round(bmp.width * k));
    const height = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // JPEG has no transparency: paper is white
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (!blob) return null;
    const out = new Uint8Array(await blob.arrayBuffer());
    return out.byteLength < bytes.byteLength * 0.9 ? { bytes: out, mime: "image/jpeg", width, height } : null;
  } catch {
    return null;
  }
}

/** Photos of receipts: big enough to read every line, small enough not to fill the storage. */
export const PHOTO = { maxSide: 2200, quality: 0.82, minBytes: 600 * 1024 };
/** Previews of PDF invoices (the PDF itself stays as it is). */
export const PREVIEW = { maxSide: 1600, quality: 0.75 };

export const jpgName = (name: string) => name.replace(/\.(png|jpe?g|webp|bmp|gif)$/i, "") + ".jpg";
