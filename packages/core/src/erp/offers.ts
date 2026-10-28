/* Offer logic (Ordo Projekte → Angebote): totals with discount, numbering, PDF texts, Excel paste import,
   offer → Summa invoice drafts and project invoice suggestions. Pure functions – no store, no React. */
import type { Contact, Invoice, InvoiceLine, Profile, VatTreatment } from "../model/types";
import type { Offer, OfferLine, Product, Project, ProjectSettings } from "./schemas";
import type { VatRate } from "../model/vat";
import { allocateCents } from "../model/money";
import { ids } from "../model/ids";
import { formatNumber } from "./numbering";

/* ================================================================== */
/* Small helpers (kept private – other erp files export their own)     */
/* ================================================================== */

const DAY_MS = 86_400_000;
const MONTHS_DE = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS_DE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const VALID_RATES: VatRate[] = [0, 10, 13, 19, 20];

function utcOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  return isoOf(utcOf(iso) + days * DAY_MS);
}
function daysBetween(a: string, b: string): number {
  return Math.round((utcOf(b) - utcOf(a)) / DAY_MS);
}
function weekdayOf(iso: string): number {
  return new Date(utcOf(iso)).getUTCDay();
}
/** 05.01.2026 */
function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
/** 5. Jänner 2026 */
function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d}. ${MONTHS_DE[(m ?? 1) - 1]} ${y}`;
}
/** 30 → "30", 33.5 → "33,5" */
function pctText(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r).replace(".", ",");
}
function clampPct(n: number | undefined | null): number {
  if (n === undefined || n === null || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
function toVatRate(n: number): VatRate {
  return (VALID_RATES as number[]).includes(n) ? (n as VatRate) : 20;
}

/* ================================================================== */
/* Totals                                                              */
/* ================================================================== */

/** Net of one line: round(quantity × unit price). */
export function offerLineNetCents(line: Pick<OfferLine, "quantity" | "unitNetCents">): number {
  return Math.round((line.quantity || 0) * (line.unitNetCents || 0));
}

export interface OfferRateTotal {
  rate: number;
  /** After discount. */
  netCents: number;
  vatCents: number;
}

export interface OfferTotals {
  /** Sum of the non-optional lines before discount. */
  linesNetCents: number;
  /** Sum of the optional lines (shown, not added). */
  optionalNetCents: number;
  discountPct: number;
  /** Positive amounts taken off net and VAT. */
  discountNetCents: number;
  discountVatCents: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
  /** Per VAT rate, after discount, highest rate first. */
  byRate: OfferRateTotal[];
  /** True when no VAT is charged (reverse charge or Kleinunternehmer). */
  noVat: boolean;
}

/**
 * Offer totals like the old ERP: per line net = round(qty × price), VAT per line, optional lines left out,
 * discount % takes the same share off net and VAT (per rate, each rounded), reverse charge / Kleinunternehmer → VAT 0.
 */
export function offerTotals(offer: Pick<Offer, "lines" | "discountPct" | "reverseCharge">, opts: { kleinunternehmer?: boolean } = {}): OfferTotals {
  const noVat = !!offer.reverseCharge || !!opts.kleinunternehmer;
  const pct = clampPct(offer.discountPct);
  const groups = new Map<number, { net: number; vat: number }>();
  let linesNetCents = 0;
  let optionalNetCents = 0;
  for (const l of offer.lines) {
    const net = offerLineNetCents(l);
    if (l.optional) {
      optionalNetCents += net;
      continue;
    }
    linesNetCents += net;
    const rate = noVat ? 0 : l.vatRate;
    const vat = Math.round((net * rate) / 100);
    const g = groups.get(rate) ?? { net: 0, vat: 0 };
    g.net += net;
    g.vat += vat;
    groups.set(rate, g);
  }
  let discountNetCents = 0;
  let discountVatCents = 0;
  const byRate: OfferRateTotal[] = [];
  for (const [rate, g] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
    const dNet = Math.round((g.net * pct) / 100);
    const dVat = Math.round((g.vat * pct) / 100);
    discountNetCents += dNet;
    discountVatCents += dVat;
    byRate.push({ rate, netCents: g.net - dNet, vatCents: g.vat - dVat });
  }
  const netCents = byRate.reduce((s, r) => s + r.netCents, 0);
  const vatCents = byRate.reduce((s, r) => s + r.vatCents, 0);
  return { linesNetCents, optionalNetCents, discountPct: pct, discountNetCents, discountVatCents, netCents, vatCents, grossCents: netCents + vatCents, byRate, noVat };
}

/** Rate with the biggest net share (used for single-line invoices); 20 when the offer is empty. */
export function offerMainVatRate(offer: Pick<Offer, "lines">): VatRate {
  const sums = new Map<number, number>();
  for (const l of offer.lines) if (!l.optional) sums.set(l.vatRate, (sums.get(l.vatRate) ?? 0) + offerLineNetCents(l));
  let best: number | undefined;
  for (const [rate, net] of sums) if (best === undefined || net > (sums.get(best) ?? 0)) best = rate;
  return toVatRate(best ?? 20);
}

/* ================================================================== */
/* Numbering                                                           */
/* ================================================================== */

function allocate(pattern: string, start: number, date: string, used: Iterable<string>): { number: string; next: number } {
  const taken = new Set(used);
  let n = Math.max(1, Math.floor(start || 1));
  let number = formatNumber(pattern, n, date);
  // a pattern without {N…} never changes – take it as it is
  if (!/\{N+\}/.test(pattern)) return { number, next: n + 1 };
  for (let guard = 0; taken.has(number) && guard < 10_000; guard++) number = formatNumber(pattern, ++n, date);
  return { number, next: n + 1 };
}

/** Next free offer number from settings.projects (skips numbers already in use); `next` goes back into nextOfferNumber. */
export function allocateOfferNumber(settings: Pick<ProjectSettings, "offerNumberPattern" | "nextOfferNumber">, date: string, used: Iterable<string> = []): { number: string; next: number } {
  return allocate(settings.offerNumberPattern || "AN-{YYYY}-{NNNN}", settings.nextOfferNumber, date, used);
}

/** Next free Summa invoice number from the profile; `next` goes back into company.nextInvoiceNumber. */
export function allocateInvoiceNumber(company: Pick<Profile["company"], "invoiceNumberPattern" | "nextInvoiceNumber">, date: string, used: Iterable<string> = []): { number: string; next: number } {
  return allocate(company.invoiceNumberPattern || "RE-{YYYY}-{NNNN}", company.nextInvoiceNumber, date, used);
}

/* ================================================================== */
/* Status helpers                                                      */
/* ================================================================== */

/** Sent offers past their validity count as expired (only for display – nothing is changed). */
export function offerDisplayStatus(offer: Pick<Offer, "status" | "validUntil">, today: string): Offer["status"] {
  if (offer.status === "sent" && offer.validUntil && offer.validUntil < today) return "expired";
  return offer.status;
}

/** Sent offer whose validity ends within the next `days` days (today included). */
export function isOfferExpiringSoon(offer: Pick<Offer, "status" | "validUntil">, today: string, days = 14): boolean {
  if (offer.status !== "sent" || !offer.validUntil) return false;
  return offer.validUntil >= today && offer.validUntil <= addDays(today, days);
}

/** Days from today until the offer's validity ends (negative = already over). */
export function offerDaysLeft(offer: Pick<Offer, "validUntil">, today: string): number | null {
  return offer.validUntil ? daysBetween(today, offer.validUntil) : null;
}

/* ================================================================== */
/* Texts and placeholders                                              */
/* ================================================================== */

export const DEFAULT_OFFER_CONTRACT_NOTE = "Bei Annahme dieses Angebotes wird dieses als Anlage B zum {contractTitle} beigefügt.";
export const DEFAULT_OFFER_SCOPE_TEXT = "Der Leistungsumfang ergibt sich aus den Positionen und Beschreibungen dieses Angebotes.";
export const DEFAULT_OFFER_COMPLETION_TEMPLATE = "Die Fertigstellung des Werkes erfolgt innerhalb von {completionRange}. Spätester Fertigstellungstermin: {completionDeadline} ({completionDeadlineWeekday}).";
const COMPLETION_WITHOUT_DATES = "Die Fertigstellung des Werkes erfolgt innerhalb von {completionRange} ab Auftragserteilung.";
export const OFFER_REVERSE_CHARGE_NOTE = "Übergang der Steuerschuld auf den Leistungsempfänger (Reverse Charge, § 19 Abs. 1 UStG / Art. 196 MwStSystRL).";
export const OFFER_KLEINUNTERNEHMER_NOTE = "Umsatzsteuerbefreit gemäß § 6 Abs. 1 Z 27 UStG (Kleinunternehmerregelung).";

/** Placeholders the texts may use – shown in the settings as help. */
export const OFFER_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "customerName", label: "Kunde" },
  { key: "projectName", label: "Projekt" },
  { key: "companyName", label: "Deine Firma" },
  { key: "contractTitle", label: "Vertragsbezeichnung" },
  { key: "offerNumber", label: "Angebotsnummer" },
  { key: "offerDate", label: "Angebotsdatum" },
  { key: "validUntil", label: "Gültig bis" },
  { key: "downPaymentPercent", label: "Anzahlung in %" },
  { key: "finalPaymentPercent", label: "Schlusszahlung in %" },
  { key: "paymentDueDays", label: "Zahlungsziel in Tagen" },
  { key: "completionRange", label: "Dauer, z. B. „ca. 6–9 Wochen“" },
  { key: "completionDeadline", label: "Spätester Fertigstellungstermin" },
  { key: "completionDeadlineWeekday", label: "Wochentag dieses Termins" },
];

export const OFFER_PAYMENT_PRESETS: { id: string; label: string; text: string }[] = [
  { id: "net14", label: "14 Tage netto", text: "Zahlungsziel 14 Tage netto ohne Abzüge." },
  { id: "net30", label: "30 Tage netto", text: "Zahlungsziel 30 Tage netto ohne Abzüge." },
  { id: "skonto14", label: "14 Tage 3 % Skonto, 30 Tage netto", text: "Zahlung innerhalb von 14 Tagen mit 3 % Skonto, ansonsten 30 Tage netto." },
  { id: "skonto10", label: "10 Tage 2 % Skonto, 30 Tage netto", text: "Zahlung innerhalb von 10 Tagen mit 2 % Skonto, ansonsten 30 Tage netto." },
  {
    id: "package",
    label: "Nach Abnahme je Arbeitspaket",
    text: "Die Abrechnung erfolgt nach Abschluss und Abnahme des jeweiligen Arbeitspakets. Rechnungen sind innerhalb von 14 Tagen ab Rechnungsdatum netto ohne Abzüge zu bezahlen. Eine Anzahlung wird nicht vereinbart.",
  },
];

export interface OfferCompletion {
  /** Project length in weeks (null without both dates). */
  weeks: number | null;
  maxWeeks: number;
  /** "ca. 6–9 Wochen" */
  range: string;
  /** Latest completion date (ISO, moved back to a weekday) or null. */
  deadline: string | null;
  deadlineLabel: string;
  deadlineWeekday: string;
}

/**
 * Completion estimate from the project dates (old ERP): N = length in weeks, range "ca. N–(N+3) Wochen",
 * 4 weeks buffer from 18 weeks on. Deadline = project end (or start + max weeks), moved back to a weekday.
 */
export function offerCompletion(start?: string, end?: string): OfferCompletion {
  const weeks = start && end && end > start ? Math.max(1, Math.round(daysBetween(start, end) / 7)) : null;
  const maxWeeks = weeks === null ? 6 : weeks + (weeks >= 18 ? 4 : 3);
  const range = weeks === null ? "ca. 4–6 Wochen" : `ca. ${weeks}–${maxWeeks} Wochen`;
  let deadline: string | null = end ?? (start ? addDays(start, maxWeeks * 7) : null);
  if (deadline) while ([0, 6].includes(weekdayOf(deadline))) deadline = addDays(deadline, -1);
  return {
    weeks,
    maxWeeks,
    range,
    deadline,
    deadlineLabel: deadline ? longDate(deadline) : "wird bei Projektstart bestätigt",
    deadlineWeekday: deadline ? WEEKDAYS_DE[weekdayOf(deadline)]! : "",
  };
}

export interface OfferTextContext {
  offer: Pick<Offer, "number" | "date" | "validUntil" | "contractTitle" | "downpaymentPct" | "finalPaymentPct" | "paymentDueDays">;
  companyName?: string;
  customerName?: string;
  projectName?: string;
  projectStart?: string;
  projectEnd?: string;
}

/** Values for every placeholder in OFFER_PLACEHOLDERS. */
export function offerPlaceholderValues(ctx: OfferTextContext): Record<string, string> {
  const o = ctx.offer;
  const c = offerCompletion(ctx.projectStart, ctx.projectEnd);
  const down = clampPct(o.downpaymentPct);
  return {
    customerName: ctx.customerName ?? "",
    projectName: ctx.projectName ?? "",
    companyName: ctx.companyName ?? "",
    contractTitle: o.contractTitle ?? "",
    offerNumber: o.number ?? "",
    offerDate: shortDate(o.date),
    validUntil: shortDate(o.validUntil),
    downPaymentPercent: pctText(down),
    finalPaymentPercent: pctText(o.finalPaymentPct === undefined || o.finalPaymentPct === null ? 100 - down : clampPct(o.finalPaymentPct)),
    paymentDueDays: String(o.paymentDueDays > 0 ? Math.round(o.paymentDueDays) : 14),
    completionRange: c.range,
    completionDeadline: c.deadlineLabel,
    completionDeadlineWeekday: c.deadlineWeekday,
  };
}

/** Replaces {key} and {{key}}; unknown placeholders stay visible so typos get noticed. Empty "()" left behind is removed. */
export function fillOfferPlaceholders(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g, (m, a: string | undefined, b: string | undefined) => {
      const key = (a ?? b)!;
      return key in values ? values[key]! : m;
    })
    .replace(/[ \t]*\(\s*\)/g, "");
}

/** Built-in payment text: "30 % bei Annahme des Angebotes, 70 % nach Übergabe … Zahlungsziel 14 Tage netto ohne Abzüge." */
export function defaultOfferPaymentTerms(o: Pick<Offer, "downpaymentPct" | "finalPaymentPct" | "paymentDueDays">): string {
  const down = clampPct(o.downpaymentPct);
  const fin = o.finalPaymentPct === undefined || o.finalPaymentPct === null ? 100 - down : clampPct(o.finalPaymentPct);
  const parts: string[] = [];
  if (down > 0) parts.push(`${pctText(down)} % bei Annahme des Angebotes`);
  if (fin > 0 && down > 0) parts.push(`${pctText(fin)} % nach Übergabe der vereinbarten Leistungen`);
  let text = parts.length ? `${parts.join(", ")}.` : "";
  const due = o.paymentDueDays > 0 ? Math.round(o.paymentDueDays) : 0;
  if (due > 0) text = `${text ? `${text} ` : ""}Zahlungsziel ${due} Tage netto ohne Abzüge.`;
  return text || "Zahlungsbedingungen laut Vereinbarung.";
}

/** Payment text: the template from the settings (with placeholders) or the built-in text. */
export function suggestOfferPaymentTerms(template: string | undefined, ctx: OfferTextContext): string {
  const t = template?.trim();
  if (t) {
    const filled = fillOfferPlaceholders(t, offerPlaceholderValues(ctx)).trim();
    if (filled) return filled;
  }
  return defaultOfferPaymentTerms(ctx.offer);
}

/** "Hinweis" block: the settings template, or contract note (when a contract title is set) + scope sentence. */
export function suggestOfferScopeText(template: string | undefined, ctx: OfferTextContext): string {
  const values = offerPlaceholderValues(ctx);
  const t = template?.trim();
  if (t) return fillOfferPlaceholders(t, values).trim();
  return [values.contractTitle ? fillOfferPlaceholders(DEFAULT_OFFER_CONTRACT_NOTE, values) : "", DEFAULT_OFFER_SCOPE_TEXT].filter(Boolean).join("\n");
}

/** "Fertigstellung" block from the project dates (settings template or built-in text). */
export function suggestOfferCompletionText(template: string | undefined, ctx: OfferTextContext): string {
  const values = offerPlaceholderValues(ctx);
  const t = template?.trim();
  const hasDates = !!(ctx.projectEnd || ctx.projectStart);
  const base = t || (hasDates ? DEFAULT_OFFER_COMPLETION_TEMPLATE : COMPLETION_WITHOUT_DATES);
  return fillOfferPlaceholders(base, values).trim();
}

/** File name like the old ERP: 20260315_AN-2026-0007_Muster_GmbH.pdf */
export function offerFileName(offer: Pick<Offer, "date" | "number">, customerName = ""): string {
  const safe = (s: string) =>
    s
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60);
  return [offer.date.replace(/-/g, ""), safe(offer.number) || "Angebot", safe(customerName)].filter(Boolean).join("_") + ".pdf";
}

/* ================================================================== */
/* New / copied offers                                                 */
/* ================================================================== */

export function newOfferLine(p: Partial<OfferLine> = {}, id: string = ids.line()): OfferLine {
  return { id, title: "", description: "", quantity: 1, unit: "Std", unitNetCents: 0, vatRate: 20, optional: false, ...p };
}

/** Offer line from a product of the article master. */
export function offerLineFromProduct(product: Pick<Product, "id" | "name" | "description" | "unit" | "priceCents" | "vatRate">, id: string = ids.line()): OfferLine {
  return newOfferLine({ title: product.name, description: product.description, unit: product.unit || "Stk", unitNetCents: product.priceCents, vatRate: product.vatRate, productId: product.id, quantity: 1 }, id);
}

/** Copy of an offer as a new draft: new id/number/dates, no status history, no invoices, fresh line ids. */
export function duplicateOffer(offer: Offer, o: { id: string; number: string; today: string; validDays: number; now: string; newLineId?: () => string }): Offer {
  const lineId = o.newLineId ?? (() => ids.line());
  const copy: Offer = {
    ...offer,
    id: o.id,
    number: o.number,
    date: o.today,
    validUntil: addDays(o.today, Math.max(0, o.validDays)),
    status: "draft",
    invoiceIds: [],
    lines: offer.lines.map((l) => ({ ...l, id: lineId() })),
    createdAt: o.now,
    updatedAt: o.now,
  };
  delete copy.sentAt;
  delete copy.decidedAt;
  delete copy.deletedAt;
  delete copy.legacyRef;
  return copy;
}

/** validUntil for a date: date + valid days. */
export function offerValidUntil(date: string, validDays: number): string {
  return addDays(date, Math.max(0, Math.round(validDays || 0)));
}

/* ================================================================== */
/* Paste from Excel                                                    */
/* ================================================================== */

export const OFFER_PASTE_LIMITS = { maxChars: 20_000, maxRows: 100, maxTextLength: 1_000 };

/** Header row for a template the user can paste into Excel. */
export const OFFER_PASTE_TEMPLATE = ["Titel", "Beschreibung", "Menge", "Einheit", "Einzelpreis", "USt %"].join("\t");

export interface OfferPasteRow {
  /** Row number in the pasted text (1-based, physical line where the row starts). */
  line: number;
  title: string;
  description: string;
  quantity: number;
  unit?: string;
  unitNetCents: number;
  vatRate: VatRate;
}

export interface OfferPasteError {
  line: number | null;
  message: string;
}

export interface OfferPasteResult {
  rows: OfferPasteRow[];
  errors: OfferPasteError[];
  /** Hints that do not block the import (e.g. ignored columns). */
  notes: string[];
  hasHeader: boolean;
  sourceRows: number;
  skippedBlankRows: number;
}

type PasteField = "title" | "description" | "quantity" | "unit" | "unitPrice" | "vatRate" | "positionText" | "ignore";

const HEADER_ALIASES: Record<PasteField, string[]> = {
  title: ["titel", "positionstitel", "bezeichnung", "title", "name", "kurztext", "item"],
  description: ["beschreibung", "position", "leistung", "artikel", "text", "description", "langtext", "details", "leistungsbeschreibung"],
  quantity: ["menge", "mengestunden", "stunden", "stundenzahl", "aufwandstunden", "anzahl", "stuck", "stuckzahl", "stk", "quantitat", "quantity", "qty", "hours", "std"],
  unit: ["einheit", "me", "unit", "mengeneinheit"],
  unitPrice: ["einzelpreis", "einzelpreisnetto", "stundensatz", "stundensatznetto", "preisjestunde", "preis", "preisjeeinheit", "preisnetto", "ep", "unitprice", "price", "rate"],
  vatRate: ["steuer", "steuersatz", "ust", "ustsatz", "mwst", "mwstsatz", "tax", "taxrate", "vat", "vatrate"],
  positionText: ["positionstext", "positionstextrahmenbedingung", "zusatztext", "rahmenbedingung", "positionshinweis", "bemerkungposition"],
  ignore: ["pos", "posnr", "nr", "gesamt", "gesamtpreis", "gesamtnetto", "betrag", "summe", "total", "amount"],
};

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("de-AT")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Number from clipboard text: German "1.234,56", "1234,5", plain "1234.56", "1,234.56", "€ 12,50", "20 %".
 * Returns null for anything else.
 */
export function parseLocalizedDecimal(raw: string): number | null {
  let v = raw
    .trim()
    .replace(/[  \s]/g, "")
    .replace(/^(?:€|EUR)/i, "")
    .replace(/(?:€|EUR|%)$/i, "")
    .replace(/'/g, "");
  if (!v) return null;
  if (/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d+$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(v)) v = v.replace(/\./g, "");
  else if (/^[+-]?(?:\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(v)) v = v.replace(/,/g, "");
  else if (/^[+-]?\d+,\d+$/.test(v)) v = v.replace(",", ".");
  else if (!/^[+-]?\d+(?:\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Splits delimited text into rows of cells; quoted cells may contain the delimiter, line breaks and "" for ". */
function splitDelimited(input: string, delimiter: string): { rows: { line: number; cells: string[] }[]; errors: OfferPasteError[] } {
  const rows: { line: number; cells: string[] }[] = [];
  const errors: OfferPasteError[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;
  let physical = 1;
  let rowLine = 1;
  const endCell = () => {
    cells.push(field);
    field = "";
    quoteClosed = false;
  };
  const endRow = () => {
    endCell();
    rows.push({ line: rowLine, cells });
    cells = [];
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const nl = ch === "\n" || ch === "\r";
    const skipNl = () => {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      physical++;
    };
    if (inQuotes) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
        quoteClosed = true;
      } else if (nl) {
        field += "\n";
        skipNl();
      } else field += ch;
      continue;
    }
    if (ch === delimiter) endCell();
    else if (nl) {
      endRow();
      skipNl();
      rowLine = physical;
    } else if (quoteClosed) {
      if (!/\s/.test(ch)) {
        errors.push({ line: physical, message: "Nach einem schließenden Anführungszeichen folgt unerwarteter Text." });
        field += ch;
        quoteClosed = false;
      }
    } else if (ch === '"' && field.trim() === "") {
      field = "";
      inQuotes = true;
    } else field += ch;
  }
  if (inQuotes) errors.push({ line: rowLine, message: "Ein Anführungszeichen wurde geöffnet, aber nicht geschlossen." });
  else if (field.length > 0 || cells.length > 0 || quoteClosed) endRow();
  return { rows, errors };
}

/** Tab (Excel) when the first row has a tab outside quotes, otherwise semicolon (German CSV) when it has one. */
function detectDelimiter(text: string): string {
  let inQuotes = false;
  let semicolon = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') inQuotes = !inQuotes;
    else if (inQuotes) continue;
    else if (ch === "\t") return "\t";
    else if (ch === ";") semicolon = true;
    else if ((ch === "\n" || ch === "\r") && text.slice(0, i).trim()) break;
  }
  return semicolon ? ";" : "\t";
}

type Columns = Partial<Record<Exclude<PasteField, "ignore">, number>>;

function headerColumns(cells: string[]): { columns: Columns; ignored: string[] } | null {
  const columns: Columns = {};
  const ignored: string[] = [];
  let known = 0;
  cells.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (!key) return;
    const field = (Object.keys(HEADER_ALIASES) as PasteField[]).find((f) => HEADER_ALIASES[f].includes(key));
    if (!field) {
      ignored.push(cell.trim());
      return;
    }
    known++;
    if (field === "ignore") return;
    if (columns[field] === undefined) columns[field] = index;
  });
  const hasText = columns.title !== undefined || columns.description !== undefined;
  if (!hasText || columns.unitPrice === undefined || known < 2) return null;
  return { columns, ignored };
}

/** Column layout without a header row, by number of columns. */
function positionalColumns(cells: string[]): Columns | null {
  const n = cells.length;
  if (n === 3) return { description: 0, quantity: 1, unitPrice: 2 };
  if (n === 4) return { description: 0, quantity: 1, unitPrice: 2, vatRate: 3 };
  if (n === 5) {
    // Text | Menge | Preis | USt | Positionstext   or   Titel | Beschreibung | Menge | Preis | USt
    return parseLocalizedDecimal(cells[1] ?? "") !== null ? { description: 0, quantity: 1, unitPrice: 2, vatRate: 3, positionText: 4 } : { title: 0, description: 1, quantity: 2, unitPrice: 3, vatRate: 4 };
  }
  if (n === 6) return { title: 0, description: 1, quantity: 2, unit: 3, unitPrice: 4, vatRate: 5 };
  return null;
}

/**
 * Parses positions pasted from Excel (tab separated) or German CSV (semicolon separated).
 * Header row optional (German/English names), German decimals, quoted multi-line cells.
 * Without a title column the first line of the text becomes the title, the rest the description.
 * Every row is checked on its own; rows with errors are listed and left out.
 */
export function parseOfferPaste(input: string, opts: { defaultVatRate?: VatRate } = {}): OfferPasteResult {
  const L = OFFER_PASTE_LIMITS;
  const empty = (message: string): OfferPasteResult => ({ rows: [], errors: [{ line: null, message }], notes: [], hasHeader: false, sourceRows: 0, skippedBlankRows: 0 });
  if (input.length > L.maxChars) return empty(`Der eingefügte Text ist zu lang (höchstens ${L.maxChars.toLocaleString("de-AT")} Zeichen).`);
  const text = input.replace(/^﻿/, "");
  if (!text.trim()) return empty("Füge mindestens eine Position ein.");
  const parsed = splitDelimited(text, detectDelimiter(text));
  const errors: OfferPasteError[] = [...parsed.errors];
  const notes: string[] = [];
  const isBlank = (cells: string[]) => cells.every((c) => c.trim() === "");
  const firstIndex = parsed.rows.findIndex((r) => !isBlank(r.cells));
  const header = firstIndex >= 0 ? headerColumns(parsed.rows[firstIndex]!.cells) : null;
  if (header?.ignored.length) notes.push(`Nicht übernommen: Spalte${header.ignored.length === 1 ? "" : "n"} ${header.ignored.map((h) => `„${h}“`).join(", ")}.`);
  const defaultRate = opts.defaultVatRate ?? 20;

  const rows: OfferPasteRow[] = [];
  let sourceRows = 0;
  let skippedBlankRows = 0;
  parsed.rows.forEach(({ cells, line }, index) => {
    if (isBlank(cells)) {
      skippedBlankRows++;
      return;
    }
    if (header && index === firstIndex) return;
    sourceRows++;
    // trailing empty cells (Excel pads rows) do not count as columns
    const trimmed = [...cells];
    while (trimmed.length > 1 && trimmed[trimmed.length - 1]!.trim() === "") trimmed.pop();
    const cols = header?.columns ?? positionalColumns(trimmed);
    if (!cols) {
      errors.push({ line, message: `${trimmed.length} Spalten erkannt – erwartet werden 3 bis 6 (Text, Menge, Einzelpreis, USt) oder eine Kopfzeile.` });
      return;
    }
    const cell = (i: number | undefined) => (i === undefined ? "" : (cells[i] ?? "").trim());
    let title = cell(cols.title);
    let description = cell(cols.description);
    const positionText = cell(cols.positionText);
    if (cols.title === undefined) {
      // first line of the text is the title
      const [first, ...rest] = description.split("\n");
      title = (first ?? "").trim();
      description = rest.join("\n").trim();
    } else if (title.includes("\n")) {
      const [first, ...rest] = title.split("\n");
      title = (first ?? "").trim();
      description = [rest.join("\n").trim(), description].filter(Boolean).join("\n");
    }
    if (positionText) description = [description, positionText].filter(Boolean).join("\n");

    const problems: string[] = [];
    if (!title) problems.push(cols.title === undefined ? "Text fehlt." : "Titel fehlt.");
    if (title.length + description.length > L.maxTextLength) problems.push(`Titel und Beschreibung dürfen zusammen höchstens ${L.maxTextLength} Zeichen lang sein.`);

    const qtyRaw = cell(cols.quantity);
    const quantity = cols.quantity === undefined || qtyRaw === "" ? 1 : parseLocalizedDecimal(qtyRaw);
    if (quantity === null) problems.push(`Menge „${qtyRaw}“ ist keine Zahl.`);
    else if (quantity <= 0) problems.push("Menge muss größer als 0 sein.");
    else if (quantity > 1_000_000_000) problems.push("Menge ist zu groß.");

    const priceRaw = cell(cols.unitPrice);
    const price = parseLocalizedDecimal(priceRaw);
    if (price === null) problems.push(priceRaw ? `Einzelpreis „${priceRaw}“ ist keine Zahl.` : "Einzelpreis fehlt.");
    else if (price < 0) problems.push("Einzelpreis darf nicht negativ sein.");
    else if (price > 1_000_000_000) problems.push("Einzelpreis ist zu groß.");

    const vatRaw = cell(cols.vatRate);
    let vat = vatRaw === "" ? defaultRate : parseLocalizedDecimal(vatRaw);
    if (vat !== null && vat > 0 && vat < 1) vat = Math.round(vat * 100); // 0,2 → 20 %
    if (vat === null || !(VALID_RATES as number[]).includes(vat)) problems.push(`Steuersatz „${vatRaw}“ geht nicht – erlaubt sind 0, 10, 13 oder 20 %.`);

    if (quantity !== null && price !== null && quantity * price > 1_000_000_000) problems.push("Positionsbetrag ist zu groß.");
    if (problems.length) {
      errors.push({ line, message: problems.join(" ") });
      return;
    }
    const unit = cell(cols.unit);
    rows.push({ line, title, description, quantity: quantity!, ...(unit ? { unit } : {}), unitNetCents: Math.round((price! + Number.EPSILON) * 100), vatRate: vat as VatRate });
  });
  if (rows.length > L.maxRows) errors.push({ line: null, message: `Höchstens ${L.maxRows} Positionen auf einmal – gefunden wurden ${rows.length}.` });
  if (sourceRows === 0) errors.push({ line: null, message: "Füge mindestens eine Position ein." });
  return { rows: rows.slice(0, L.maxRows), errors, notes, hasHeader: !!header, sourceRows, skippedBlankRows };
}

/** Offer lines from parsed paste rows. */
export function offerLinesFromPaste(rows: OfferPasteRow[], defaults: { unit?: string } = {}, newId: () => string = () => ids.line()): OfferLine[] {
  return rows.map((r) => newOfferLine({ title: r.title, description: r.description, quantity: r.quantity, unit: r.unit ?? defaults.unit ?? "Std", unitNetCents: r.unitNetCents, vatRate: r.vatRate }, newId()));
}

/* ================================================================== */
/* Invoices: offer → Summa invoice draft, project invoices, budget      */
/* ================================================================== */

/** Net per VAT rate of a Summa invoice (line discount, then invoice discount); credit notes negative. */
function invoiceNetByRate(inv: Invoice): Map<number, number> {
  const out = new Map<number, number>();
  const taxable = inv.vatTreatment === "standard";
  for (const l of inv.lines) {
    const net = Math.round(l.quantity * l.unitNetCents * (1 - (l.discountPct || 0) / 100));
    const rate = taxable ? l.vatRate : 0;
    out.set(rate, (out.get(rate) ?? 0) + net);
  }
  const d = clampPct(inv.discountPct);
  for (const [rate, net] of out) {
    const n = Math.round(net * (1 - d / 100));
    out.set(rate, inv.kind === "credit_note" ? -Math.abs(n) : n);
  }
  return out;
}

/** Net of a Summa invoice as it counts against a budget (credit notes negative). */
export function invoiceBudgetNetCents(inv: Invoice): number {
  let s = 0;
  for (const v of invoiceNetByRate(inv).values()) s += v;
  return s;
}

function counts(inv: Invoice): boolean {
  return !inv.deletedAt && inv.status !== "cancelled" && inv.kind !== "offer";
}

/** Invoices that bill this offer: linked to it, plus invoices of its project that are not linked to any offer. */
export function invoicesForOffer(offer: Pick<Offer, "id" | "projectId" | "invoiceIds">, invoices: Invoice[]): Invoice[] {
  return invoices.filter((i) => counts(i) && (i.offerId === offer.id || offer.invoiceIds.includes(i.id) || (!!offer.projectId && i.projectId === offer.projectId && !i.offerId)));
}

export type OfferInvoiceKind = "full" | "downpayment" | "final" | "amount";

export interface InvoiceDraftOptions {
  profile: Pick<Profile, "id" | "vatRegime" | "company">;
  /** Customer – gives the address snapshot and payment days. */
  contact?: Contact;
  /** Invoice numbers already taken (skipped when numbering). */
  usedNumbers?: Iterable<string>;
  issueDate: string;
  now: string;
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
  /**
   * Where the offer discount goes. "lines" (default) puts it on every copied line (InvoiceLine.discountPct), which
   * Summa's totals, PDF and booking already understand. "invoice" sets Invoice.discountPct instead.
   */
  discountMode?: "lines" | "invoice";
  newId?: (kind: "invoice" | "line") => string;
}

export interface InvoiceDraft {
  invoice: Invoice;
  /** Value for profile.company.nextInvoiceNumber after saving this draft. */
  nextInvoiceNumber: number;
}

function vatTreatmentFor(profile: Pick<Profile, "vatRegime">, reverseCharge: boolean | undefined): VatTreatment {
  if (reverseCharge) return "reverse_charge";
  if (profile.vatRegime === "kleinunternehmer") return "kleinunternehmer";
  return "standard";
}

function servicePeriodLabel(start?: string, end?: string): string {
  if (start && end) return start === end ? shortDate(start) : `${shortDate(start)} – ${shortDate(end)}`;
  return shortDate(start ?? end);
}

function baseInvoice(o: InvoiceDraftOptions, p: { customerId?: string; dueDays: number; vatTreatment: VatTreatment; projectId?: string; offerId?: string; reference: string; introText: string; lines: InvoiceLine[] }): InvoiceDraft {
  const newId = o.newId ?? ((k: "invoice" | "line") => (k === "invoice" ? ids.invoice() : ids.line()));
  const { number, next } = allocateInvoiceNumber(o.profile.company, o.issueDate, o.usedNumbers ?? []);
  const c = o.contact;
  const invoice: Invoice = {
    id: newId("invoice"),
    profileId: o.profile.id,
    number,
    kind: "invoice",
    customerId: c?.id ?? p.customerId,
    customerSnapshot: { name: c?.name ?? "", street: c?.street ?? "", zip: c?.zip ?? "", city: c?.city ?? "", country: c?.country ?? "AT", uid: c?.uid ?? "", email: c?.email ?? "" },
    issueDate: o.issueDate,
    dueDate: addDays(o.issueDate, Math.max(0, Math.round(p.dueDays))),
    servicePeriod: servicePeriodLabel(o.servicePeriodStart, o.servicePeriodEnd),
    lines: p.lines,
    introText: p.introText,
    footerText: o.profile.company.invoiceFooter ?? "",
    status: "draft",
    paidCents: 0,
    vatTreatment: p.vatTreatment,
    reference: p.reference,
    createdAt: o.now,
    updatedAt: o.now,
  };
  if (p.projectId) invoice.projectId = p.projectId;
  if (p.offerId) invoice.offerId = p.offerId;
  if (o.servicePeriodStart) invoice.servicePeriodStart = o.servicePeriodStart;
  if (o.servicePeriodEnd) invoice.servicePeriodEnd = o.servicePeriodEnd;
  return { invoice, nextInvoiceNumber: next };
}

/** Splits a net amount over the offer's VAT rates (largest remainder), one line per rate. */
function amountLines(amountNet: number, byRate: { rate: number; netCents: number }[], text: string, standard: boolean, fallbackRate: VatRate, lineId: () => string): InvoiceLine[] {
  const groups = byRate.filter((r) => r.netCents !== 0);
  if (groups.length <= 1) {
    const rate = standard ? toVatRate(groups[0]?.rate ?? fallbackRate) : 0;
    return [{ id: lineId(), description: text, quantity: 1, unit: "pauschal", unitNetCents: amountNet, vatRate: rate, discountPct: 0 }];
  }
  const parts = allocateCents(amountNet, groups.map((g) => g.netCents));
  return groups.map((g, i) => ({ id: lineId(), description: `${text} (Anteil ${g.rate} % USt)`, quantity: 1, unit: "pauschal", unitNetCents: parts[i]!, vatRate: standard ? toVatRate(g.rate) : 0, discountPct: 0 }));
}

/**
 * Summa invoice draft from an offer.
 * - full: every non-optional position ("Titel\nBeschreibung"), with the offer discount
 * - downpayment: one line per VAT rate over offer net × down-payment %
 * - final: every position, minus the earlier invoices of this offer (and unlinked invoices of its project)
 * - amount: a free net amount, split over the offer's VAT rates
 */
export function invoiceFromOffer(
  offer: Offer,
  o: InvoiceDraftOptions & { kind?: OfferInvoiceKind; amountNetCents?: number; earlierInvoices?: Invoice[] },
): InvoiceDraft {
  const kind = o.kind ?? "full";
  const ku = o.profile.vatRegime === "kleinunternehmer";
  const vatTreatment = vatTreatmentFor(o.profile, offer.reverseCharge);
  const standard = vatTreatment === "standard";
  const newId = o.newId ?? ((k: "invoice" | "line") => (k === "invoice" ? ids.invoice() : ids.line()));
  const lineId = () => newId("line");
  const totals = offerTotals(offer, { kleinunternehmer: ku });
  // VAT rates as entered (offerTotals drops them to 0 without VAT) – used for splitting amounts
  const enteredByRate = offerTotals({ ...offer, reverseCharge: false }).byRate;
  const mainRate = offerMainVatRate(offer);
  const discountMode = o.discountMode ?? "lines";
  const lineDiscount = discountMode === "lines" ? clampPct(offer.discountPct) : 0;

  const positionLines = (): InvoiceLine[] =>
    offer.lines
      .filter((l) => !l.optional)
      .map((l) => ({
        id: lineId(),
        description: [l.title.trim(), l.description.trim()].filter(Boolean).join("\n"),
        quantity: l.quantity,
        unit: l.unit || "Stk",
        unitNetCents: l.unitNetCents,
        vatRate: standard ? toVatRate(l.vatRate) : 0,
        discountPct: lineDiscount,
        ...(l.productId ? { productId: l.productId } : {}),
      }));

  let lines: InvoiceLine[];
  let usesOfferDiscount = false;
  const subject = offer.subject.trim();
  if (kind === "downpayment") {
    const pct = clampPct(offer.downpaymentPct);
    const amount = Math.round((totals.netCents * pct) / 100);
    lines = amountLines(amount, enteredByRate.map((r) => ({ rate: r.rate, netCents: r.netCents })), `Anzahlung ${pctText(pct)} % laut Angebot ${offer.number}${subject ? `\n${subject}` : ""}`, standard, mainRate, lineId);
  } else if (kind === "amount") {
    lines = amountLines(Math.round(o.amountNetCents ?? 0), enteredByRate.map((r) => ({ rate: r.rate, netCents: r.netCents })), `Teilrechnung laut Angebot ${offer.number}${subject ? `\n${subject}` : ""}`, standard, mainRate, lineId);
  } else {
    lines = positionLines();
    usesOfferDiscount = true;
    if (kind === "final") {
      const earlier = (o.earlierInvoices ?? []).filter(counts).sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number));
      for (const inv of earlier) {
        const isCredit = inv.kind === "credit_note";
        for (const [rate, net] of invoiceNetByRate(inv)) {
          if (!net) continue;
          lines.push({
            id: lineId(),
            description: `${isCredit ? "zuzüglich Gutschrift" : "abzüglich Rechnung"} ${inv.number} vom ${shortDate(inv.issueDate)}`,
            quantity: 1,
            unit: "pauschal",
            unitNetCents: -net,
            vatRate: standard ? toVatRate(rate) : 0,
            discountPct: 0,
          });
        }
      }
    }
  }

  const dueDays = o.contact?.paymentDueDays ?? offer.paymentDueDays ?? 14;
  const intro = `Vielen Dank für Ihren Auftrag. Gemäß unserem Angebot ${offer.number} vom ${shortDate(offer.date)} erlauben wir uns, folgende Leistungen in Rechnung zu stellen:`;
  const draft = baseInvoice(o, {
    customerId: offer.customerId,
    dueDays,
    vatTreatment,
    projectId: offer.projectId,
    offerId: offer.id,
    reference: `Angebot ${offer.number}`,
    introText: intro,
    lines,
  });
  if (usesOfferDiscount && clampPct(offer.discountPct) > 0) {
    if (discountMode === "invoice") draft.invoice.discountPct = clampPct(offer.discountPct);
    if (offer.discountText.trim()) draft.invoice.discountText = offer.discountText.trim();
  }
  return draft;
}

export type ProjectInvoiceKind = "downpayment" | "final" | "partial";

/** Summa invoice draft over a net amount for a project (one line), e.g. down payment or final invoice. */
export function projectInvoiceDraft(
  project: Pick<Project, "id" | "name" | "number" | "customerId" | "startDate" | "endDate">,
  o: InvoiceDraftOptions & { amountNetCents: number; kind?: ProjectInvoiceKind; description?: string; vatRate?: VatRate; downpaymentPct?: number; offer?: Offer },
): InvoiceDraft {
  const vatTreatment = vatTreatmentFor(o.profile, o.offer?.reverseCharge);
  const standard = vatTreatment === "standard";
  const newId = o.newId ?? ((k: "invoice" | "line") => (k === "invoice" ? ids.invoice() : ids.line()));
  const kind = o.kind ?? "partial";
  const text =
    o.description?.trim() ||
    (kind === "downpayment" ? `Anzahlung ${pctText(clampPct(o.downpaymentPct ?? 30))} % – ${project.name}` : kind === "final" ? `Schlussrechnung – ${project.name}` : `Teilrechnung – ${project.name}`);
  const rate: VatRate = standard ? (o.vatRate ?? (o.offer ? offerMainVatRate(o.offer) : 20)) : 0;
  const start = o.servicePeriodStart ?? project.startDate;
  const end = o.servicePeriodEnd ?? project.endDate;
  return baseInvoice(
    { ...o, servicePeriodStart: start, servicePeriodEnd: end },
    {
      customerId: project.customerId ?? o.offer?.customerId,
      dueDays: o.contact?.paymentDueDays ?? o.offer?.paymentDueDays ?? 14,
      vatTreatment,
      projectId: project.id,
      offerId: o.offer?.id,
      reference: [project.number ? `Projekt ${project.number}` : "", o.offer ? `Angebot ${o.offer.number}` : ""].filter(Boolean).join(" · "),
      introText: "Vielen Dank für Ihren Auftrag. Wir erlauben uns, folgende Leistungen in Rechnung zu stellen:",
      lines: [{ id: newId("line"), description: text, quantity: 1, unit: "pauschal", unitNetCents: Math.round(o.amountNetCents), vatRate: rate, discountPct: 0 }],
    },
  );
}

export interface ProjectBillingSuggestion {
  budgetCents: number;
  /** Net of the counted invoices (not deleted, not cancelled). */
  billedNetCents: number;
  /** Budget − billed; negative = more billed than agreed. */
  remainingCents: number;
  invoiceCount: number;
  /** downpayment = first invoice, final = the rest, none = no budget or nothing left. */
  kind: "downpayment" | "final" | "none";
  suggestedCents: number;
  /** 0..1 of the budget billed. */
  progress: number;
  /** start = nothing billed yet, end = project end passed with budget left. */
  reminder: "start" | "end" | null;
}

/**
 * What to bill next (old ERP): first invoice = down-payment % of the budget, after that the remaining budget
 * (budget − net of the project's non-cancelled invoices).
 */
export function projectBillingSuggestion(
  project: Pick<Project, "id" | "budgetCents" | "status" | "endDate" | "billing">,
  invoices: Invoice[],
  o: { downpaymentPct: number; today: string },
): ProjectBillingSuggestion {
  const list = invoices.filter((i) => counts(i) && i.projectId === project.id);
  const billedNetCents = list.reduce((s, i) => s + invoiceBudgetNetCents(i), 0);
  const budgetCents = project.budgetCents || 0;
  const remainingCents = budgetCents - billedNetCents;
  let kind: ProjectBillingSuggestion["kind"] = "none";
  let suggestedCents = 0;
  if (budgetCents > 0) {
    if (!list.length) {
      kind = "downpayment";
      suggestedCents = Math.round((budgetCents * clampPct(o.downpaymentPct)) / 100);
    } else if (remainingCents > 0) {
      kind = "final";
      suggestedCents = remainingCents;
    }
  }
  let reminder: ProjectBillingSuggestion["reminder"] = null;
  const closed = project.status === "completed" || project.status === "cancelled" || project.billing === "internal";
  if (!closed && budgetCents > 0 && remainingCents > 0) {
    if (!list.length) reminder = "start";
    else if (project.endDate && project.endDate < o.today) reminder = "end";
  }
  return { budgetCents, billedNetCents, remainingCents, invoiceCount: list.length, kind, suggestedCents, progress: budgetCents > 0 ? Math.max(0, billedNetCents / budgetCents) : 0, reminder };
}
