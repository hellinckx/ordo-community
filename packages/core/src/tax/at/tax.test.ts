import { describe, expect, it } from "vitest";
import { computeUva } from "./uva";
import { computeE1a } from "./e1a";
import { computeL1 } from "./l1";
import { incomeTaxCents, marginalRate } from "./tariff";
import { uvaDueDate, uvaPeriodRange, periodForDate, upcomingUvaDeadlines } from "./deadlines";
import { DEFAULT_CATEGORIES } from "../../model/defaults";
import type { Asset, Profile, Transaction } from "../../model/types";
import { ProfileSchema } from "../../model/types";
import { lineFromGross } from "../../model/vat";

const now = "2026-03-01T00:00:00.000Z";

function profile(over: Partial<Profile> = {}): Profile {
  return ProfileSchema.parse({ id: "p1", name: "Test", mode: "business", createdAt: now, updatedAt: now, ...over });
}

let n = 0;
function tx(over: Partial<Transaction> & { grossCents: number; kind: Transaction["kind"]; date: string }): Transaction {
  const rate = over.vatLines ? undefined : 20;
  return {
    id: `t${++n}`,
    profileId: "p1",
    description: "",
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
    vatLines: rate ? [lineFromGross(over.grossCents, rate)] : [],
    ...over,
  };
}

describe("UVA", () => {
  it("maps standard income and expenses to KZ 000/022/060/095", () => {
    const p = profile({ uvaPeriod: "quarterly" });
    const txs = [
      tx({ kind: "income", date: "2026-01-15", grossCents: 120000, categoryId: "cat_b_in_20" }),
      tx({ kind: "income", date: "2026-02-15", grossCents: 11000, vatLines: [lineFromGross(11000, 10)], categoryId: "cat_b_in_10" }),
      tx({ kind: "expense", date: "2026-02-20", grossCents: 60000, categoryId: "cat_b_ex_software" }),
      tx({ kind: "expense", date: "2026-02-21", grossCents: 12000, categoryId: "cat_b_ex_kfz", vatDeductiblePct: 0 }),
      tx({ kind: "expense", date: "2026-04-01", grossCents: 99900, categoryId: "cat_b_ex_software" }), // next quarter
    ];
    const r = computeUva(p, { year: 2026, index: 1, kind: "quarterly" }, txs, DEFAULT_CATEGORIES);
    expect(r.kz["000"]?.baseCents).toBe(100000 + 10000);
    expect(r.kz["022"]).toEqual({ baseCents: 100000, taxCents: 20000 });
    expect(r.kz["029"]).toEqual({ baseCents: 10000, taxCents: 1000 });
    expect(r.kz["060"]?.taxCents).toBe(10000); // PKW: 0 % Vorsteuer
    expect(r.totals.umsatzsteuer).toBe(21000);
    expect(r.totals.vorsteuer).toBe(10000);
    expect(r.totals.zahllast).toBe(11000);
    expect(r.kz["095"]?.taxCents).toBe(11000);
    expect(r.period.dueDate).toBe("2026-05-15");
  });

  it("handles reverse charge and ig. Erwerb", () => {
    const p = profile();
    const txs = [
      tx({ kind: "expense", date: "2026-01-10", grossCents: 10000, vatLines: [{ rate: 20, netCents: 10000, vatCents: 0 }], vatTreatment: "reverse_charge" }),
      tx({ kind: "expense", date: "2026-01-11", grossCents: 50000, vatLines: [{ rate: 20, netCents: 50000, vatCents: 0 }], vatTreatment: "ig_erwerb" }),
      tx({ kind: "income", date: "2026-01-12", grossCents: 80000, vatLines: [{ rate: 0, netCents: 80000, vatCents: 0 }], vatTreatment: "reverse_charge" }),
    ];
    const r = computeUva(p, { year: 2026, index: 1, kind: "monthly" }, txs, DEFAULT_CATEGORIES);
    expect(r.kz["057"]?.taxCents).toBe(2000);
    expect(r.kz["066"]?.taxCents).toBe(2000);
    expect(r.kz["070"]?.baseCents).toBe(50000);
    expect(r.kz["072"]).toEqual({ baseCents: 50000, taxCents: 10000 });
    expect(r.kz["065"]?.taxCents).toBe(10000);
    expect(r.totals.zahllast).toBe(0);
    expect(r.info.zmAuslandsleistungenCents).toBe(80000);
  });

  it("Kleinunternehmer: KZ 016, no input VAT", () => {
    const p = profile({ vatRegime: "kleinunternehmer" });
    const txs = [tx({ kind: "income", date: "2026-01-10", grossCents: 50000 }), tx({ kind: "expense", date: "2026-01-11", grossCents: 12000 })];
    const r = computeUva(p, { year: 2026, index: 1, kind: "quarterly" }, txs, DEFAULT_CATEGORIES);
    expect(r.kz["016"]?.baseCents).toBe(50000);
    expect(r.kz["060"]).toBeUndefined();
    expect(r.totals.zahllast).toBe(0);
  });

  it("uses payment date for Istbesteuerung", () => {
    const p = profile({ accountingMethod: "eur" });
    const txs = [tx({ kind: "income", date: "2026-03-30", paidDate: "2026-04-05", dueDate: "2026-04-13", grossCents: 12000 })];
    const q1 = computeUva(p, { year: 2026, index: 1, kind: "quarterly" }, txs, DEFAULT_CATEGORIES);
    const q2 = computeUva(p, { year: 2026, index: 2, kind: "quarterly" }, txs, DEFAULT_CATEGORIES);
    expect(q1.kz["022"]).toBeUndefined();
    expect(q2.kz["022"]?.taxCents).toBe(2000);
  });
});

