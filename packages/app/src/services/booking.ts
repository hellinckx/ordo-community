/**
 * Turning a reviewed (or confidently extracted) document into a booked transaction – shared by the
 * review screen ("Bestätigen & buchen") and the importer (automatic booking). Everything in here is safe
 * to run unattended: it never creates assets on its own (saveTransaction does that only for the special
 * asset categories, which auto-booking excludes) and only learns from the document itself.
 */
import { ids, nowIso, type Contact, type Extraction, type SummaDocument, type Transaction } from "@ordo/core";
import { requireStore } from "@/state/session";
import { saveTransaction } from "@/components/TransactionForm";

export interface BookOptions {
  /** Booked by the importer without a human looking at it. */
  auto?: boolean;
  /** Extraction to learn from (defaults to the document's). */
  extraction?: Extraction;
  /** Category the draft had before the user touched it – a change teaches the category a keyword. */
  draftCategoryId?: string;
}

const LEGAL_WORDS = new Set(["gmbh", "ag", "kg", "og", "e.u.", "eu", "ltd", "limited", "inc", "llc", "se", "co", "sarl", "gesmbh", "ug"]);

/** First meaningful word of a vendor name, lower-cased ("Billa AG" → "billa"). */
export function vendorToken(name: string): string | null {
  const word = name
    .toLowerCase()
    .split(/[\s,./|()-]+/)
    .find((w) => w.length >= 4 && !LEGAL_WORDS.has(w) && !/^\d+$/.test(w));
  return word ?? null;
}

export function bookDocument(doc: SummaDocument, tx: Transaction, opts: BookOptions = {}): Transaction {
  const store = requireStore();
  const ex = opts.extraction ?? doc.extraction;
  const profileId = tx.profileId;
  let contactId = tx.contactId;
  const income = tx.kind === "income";
  // Learn the vendor/customer so the next receipt is matched and categorised instantly.
  const partnerName = income ? (ex?.fields.customerName ?? null) : (ex?.fields.vendorName ?? null);
  const partnerConf = income ? (ex?.confidence.customerName ?? ex?.confidence.vendorName ?? 0) : (ex?.confidence.vendorName ?? 0);
  if (!contactId && partnerName && tx.kind !== "transfer" && (!opts.auto || partnerConf >= 0.85)) {
    const name = partnerName.trim();
    const found = store.list("contacts", { profileId }).find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (found) contactId = found.id;
    else {
      const now = nowIso();
      const c: Contact = { id: ids.contact(), profileId, name, kind: income ? "customer" : "vendor", uid: income ? "" : (ex?.fields.vendorUid ?? ""), email: "", phone: "", street: income ? "" : (ex?.fields.vendorAddress ?? ""), zip: "", city: "", country: "AT", iban: income ? "" : (ex?.fields.vendorIban ?? ""), defaultCategoryId: tx.categoryId, notes: "", aliases: [], createdAt: now, updatedAt: now };
      store.insert("contacts", c, "contact.learn");
      contactId = c.id;
    }
  }
  const existing = store.byId("transactions", tx.id);
  const saved = saveTransaction({ ...tx, contactId, documentIds: tx.documentIds.includes(doc.id) ? tx.documentIds : [...tx.documentIds, doc.id], autoBooked: !!opts.auto }, { isNew: !existing });
  store.update("documents", doc.id, { status: "approved", transactionId: saved.id, reviewedAt: nowIso(), autoBooked: !!opts.auto, autoBookReasons: undefined }, opts.auto ? "document.autobook" : "document.approve");

  // vendor → category memory: a human decision always wins, automation only fills gaps
  if (saved.contactId && saved.categoryId) {
    const contact = store.byId("contacts", saved.contactId);
    if (contact && (opts.auto ? !contact.defaultCategoryId : contact.defaultCategoryId !== saved.categoryId)) {
      store.update("contacts", contact.id, { defaultCategoryId: saved.categoryId, uid: contact.uid || ex?.fields.vendorUid || "", iban: contact.iban || ex?.fields.vendorIban || "" });
    }
  }
  // A corrected category teaches the category the vendor's name as keyword.
  if (!opts.auto && opts.draftCategoryId && saved.categoryId && opts.draftCategoryId !== saved.categoryId && ex?.fields.vendorName && !income) {
    const token = vendorToken(ex.fields.vendorName);
    const cat = store.byId("categories", saved.categoryId);
    const known = store.vault.categories.some((c) => !c.deletedAt && [...c.keywords, ...c.userKeywords].some((k) => k.toLowerCase() === token));
    if (token && cat && !known) store.update("categories", cat.id, { userKeywords: [...cat.userKeywords, token] }, "category.learn");
  }
  return saved;
}

/** "Korrigieren": puts an auto-booked document back into review without losing the transaction. */
export function reopenDocument(doc: SummaDocument): void {
  const store = requireStore();
  store.update("documents", doc.id, { status: "review", autoBooked: false, reviewedAt: undefined }, "document.reopen");
  if (doc.transactionId) store.update("transactions", doc.transactionId, { reviewed: false, autoBooked: false }, "transaction.reopen");
}
