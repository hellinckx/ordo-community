import { describe, expect, it } from "vitest";
import { AssetSchema, ExtractionSchema, ProfileSchema, TransactionSchema, type Asset } from "../model/types";
import { DEFAULT_CATEGORIES, SPECIAL_CATEGORIES } from "../model/defaults";
import { assetFromTransaction, assetPurchaseCost, afaSchedule, bookValueAt } from "./assets";
import { deriveJournal, validateEntry } from "./posting";
import { bilanz, guv, saldenliste } from "./ledger";
import { computeE1a } from "../tax/at/e1a";
import { transactionFromExtraction } from "../extraction/pipeline";
import { assetsCsv, parseAssetsCsv, validateAsset } from "../exports/assets";

const now = "2026-10-27T00:00:00.000Z";
const profile = ProfileSchema.parse({ id: "p", name: "Test", mode: "business", accountingMethod: "doppik", createdAt: now, updatedAt: now });
const tx = (patch = {}) => TransactionSchema.parse({ id: "t", profileId: "p", kind: "expense", date: "2026-02-01", description: "Laptop", grossCents: 240000, vatLines: [{ rate: 20, netCents: 200000, vatCents: 40000 }], categoryId: SPECIAL_CATEGORIES.assetPurchase, createdAt: now, updatedAt: now, ...patch });
const asset = (patch: Partial<Asset> = {}) => AssetSchema.parse({ id: "a", profileId: "p", name: "Maschine", acquisitionDate: "2024-01-01", costCents: 400000, usefulLifeYears: 4, method: "linear", ekrAccount: "0400", createdAt: now, updatedAt: now, ...patch });
const journal = (a: Asset[], transactions = [tx()]) => deriveJournal(profile, transactions, a, DEFAULT_CATEGORIES, [], [2026]);

