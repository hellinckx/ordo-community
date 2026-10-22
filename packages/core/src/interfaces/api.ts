/**
 * The Ordo API, version 1 – one JSON shape for the local API (Desktop), webhooks and pull connections. Amounts are
 * euros with two decimals (what other programs expect), dates YYYY-MM-DD. Internally Ordo keeps cents.
 * Documented for other programs in docs/API.md.
 */
import { z } from "zod";
import type { Contact, Invoice, Profile, Transaction } from "../model/types";
import type { Product, Project, StockMove, TimeEntry } from "../erp/schemas";
import { invoiceTotals } from "../analytics/stats";

export const ORDO_API_VERSION = "ordo.v1";

const eur = (cents: number | undefined | null) => (cents === undefined || cents === null ? null : Math.round(cents) / 100);
/** Euros from another program (number, "1.234,56" or "1234.56") → cents. Strict: unreadable amounts throw. */
export function apiCents(v: number | string): number {
  if (typeof v === "number") return Math.round(v * 100);
  const s = v.trim().replace(/\s/g, "");
  const normalised = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(normalised);
  if (!Number.isFinite(n)) throw new Error(`Kein Betrag: ${v}`);
  return Math.round(n * 100);
}

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");
const Amount = z.union([z.number(), z.string()]);
const VatRateIn = z.union([z.literal(0), z.literal(10), z.literal(13), z.literal(20)]);

/* ------------------------------------------------------------------ */
/* Out                                                                 */
/* ------------------------------------------------------------------ */

export function apiContact(c: Contact) {
  return { id: c.id, number: c.number ?? null, name: c.name, kind: c.kind, uid: c.uid, email: c.email, phone: c.phone, street: c.street, zip: c.zip, city: c.city, country: c.country, iban: c.iban, notes: c.notes, active: c.active !== false, updatedAt: c.updatedAt, deleted: !!c.deletedAt };
}

export function apiTransaction(t: Transaction, names: { category?: string; contact?: string } = {}) {
  return {
    id: t.id,
    date: t.date,
    kind: t.kind,
    description: t.description,
    amount: eur(t.grossCents),
    currency: t.currency,
    vat: t.vatLines.map((l) => ({ rate: l.rate, net: eur(l.netCents), vat: eur(l.vatCents) })),
    vatTreatment: t.vatTreatment,
    paymentMethod: t.paymentMethod,
    contactId: t.contactId ?? null,
    contactName: names.contact ?? null,
    category: names.category ?? null,
    invoiceNumber: t.invoiceNumber || null,
    reference: t.reference || null,
    dueDate: t.dueDate ?? null,
    paidDate: t.paidDate ?? null,
    open: !!t.dueDate && !t.paidDate,
    projectId: t.projectId ?? null,
    externalId: t.legacyRef ?? null,
    updatedAt: t.updatedAt,
    deleted: !!t.deletedAt,
  };
}

export function apiInvoice(inv: Invoice, profile?: Profile) {
  const ku = profile?.vatRegime === "kleinunternehmer" && inv.vatTreatment === "standard";
  const totals = invoiceTotals(ku ? { ...inv, vatTreatment: "kleinunternehmer" } : inv);
  return {
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    status: inv.status,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    customerId: inv.customerId ?? null,
    customer: { name: inv.customerSnapshot.name, uid: inv.customerSnapshot.uid, street: inv.customerSnapshot.street, zip: inv.customerSnapshot.zip, city: inv.customerSnapshot.city, country: inv.customerSnapshot.country, email: inv.customerSnapshot.email },
    lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitNet: eur(l.unitNetCents), vatRate: l.vatRate, discountPct: l.discountPct || 0 })),
    net: eur(totals.netCents),
    vat: eur(totals.vatCents),
    gross: eur(totals.grossCents),
    paid: eur(inv.paidCents),
    paidDate: inv.paidDate ?? null,
    vatTreatment: inv.vatTreatment,
    reference: inv.reference || null,
    projectId: inv.projectId ?? null,
    updatedAt: inv.updatedAt,
    deleted: !!inv.deletedAt,
  };
}

export function apiProduct(p: Product, stock?: number) {
  return { id: p.id, sku: p.sku, name: p.name, kind: p.kind, unit: p.unit, priceNet: eur(p.priceCents), vatRate: p.vatRate, cost: eur(p.costCents), category: p.category, barcode: p.barcode, trackStock: p.trackStock, stock: stock ?? null, minStock: p.minStock, active: p.active, updatedAt: p.updatedAt, deleted: !!p.deletedAt };
}

export function apiStockMove(m: StockMove) {
  return { id: m.id, productId: m.productId, date: m.date, quantity: m.quantity, kind: m.kind, note: m.note, updatedAt: m.updatedAt, deleted: !!m.deletedAt };
}

export function apiProject(p: Project) {
  return { id: p.id, number: p.number, name: p.name, status: p.status, customerId: p.customerId ?? null, startDate: p.startDate ?? null, endDate: p.endDate ?? null, billing: p.billing, budgetNet: eur(p.budgetCents), updatedAt: p.updatedAt, deleted: !!p.deletedAt };
}

export function apiTimeEntry(t: TimeEntry) {
  return { id: t.id, projectId: t.projectId, taskId: t.taskId ?? null, memberId: t.memberId ?? null, date: t.date, minutes: t.minutes, description: t.description, billable: t.billable, updatedAt: t.updatedAt, deleted: !!t.deletedAt };
}

/* ------------------------------------------------------------------ */
/* In                                                                  */
/* ------------------------------------------------------------------ */

