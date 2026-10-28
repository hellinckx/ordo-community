/**
 * QR codes on Austrian receipts and invoices – authoritative, OCR-free data:
 *  - RKSV (Registrierkassensicherheitsverordnung) QR on every cash register receipt since 2017:
 *    _R1-AT1_<KassenID>_<Belegnummer>_<Datum>_<Satz-Normal>_<Satz-Ermäßigt-1>_<Satz-Ermäßigt-2>_<Satz-Null>_<Satz-Besonders>_<Umsatzzähler>_<Zertifikat>_<Sig-Vorbeleg>_<Signatur>
 *    Amounts are gross (incl. VAT) per tax rate: Normal 20 %, Ermäßigt-1 10 %, Ermäßigt-2 13 %, Null 0 %, Besonders 19 %.
 *  - EPC QR ("Zahlen mit Code" / GiroCode) on invoices: BCD / 002 / 1 / SCT / BIC / Name / IBAN / EURamount / purpose / reference / text
 */
import type { ExtractedFields } from "../model/types";
import { ExtractedFieldsSchema } from "../model/types";
import { parseAmount } from "../model/money";
import { lineFromGross, type VatLine, type VatRate } from "../model/vat";

export interface RksvReceipt {
  kind: "rksv";
  kassenId: string;
  belegNummer: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
  /** gross amounts per rate */
  normal20: number;
  ermaessigt10: number;
  ermaessigt13: number;
  null0: number;
  besonders19: number;
  grossCents: number;
  vatLines: VatLine[];
  raw: string;
}

export interface EpcPayment {
  kind: "epc";
  name: string;
  iban: string;
  bic: string;
  amountCents: number | null;
  currency: string;
  reference: string;
  text: string;
  raw: string;
}

export type QrPayload = RksvReceipt | EpcPayment | { kind: "unknown"; raw: string };

export function parseRksv(text: string): RksvReceipt | null {
  const t = text.trim();
  if (!/^_R1-AT\d+_/.test(t)) return null;
  const parts = t.split("_");
  // parts[0] = "" (leading underscore), parts[1] = "R1-AT1"
  if (parts.length < 13) return null;
  const kassenId = parts[2] ?? "";
  const belegNummer = parts[3] ?? "";
  const dateTime = parts[4] ?? "";
  const m = dateTime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  const amt = (s: string | undefined) => {
    const c = parseAmount((s ?? "0").replace(".", ","));
    return c === null ? 0 : c;
  };
  const normal20 = amt(parts[5]);
  const ermaessigt10 = amt(parts[6]);
  const ermaessigt13 = amt(parts[7]);
  const null0 = amt(parts[8]);
  const besonders19 = amt(parts[9]);
  const vatLines: VatLine[] = [];
  const push = (gross: number, rate: VatRate) => {
    if (gross !== 0) vatLines.push(lineFromGross(gross, rate));
  };
  push(normal20, 20);
  push(ermaessigt10, 10);
  push(ermaessigt13, 13);
  push(null0, 0);
  push(besonders19, 19);
  return { kind: "rksv", kassenId, belegNummer, date: m[1]!, time: m[2]!, normal20, ermaessigt10, ermaessigt13, null0, besonders19, grossCents: normal20 + ermaessigt10 + ermaessigt13 + null0 + besonders19, vatLines, raw: t };
}

export function parseEpc(text: string): EpcPayment | null {
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines[0]?.trim() !== "BCD") return null;
  if (lines[3]?.trim() !== "SCT") return null;
  const amountRaw = (lines[7] ?? "").trim();
  const cur = amountRaw.slice(0, 3).toUpperCase();
  const amountCents = amountRaw.length > 3 ? parseAmount(amountRaw.slice(3).replace(".", ",")) : null;
  return {
    kind: "epc",
    bic: (lines[4] ?? "").trim(),
    name: (lines[5] ?? "").trim(),
    iban: (lines[6] ?? "").replace(/\s+/g, "").toUpperCase(),
    amountCents,
    currency: /^[A-Z]{3}$/.test(cur) ? cur : "EUR",
    reference: (lines[9] ?? "").trim() || (lines[8] ?? "").trim(),
    text: (lines[10] ?? "").trim(),
    raw: text,
  };
}

