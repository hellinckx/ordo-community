import { describe, expect, it } from "vitest";
import { afaSchedule } from "./assets";
import { deriveJournal, postingsForTransaction, validateEntry } from "./posting";
import { bilanz, guv, kontoblatt, saldenliste } from "./ledger";
import { DEFAULT_CATEGORIES } from "../model/defaults";
import { ProfileSchema, type Asset, type Profile, type Transaction } from "../model/types";
import { lineFromGross } from "../model/vat";

const now = "2026-01-01T00:00:00.000Z";
const p: Profile = ProfileSchema.parse({ id: "p1", name: "Firma", mode: "business", accountingMethod: "doppik", createdAt: now, updatedAt: now });
const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));

function tx(over: Partial<Transaction> & { grossCents: number; kind: Transaction["kind"]; date: string }): Transaction {
  return {
    id: over.id ?? "t1",
    profileId: "p1",
    description: "Test",
    currency: "EUR",
    vatTreatment: "standard",
    vatDeductiblePct: 100,
    paymentMethod: "bank",
    invoiceNumber: "",
    reference: "",
    documentIds: [],
    tags: [],
    notes: "",
    origin: "manual",
    reviewed: true,
    createdAt: now,
    updatedAt: now,
    vatLines: [lineFromGross(over.grossCents, 20)],
    ...over,
  };
}

describe("AfA", () => {
  it("linear with half-year rule", () => {
    const a: Asset = { id: "a", profileId: "p1", name: "Maschine", acquisitionDate: "2026-09-10", costCents: 400000, usefulLifeYears: 4, method: "linear", degressiveRatePct: 30, privateUsePct: 0, ekrAccount: "0400", notes: "", createdAt: now, updatedAt: now };
    const s = afaSchedule(a);
    expect(s[0]).toMatchObject({ year: 2026, afaCents: 50000, mode: "halb" });
    expect(s[1]).toMatchObject({ year: 2027, afaCents: 100000 });
    expect(s[4]).toMatchObject({ year: 2030, afaCents: 50000, bookValueEndCents: 0 });
    expect(s.reduce((x, r) => x + r.afaCents, 0)).toBe(400000);
  });
  it("gwg is expensed immediately", () => {
    const a: Asset = { id: "a", profileId: "p1", name: "Monitor", acquisitionDate: "2026-03-10", costCents: 80000, usefulLifeYears: 3, method: "gwg", degressiveRatePct: 30, privateUsePct: 0, ekrAccount: "0620", notes: "", createdAt: now, updatedAt: now };
    expect(afaSchedule(a)).toHaveLength(1);
    expect(afaSchedule(a)[0]!.afaCents).toBe(80000);
  });
  it("disposal expenses remaining book value", () => {
    const a: Asset = { id: "a", profileId: "p1", name: "Auto", acquisitionDate: "2024-01-10", costCents: 300000, usefulLifeYears: 5, method: "linear", degressiveRatePct: 30, privateUsePct: 0, ekrAccount: "0640", notes: "", createdAt: now, updatedAt: now, disposedAt: "2026-08-01", disposalProceedsCents: 100000 };
    const s = afaSchedule(a);
    const last = s[s.length - 1]!;
    expect(last.year).toBe(2026);
    expect(last.bookValueAtDisposalCents).toBe(300000 - 60000 * 3);
  });
});

describe("posting", () => {
  it("books a standard expense with input VAT", () => {
    const [e] = postingsForTransaction(tx({ kind: "expense", date: "2026-02-01", grossCents: 12000, categoryId: "cat_b_ex_software" }), p, cats);
    expect(e!.lines).toEqual([
      expect.objectContaining({ account: "7790", debitCents: 10000 }),
      expect.objectContaining({ account: "2500", debitCents: 2000 }),
      expect.objectContaining({ account: "2800", creditCents: 12000 }),
    ]);
    expect(validateEntry(e!.lines)).toEqual([]);
  });
  it("books income with output VAT and later payment", () => {
    const entries = postingsForTransaction(tx({ kind: "income", date: "2026-02-01", dueDate: "2026-02-15", paidDate: "2026-02-10", grossCents: 12000, categoryId: "cat_b_in_20" }), p, cats);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.lines[0]).toMatchObject({ account: "2000", debitCents: 12000 });
    expect(entries[0]!.lines).toContainEqual(expect.objectContaining({ account: "3500", creditCents: 2000 }));
    expect(entries[1]!.lines).toEqual([expect.objectContaining({ account: "2800", debitCents: 12000 }), expect.objectContaining({ account: "2000", creditCents: 12000 })]);
  });
  it("books reverse charge neutral", () => {
    const [e] = postingsForTransaction(tx({ kind: "expense", date: "2026-02-01", grossCents: 10000, vatLines: [{ rate: 20, netCents: 10000, vatCents: 0 }], vatTreatment: "reverse_charge", categoryId: "cat_b_ex_software" }), p, cats);
    expect(validateEntry(e!.lines)).toEqual([]);
    expect(e!.lines).toContainEqual(expect.objectContaining({ account: "2530", debitCents: 2000 }));
    expect(e!.lines).toContainEqual(expect.objectContaining({ account: "3520", creditCents: 2000 }));
  });
  it("derives journal, Saldenliste, GuV and Bilanz consistently", () => {
    const txs = [
      tx({ id: "t1", kind: "income", date: "2026-01-10", grossCents: 120000, categoryId: "cat_b_in_20" }),
      tx({ id: "t2", kind: "expense", date: "2026-01-12", grossCents: 24000, categoryId: "cat_b_ex_miete" }),
      tx({ id: "t3", kind: "expense", date: "2026-01-13", grossCents: 5000, vatLines: [{ rate: 0, netCents: 5000, vatCents: 0 }], categoryId: "cat_b_ex_privat" }),
    ];
    const assets: Asset[] = [{ id: "a", profileId: "p1", name: "PC", acquisitionDate: "2026-01-05", costCents: 120000, usefulLifeYears: 3, method: "linear", degressiveRatePct: 30, privateUsePct: 0, ekrAccount: "0620", notes: "", createdAt: now, updatedAt: now }];
    const journal = deriveJournal(p, txs, assets, DEFAULT_CATEGORIES, [], [2026]);
    expect(journal.map((j) => j.number)).toEqual([1, 2, 3, 4]);
    for (const j of journal) expect(validateEntry(j.lines)).toEqual([]);
    const sl = saldenliste(journal);
    const bank = sl.find((b) => b.account === "2800")!;
    expect(bank.balanceCents).toBe(120000 - 24000 - 5000);
    const g = guv(journal, "2026-01-01", "2026-12-31");
    expect(g.revenueTotalCents).toBe(100000);
    expect(g.expenseTotalCents).toBe(20000 + 40000);
    const b = bilanz(journal, "2026-12-31");
    expect(b.aktivaTotalCents).toBe(b.passivaTotalCents);
    const kb = kontoblatt(journal, "2800");
    expect(kb[kb.length - 1]!.balanceCents).toBe(bank.balanceCents);
  });
});
