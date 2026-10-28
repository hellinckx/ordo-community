/**
 * Rule-based receipt/invoice parser (works fully offline, no AI). Tuned for Austrian/German documents
 * but tolerant to English layouts. Produces fields with per-field confidence (0..1).
 */
import type { ExtractedFields, PaymentMethod } from "../model/types";
import { ExtractedFieldsSchema } from "../model/types";
import { parseAmount, type Cents } from "../model/money";
import { isVatRate, type VatLine, type VatRate } from "../model/vat";

export interface ParseResult {
  fields: ExtractedFields;
  confidence: Record<string, number>;
  overall: number;
  warnings: string[];
}

const MONTHS: Record<string, number> = {
  jänner: 1, januar: 1, jan: 1, feber: 2, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6, juli: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
  january: 1, february: 2, march: 3, mar: 3, may: 5, june: 6, july: 7, october: 10, oct: 10, december: 12, dec: 12,
};

// thousands: 1.234,56 · 1 234,56 · 1'234.56 · 1,234.56 (English) – parseAmount sorts out which separator is decimal
const AMOUNT_RE = /(?<![\d,.])-?\s?(?:€\s?)?(\d{1,3}(?:[.,\s']\d{3})+|\d+)(?:[,.](\d{2}))(?!\d)(?:\s?(?:€|EUR|CHF|USD|\$))?/g;
const PCT_RE = /(\d{1,2}(?:[,.]\d{1,2})?)\s?%/;

export interface DateHit {
  iso: string;
  line: number;
  context: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function findDates(lines: string[]): DateHit[] {
  const hits: DateHit[] = [];
  lines.forEach((line, i) => {
    const l = line.toLowerCase();
    const push = (iso: string | null) => {
      if (iso) hits.push({ iso, line: i, context: l });
    };
    for (const m of line.matchAll(/(?<!\d)(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})(?!\d)/g)) push(validDate(Number(m[3]), Number(m[2]), Number(m[1])));
    for (const m of line.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) push(validDate(Number(m[1]), Number(m[2]), Number(m[3])));
    for (const m of line.matchAll(/(?<!\d)(\d{1,2})\.?\s*([A-Za-zäöüÄÖÜ]{3,9})\.?\s+(\d{4})/g)) {
      const mon = MONTHS[m[2]!.toLowerCase()];
      if (mon) push(validDate(Number(m[3]), mon, Number(m[1])));
    }
    for (const m of line.matchAll(/(?<!\d)(\d{1,2})\s?[./]\s?(\d{1,2})\s?[./]\s?(\d{4})(?!\d)/g)) push(validDate(Number(m[3]), Number(m[2]), Number(m[1])));
    // US style "October 15, 2026" / "Oct 15 2026"
    for (const m of line.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
      const mon = MONTHS[m[1]!.toLowerCase()];
      if (mon) push(validDate(Number(m[3]), mon, Number(m[2])));
    }
  });
  return hits;
}

const OVERALL_WEIGHTS: [string, number][] = [["grossCents", 0.35], ["invoiceDate", 0.25], ["vendorName", 0.2], ["vatLines", 0.2]];
/** Weighted total confidence (0..1) from the per-field confidences – shared by rules, AI merge and pipeline. */
export function overallConfidence(conf: Record<string, number>): number {
  return Math.round(OVERALL_WEIGHTS.reduce((s, [k, w]) => s + (conf[k] ?? 0) * w, 0) * 100) / 100;
}

export function findAmounts(line: string): Cents[] {
  const out: Cents[] = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const c = parseAmount(m[0]);
    if (c !== null && Math.abs(c) < 10_000_000_00) out.push(Math.abs(c));
  }
  return out;
}

function ibanValid(iban: string): boolean {
  const s = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

export function findIban(text: string): string | null {
  for (const m of text.matchAll(/\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?)\b/g)) {
    if (ibanValid(m[1]!)) return m[1]!.replace(/\s+/g, "");
  }
  return null;
}

export function findUids(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bATU\s?\d{8}\b/gi)) out.add(m[0].replace(/\s+/g, "").toUpperCase());
  for (const m of text.matchAll(/\b(DE\s?\d{9}|CHE[-\s]?\d{3}[.\s]?\d{3}[.\s]?\d{3}(?:\s?MWST)?|NL\s?\d{9}B\d{2}|IT\s?\d{11}|FR\s?[A-Z0-9]{2}\s?\d{9}|GB\s?\d{9}|PL\s?\d{10}|CZ\s?\d{8,10}|HU\s?\d{8}|SK\s?\d{10}|SI\s?\d{8}|ES\s?[A-Z0-9]\d{7}[A-Z0-9]|BE\s?0\d{9}|LU\s?\d{8}|DK\s?\d{8}|SE\s?\d{12}|IE\s?\d[A-Z0-9+*]\d{5}[A-Z]{1,2})\b/g)) {
    out.add(m[1]!.replace(/\s+/g, "").toUpperCase());
  }
  return [...out];
}

