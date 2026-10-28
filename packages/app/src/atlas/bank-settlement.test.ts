import { beforeAll, describe, expect, it } from "vitest";
import { MemoryStorage, VaultStore, nowIso, type BankLine } from "@ordo/core";
import type { OrdoModule } from "@/modules/types";
import { buildToolset, runTool, toolContext } from "./toolset";

let store: VaultStore;
const modules = ["basis", "summa"].map((id) => ({ id, routes: [] }) as unknown as OrdoModule);
beforeAll(async () => {
  ({ store } = await VaultStore.create(new MemoryStorage(), { password: "synthetischer-test-123", profileName: "Privater Test", mode: "employee", withRecoveryKey: false }));
});
const line = (id: string, amountCents = 7000): BankLine => ({ id, profileId: store.activeProfile.id, statementId: "statement-test", date: "2026-03-02", amountCents, currency: "EUR", counterparty: "Familie Beispiel", counterpartyIban: "", purpose: "Taschengeld", reference: "", hash: id, status: "unmatched", createdAt: nowIso(), updatedAt: nowIso() });
const settle = async (lines: unknown[]) => {
  const tool = buildToolset({ modules, role: "owner", permission: "auto" }).byName.get("settle_bank_lines")!;
  return runTool(tool, { lines }, toolContext(store, "owner", () => undefined));
};

describe("bank settlement safeguards", () => {
  it("rejects discarding household income and books pocket money once even on retry", async () => {
    store.insert("bankLines", line("pocket"));
    const rejected = await settle([{ line: "pocket", action: "ignore", reason: "Privat" }]);
    expect(JSON.parse(rejected.content).errors[0]).toContain("Privatprofil");
    expect(store.vault.bankLines.find((l) => l.id === "pocket")?.status).toBe("unmatched");
    const before = store.vault.transactions.length;
    await settle([{ line: "pocket", action: "book" }, { line: "pocket", action: "book" }]);
    await settle([{ line: "pocket", action: "book" }]);
    expect(store.vault.transactions).toHaveLength(before + 1);
    expect(store.vault.transactions.at(-1)).toMatchObject({ kind: "income", grossCents: 7000, categoryId: "cat_e_in_geschenke" });
    expect(store.vault.transactions.at(-1)?.vatLines[0]?.vatCents).toBe(0);
  });
  it("rejects matching an incoming payment to an outgoing booking or an already claimed booking", async () => {
    store.insert("bankLines", line("incoming"));
    store.insert("bankLines", line("outgoing", -7000));
    await settle([{ line: "outgoing", action: "book" }]);
    const expense = store.vault.bankLines.find((l) => l.id === "outgoing")!.matchedTransactionId;
    const mismatch = await settle([{ line: "incoming", action: "match", target: expense }]);
    expect(JSON.parse(mismatch.content).errors[0]).toContain("Richtung");
    const income = store.vault.bankLines.find((l) => l.id === "pocket")!.matchedTransactionId;
    await settle([{ line: "incoming", action: "match", target: income }]);
    expect(store.vault.bankLines.find((l) => l.id === "incoming")?.status).toBe("unmatched");
  });
  it("leaves possible own-account transfers and ATM withdrawals open instead of inventing an expense", async () => {
    store.insert("bankLines", { ...line("cash", -5000), counterparty: "AUTOMAT 12345", purpose: "Bargeldbehebung" });
    const result = await settle([{ line: "cash", action: "book" }]);
    expect(JSON.parse(result.content).errors[0]).toContain("Bargeldbehebung");
    expect(store.vault.bankLines.find((l) => l.id === "cash")?.status).toBe("unmatched");
  });
});
