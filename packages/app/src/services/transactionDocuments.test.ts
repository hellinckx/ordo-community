import { beforeEach, describe, expect, it } from "vitest";
import { DocumentSchema, MemoryStorage, TransactionSchema, VaultStore, nowIso, type Transaction } from "@ordo/core";
import { saveWithTransactionDocuments } from "./transactionDocuments";

let store: VaultStore;
const file = (name = "Rechnung.pdf", text = "receipt") => ({ name, mime: "application/pdf", bytes: new TextEncoder().encode(text) });
const transaction = (id = "tx_manual") => TransactionSchema.parse({ id, profileId: store.activeProfile.id, kind: "expense", date: "2026-10-27", grossCents: 1200, createdAt: nowIso(), updatedAt: nowIso() });
const save = (next: Transaction) => {
  if (store.byId("transactions", next.id)) store.update("transactions", next.id, next);
  else store.insert("transactions", next);
  return next;
};
const document = (id = "doc_existing", patch = {}) => {
  const doc = DocumentSchema.parse({ id, profileId: store.activeProfile.id, attachmentId: "att_existing", originalName: "Vorhandene Rechnung.pdf", mime: "application/pdf", sha256: "existing", source: "upload", status: "review", importedAt: nowIso(), createdAt: nowIso(), updatedAt: nowIso(), ...patch });
  store.insert("documents", doc);
  return doc;
};

beforeEach(async () => {
  ({ store } = await VaultStore.create(new MemoryStorage(), { password: "test-passwort", profileName: "Test", mode: "business", withRecoveryKey: false }));
});

describe("manual transaction documents", () => {
  it("stores encrypted files and both link directions without a second booking, deduplicating identical files", async () => {
    const saved = await saveWithTransactionDocuments(store, transaction(), [file(), file("Kopie.pdf")], save);
    expect(store.list("transactions")).toHaveLength(1);
    expect(store.list("documents")).toHaveLength(1);
    expect(store.list("attachments")).toHaveLength(1);
    const doc = store.list("documents")[0]!;
    expect(saved.documentIds).toEqual([doc.id]);
    expect(doc).toMatchObject({ transactionId: saved.id, status: "approved", autoBooked: false });
    expect(await store.getAttachmentBytes(doc.attachmentId)).toEqual(file().bytes);
    await store.flush();
  });

  it("links an existing document without uploading another copy", async () => {
    const doc = document();
    const saved = await saveWithTransactionDocuments(store, { ...transaction(), documentIds: [doc.id] }, [], save);
    expect(store.byId("documents", doc.id)).toMatchObject({ status: "approved", transactionId: saved.id });
    expect(store.list("attachments")).toHaveLength(0);
  });

  it("preserves invoice documents already linked to the booking being edited", async () => {
    const tx = transaction();
    const doc = document("doc_invoice", { invoiceId: "invoice_own", transactionId: tx.id, status: "approved" });
    save({ ...tx, documentIds: [doc.id] });
    const saved = await saveWithTransactionDocuments(store, { ...tx, description: "Korrigiert", documentIds: [doc.id] }, [], save);
    expect(saved.documentIds).toEqual([doc.id]);
    expect(store.byId("documents", doc.id)?.invoiceId).toBe("invoice_own");
  });

  it("removes both link directions while preserving the original document", async () => {
    const tx = transaction();
    const doc = document("doc_existing", { transactionId: tx.id, status: "approved" });
    save({ ...tx, documentIds: [doc.id] });
    await saveWithTransactionDocuments(store, tx, [], save);
    expect(store.byId("transactions", tx.id)?.documentIds).toEqual([]);
    expect(store.byId("documents", doc.id)).toMatchObject({ status: "review", attachmentId: "att_existing" });
    expect(store.byId("documents", doc.id)?.transactionId).toBeUndefined();
  });

  it("rejects a duplicate file belonging to another booking and cleans up earlier staged uploads", async () => {
    const other = await saveWithTransactionDocuments(store, transaction("tx_other"), [file()], save);
    await expect(saveWithTransactionDocuments(store, transaction(), [file("Neu.pdf", "new receipt"), file()], save)).rejects.toThrow("bereits");
    expect(store.list("documents")).toHaveLength(1);
    expect(store.list("attachments")).toHaveLength(1);
    expect(store.list("transactions")).toHaveLength(1);
    expect(store.byId("documents", other.documentIds[0]!)?.transactionId).toBe(other.id);
  });

  it("keeps staged files out of the vault if saving the booking fails", async () => {
    await expect(saveWithTransactionDocuments(store, transaction(), [file()], () => { throw new Error("Speichern fehlgeschlagen"); })).rejects.toThrow("Speichern fehlgeschlagen");
    expect(store.list("attachments")).toHaveLength(0);
    expect(store.list("documents")).toHaveLength(0);
    expect(store.list("transactions")).toHaveLength(0);
  });

  it.each([{ profileId: "another_profile" }, { status: "processing" }, { invoiceId: "invoice_other" }])("rejects unavailable documents: %s", async (patch) => {
    const doc = document("doc_invalid", patch);
    await expect(saveWithTransactionDocuments(store, { ...transaction(), documentIds: [doc.id] }, [], save)).rejects.toThrow();
    expect(store.list("transactions")).toHaveLength(0);
  });
});
