/**
 * Pictures Atlas can look at: screenshots of Ordo and images the person attaches (PNG, JPEG, WebP, GIF). Like every
 * attachment they stay in memory on this device only – the chat history keeps the 📎 line, the picture itself goes
 * with the requests of this session and is gone after a restart. Kept apart from attachments.ts so the providers can
 * read it without pulling in the operator's modules.
 */
export interface VisionImage {
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** Base64 without the data: prefix. */
  data: string;
}

const images = new Map<string, VisionImage>();

/** Long edge the models work with anyway; larger pictures only cost upload time. */
const MAX_EDGE = 1600;
/** The APIs take at most 5 MB per picture as base64. */
const MAX_BASE64 = 4_800_000;

const SEEN = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function canSee(mime: string): boolean {
  return SEEN.has(mime);
}

export function imageFor(id: string): VisionImage | undefined {
  return images.get(id);
}

/** The ids of the attachments in a message text ("[Datei-ID: att_…]") that Atlas can look at. */
export function imagesIn(text: string): { id: string; image: VisionImage }[] {
  return [...text.matchAll(/\[Datei-ID: (att_[A-Za-z0-9_-]+)\]/g)].map((m) => ({ id: m[1]!, image: images.get(m[1]!) })).filter((x): x is { id: string; image: VisionImage } => !!x.image);
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Scales a picture down to MAX_EDGE (JPEG for photos, PNG for screens) when it is too large to send as it is. */
async function shrink(bytes: Uint8Array, mime: string, screen: boolean): Promise<VisionImage | undefined> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return undefined;
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  for (const [type, q] of [...(screen ? [["image/png", 1] as const] : []), ["image/jpeg", 0.85] as const, ["image/jpeg", 0.7] as const]) {
    const data = canvas.toDataURL(type, q).split(",")[1] ?? "";
    if (data.length <= MAX_BASE64) return { mime: type, data };
  }
  return undefined;
}

/** Makes an attached picture visible to Atlas. Pictures that cannot be read stay plain attachments. */
export async function rememberImage(id: string, bytes: Uint8Array, mime: string, opts: { screen?: boolean; width?: number; height?: number } = {}): Promise<boolean> {
  if (!canSee(mime)) return false;
  try {
    const small = (opts.width ?? 0) <= MAX_EDGE && (opts.height ?? 0) <= MAX_EDGE && opts.width !== undefined;
    const direct = small && bytes.byteLength * 1.37 <= MAX_BASE64 ? { mime: mime as VisionImage["mime"], data: toBase64(bytes) } : await shrink(bytes, mime, !!opts.screen);
    if (!direct) return false;
    images.set(id, direct);
    return true;
  } catch {
    return false;
  }
}