const TOTAL_KEYWORDS: [RegExp, number][] = [
  [/\b(zu zahlen|zu bezahlen|zahlbetrag|rechnungsbetrag|gesamtbetrag|endbetrag|amount due|total due|grand total|amount paid|total paid|total charged)\b/i, 6],
  [/\b(gesamtsumme|gesamt\s?summe|summe brutto|brutto\s?gesamt|total brutto|gesamt brutto)\b/i, 5],
  [/\b(gesamt|summe|total)\b/i, 4],
  [/\b(brutto)\b/i, 3],
  [/\b(betrag|amount)\b/i, 2],
  [/\b(bar|cash|karte|card|bankomat|visa|master|maestro|gegeben)\b/i, 1],
];
const NOT_TOTAL = /\b(netto|zwischensumme|subtotal|mwst|ust|umsatzsteuer|mehrwertsteuer|vat|steuer|rückgeld|retour|wechselgeld|rabatt|pfand|trinkgeld|tip)\b/i;
const VAT_WORD = /\b(mwst|ust|umsatzsteuer|mehrwertsteuer|vat|steuer|tax)\b/i;

export function parseReceiptText(rawText: string, opts: { ownNames?: string[]; ownUid?: string; /** document is our own outgoing invoice */ outgoing?: boolean } = {}): ParseResult {
  const text = rawText.replace(/\r/g, "");
  const lines = text
    .split("\n")
    .map((l) => l.replace(/[\t ]+/g, " ").replace(/ {2,}/g, " ").trim())
    .filter((l) => l.length > 0);
  const lower = text.toLowerCase();
  const warnings: string[] = [];
  const conf: Record<string, number> = {};
  const fields = ExtractedFieldsSchema.parse({});

  /* ---- document type ---- */
  if (/\b(gutschrift|credit note|storno)\b/i.test(text)) fields.documentType = "credit_note";
  else if (/\b(lohnzettel|gehaltsabrechnung|lohnabrechnung|gehaltszettel|monatsabrechnung)\b/i.test(text)) fields.documentType = "salary_slip";
  else if (/\b(kontoauszug|account statement|umsatzliste)\b/i.test(text)) fields.documentType = "bank_statement";
  else if (/\b(rechnung|invoice|faktura|honorarnote)\b/i.test(text)) fields.documentType = "invoice";
  else if (/\b(kassenbon|kassabon|kassenbeleg|bon|beleg|quittung|receipt|tse|kassa)\b/i.test(text) || lines.length < 40) fields.documentType = "receipt";
  conf.documentType = 0.6;

  /* ---- dates ---- */
  const dates = findDates(lines);
  const today = new Date();
  const maxIso = new Date(today.getTime() + 2 * 86400_000).toISOString().slice(0, 10);
  const plausible = dates.filter((d) => d.iso <= maxIso && d.iso >= "2010-01-01");
  const invoiceHit =
    plausible.find((d) => /(rechnungsdatum|belegdatum|ausstellungsdatum|invoice date|rechnungs-datum)/.test(d.context)) ??
    plausible.find((d) => /\bdatum\b|\bdate\b/.test(d.context) && !/(fällig|zahlbar|due|liefer|leistungs|geburts)/.test(d.context)) ??
    plausible.find((d) => !/(fällig|zahlbar|due|geburts|gültig)/.test(d.context));
  if (invoiceHit) {
    fields.invoiceDate = invoiceHit.iso;
    conf.invoiceDate = /(rechnungsdatum|belegdatum|datum|date)/.test(invoiceHit.context) ? 0.9 : plausible.length === 1 ? 0.75 : 0.55;
  } else if (dates.length) {
    warnings.push("Kein plausibles Rechnungsdatum gefunden (nur zukünftige/alte Daten).");
  }
  const dueHit = plausible.find((d) => /(fällig|zahlbar bis|zahlungsziel|due date|due by|zahlbar)/.test(d.context) && d.iso !== fields.invoiceDate);
  if (dueHit) {
    fields.dueDate = dueHit.iso;
    conf.dueDate = 0.8;
  } else if (fields.invoiceDate) {
    const m = lower.match(/(?:zahlbar|fällig|zahlung)[^\n]{0,40}?(\d{1,3})\s?tag/);
    if (m) {
      const d = new Date(fields.invoiceDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + Number(m[1]));
      fields.dueDate = d.toISOString().slice(0, 10);
      conf.dueDate = 0.6;
    }
  }
  const serviceLine = lines.find((l) => /(leistungsdatum|leistungszeitraum|lieferdatum|leistung vom|zeitraum)/i.test(l));
  if (serviceLine) fields.serviceDate = serviceLine.slice(0, 80);

  /* ---- currency ---- */
  if (/\bCHF\b/.test(text)) fields.currency = "CHF";
  else if (/\bUSD\b|\$/.test(text) && !/€|EUR/.test(text)) fields.currency = "USD";
  else if (/\bGBP\b|£/.test(text)) fields.currency = "GBP";
  else fields.currency = "EUR";
  conf.currency = fields.currency === "EUR" ? 0.8 : 0.6;

  /* ---- totals ---- */
  let best: { cents: Cents; score: number; line: number } | null = null;
  let maxAmount: { cents: Cents; line: number } | null = null;
  lines.forEach((line, i) => {
    const amounts = findAmounts(line);
    if (!amounts.length) return;
    const lineMax = Math.max(...amounts);
    if (!maxAmount || lineMax > maxAmount.cents) maxAmount = { cents: lineMax, line: i };
    if (NOT_TOTAL.test(line) && !/\b(gesamt|summe|total|zu zahlen)\b/i.test(line)) return;
    for (const [re, score] of TOTAL_KEYWORDS) {
      if (re.test(line)) {
        // Prefer later occurrences for equal scores (totals come last) and the largest amount on that line.
        const s = score + i / lines.length / 2;
        if (!best || s > best.score) best = { cents: lineMax, score: s, line: i };
        break;
      }
    }
  });
  if (best) {
    const b = best as { cents: Cents; score: number; line: number };
    fields.grossCents = b.cents;
    conf.grossCents = b.score >= 4 ? 0.85 : 0.6;
  } else if (maxAmount) {
    const m = maxAmount as { cents: Cents; line: number };
    fields.grossCents = m.cents;
    conf.grossCents = 0.4;
    warnings.push("Gesamtbetrag nur anhand des größten Betrags geschätzt.");
  }

  /* ---- VAT lines ---- */
  const vatLines: VatLine[] = [];
  const seenRates = new Set<number>();
  lines.forEach((line) => {
    const pm = line.match(PCT_RE);
    if (!pm) return;
    const rate = Math.round(Number(pm[1]!.replace(",", ".")));
    if (!isVatRate(rate) || rate === 0) return;
    if (!VAT_WORD.test(line) && !/^\s*[abcd]\b/i.test(line) && !/\b(netto|brutto)\b/i.test(line) && !/^\s*\d{1,2}\s?%/.test(line)) return;
    const amounts = findAmounts(line);
    if (!amounts.length) return;
    const r: VatRate = rate;
    const ok = (net: Cents, vat: Cents) => Math.abs(Math.round((net * r) / 100) - vat) <= 2;
    let found: VatLine | null = null;
    if (amounts.length >= 3) {
      outer: for (const a of amounts) for (const b of amounts) for (const c of amounts) {
        if (a === b || b === c) continue;
        if (ok(a, b) && Math.abs(a + b - c) <= 2) {
          found = { rate: r, netCents: a, vatCents: b };
          break outer;
        }
      }
    }
    if (!found && amounts.length >= 2) {
      for (const a of amounts) for (const b of amounts) {
        if (a === b) continue;
        if (ok(a, b)) {
          found = { rate: r, netCents: a, vatCents: b };
          break;
        }
        // (gross, vat)
        if (ok(a - b, b) && a > b) {
          found = { rate: r, netCents: a - b, vatCents: b };
          break;
        }
      }
    }
    if (!found && amounts.length === 1 && VAT_WORD.test(line)) {
      const vat = amounts[0]!;
      const net = Math.round((vat * 100) / r);
      found = { rate: r, netCents: net, vatCents: vat };
    }
    if (found && !seenRates.has(r)) {
      seenRates.add(r);
      vatLines.push(found);
    }
  });
  if (vatLines.length) {
    fields.vatLines = vatLines.sort((a, b) => b.rate - a.rate);
    const sumGross = vatLines.reduce((s, l) => s + l.netCents + l.vatCents, 0);
    const consistent = fields.grossCents !== null && Math.abs(sumGross - fields.grossCents) <= 2;
    conf.vatLines = consistent ? 0.9 : 0.55;
    if (consistent) conf.grossCents = Math.max(conf.grossCents ?? 0, 0.92);
    else if (fields.grossCents !== null && Math.abs(sumGross - fields.grossCents) > 2) warnings.push("Steuerzeilen ergeben nicht den Gesamtbetrag – bitte prüfen.");
    fields.netCents = vatLines.reduce((s, l) => s + l.netCents, 0);
    fields.vatCents = vatLines.reduce((s, l) => s + l.vatCents, 0);
  } else {
    const nettoLine = lines.find((l) => /\b(netto|net amount|subtotal|zwischensumme)\b/i.test(l) && findAmounts(l).length);
    if (nettoLine) fields.netCents = Math.max(...findAmounts(nettoLine));
    const rateMention = lower.match(/(20|10|13)\s?%/);
    if (fields.grossCents && rateMention && !/\b(0\s?%|steuerfrei|umsatzsteuerbefreit|kleinunternehmer)\b/.test(lower)) {
      const r = Number(rateMention[1]) as VatRate;
      const net = Math.round((fields.grossCents * 100) / (100 + r));
      fields.vatLines = [{ rate: r, netCents: net, vatCents: fields.grossCents - net }];
      conf.vatLines = 0.35;
      warnings.push(`Steuersatz ${r} % nur aus dem Text abgeleitet.`);
    } else if (/\b(kleinunternehmer|§ ?6 abs\.? ?1 z ?27|umsatzsteuerbefreit|keine umsatzsteuer)\b/.test(lower) && fields.grossCents) {
      fields.vatLines = [{ rate: 0, netCents: fields.grossCents, vatCents: 0 }];
      conf.vatLines = 0.8;
    }
  }

  /* ---- identifiers ---- */
  const uids = findUids(text).filter((u) => !opts.ownUid || u !== opts.ownUid.replace(/\s+/g, "").toUpperCase());
  if (uids.length) {
    fields.vendorUid = uids[0]!;
    conf.vendorUid = 0.9;
  }
  const iban = findIban(text);
  if (iban) {
    fields.vendorIban = iban;
    conf.vendorIban = 0.9;
  }
  const invNo = text.match(/(?:rechnungs?\s?-?\s?(?:nr|nummer|no)\.?|re\.?-?\s?nr\.?|rg\.?-?\s?nr\.?|invoice\s?(?:no|number|#)\.?|receipt\s?(?:no|number|#)\.?|beleg-?\s?(?:nr|nummer)\.?|bon-?\s?nr\.?|rechnung\s?(?:nr|nummer)\.?|belegnummer|rechnungsnummer)\s*[:.#]?\s*([A-Z0-9][A-Z0-9\-\/_.]{1,30})/i);
  if (invNo && !/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(invNo[1]!)) {
    fields.invoiceNumber = invNo[1]!.replace(/[.:]$/, "");
    conf.invoiceNumber = 0.85;
  }

  /* ---- vendor ---- */
  const ownNames = (opts.ownNames ?? []).map((n) => n.toLowerCase()).filter(Boolean);
  const isNoise = (l: string) =>
    /^\d/.test(l) ||
    findAmounts(l).length > 0 ||
    /(rechnung|invoice|receipt|kassenbon|kassabon|beleg|quittung|datum|\bdate\b|\btel\b|telefon|\bfax\b|www\.|@|http|\buid\b|\batu\d|\biban\b|\bbic\b|\bseite\b|\bpage\b|^kunde\b|kundennummer|customer|\bherrn?\b|\bfrau\b|z\.hd|zu handen|\bamount\b|\btotal\b|\bpaid\b|\bpayment\b|\bsummary\b|\bbilling\b|\bsold to\b|\bship to\b)/i.test(l) ||
    l.replace(/[^A-Za-zÄÖÜäöüß]/g, "").length < 3 ||
    l.length > 70;
  const legalForm = /\b(gmbh|ag|kg|og|e\.?u\.?|ges\.?m\.?b\.?h\.?|ltd|limited|inc|llc|s\.?\s?à\s?r\.?l\.?|sàrl|sarl|s\.?r\.?l|s\.?a\.?|& ?co|ohg|se|b\.?v\.?|gesmbh|ug|stiftung|verein|pte|plc|corp)(?=[^a-zäöü]|$)/i;
  // Multi-column layouts glue the "Bill to" / "Ship to" blocks onto the issuer line – keep the left part.
  // One-line sender rows ("Firma GmbH · Straße 4 · 3300 Ort", "Firma AG - Platz 6 - 63452 Hanau") keep only the name;
  // PDF symbol fonts turn the dots into control or private-use characters.
  const SENDER_SEP = /\s*[\u0000-\u001f\u007f•·●▪‧�-|]+\s*|\s+[-–]\s+/;
  const vendorPart = (l: string) => {
    const left = l.split(/\s+(?=(?:bill|ship|sold|invoice)\s+to\b|rechnungs(?:empfänger|adresse)\b|lieferadresse\b)/i)[0]!.trim();
    const parts = left.split(SENDER_SEP).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2 || !parts.slice(1).some((x) => /\d/.test(x))) return left.replace(/[\u0000-\u001f\u007f�-]+/g, " ").trim();
    return parts.find((x) => legalForm.test(x)) ?? parts[0]!;
  };
  let vendor: string | null = null;
  let vendorIdx = -1;
  const head = lines.slice(0, 12).map(vendorPart);
  const notOwn = (l: string) => !ownNames.some((n) => l.toLowerCase().includes(n));
  // Marketplaces and platforms name the actual seller explicitly – that beats any header heuristic.
  const seller = lines.map((l) => l.match(/^(?:verkauft von|verkäufer|sold by|aussteller|anbieter)\s*:?\s*(.{3,80})$/i)).find((m) => m && notOwn(m[1]!));
  if (seller) {
    vendor = seller[1]!;
    vendorIdx = lines.findIndex((l) => l === seller[0]);
    conf.vendorName = 0.85;
  } else {
    const legalIdx = head.findIndex((l) => legalForm.test(l) && !isNoise(l) && notOwn(l));
    const firstIdx = legalIdx >= 0 ? legalIdx : head.findIndex((l) => !isNoise(l) && notOwn(l));
    if (firstIdx >= 0) {
      vendor = head[firstIdx]!;
      vendorIdx = firstIdx;
      conf.vendorName = legalIdx >= 0 ? 0.75 : 0.5;
    }
  }
  if (vendor) fields.vendorName = vendor.replace(/\s{2,}/g, " ").trim();
  /* ---- customer (recipient block) – needed for our own outgoing invoices ---- */
  {
    const streetLike = /(straße|strasse|gasse|platz|weg|allee|ring|zeile|str\.)\s*\d|^\d{4,5}\s+\S|^(a|at|d|de)-\d{4}/i;
    const labelled = lines.find((l) => /^(rechnungsempfänger|empfänger|kunde|an|bill to|invoice to|billed to)\b\s*:\s*\S/i.test(l));
    let labelledName: string | null = labelled ? labelled.replace(/^(rechnungsempfänger|empfänger|kunde|an|bill to|invoice to|billed to)\b\s*:\s*/i, "").trim() || null : null;
    if (!labelledName) {
      // Label on its own line, name underneath ("Bill to" / "Rechnungsadresse" blocks)
      const li = lines.findIndex((l) => /^(rechnungsempfänger|rechnungsadresse|empfänger|bill to|invoice to|billed to)\s*:?\s*$/i.test(l));
      if (li >= 0) labelledName = lines.slice(li + 1, li + 4).find((l) => !isNoise(l) && !streetLike.test(l)) ?? null;
    }
    if (labelledName) {
      fields.customerName = labelledName;
    } else {
      const own = ownNames;
      // On our own invoice the issuer is the first name-like line at the top; the recipient follows its address block.
      const issuer = opts.outgoing ? head.find((l) => !isNoise(l) && !streetLike.test(l)) : vendor;
      const vIdx = issuer ? (opts.outgoing ? head.indexOf(issuer) : vendorIdx) : -1;
      // Two-column layouts put address and invoice meta on one text line: keep only the left part.
      const leftPart = (l: string) => l.split(/\s+(?=(rechnung|rechnungs-?nr|rechnungsdatum|datum|nr\.|leistungszeitraum|kundennummer|invoice|date)\b)/i)[0]!.trim();
      const candidates = lines.slice(Math.max(0, vIdx + 1), 20).map(leftPart).filter((l) => l.length >= 3).filter((l) => !isNoise(l) && !streetLike.test(l) && l !== issuer && !/^(leistung|leistungszeitraum|betreff|projekt|zahlbar|pos\b)/i.test(l) && !own.some((n) => n && l.toLowerCase().includes(n)));
      const pick = candidates.slice(0, 6).find((l) => legalForm.test(l)) ?? candidates[0];
      if (pick && (opts.outgoing || own.length)) fields.customerName = pick.trim();
      if (opts.outgoing && issuer) {
        fields.vendorName = issuer.trim();
        conf.vendorName = 0.7;
      }
    }
    if (fields.customerName) conf.customerName = labelledName ? 0.8 : 0.55;
  }
  const addrIdx = vendorIdx;
  if (addrIdx >= 0) {
    const addr = lines.slice(addrIdx + 1, addrIdx + 4).filter((l) => /\d{4}\s+[A-Za-zÄÖÜäöü]/.test(l) || /(straße|strasse|gasse|platz|weg|str\.)/i.test(l));
    if (addr.length) fields.vendorAddress = addr.join(", ");
  }

  /* ---- payment / paid status ---- */
  let pm: PaymentMethod | null = null;
  if (/\b(paypal)\b/i.test(text)) pm = "paypal";
  else if (/\b(visa|mastercard|master\s?card|maestro|bankomat|debitkarte|kreditkarte|kartenzahlung|ec-karte|girocard|apple pay|google pay|kontaktlos|contactless)\b/i.test(text)) pm = "card";
  else if (/\b(bar|bargeld|cash|gegeben|rückgeld|retourgeld)\b/i.test(text)) pm = "cash";
  else if (/\b(lastschrift|sepa-lastschrift|einzug|abbuchung)\b/i.test(text)) pm = "direct_debit";
  else if (iban || /\b(überweisung|zahlbar|zahlungsziel|bank transfer)\b/i.test(text)) pm = "bank";
  fields.paymentMethod = pm;
  if (pm) conf.paymentMethod = 0.6;
  if (/\b(bezahlt|paid|gegeben|rückgeld|zahlung erhalten|dankend erhalten|betrag erhalten)\b/i.test(text) || pm === "cash" || pm === "card") fields.isPaid = true;
  else if (fields.dueDate || iban) fields.isPaid = false;

  fields.reverseCharge = /(reverse charge|steuerschuldnerschaft des leistungsempfängers|übergang der steuerschuld|vat reverse)/i.test(text) ? true : null;
  fields.direction = ownNames.length && head.some((l) => ownNames.some((n) => l.toLowerCase().includes(n))) && !vendor ? "outgoing" : "incoming";
  fields.description = [fields.vendorName, fields.documentType === "invoice" && fields.invoiceNumber ? `Rechnung ${fields.invoiceNumber}` : null].filter(Boolean).join(" – ") || null;

  if (!lines.length) warnings.push("Kein Text erkannt.");
  return { fields, confidence: conf, overall: overallConfidence(conf), warnings };
}