describe("deadlines", () => {
  it("computes UVA due dates", () => {
    expect(uvaDueDate({ year: 2026, index: 1, kind: "monthly" })).toBe("2026-03-15");
    expect(uvaDueDate({ year: 2026, index: 12, kind: "monthly" })).toBe("2027-02-15");
    expect(uvaDueDate({ year: 2026, index: 4, kind: "quarterly" })).toBe("2027-02-15");
    expect(uvaPeriodRange({ year: 2026, index: 2, kind: "quarterly" })).toMatchObject({ from: "2026-04-01", to: "2026-06-30", dueDate: "2026-08-15" });
    expect(periodForDate("2026-08-03", "quarterly")).toEqual({ year: 2026, index: 3, kind: "quarterly" });
    const up = upcomingUvaDeadlines(profile({ uvaPeriod: "quarterly" }), "2026-04-20");
    expect(up[0]?.ref.index).toBe(1);
    expect(up[0]?.dueDate).toBe("2026-05-15");
  });
});

describe("tariff", () => {
  it("computes 2026 income tax", () => {
    expect(incomeTaxCents(1000000, 2026)).toBe(0);
    expect(incomeTaxCents(2000000, 2026)).toBe(Math.round((20000 - 13539) * 0.2 * 100));
    expect(marginalRate(5000000, 2026)).toBe(0.4);
    expect(marginalRate(200000000, 2026)).toBe(0.55);
  });
});

