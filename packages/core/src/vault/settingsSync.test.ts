import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage";
import { VaultStore } from "./store";
import { mergeSettings } from "../exports/json";

describe("settings sync", () => {
  it("stamps changed settings areas and merges them area by area", async () => {
    const a = (await VaultStore.create(new MemoryStorage(), { password: "pw-geraet-a", profileName: "Ich", mode: "employee" })).store;
    const b = (await VaultStore.create(new MemoryStorage(), { password: "pw-geraet-b", profileName: "Ich", mode: "employee" })).store;
    a.mutate((v) => { v.settings = { ...v.settings, ai: { ...v.settings.ai, anthropicApiKey: "sk-a" } }; });
    expect(a.vault.settings.stamps.ai).toBeTruthy();
    expect(a.vault.settings.stamps.theme).toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));
    // in-place change on the other device, later
    b.mutate((v) => { v.settings.theme = "dark"; v.settings.watchFolders = [{ id: "w", profileId: "p", path: "C:/B", kind: "receipts", active: true, recursive: true, moveProcessed: false }]; });
    expect(b.vault.settings.stamps.theme).toBeTruthy();

    const onB = mergeSettings(b.vault.settings, a.vault.settings);
    expect(onB.ai.anthropicApiKey).toBe("sk-a");
    expect(onB.theme).toBe("dark");
    expect(onB.watchFolders[0]!.path).toBe("C:/B");
    const onA = mergeSettings(a.vault.settings, b.vault.settings);
    expect(onA.theme).toBe("dark");
    expect(onA.watchFolders).toHaveLength(0);

    // taking over a merged area keeps the other device's stamp instead of a new one
    a.mutate((v) => { v.settings = onA; });
    expect(a.vault.settings.stamps.theme).toBe(b.vault.settings.stamps.theme);
  });

  it("keeps the larger AI usage count from both devices", () => {
    const bucket = (calls: number) => ({ calls, inputTokens: 0, outputTokens: 0, costCents: 0, unpriced: 0 });
    const s = (months: Record<string, Record<string, Record<string, ReturnType<typeof bucket>>>>) => ({ aiUsage: { months, monthlyLimitCents: 0, warnedMonth: "" }, stamps: {} }) as never;
    const out = mergeSettings(s({ "2026-10": { atlas: { m: bucket(5) } } }), s({ "2026-10": { atlas: { m: bucket(3), n: bucket(1) } }, "2026-09": { invoices: { m: bucket(2) } } }));
    expect(out.aiUsage.months["2026-10"]!.atlas!.m!.calls).toBe(5);
    expect(out.aiUsage.months["2026-10"]!.atlas!.n!.calls).toBe(1);
    expect(out.aiUsage.months["2026-09"]!.invoices!.m!.calls).toBe(2);
  });
});
