import type { SummaDocument, Transaction } from "../model/types";

export type DocDirection = "incoming" | "outgoing";

/**
 * Effective direction of a document: forced at import (folder/upload for own invoices) wins, then the
 * booked transaction's kind, then what the extraction detected. Everything else is an incoming receipt.
 */
export function documentDirection(doc: Pick<SummaDocument, "direction" | "extraction">, tx?: Pick<Transaction, "kind"> | null): DocDirection {
  if (doc.direction) return doc.direction;
  if (tx?.kind === "income") return "outgoing";
  if (tx?.kind === "expense") return "incoming";
  return doc.extraction?.fields.direction === "outgoing" ? "outgoing" : "incoming";
}
