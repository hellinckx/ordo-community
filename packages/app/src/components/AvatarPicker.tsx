import { useEffect, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { requirePlatform, requireStore, useSession } from "@/state/session";
import { toast } from "@/state/toasts";
import { cls, initials } from "@/lib/format";

/** Object URLs of decrypted attachments, shared by every avatar on screen (revoked when the vault locks). */
const urls = new Map<string, Promise<string | null>>();
useSession.subscribe((s, prev) => {
  if (s.status !== "unlocked" && prev.status === "unlocked") {
    for (const p of urls.values()) void p.then((u) => u && URL.revokeObjectURL(u));
    urls.clear();
  }
});

function attachmentUrl(id: string): Promise<string | null> {
  let p = urls.get(id);
  if (!p) {
    p = (async () => {
      const store = useSession.getState().store;
      const att = store?.vault.attachments.find((a) => a.id === id && !a.deletedAt);
      const bytes = att ? await store!.getAttachmentBytes(id).catch(() => null) : null;
      return bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: att!.mime })) : null;
    })();
    urls.set(id, p);
  }
  return p;
}

/** URL of an image attachment (logo, profile picture), null while loading or when there is none. */
export function useAttachmentUrl(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (id) void attachmentUrl(id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}

const SIZES = { xs: "h-6 w-6 text-[10px]", sm: "h-7 w-7 text-[11px]", md: "h-10 w-10 text-sm", lg: "h-16 w-16 text-lg", xl: "h-20 w-20 text-xl" } as const;

/** Round picture, or the initials in the person's colour while there is none. */
export function Avatar({ name, color, imageId, size = "md", square, className }: { name: string; color?: string; imageId?: string; size?: keyof typeof SIZES; square?: boolean; className?: string }) {
  const url = useAttachmentUrl(imageId);
  return (
    <span className={cls("relative flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white", square ? "rounded-xl" : "rounded-full", SIZES[size], className)} style={{ background: url ? "var(--surface-2)" : color || "#64748b" }}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initials(name) || "?"}
    </span>
  );
}

/** Square crop, at most 320 px, as JPEG (photos) or PNG (logos with transparency). */
async function shrink(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(320, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  const outMime = mime === "image/png" || mime === "image/svg+xml" || mime === "image/webp" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, outMime, 0.88));
  if (!blob) throw new Error("Bild konnte nicht umgewandelt werden.");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: outMime };
}

/**
 * Picture for a person or contact: pick a photo or logo, Ordo crops it square and shrinks it, it lives encrypted in the
 * vault like every other file. Calls onChange with the new attachment id (or undefined when removed).
 */
export function AvatarPicker({ name, color, imageId, onChange, square, label = "Bild" }: { name: string; color?: string; imageId?: string; onChange: (id: string | undefined) => void; square?: boolean; label?: string }) {
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    setBusy(true);
    try {
      const [f] = await requirePlatform().pickFiles({ multiple: false, accept: ["image/png", "image/jpeg", "image/webp", "image/heic"] });
      if (!f) return;
      if (f.bytes.byteLength > 15 * 1048576) throw new Error("Das Bild ist zu groß (höchstens 15 MB).");
      const small = await shrink(f.bytes, f.mime || "image/jpeg");
      const store = requireStore();
      const att = await store.putAttachment(store.activeProfile.id, small.bytes, { name: `${label.toLowerCase()}-${name || "bild"}.${small.mime === "image/png" ? "png" : "jpg"}`, mime: small.mime, width: 320, height: 320 });
      onChange(att.id);
    } catch (e) {
      toast.error("Bild nicht übernommen", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => void pick()} className="group relative rounded-full focus-visible:outline-none" aria-label={`${label} wählen`} disabled={busy}>
        <Avatar name={name} color={color} imageId={imageId} size="lg" square={square} />
        <span className={cls("absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100", square ? "rounded-xl" : "rounded-full", busy && "opacity-100")}>
          <Camera className="h-5 w-5" />
        </span>
      </button>
      <div className="flex flex-col items-start gap-1 text-xs">
        <button type="button" onClick={() => void pick()} className="font-medium text-brand-700 hover:underline dark:text-brand-300" disabled={busy}>{imageId ? `${label} ändern` : `${label} hinzufügen`}</button>
        {imageId ? <button type="button" onClick={() => onChange(undefined)} className="inline-flex items-center gap-1 text-(--text-muted) hover:text-red-600"><Trash2 className="h-3 w-3" /> Entfernen</button> : <span className="text-(--text-muted)">JPG oder PNG, wird quadratisch zugeschnitten</span>}
      </div>
    </div>
  );
}
