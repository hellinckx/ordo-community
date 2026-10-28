import { describe, expect, it } from "vitest";
import { InvoiceSchema, type Invoice, type InvoiceLine } from "../model/types";
import { ProductSchema, StockMoveSchema, type Product } from "./schemas";
import { invoiceStockMoves, invoiceStockReversal, isGoodsCategory, purchaseStockMoves, suggestReceiptLines } from "./invoiceStock";
import { newStockMove, stockLevels } from "./stock";

const now = "2026-10-01T00:00:00.000Z";
const prod = (id: string, patch: Partial<Product> = {}): Product => ProductSchema.parse({ id, profileId: "p", name: id, costCents: 100, createdAt: now, updatedAt: now, ...patch });
const line = (patch: Partial<InvoiceLine>): InvoiceLine => ({ id: `l${Math.random()}`, description: "x", quantity: 1, unit: "Stk", unitNetCents: 1000, vatRate: 20, discountPct: 0, ...patch });
const inv = (lines: InvoiceLine[], patch: Partial<Invoice> = {}): Invoice => InvoiceSchema.parse({ id: "inv1", profileId: "p", number: "2026-001", issueDate: "2026-10-05", dueDate: "2026-10-19", customerId: "c1", lines, createdAt: now, updatedAt: now, ...patch });
const products = [prod("poster"), prod("paper", { kind: "material", costCents: 40 }), prod("design", { kind: "service" }), prod("free", { trackStock: false })];

describe("invoiceStockMoves", () => {
  it("takes one sale per line with a stock-tracked article out of stock", () => {
    const drafts = invoiceStockMoves(inv([line({ productId: "poster", quantity: 3 }), line({ productId: "paper", quantity: 2.5 }), line({ productId: "poster", quantity: 1 })]), products);
    expect(drafts.map((d) => [d.productId, d.quantity, d.kind])).toEqual([["poster", -3, "sale"], ["paper", -2.5, "sale"], ["poster", -1, "sale"]]);
    expect(drafts[0]).toMatchObject({ date: "2026-10-05", invoiceId: "inv1", contactId: "c1", unitCostCents: 100, note: "Rechnung 2026-001" });
  });
  it("skips lines without article, services, untracked articles and zero quantities", () => {
    const drafts = invoiceStockMoves(inv([line({}), line({ productId: "design" }), line({ productId: "free" }), line({ productId: "poster", quantity: 0 }), line({ productId: "gone" })]), products);
    expect(drafts).toEqual([]);
  });
  it("brings goods back on a credit note and moves nothing for an offer", () => {
    expect(invoiceStockMoves(inv([line({ productId: "poster", quantity: 2 })], { kind: "credit_note", number: "G-1" }), products)[0]).toMatchObject({ quantity: 2, note: "Gutschrift G-1" });
    expect(invoiceStockMoves(inv([line({ productId: "poster", quantity: 2 })], { kind: "offer" }), products)).toEqual([]);
  });
});

describe("invoiceStockReversal", () => {
  const invoice = inv([line({ productId: "poster", quantity: 3 }), line({ productId: "poster", quantity: 1 }), line({ productId: "paper", quantity: 2 })]);
  const sold = invoiceStockMoves(invoice, products).map((d) => newStockMove("p", d, now));
  const other = StockMoveSchema.parse({ id: "o", profileId: "p", productId: "poster", quantity: 10, kind: "receipt", date: "2026-10-01", createdAt: now, updatedAt: now });

  it("puts back the net quantity per article once", () => {
    const back = invoiceStockReversal(invoice, [other, ...sold], { date: "2026-10-10" });
    expect(back.map((d) => [d.productId, d.quantity])).toEqual([["poster", 4], ["paper", 2]]);
    expect(back[0]).toMatchObject({ kind: "sale", invoiceId: "inv1", date: "2026-10-10", note: "Rechnung 2026-001 storniert", contactId: "c1" });
    const all = [other, ...sold, ...back.map((d) => newStockMove("p", d, now))];
    expect(stockLevels(products, all).get("poster")).toBe(10);
    expect(invoiceStockReversal(invoice, all, { date: "2026-10-11" })).toEqual([]);
  });
  it("ignores deleted moves", () => {
    expect(invoiceStockReversal(invoice, sold.map((m) => ({ ...m, deletedAt: now })), { date: "2026-10-10" })).toEqual([]);
  });
});

describe("incoming invoices", () => {
  it("recognises goods categories", () => {
    expect(isGoodsCategory({ name: "Wareneinkauf / Material", ekrAccount: "5000" })).toBe(true);
    expect(isGoodsCategory({ name: "Druckerei", ekrAccount: "5100" })).toBe(true);
    expect(isGoodsCategory({ name: "Miete", ekrAccount: "7400" })).toBe(false);
    expect(isGoodsCategory(undefined)).toBe(false);
  });
  it("matches read lines with articles by number or name", () => {
    const list = [prod("a", { name: "Plakatpapier A1", sku: "PP-A1" }), prod("b", { name: "Roll-up Kassette" }), prod("s", { name: "Montage", kind: "service" })];
    const lines = suggestReceiptLines([
      { description: "Art. PP-A1 Papier 120g", quantity: 50, unitPriceCents: 30, totalCents: 1500, vatRate: 20 },
      { description: "ROLL-UP KASSETTE schwarz", quantity: 2, unitPriceCents: null, totalCents: 7000, vatRate: 20 },
      { description: "Montage", quantity: 1, unitPriceCents: 5000, totalCents: 5000, vatRate: 20 },
    ], list);
    expect(lines.map((l) => [l.productId, l.quantity, l.unitCostCents])).toEqual([["a", 50, 30], ["b", 2, 3500], [undefined, 1, 5000]]);
  });
  it("books receipts for lines with article and quantity", () => {
    const drafts = purchaseStockMoves({ id: "tx1", date: "2026-10-03", contactId: "v1", invoiceNumber: "R-77", description: "Papier" }, [{ productId: "paper", quantity: 20, unitCostCents: 35 }, { productId: "design", quantity: 1 }, { quantity: 4 }, { productId: "poster", quantity: 0 }], products);
    expect(drafts).toEqual([{ productId: "paper", date: "2026-10-03", quantity: 20, kind: "receipt", unitCostCents: 35, note: "Eingangsrechnung R-77", transactionId: "tx1", contactId: "v1" }]);
  });
});
