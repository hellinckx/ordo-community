import { describe, expect, it, vi } from "vitest";
import { extractDocument } from "./pipeline";
import { TextExtractor } from "./text";
import { DEFAULT_CATEGORIES } from "../model/defaults";
import { ProfileSchema, SettingsSchema } from "../model/types";
import { ProviderError, type ExtractionProvider, type ProviderInput } from "./providers/types";
import { aiOutput } from "./aiOutput.fixture";

const now = "2026-10-21T00:00:00.000Z";
const profile = ProfileSchema.parse({ id: "p1", name: "Test", mode: "business", createdAt: now, updatedAt: now, company: { name: "Test e.U.", uid: "ATU00000000" } });
const RECEIPT = "BILLA AG\nDatum: 01.10.2026\nSumme EUR 120,00\n20% MwSt 20,00";

function provider(impl: (i: ProviderInput) => ReturnType<ExtractionProvider["extract"]>): ExtractionProvider & { calls: ProviderInput[] } {
  const calls: ProviderInput[] = [];
  return { id: "anthropic", name: "Claude (automatisch)", cloud: true, calls, available: async () => ({ ok: true }), extract: (i) => { calls.push(i); return impl(i); } };
}

describe("Mit KI lesen (forceAi)", () => {
  const bytes = new TextEncoder().encode(RECEIPT);

  it("asks the AI even with strategy local_only and skips local OCR", async () => {
    const settings = SettingsSchema.parse({ ai: { provider: "anthropic", strategy: "local_only", cloudConsent: true } });
    const p = provider(async () => ({ output: aiOutput(), model: "claude-opus-5-5", durationMs: 1, attempts: [{ model: "claude-haiku-5-5", issues: ["Betrag unsicher (60 %)"], usage: { inputTokens: 3000, outputTokens: 800 } }, { model: "claude-opus-5-5", issues: [], usage: { inputTokens: 3000, outputTokens: 900 } }] }));
    const te = new TextExtractor();
    const spy = vi.spyOn(te, "extract");
    const out = await extractDocument(bytes, "bon.txt", "text/plain", { profile, settings, categories: DEFAULT_CATEGORIES, contacts: [], textExtractor: te, provider: p, forceAi: true });
    expect(spy.mock.calls[0]![3]).toEqual({ ocr: false });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]!.checkVat).toBe(true);
    expect(out.sources).toContain("ai");
    expect(out.extraction.provider).toBe("anthropic");
    expect(out.extraction.model).toBe("claude-opus-5-5");
    expect(out.aiUsage.map((u) => u.model)).toEqual(["claude-haiku-5-5", "claude-opus-5-5"]);
    expect(out.extraction.warnings.some((w) => w.includes("Haiku 5.5 hat zuerst gelesen") && w.includes("Opus 5.5 hat nachgelesen"))).toBe(true);
  });

  it("without forceAi, local_only never calls the AI", async () => {
    const settings = SettingsSchema.parse({ ai: { provider: "anthropic", strategy: "local_only", cloudConsent: true } });
    const p = provider(async () => ({ output: aiOutput(), model: "claude-haiku-5-5", durationMs: 1 }));
    await extractDocument(bytes, "bon.txt", "text/plain", { profile, settings, categories: DEFAULT_CATEGORIES, contacts: [], textExtractor: new TextExtractor(), provider: p });
    expect(p.calls).toHaveLength(0);
  });

  it("throws instead of falling back when consent is missing or the AI fails", async () => {
    const noConsent = SettingsSchema.parse({ ai: { provider: "anthropic", cloudConsent: false } });
    const p = provider(async () => ({ output: aiOutput(), model: "claude-haiku-5-5", durationMs: 1 }));
    await expect(extractDocument(bytes, "bon.txt", "text/plain", { profile, settings: noConsent, categories: DEFAULT_CATEGORIES, contacts: [], textExtractor: new TextExtractor(), provider: p, forceAi: true })).rejects.toMatchObject({ code: "consent" });
    expect(p.calls).toHaveLength(0);

    const settings = SettingsSchema.parse({ ai: { provider: "anthropic", cloudConsent: true } });
    const failing = provider(async () => {
      throw new ProviderError("Gerade zu viele Anfragen an Claude", "anthropic", 429, "rate_limit", 5000);
    });
    await expect(extractDocument(bytes, "bon.txt", "text/plain", { profile, settings, categories: DEFAULT_CATEGORIES, contacts: [], textExtractor: new TextExtractor(), provider: failing, forceAi: true })).rejects.toMatchObject({ code: "rate_limit", retryAfterMs: 5000 });
    await expect(extractDocument(bytes, "bon.txt", "text/plain", { profile, settings, categories: DEFAULT_CATEGORIES, contacts: [], textExtractor: new TextExtractor(), forceAi: true })).rejects.toMatchObject({ code: "no_provider" });
  });

  it("a failing AI on a normal import still falls back to the local result", async () => {
    const settings = SettingsSchema.parse({ ai: { provider: "anthropic", strategy: "always", cloudConsent: true } });
    const failing = provider(async () => {
      throw new ProviderError("weg", "anthropic", undefined, "network");
    });
    const out = await extractDocument(bytes, "bon.txt", "text/plain", { profile, settings, categories: DEFAULT_CATEGORIES, contacts: [], textExtractor: new TextExtractor(), provider: failing });
    expect(out.aiError).toBe("weg");
    expect(out.extraction.provider).toBe("rules");
  });

  it("new vaults read with Claude automatically, old ones keep their model", () => {
    expect(SettingsSchema.parse({}).ai.anthropicModel).toBe("auto");
    expect(SettingsSchema.parse({ ai: { anthropicModel: "claude-sonnet-5-5" } }).ai.anthropicModel).toBe("claude-sonnet-5-5");
  });
});
