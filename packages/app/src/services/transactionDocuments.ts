import { ids, mimeFor, nowIso, sha256Hex, type SummaDocument, type Transaction, type VaultStore } from "@ordo/core";
import type { PickedFile } from "@/platform/types";

/** Attach receipts to a manual booking without sending them through automatic extraction/booking. */
export async function saveWithTransactionDocuments(store: VaultStore, transaction: Transaction, files: PickedFile[], save: (next: Transaction) => Transaction): Promise<Transaction> {
  const documents: SummaDocument[] = [];
  const attachments: string[] = [];
  const selected = new Set(transaction.documentIds);
  const assertAvailable = (doc: SummaDocument | undefined): SummaDocument => {
    if (!doc || doc.deletedAt || doc.profileId !== transaction.profileId) throw new Error("Eine ausgewählte Rechnung ist nicht mehr verfügbar.");
    if (doc.status === "processing") throw new Error(`„${doc.originalName}“ wird gerade gelesen. Bitte kurz warten.`);
    const alreadyLinked = doc.transactionId === transaction.id || store.byId("transactions", transaction.id)?.documentIds.includes(doc.id);
    if ((doc.invoiceId && !alreadyLinked) || (doc.transactionId && doc.transactionId !== transaction.id) || store.vault.transactions.some((t) => !t.deletedAt && t.id !== transaction.id && t.documentIds.includes(doc.id))) {
      throw new Error(`„${doc.originalName}“ ist bereits mit einer anderen Buchung oder Rechnung verknüpft.`);
    }
    return doc;
  };
  try {
    for (const id of selected) assertAvailable(store.byId("documents", id));
    for (const file of files) {
      const sha256 = await sha256Hex(file.bytes);
      const existing = store.vault.documents.find((d) => !d.deletedAt && d.profileId === transaction.profileId && d.sha256 === sha256)
        ?? documents.find((d) => d.sha256 === sha256);
      if (existing) {
        selected.add(assertAvailable(existing).id);
        continue;
      }
      const mime = file.mime || mimeFor(file.name);
      const attachment = await store.putAttachment(transaction.profileId, file.bytes, { name: file.name, mime });
      attachments.push(attachment.id);
      const now = nowIso();
      const doc: SummaDocument = {
        id: ids.document(), profileId: transaction.profileId, attachmentId: attachment.id,
        originalName: file.name, originalPath: file.path, mime, sha256, source: "upload",
        importedAt: now, status: "approved", transactionId: transaction.id, reviewedAt: now,
        autoBooked: false, createdAt: now, updatedAt: now,
      };
      documents.push(doc);
      selected.add(doc.id);
    }
    // Recheck after async file storage: another import may have linked a selected document meanwhile.
    for (const id of selected) if (!documents.some((d) => d.id === id)) assertAvailable(store.byId("documents", id));
    const saved = save({ ...transaction, documentIds: [...selected] });
    const now = nowIso();
    store.mutate((v) => {
      v.documents = [...v.documents.map((doc) => {
        if (selected.has(doc.id)) return { ...doc, transactionId: saved.id, status: "approved" as const, reviewedAt: now, autoBooked: false, error: undefined, updatedAt: now };
        if (doc.transactionId === saved.id && !doc.deletedAt) return { ...doc, transactionId: undefined, status: "review" as const, reviewedAt: undefined, autoBooked: false, updatedAt: now };
        return doc;
      }), ...documents];
    }, { audit: { action: "transaction.documents", entity: "transactions", entityId: saved.id } });
    return saved;
  } catch (error) {
    await Promise.allSettled(attachments.map((id) => store.deleteAttachment(id)));
    throw error;
  }
}
