import { describe, expect, it } from "vitest";
import { VaultSchema } from "../model/types";
import { DEFAULT_CATEGORIES } from "../model/defaults";
import { DEMO_CATEGORY_IDS, seedDemoVault } from "./seed";
import { computeUva } from "../tax/at/uva";
import { computeE1a } from "../tax/at/e1a";
import { computeL1 } from "../tax/at/l1";
import { deriveJournal, validateEntry } from "../accounting/posting";

describe("demo seed", () => {
  it("produces a consistent, schema-valid vault", () => {
    const vault = VaultSchema.parse({ createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z", categories: DEFAULT_CATEGORIES });
    const r = seedDemoVault(vault, { today: "2026-10-20" });
    expect(() => VaultSchema.parse(vault)).not.toThrow();
    expect(vault.profiles).toHaveLength(2);
    expect(vault.transactions.length).toBeGreaterThan(200);
    expect(vault.invoices).toHaveLength(3);
    expect(vault.assets).toHaveLength(4);
    expect(vault.bankLines.length).toBeGreaterThan(5);
    expect(vault.bankLines.some((l) => l.status === "matched")).toBe(true);
    const catIds = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
    for (const id of DEMO_CATEGORY_IDS) expect(catIds.has(id)).toBe(true);
    for (const t of vault.transactions) if (t.categoryId) expect(catIds.has(t.categoryId)).toBe(true);
    const business = vault.profiles.find((p) => p.id === r.ids.business)!;
    const employee = vault.profiles.find((p) => p.id === r.ids.employee)!;
    const uva = computeUva(business, { year: 2026, index: 3, kind: "quarterly" }, vault.transactions, vault.categories);
    expect(uva.totals.umsatzsteuer).toBeGreaterThan(0);
    expect(uva.kz["057"]?.taxCents).toBeGreaterThan(0); // reverse charge Adobe/Google
    const e1a = computeE1a(business, 2026, vault.transactions, vault.categories, vault.assets);
    expect(e1a.einnahmenCents).toBeGreaterThan(0);
    expect(e1a.kz["9130"]).toBeGreaterThan(0); // AfA
    const l1 = computeL1(employee, 2026, vault.transactions, vault.categories, vault.settings.employee[employee.id]);
    expect(l1.kz["722"]).toBe(69000);
    expect(l1.kz["730"]).toBeGreaterThan(0);
    const journal = deriveJournal(business, vault.transactions, vault.assets, vault.categories, []);
    for (const e of journal) expect(validateEntry(e.lines)).toEqual([]);
  });
});