describe("E1a", () => {
  it("builds EÜR Kennzahlen with AfA, Bewirtung correction and Grundfreibetrag", () => {
    const p = profile({ uvaPeriod: "quarterly" });
    const txs = [
      tx({ kind: "income", date: "2026-01-15", grossCents: 1200000, categoryId: "cat_b_in_20" }), // 10.000 net
      tx({ kind: "expense", date: "2026-02-01", grossCents: 120000, categoryId: "cat_b_ex_software" }), // 1.000 net -> 9230
      tx({ kind: "expense", date: "2026-02-02", grossCents: 11000, vatLines: [lineFromGross(11000, 10)], categoryId: "cat_b_ex_bewirtung" }), // 100 net -> 9200, 50 % Korrektur 9280
      tx({ kind: "expense", date: "2026-02-03", grossCents: 12000, categoryId: "cat_b_ex_kfz", vatDeductiblePct: 0 }), // 120 gross -> 9170 (no input VAT)
      tx({ kind: "expense", date: "2026-02-04", grossCents: 240000, categoryId: "cat_b_ex_anlage" }), // asset purchase: not expensed
    ];
    const assets: Asset[] = [
      { id: "a1", profileId: "p1", name: "Laptop", acquisitionDate: "2026-02-04", costCents: 200000, usefulLifeYears: 4, method: "linear", degressiveRatePct: 30, privateUsePct: 0, ekrAccount: "0620", notes: "", createdAt: now, updatedAt: now },
    ];
    const r = computeE1a(p, 2026, txs, DEFAULT_CATEGORIES, assets);
    expect(r.kz["9040"]).toBe(1000000);
    expect(r.kz["9050"]).toBe(0);
    expect(r.kz["9230"]).toBe(100000);
    expect(r.kz["9200"]).toBe(10000);
    expect(r.kz["9280"]).toBe(5000);
    expect(r.kz["9170"]).toBe(12000);
    expect(r.kz["9130"]).toBe(50000); // 2000 / 4 years, acquired in first half → full year
    expect(r.einnahmenCents).toBe(1000000);
    const expectedProfit = 1000000 - 100000 - 10000 - 12000 - 50000 + 5000;
    expect(r.gewinnVorFreibetragCents).toBe(expectedProfit);
    expect(r.grundfreibetragCents).toBe(Math.round(expectedProfit * 0.15));
    expect(r.gewinnCents).toBe(expectedProfit - Math.round(expectedProfit * 0.15));
  });

  it("applies Basispauschalierung", () => {
    const p = profile({ pauschalierung: "basis", pauschalierungBranch: "regular" });
    const txs = [
      tx({ kind: "income", date: "2026-01-15", grossCents: 1200000, categoryId: "cat_b_in_20" }),
      tx({ kind: "expense", date: "2026-02-01", grossCents: 120000, categoryId: "cat_b_ex_software" }),
      tx({ kind: "expense", date: "2026-02-01", grossCents: 50000, vatLines: [{ rate: 0, netCents: 50000, vatCents: 0 }], categoryId: "cat_b_ex_svs" }),
    ];
    const r = computeE1a(p, 2026, txs, DEFAULT_CATEGORIES, []);
    expect(r.kz["9259"]).toBe(Math.round(1000000 * 0.15));
    expect(r.kz["9230"]).toBeUndefined();
    expect(r.kz["9225"]).toBe(50000);
  });
});

describe("L1", () => {
  it("does not treat gifts and pocket money as salary in the fallback estimate", () => {
    const p = profile({ mode: "employee" });
    const salary = tx({ kind: "income", date: "2026-03-05", grossCents: 250000, categoryId: "cat_e_in_gehalt" });
    const gift = tx({ kind: "income", date: "2026-03-06", grossCents: 7000, categoryId: "cat_e_in_geschenke" });
    const without = computeL1(p, 2026, [salary], DEFAULT_CATEGORIES, undefined);
    const withGift = computeL1(p, 2026, [salary, gift], DEFAULT_CATEGORIES, undefined);
    expect(withGift.incomeCents).toBe(257000);
    expect(withGift.taxableIncomeEstimateCents).toBe(without.taxableIncomeEstimateCents);
    expect(withGift.warnings.join(" ")).toContain("Andere Budget-Einnahmen");
  });
  it("maps employee expenses to Kennzahlen with caps", () => {
    const p = profile({ mode: "employee" });
    const txs = [
      tx({ kind: "expense", date: "2026-03-01", grossCents: 45000, categoryId: "cat_e_wk_mobiliar" }), // cap 300
      tx({ kind: "expense", date: "2026-03-02", grossCents: 20000, categoryId: "cat_e_wk_fortbildung" }),
      tx({ kind: "expense", date: "2026-03-03", grossCents: 80000, categoryId: "cat_e_agb_krankheit" }),
      tx({ kind: "expense", date: "2026-03-04", grossCents: 5000, categoryId: "cat_e_p_lebensmittel" }),
      tx({ kind: "income", date: "2026-03-05", grossCents: 250000, categoryId: "cat_e_in_gehalt" }),
    ];
    const r = computeL1(p, 2026, txs, DEFAULT_CATEGORIES, { monthlyGrossCents: 350000, monthlyNetCents: 0, employerName: "", pendlerpauschaleCents: 69600, pendlereuroCents: 4000, homeofficeDays: 0 });
    expect(r.kz["158"]).toBe(30000);
    expect(r.kz["722"]).toBe(20000);
    expect(r.kz["730"]).toBe(80000);
    expect(r.kz["718"]).toBe(69600);
    expect(r.kz["916"]).toBe(4000);
    expect(r.privateExpensesCents).toBe(5000);
    expect(r.werbungskostenCents).toBe(30000 + 20000 + 69600);
    expect(r.selbstbehaltPct).toBe(10);
    expect(r.estimatedRefundCents).toBeGreaterThan(0);
  });
});