export const ApiContactInputSchema = z.object({
  name: z.string().trim().min(1, "name fehlt"),
  kind: z.enum(["customer", "vendor", "both"]).default("customer"),
  uid: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  street: z.string().default(""),
  zip: z.string().default(""),
  city: z.string().default(""),
  country: z.string().length(2).default("AT"),
  iban: z.string().default(""),
  notes: z.string().default(""),
  /** Your id for the record – a second call with the same id updates instead of creating a duplicate. */
  externalId: z.string().max(120).optional(),
});
export type ApiContactInput = z.infer<typeof ApiContactInputSchema>;

export const ApiTransactionInputSchema = z.object({
  kind: z.enum(["income", "expense"]),
  date: ISO,
  /** Gross amount in euros. */
  amount: Amount,
  /** Either one rate for the whole amount … */
  vatRate: VatRateIn.optional(),
  /** … or the split per rate (net + VAT in euros). */
  vat: z.array(z.object({ rate: VatRateIn, net: Amount, vat: Amount })).optional(),
  vatTreatment: z.enum(["standard", "kleinunternehmer", "reverse_charge", "ig_erwerb", "ig_lieferung", "export", "exempt"]).default("standard"),
  description: z.string().default(""),
  contactId: z.string().optional(),
  /** Matched to an existing contact by name; created when unknown. */
  contactName: z.string().optional(),
  /** Category name as shown in Summa (e.g. "Büromaterial"); unknown names fall back to the default category. */
  category: z.string().optional(),
  paymentMethod: z.enum(["bank", "cash", "card", "paypal", "direct_debit", "other"]).default("bank"),
  invoiceNumber: z.string().default(""),
  reference: z.string().default(""),
  dueDate: ISO.optional(),
  paidDate: ISO.optional(),
  projectId: z.string().optional(),
  externalId: z.string().max(120).optional(),
});
export type ApiTransactionInput = z.infer<typeof ApiTransactionInputSchema>;

export const ApiInvoiceInputSchema = z.object({
  customerId: z.string().optional(),
  customer: z.object({ name: z.string().min(1), uid: z.string().default(""), street: z.string().default(""), zip: z.string().default(""), city: z.string().default(""), country: z.string().length(2).default("AT"), email: z.string().default("") }).optional(),
  issueDate: ISO.optional(),
  dueDate: ISO.optional(),
  lines: z.array(z.object({ description: z.string().min(1), quantity: z.number().default(1), unit: z.string().default("Stk"), unitNet: Amount, vatRate: VatRateIn.default(20), discountPct: z.number().min(0).max(100).default(0) })).min(1),
  reference: z.string().default(""),
  introText: z.string().default(""),
  footerText: z.string().default(""),
  projectId: z.string().optional(),
  externalId: z.string().max(120).optional(),
});
export type ApiInvoiceInput = z.infer<typeof ApiInvoiceInputSchema>;

export const ApiIncomingInputSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().optional(),
  /** File content, base64. PDF, image, ebInterface/XRechnung/ZUGFeRD XML. */
  contentBase64: z.string().min(1),
  direction: z.enum(["incoming", "outgoing"]).default("incoming"),
});
export type ApiIncomingInput = z.infer<typeof ApiIncomingInputSchema>;

export const ApiStockMoveInputSchema = z.object({
  productId: z.string().optional(),
  sku: z.string().optional(),
  /** + into stock, − out of stock. */
  quantity: z.number().refine((n) => n !== 0, "quantity darf nicht 0 sein"),
  kind: z.enum(["receipt", "issue", "adjustment", "sale"]).default("adjustment"),
  date: ISO.optional(),
  note: z.string().default(""),
});
export type ApiStockMoveInput = z.infer<typeof ApiStockMoveInputSchema>;

export const ApiTimeEntryInputSchema = z.object({
  projectId: z.string().optional(),
  projectNumber: z.string().optional(),
  date: ISO,
  minutes: z.number().int().refine((n) => n !== 0, "minutes darf nicht 0 sein"),
  description: z.string().default(""),
  billable: z.boolean().default(true),
  memberId: z.string().optional(),
});
export type ApiTimeEntryInput = z.infer<typeof ApiTimeEntryInputSchema>;

/* ------------------------------------------------------------------ */
/* Webhook events                                                      */
/* ------------------------------------------------------------------ */

export type ApiChange = "created" | "updated" | "deleted";

export function changeOf(e: { createdAt: string; updatedAt: string; deletedAt?: string }, since?: string): ApiChange {
  if (e.deletedAt) return "deleted";
  return !since || e.createdAt > since || e.createdAt === e.updatedAt ? "created" : "updated";
}

/** Reads a dotted path ("data.items.0.name") out of JSON returned by another program. */
export function pickPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Every leaf path of a sample record with a short preview – Atlas uses it to suggest a field mapping. */
export function describeFields(sample: unknown, prefix = "", out: { path: string; type: string; example: string }[] = [], depth = 0): { path: string; type: string; example: string }[] {
  if (out.length >= 80 || depth > 4) return out;
  if (sample && typeof sample === "object" && !Array.isArray(sample)) {
    for (const [k, v] of Object.entries(sample as Record<string, unknown>)) describeFields(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
  } else if (Array.isArray(sample)) {
    out.push({ path: prefix, type: `Liste (${sample.length})`, example: "" });
    if (sample.length && typeof sample[0] === "object") describeFields(sample[0], `${prefix}.0`, out, depth + 1);
  } else {
    const s = sample === null || sample === undefined ? "" : String(sample);
    out.push({ path: prefix, type: sample === null ? "leer" : typeof sample, example: s.length > 40 ? `${s.slice(0, 40)}…` : s });
  }
  return out;
}
