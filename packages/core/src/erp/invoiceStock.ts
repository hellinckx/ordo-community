/* Stock ↔ bookkeeping (Ordo Lager × Summa): invoices move goods out, incoming invoices bring them in. Pure functions. */
import type { Category, ExtractedLineItem, Invoice, Transaction } from "../model/types";
import type { Product, StockMove } from "./schemas";
import { isStockTracked, roundQty, type StockMoveDraft } from "./stock";

type InvoiceRef = Pick<Invoice, "id" | "number" | "kind">;

/** "Rechnung 2026-014" / "Gutschrift G-3" – used in move notes. */
export function invoiceLabel(inv: Pick<Invoice, "number" | "kind">): string {
  return `${inv.kind === "credit_note" ? "Gutschrift" : "Rechnung"} ${inv.number}`;
}

/**
 * A finished invoice → one `sale` move per line with a stock-tracked article: an invoice takes the goods out (−),
 * a credit note brings them back (+). Offers, lines without article, services and zero quantities move nothing.
 */
export function invoiceStockMoves(invoice: InvoiceRef & Pick<Invoice, "issueDate" | "customerId" | "lines">, products: Product[]): StockMoveDraft[] {
  if (invoice.kind === "offer") return [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const sign = invoice.kind === "credit_note" ? 1 : -1;
  const out: StockMoveDraft[] = [];
  for (const l of invoice.lines) {
    const p = l.productId ? byId.get(l.productId) : undefined;
    if (!p || p.deletedAt || !isStockTracked(p) || !l.quantity) continue;
    out.push({ productId: p.id, date: invoice.issueDate, quantity: roundQty(sign * l.quantity), kind: "sale", unitCostCents: p.costCents, note: invoiceLabel(invoice), invoiceId: invoice.id, contactId: invoice.customerId });
  }
  return out;
}

/**
 * Undo what an invoice moved (deleted or cancelled): one counter-move per article whose linked moves don't add up to 0.
 * Running it twice does nothing the second time.
 */
export function invoiceStockReversal(invoice: InvoiceRef, moves: StockMove[], opts: { date: string; reason?: string }): StockMoveDraft[] {
  const net = new Map<string, { qty: number; move: StockMove }>();
  for (const m of moves) {
    if (m.deletedAt || m.invoiceId !== invoice.id) continue;
    const e = net.get(m.productId);
    net.set(m.productId, { qty: (e?.qty ?? 0) + m.quantity, move: e?.move ?? m });
  }
  const out: StockMoveDraft[] = [];
  for (const [productId, { qty, move }] of net) {
    const q = roundQty(-qty);
    if (Math.abs(q) < 1e-9) continue;
    out.push({ productId, date: opts.date, quantity: q, kind: "sale", unitCostCents: move.unitCostCents, note: `${invoiceLabel(invoice)} ${opts.reason ?? "storniert"}`, invoiceId: invoice.id, contactId: move.contactId });
  }
  return out;
}

/** Whether an expense category is about goods or material (Wareneinkauf, Rohstoffe – EKR class 5). */
export function isGoodsCategory(cat: Pick<Category, "name" | "ekrAccount"> | undefined): boolean {
  if (!cat) return false;
  if (cat.ekrAccount && /^5[0-3]/.test(cat.ekrAccount)) return true;
  return /waren|material|rohstoff|handelsware|einkauf/i.test(cat.name);
}

export interface ReceiptLine {
  productId?: string;
  quantity: number;
  /** Net purchase price per unit. */
  unitCostCents?: number;
  /** Text of the invoice line it came from. */
  description?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Matches the lines read from an incoming invoice with stock-tracked articles (Artikelnummer, Barcode or name in the text).
 * Unmatched lines stay without article so the person can pick one.
 */
export function suggestReceiptLines(lineItems: ExtractedLineItem[], products: Product[]): ReceiptLine[] {
  const tracked = products.filter((p) => !p.deletedAt && p.active && isStockTracked(p));
  return lineItems
    .filter((li) => li.description || li.totalCents)
    .map((li) => {
      const text = norm(li.description ?? "");
      const p = text ? tracked.find((x) => (x.sku && text.includes(norm(x.sku))) || (x.barcode && text.includes(norm(x.barcode)))) ?? tracked.find((x) => x.name.length >= 3 && text.includes(norm(x.name))) : undefined;
      const quantity = li.quantity && li.quantity > 0 ? li.quantity : 1;
      const unitCostCents = li.unitPriceCents ?? (li.totalCents != null ? Math.round(li.totalCents / quantity) : undefined);
      return { productId: p?.id, quantity, unitCostCents: unitCostCents ?? p?.costCents, description: li.description ?? undefined };
    });
}

/** Incoming invoice → one `receipt` move per line with a stock-tracked article and a quantity. */
export function purchaseStockMoves(tx: Pick<Transaction, "id" | "date" | "contactId" | "invoiceNumber" | "description">, lines: ReceiptLine[], products: Product[]): StockMoveDraft[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const note = tx.invoiceNumber ? `Eingangsrechnung ${tx.invoiceNumber}` : tx.description || "Eingangsrechnung";
  const out: StockMoveDraft[] = [];
  for (const l of lines) {
    const p = l.productId ? byId.get(l.productId) : undefined;
    if (!p || !isStockTracked(p) || !(l.quantity > 0)) continue;
    out.push({ productId: p.id, date: tx.date, quantity: roundQty(l.quantity), kind: "receipt", unitCostCents: l.unitCostCents ?? p.costCents, note, transactionId: tx.id, contactId: tx.contactId });
  }
  return out;
}
