import { describe, expect, it } from "vitest";
import { TransactionSchema, VaultSchema, type Transaction, type Vault } from "../model/types";
import { missingReceipt, runAllCheck } from "./allCheck";

const now = "2026-10-01T00:00:00.000Z";
const tx = (id: string, patch: Partial<Transaction> = {}): Transaction =>
  TransactionSchema.parse({ id, profileId: "p", kind: "expense", date: "2026-10-01", description: id, categoryId: "cat_b_ex_buero", grossCents: 1200, vatLines: [{ rate: 20, netCents: 1000, vatCents: 200 }], createdAt: now, updatedAt: now, ...patch });
const vault = (transactions: Transaction[], mode: "business" | "employee" = "business"): Vault =>
  VaultSchema.parse({ version: 1, createdAt: now, updatedAt: now, profiles: [{ id: "p", name: "Test", mode, createdAt: now, updatedAt: now }], activeProfileId: "p", transactions });

describe("runAllCheck", () => {
  it("flags business expenses without an invoice as an error, but not SVS, bank fees or what has a file", () => {
    const r = runAllCheck(vault([tx("papier"), tx("svs", { categoryId: "cat_b_ex_svs" }), tx("spesen", { categoryId: "cat_b_ex_bank" }), tx("mit", { documentIds: ["doc1"] })]), "p", "2026-10-22");
    const f = r.findings.find((x) => x.id === "expense-no-receipt")!;
    expect(f.level).toBe("error");
    expect(f.ids).toEqual(["papier"]);
    expect(f.detail).toContain("keine Vorsteuer");
    expect(r.errors).toBeGreaterThan(0);
  });

  it("finds amounts that do not add up, missing categories, duplicates and dates in the future", () => {
    const r = runAllCheck(vault([
      tx("falsch", { grossCents: 1500, documentIds: ["d"] }),
      tx("ohne", { categoryId: undefined, documentIds: ["d"] }),
      tx("a", { contactId: "c", invoiceNumber: "R1", documentIds: ["d"] }),
      tx("b", { contactId: "c", invoiceNumber: "R1", documentIds: ["d"] }),
      tx("morgen", { date: "2027-01-01", documentIds: ["d"] }),
    ]), "p", "2026-10-22");
    const by = (id: string) => r.findings.find((x) => x.id === id);
    expect(by("vat-sum")?.ids).toEqual(["falsch"]);
    expect(by("no-category")?.ids).toEqual(["ohne"]);
    expect(by("duplicates")?.ids).toEqual(["b"]);
    expect(by("future")?.ids).toEqual(["morgen"]);
    // errors come first
    expect(r.findings[0]!.level).toBe("error");
  });

  it("leaves out areas the caller may not see, and contact names", () => {
    const v = vault([tx("papier", { contactId: "c1" })]);
    v.contacts = [{ id: "c1", profileId: "p", name: "Geheim GmbH" } as never];
    expect(runAllCheck(v, "p", "2026-10-22").findings[0]!.detail).toContain("Geheim GmbH");
    expect(runAllCheck(v, "p", "2026-10-22", { contacts: false }).findings[0]!.detail).not.toContain("Geheim GmbH");
    expect(runAllCheck(v, "p", "2026-10-22", { bookings: false }).findings).toEqual([]);
  });

  it("is quiet when everything is in order", () => {
    const r = runAllCheck(vault([tx("ok", { documentIds: ["d"] })]), "p", "2026-10-22");
    expect(r.findings).toEqual([]);
    expect(r.errors + r.warnings).toBe(0);
  });

  it("private profiles: only Arbeitnehmerveranlagung items need proof, and only as a hint", () => {
    const p = { mode: "employee" as const };
    expect(missingReceipt(tx("lebensmittel", { categoryId: "cat_e_p_lebensmittel" }), p, undefined)).toBe(false);
    expect(missingReceipt(tx("buch", { categoryId: "cat_e_wk" }), p, { l1Kz: "719" } as never)).toBe(true);
  });
});
