import type { Category, Contact, SummaDocument, Transaction } from "../model/types";
import { fromCents } from "../model/money";
import { toCsv } from "./csv";

export interface BelegeZipOptions {
  documents: SummaDocument[];
  transactions: Transaction[];
  contacts: Contact[];
  categories: Category[];
  getBytes: (attachmentId: string) => Promise<Uint8Array | null>;
  /** Extra files, e.g. reports. */
  extra?: { path: string; bytes: Uint8Array }[];
  onProgress?: (done: number, total: number) => void;
}

function safe(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * Packs all receipts of a period into a ZIP, renamed to "YYYY-MM-DD_Lieferant_Betrag_Nr.ext" with an index CSV.
 * Folder structure: Belege/YYYY/MM/.
 */
export async function belegeZip(opts: BelegeZipOptions): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const txByDoc = new Map<string, Transaction>();
  for (const t of opts.transactions) for (const d of t.documentIds) txByDoc.set(d, t);
  const contacts = new Map(opts.contacts.map((c) => [c.id, c.name]));
  const cats = new Map(opts.categories.map((c) => [c.id, c.name]));
  const index: (string | number)[][] = [];
  let done = 0;
  const used = new Set<string>();
  for (const d of opts.documents) {
    const bytes = await opts.getBytes(d.attachmentId);
    done++;
    opts.onProgress?.(done, opts.documents.length);
    if (!bytes) continue;
    const tx = txByDoc.get(d.id);
    const date = tx?.date ?? d.extraction?.fields.invoiceDate ?? d.importedAt.slice(0, 10);
    const vendor = (tx?.contactId ? contacts.get(tx.contactId) : undefined) ?? d.extraction?.fields.vendorName ?? "Beleg";
    const amount = tx?.grossCents ?? d.extraction?.fields.grossCents ?? 0;
    const ext = d.originalName.includes(".") ? d.originalName.split(".").pop()! : d.mime.split("/")[1] ?? "bin";
    let base = `${date}_${safe(vendor)}_${fromCents(amount).toFixed(2).replace(".", ",")}`;
    let name = `${base}.${ext}`;
    let n = 2;
    while (used.has(name)) name = `${base}_${n++}.${ext}`;
    used.add(name);
    const path = `Belege/${date.slice(0, 4)}/${date.slice(5, 7)}/${name}`;
    zip.file(path, bytes);
    index.push([date, vendor, fromCents(amount), tx ? (tx.categoryId ? (cats.get(tx.categoryId) ?? "") : "") : "", tx?.invoiceNumber ?? d.extraction?.fields.invoiceNumber ?? "", path, d.originalName, d.status]);
  }
  zip.file("Belege/Index.csv", toCsv(["Datum", "Lieferant", "Betrag", "Kategorie", "Rechnungsnr.", "Datei", "Originalname", "Status"], index));
  for (const e of opts.extra ?? []) zip.file(e.path, e.bytes);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