export function parseQrPayload(text: string): QrPayload {
  return parseRksv(text) ?? parseEpc(text) ?? { kind: "unknown", raw: text };
}

/** Turns QR payloads into (partial) extracted fields with very high confidence. */
export function fieldsFromQr(payloads: QrPayload[]): { fields: Partial<ExtractedFields>; confidence: Record<string, number>; notes: string[] } {
  const fields: Partial<ExtractedFields> = {};
  const confidence: Record<string, number> = {};
  const notes: string[] = [];
  for (const p of payloads) {
    if (p.kind === "rksv") {
      fields.documentType = "receipt";
      fields.invoiceDate = p.date;
      fields.grossCents = p.grossCents;
      fields.vatLines = p.vatLines;
      fields.netCents = p.vatLines.reduce((s, l) => s + l.netCents, 0);
      fields.vatCents = p.vatLines.reduce((s, l) => s + l.vatCents, 0);
      fields.invoiceNumber = p.belegNummer;
      fields.isPaid = true;
      confidence.invoiceDate = 0.99;
      confidence.grossCents = 0.99;
      confidence.vatLines = 0.99;
      confidence.invoiceNumber = 0.95;
      confidence.documentType = 0.99;
      notes.push(`RKSV-QR gelesen: Kassen-ID ${p.kassenId}, Bon ${p.belegNummer}, ${p.date} ${p.time}`);
    } else if (p.kind === "epc") {
      if (p.iban) {
        fields.vendorIban = p.iban;
        confidence.vendorIban = 0.99;
      }
      if (p.name) {
        fields.vendorName = p.name;
        confidence.vendorName = 0.9;
      }
      if (p.amountCents !== null) {
        fields.grossCents = p.amountCents;
        confidence.grossCents = 0.97;
      }
      if (p.reference) {
        fields.invoiceNumber = fields.invoiceNumber ?? p.reference;
        confidence.invoiceNumber = Math.max(confidence.invoiceNumber ?? 0, 0.8);
      }
      fields.paymentMethod = "bank";
      fields.isPaid = false;
      fields.documentType = "invoice";
      notes.push(`Zahlungs-QR (EPC) gelesen: ${p.name} ${p.iban}${p.amountCents !== null ? ` ${(p.amountCents / 100).toFixed(2)} ${p.currency}` : ""}`);
    }
  }
  return { fields: ExtractedFieldsSchema.partial().parse(fields), confidence, notes };
}

/* ------------------------------------------------------------------ */
/* Decoding from images (browser)                                      */
/* ------------------------------------------------------------------ */

async function decodeBitmap(bmp: ImageBitmap): Promise<string[]> {
  const found = new Set<string>();
  // 1) native BarcodeDetector (Chrome, Android, Edge) – fast and robust
  const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(src: ImageBitmap): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  if (BD) {
    try {
      const det = new BD({ formats: ["qr_code"] });
      for (const r of await det.detect(bmp)) if (r.rawValue) found.add(r.rawValue);
    } catch {
      /* fall through */
    }
  }
  if (found.size) return [...found];
  // 2) jsQR fallback on downscaled grayscale canvases (tries a few scales)
  const jsQR = (await import("jsqr")).default;
  const scales = [1, 0.6, 0.35];
  for (const scale of scales) {
    const w = Math.max(200, Math.round(bmp.width * scale));
    const h = Math.max(200, Math.round(bmp.height * scale));
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) break;
    ctx.drawImage(bmp, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const r = jsQR(data.data, w, h, { inversionAttempts: "attemptBoth" });
    if (r?.data) {
      found.add(r.data);
      break;
    }
  }
  return [...found];
}

/** Finds QR codes in a PNG/JPEG. Returns raw payloads (possibly empty). Browser only. */
export async function decodeQrCodes(image: Uint8Array, mime = "image/png"): Promise<string[]> {
  if (typeof createImageBitmap === "undefined") return [];
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(new Blob([image as BlobPart], { type: mime }));
  } catch {
    return [];
  }
  try {
    return await decodeBitmap(bmp);
  } finally {
    bmp.close();
  }
}
