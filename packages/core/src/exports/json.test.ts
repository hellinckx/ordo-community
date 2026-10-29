import { beforeAll, describe, expect, it } from "vitest";
import { VaultStore } from "../vault/store";
import { MemoryStorage } from "../vault/storage";
import { exportJson, parseDataExport } from "./json";
import type { Vault } from "../model/types";

describe("Ordo data exports", () => {
  let vault: Vault;
  beforeAll(async () => {
    const { store } = await VaultStore.create(new MemoryStorage(), { password: "test-export-2026", profileName: "Test", mode: "business", withRecoveryKey: false });
    store.mutate((v) => { v.settings.ai.openaiApiKey = "test-secret"; });
    vault = store.vault;
  });

  it("exports under the Ordo name and keeps accounting data while removing API secrets", () => {
    const bytes = exportJson(vault);
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    expect(raw.app).toBe("Ordo");
    expect(raw.format).toBe("ordo-data");
    const parsed = parseDataExport(bytes);
    expect(parsed.profiles).toEqual(vault.profiles);
    expect(parsed.categories).toEqual(vault.categories);
    expect(parsed.settings.ai.openaiApiKey).toBe("");
    expect(vault.settings.ai.openaiApiKey).toBe("test-secret");
  });

  it("still accepts the previous export format without changing category IDs or profile settings", () => {
    const legacy = JSON.parse(new TextDecoder().decode(exportJson(vault)));
    legacy.format = "summa-data";
    const parsed = parseDataExport(new TextEncoder().encode(JSON.stringify(legacy)));
    expect(parsed.profiles).toEqual(vault.profiles);
    expect(parsed.categories).toEqual(vault.categories);
    expect(parsed.settings.modules).toEqual(vault.settings.modules);
  });
});
