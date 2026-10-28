/**
 * Keeps the files in the vault (and so on the server) to what is still needed:
 * - files nothing points to any more are removed – at the earliest when the record that used them has left the
 *   trash (soft-deleted records still count as using their files, so a restore keeps working);
 * - old full-size previews of PDF invoices become small JPEGs.
 * Originals of invoices and receipts are never touched: they have to be kept for seven years (§ 132 BAO).
 */
import type { Vault, VaultStore } from "@ordo/core";
import { PREVIEW, jpgName, shrinkImage } from "@/lib/shrink";

/** Every attachment id anything in the vault points to (fields named …attachmentId / …attachmentIds). */
export function referencedAttachmentIds(v: Vault): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown, key: string, depth: number) => {
    if (depth > 12 || node == null) return;
    if (typeof node === "string") {
      if (/attachmentids?$/i.test(key)) out.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const x of node) walk(x, key, depth + 1);
      return;
    }
    if (typeof node === "object") for (const [k, x] of Object.entries(node as Record<string, unknown>)) if (k !== "attachments") walk(x, k, depth + 1);
  };
  walk(v, "", 0);
  return out;
}

/** Removes attachments nothing points to. Young ones are left alone: an import may still be linking them. */
export async function sweepUnusedAttachments(store: VaultStore, minAgeDays = 2): Promise<number> {
  const used = referencedAttachmentIds(store.vault);
  const cutoff = Date.now() - minAgeDays * 86400_000;
  const unused = store.vault.attachments.filter((a) => !used.has(a.id) && Date.parse(a.createdAt) < cutoff);
  for (const a of unused) await store.deleteAttachment(a.id);
  return unused.length;
}

/** Old previews were full-size PNGs – a small JPEG reads just as well. A few per run, so nothing waits on it. */
export async function shrinkOldPreviews(store: VaultStore, max = 20): Promise<number> {
  const byId = new Map(store.vault.attachments.map((a) => [a.id, a]));
  const docs = store.vault.documents.filter((d) => d.previewAttachmentId && byId.get(d.previewAttachmentId)?.mime === "image/png").slice(0, max);
  let done = 0;
  for (const d of docs) {
    const old = byId.get(d.previewAttachmentId!)!;
    const bytes = await store.getAttachmentBytes(old.id).catch(() => null);
    if (!bytes) continue;
    const small = await shrinkImage(bytes, old.mime, PREVIEW.maxSide, PREVIEW.quality);
    if (!small) continue;
    const att = await store.putAttachment(old.profileId, small.bytes, { name: jpgName(old.name), mime: small.mime, width: small.width, height: small.height });
    store.update("documents", d.id, { previewAttachmentId: att.id }, "document.preview");
    // the old PNG is used by nothing now
    await store.deleteAttachment(old.id);
    done++;
  }
  return done;
}