describe("asset register integration", () => {
  it("capitalises net, gross for small businesses and non-deductible VAT including reverse charge", () => {
    expect(assetPurchaseCost(tx(), profile)).toBe(200000);
    expect(assetPurchaseCost(tx(), { ...profile, vatRegime: "kleinunternehmer" })).toBe(240000);
    expect(assetPurchaseCost(tx({ vatDeductiblePct: 50 }), profile)).toBe(220000);
    expect(assetPurchaseCost(tx({ vatTreatment: "reverse_charge", grossCents: 200000, vatLines: [{ rate: 20, netCents: 200000, vatCents: 0 }], vatDeductiblePct: 50 }), profile)).toBe(220000);
  });
  it("starts depreciation on commissioning and never applies the half-year rule twice", () => {
    const a = asset({ acquisitionDate: "2025-12-01", inServiceDate: "2026-09-01" });
    expect(afaSchedule(a)[0]).toMatchObject({ year: 2026, afaCents: 50000 });
    expect(bookValueAt(a, 2025)).toBe(400000);
    expect(afaSchedule(asset({ acquisitionDate: "2026-02-01", disposedAt: "2026-03-01" }))[0]?.afaCents).toBe(50000);
  });
  it("matches the official degressive half-year example after switching to linear", () => {
    const rows = afaSchedule(asset({ acquisitionDate: "2021-10-01", costCents: 300000, usefulLifeYears: 4, method: "degressive" }));
    expect(rows.map((r) => r.afaCents)).toEqual([45000, 76500, 71400, 71400, 35700]);
  });
  it("keeps non-depreciable assets at cost until disposal", () => {
    const a = asset({ method: "none", disposedAt: "2026-09-01" });
    expect(afaSchedule(a)).toEqual([]);
    expect(bookValueAt(a, 2025)).toBe(400000);
    expect(bookValueAt(a, 2026)).toBe(0);
  });
  it("counts a linked GWG exactly once in the journal and tax report", () => {
    const purchase = tx({ grossCents: 96000, vatLines: [{ rate: 20, netCents: 80000, vatCents: 16000 }], categoryId: SPECIAL_CATEGORIES.gwg });
    const a = assetFromTransaction(purchase, profile);
    const entries = journal([a], [purchase]);
    expect(guv(entries, "2026-01-01", "2026-12-31").expenseTotalCents).toBe(80000);
    expect(computeE1a(profile, 2026, [purchase], DEFAULT_CATEGORIES, [a]).kz["9130"]).toBe(80000);
    expect(entries.every((e) => !validateEntry(e.lines).length)).toBe(true);
  });
  it("books private depreciation shares as withdrawals while preserving full asset depreciation", () => {
    const purchase = tx({ assetSettings: { method: "linear", usefulLifeYears: 4, degressiveRatePct: 30, privateUsePct: 25, ekrAccount: "0620" } });
    const a = assetFromTransaction(purchase, profile);
    const entries = journal([a], [purchase]);
    expect(guv(entries, "2026-01-01", "2026-12-31").expenseTotalCents).toBe(37500);
    expect(saldenliste(entries).find((b) => b.account === "0690")?.balanceCents).toBe(-50000);
    expect(entries.every((e) => !validateEntry(e.lines).length)).toBe(true);
  });
  it("takes a linked GWG in the payment year for cash accounting", () => {
    const purchase = tx({ grossCents: 96000, vatLines: [{ rate: 20, netCents: 80000, vatCents: 16000 }], categoryId: SPECIAL_CATEGORIES.gwg, date: "2025-12-01", paidDate: "2026-01-10" });
    const a = assetFromTransaction(purchase, profile);
    const cash = { ...profile, accountingMethod: "eur" as const };
    expect(computeE1a(cash, 2025, [purchase], DEFAULT_CATEGORIES, [a]).kz["9130"] ?? 0).toBe(0);
    expect(computeE1a(cash, 2026, [purchase], DEFAULT_CATEGORIES, [a]).kz["9130"]).toBe(80000);
  });
  it("uses the asset account and only annual depreciation as investment expense", () => {
    const purchase = tx({ assetSettings: { inServiceDate: "2026-09-01", usefulLifeYears: 4, method: "linear", degressiveRatePct: 30, privateUsePct: 0, ekrAccount: "0400" } });
    const a = assetFromTransaction(purchase, profile);
    const entries = journal([a], [purchase]);
    expect(saldenliste(entries).find((b) => b.account === "0400")?.balanceCents).toBe(200000);
    expect(guv(entries, "2026-01-01", "2026-12-31").expenseTotalCents).toBe(25000);
    const balance = bilanz(entries, "2026-12-31");
    expect(balance.aktivaTotalCents).toBe(balance.passivaTotalCents);
  });
  it("removes original cost and accumulated depreciation on disposal, even after full depreciation", () => {
    for (const usefulLifeYears of [2, 4]) {
      const a = asset({ disposedAt: "2026-08-01", usefulLifeYears });
      const entries = journal([a], []);
      const disposal = entries.find((e) => e.description.startsWith("Anlagenabgang"))!;
      expect(disposal.lines.find((l) => l.account === "0400")?.creditCents).toBe(400000);
      expect(validateEntry(disposal.lines)).toEqual([]);
    }
  });
  it("creates balanced opening balances for historical imports without invented payments", () => {
    const a = asset({ openingBalanceDate: "2026-01-01" });
    const entries = journal([a], []);
    expect(entries.find((e) => e.id === "asset-opening:a")?.lines).toContainEqual(expect.objectContaining({ account: "9000", creditCents: 200000 }));
    expect(saldenliste(entries).some((b) => b.account === "2800")).toBe(false);
    const balance = bilanz(entries, "2026-12-31");
    expect(balance.aktivaTotalCents).toBe(balance.passivaTotalCents);
    expect(balance.aktivaTotalCents).toBe(100000);
  });
  it("carries fully depreciated historical assets at original cost and accumulated depreciation until disposal", () => {
    const a = asset({ usefulLifeYears: 2, openingBalanceDate: "2026-01-01", disposedAt: "2026-08-01" });
    const entries = journal([a], []);
    const opening = entries.find((e) => e.id === "asset-opening:a")!;
    expect(opening.lines).toHaveLength(2);
    expect(validateEntry(opening.lines)).toEqual([]);
    const end = saldenliste(entries);
    expect(end.find((b) => b.account === "0400")?.balanceCents).toBe(0);
    expect(end.find((b) => b.account === "0690")?.balanceCents).toBe(0);
  });
  it("books linked sales once with VAT and removes the asset at the disposal date", () => {
    const purchase = tx({ date: "2024-01-01" });
    const sale = tx({ id: "sale", kind: "income", date: "2026-08-01", categoryId: "cat_b_in_anlage", grossCents: 120000, vatLines: [{ rate: 20, netCents: 100000, vatCents: 20000 }] });
    const a = { ...assetFromTransaction(purchase, profile), disposedAt: sale.date, disposalTransactionId: sale.id, disposalProceedsCents: 100000 };
    const entries = deriveJournal(profile, [purchase, sale], [a], DEFAULT_CATEGORIES, []);
    const balances = saldenliste(entries, undefined, sale.date);
    expect(balances.find((b) => b.account === "0620")?.balanceCents).toBe(0);
    expect(balances.find((b) => b.account === "0690")?.balanceCents).toBe(0);
    expect(computeE1a(profile, 2026, [purchase, sale], DEFAULT_CATEGORIES, [a]).kz["9060"]).toBe(100000);
    expect(entries.every((e) => !validateEntry(e.lines).length)).toBe(true);
  });
  it("does not grant investment-based profit allowances without reviewed eligibility", () => {
    const income = tx({ kind: "income", categoryId: "cat_b_in_20", grossCents: 12000000, vatLines: [{ rate: 20, netCents: 10000000, vatCents: 2000000 }] });
    const a = asset({ acquisitionDate: "2026-02-01" });
    expect(computeE1a(profile, 2026, [income], DEFAULT_CATEGORIES, [a]).investFreibetragCoveredCents).toBe(0);
    expect(computeE1a(profile, 2026, [income], DEFAULT_CATEGORIES, [{ ...a, gfbEligible: true }]).investFreibetragCoveredCents).toBeGreaterThan(0);
    expect(validateAsset({ ...a, gfbEligible: true, method: "none" })).toContain("Gewinnfreibetrag");
  });
  it("includes depreciation in years without any purchase or other transaction", () => {
    const entries = deriveJournal(profile, [], [asset()], DEFAULT_CATEGORIES, []);
    expect(entries.some((e) => e.description === "AfA 2025: Maschine")).toBe(true);
  });
  it("keeps reviewed parameters and subsequent capitalised costs when correcting a purchase", () => {
    const initial = assetFromTransaction(tx(), profile);
    const updated = assetFromTransaction(tx({ grossCents: 300000, vatLines: [{ rate: 20, netCents: 250000, vatCents: 50000 }] }), profile, { ...initial, costCents: initial.costCents + 10000, usefulLifeYears: 8 });
    expect(updated.costCents).toBe(260000);
    expect(updated.usefulLifeYears).toBe(8);
    expect(updated.id).toBe(initial.id);
  });
  it("recognises investment invoices despite a supplier's ordinary default category", () => {
    const extraction = ExtractionSchema.parse({ provider: "rules", extractedAt: now, fields: { direction: "incoming", description: "Laptop", grossCents: 240000, vatLines: [{ rate: 20, netCents: 200000, vatCents: 40000 }], invoiceDate: "2026-02-01" }, confidence: {}, overall: 0.9 });
    const draft = transactionFromExtraction(profile, extraction, { categoryId: "cat_b_ex_buero" }, DEFAULT_CATEGORIES, "doc");
    expect(draft.categoryId).toBe(SPECIAL_CATEGORIES.assetPurchase);
    const repair = transactionFromExtraction(profile, { ...extraction, fields: { ...extraction.fields, description: "Laptop Reparatur" } }, { categoryId: "cat_b_ex_buero" }, DEFAULT_CATEGORIES, "doc");
    expect(repair.categoryId).toBe("cat_b_ex_buero");
  });
  it("round-trips register data including umlauts, supplier addresses and quoted fields", () => {
    const a = asset({ supplierName: 'Müller; "Technik"', supplierAddress: "Straße 1\n1010 Wien", inServiceDate: "2024-02-01", inventoryNumber: "INV-001", notes: "Prüfen", openingBalanceDate: "2026-01-01" });
    const parsed = parseAssetsCsv(new TextDecoder().decode(assetsCsv([a], 2026)), "p");
    expect(parsed.errors).toEqual([]);
    expect(parsed.assets[0]).toMatchObject({ id: a.id, costCents: a.costCents, supplierName: a.supplierName, supplierAddress: a.supplierAddress, inServiceDate: a.inServiceDate, openingBalanceDate: a.openingBalanceDate });
    expect(validateAsset(asset({ inServiceDate: "2023-01-01" }))).toContain("Inbetriebnahme");
    expect(validateAsset(asset({ acquisitionDate: "2026-02-30" }))).toContain("Datumswerte");
  });
});
