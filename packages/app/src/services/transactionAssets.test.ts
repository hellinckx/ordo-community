import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentSchema, ExtractionSchema, MemoryStorage, TransactionSchema, VaultStore, nowIso, SPECIAL_CATEGORIES, deriveJournal, guv } from "@ordo/core";
import { useSession } from "@/state/session";
import { saveTransaction } from "@/components/TransactionForm";
import { bookDocument } from "./booking";

let store: VaultStore;
beforeEach(async () => {
  ({ store } = await VaultStore.create(new MemoryStorage(), { password: "anlage-test", profileName: "Test", mode: "business", withRecoveryKey: false }));
  useSession.setState({ store, vault: store.vault });
});
afterEach(() => useSession.setState({ store: null, vault: null }));
const tx = (patch = {}) => TransactionSchema.parse({ id: "t_invoice", profileId: store.activeProfile.id, kind: "expense", description: "Laptop", date: "2026-02-01", grossCents: 240000,
  vatLines: [{ rate: 20, netCents: 200000, vatCents: 40000 }], categoryId: SPECIAL_CATEGORIES.assetPurchase, createdAt: nowIso(), updatedAt: nowIso(), ...patch });

describe("investment invoice booking", () => {
  it("creates an asset from a reviewed invoice with supplier data and keeps one asset on correction", () => {
    const extraction = ExtractionSchema.parse({ provider: "rules", extractedAt: nowIso(), fields: { vendorName: "Müller Technik", vendorAddress: "Straße 1, 1010 Wien" }, confidence: { vendorName: 0.95 }, overall: 0.95 });
    const doc = DocumentSchema.parse({ id: "doc_laptop", profileId: store.activeProfile.id, attachmentId: "att", originalName: "Laptop.pdf", mime: "application/pdf", sha256: "sha", source: "upload", importedAt: nowIso(), createdAt: nowIso(), updatedAt: nowIso(), extraction });
    store.insert("documents", doc);
    const saved = bookDocument(doc, tx());
    const a = store.list("assets")[0]!;
    expect(a).toMatchObject({ transactionId: saved.id, supplierName: "Müller Technik", costCents: 200000 });
    expect(a.supplierAddress).toContain("Straße 1");
    expect(saved.assetId).toBe(a.id);
    expect(store.byId("documents", doc.id)?.transactionId).toBe(saved.id);
    saveTransaction({ ...saved, grossCents: 300000, vatLines: [{ rate: 20, netCents: 250000, vatCents: 50000 }] }, { isNew: false });
    expect(store.list("assets")).toHaveLength(1);
    expect(store.byId("assets", a.id)?.costCents).toBe(250000);
  });
  it("rejects an oversized GWG before creating any asset or booking", () => {
    expect(() => saveTransaction(tx({ categoryId: SPECIAL_CATEGORIES.gwg }), { isNew: true })).toThrow("GWG");
    expect(store.list("assets")).toHaveLength(0);
    expect(store.list("transactions")).toHaveLength(0);
  });
  it("capitalises small-business gross cost and respects reviewed commissioning and duration", () => {
    store.update("profiles", store.activeProfile.id, { vatRegime: "kleinunternehmer" });
    const saved = saveTransaction(tx({ assetSettings: { inServiceDate: "2026-09-01", method: "linear", usefulLifeYears: 4, privateUsePct: 0, degressiveRatePct: 30, ekrAccount: "0620" } }), { isNew: true });
    const a = store.byId("assets", saved.assetId!)!;
    expect(a.costCents).toBe(240000);
    const entries = deriveJournal(store.activeProfile, store.list("transactions"), store.list("assets"), store.vault.categories, [], [2026]);
    expect(guv(entries, "2026-01-01", "2026-12-31").expenseTotalCents).toBe(30000);
  });
});
