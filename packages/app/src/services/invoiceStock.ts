/**
 * Stock ↔ bookkeeping: a finished invoice takes its articles out of stock (a credit note brings them back), deleting it
 * books them back, and an incoming invoice can put goods into stock. Only called when "Produkte & Lager" is installed.
 */
import { invoiceStockMoves, invoiceStockReversal, newStockMove, purchaseStockMoves, todayIso, type Invoice, type ReceiptLine, type Transaction } from "@ordo/core";
import { requireStore } from "@/state/session";

/** Finished invoice → one sale per article line. Does nothing when the invoice already moved stock. Returns the number of moves. */
export function bookInvoiceStock(inv: Invoice): number {
  const store = requireStore();
  if (store.list("stockMoves", { profileId: inv.profileId }).some((m) => m.invoiceId === inv.id)) return 0;
  const drafts = invoiceStockMoves(inv, store.list("products", { profileId: inv.profileId }));
  for (const d of drafts) store.insert("stockMoves", newStockMove(inv.profileId, d), "stock.invoice");
  return drafts.length;
}

/** Deleted or cancelled invoice → counter-moves so the stock is as before. Returns the number of moves. */
export function reverseInvoiceStock(inv: Invoice, reason = "storniert"): number {
  const store = requireStore();
  const drafts = invoiceStockReversal(inv, store.list("stockMoves", { profileId: inv.profileId }), { date: todayIso(), reason });
  for (const d of drafts) store.insert("stockMoves", newStockMove(inv.profileId, d), "stock.invoice_reverse");
  return drafts.length;
}

/** Incoming invoice → goods into stock; optionally the paid price becomes the article's purchase price. */
export function bookPurchaseStock(tx: Transaction, lines: ReceiptLine[], opts: { updateCost?: boolean } = {}): number {
  const store = requireStore();
  const products = store.list("products", { profileId: tx.profileId });
  const drafts = purchaseStockMoves(tx, lines, products);
  for (const d of drafts) {
    store.insert("stockMoves", newStockMove(tx.profileId, d), "stock.purchase");
    const p = products.find((x) => x.id === d.productId);
    if (opts.updateCost && p && d.unitCostCents && d.unitCostCents !== p.costCents) store.update("products", p.id, { costCents: d.unitCostCents });
  }
  return drafts.length;
}
