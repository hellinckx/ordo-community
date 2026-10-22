import { describe, expect, it } from "vitest";
import { AiUsageSchema, addAiUsage, aiUsageByModel, aiUsageByMonth } from "./aiUsage";

describe("AI usage statistics", () => {
  it("adds calls per month, feature and model with list-price estimates", () => {
    let u = AiUsageSchema.parse({});
    const oct = new Date("2026-10-22T10:00:00Z");
    u = addAiUsage(u, { feature: "invoices", model: "claude-haiku-5-5", inputTokens: 4000, outputTokens: 1000 }, oct);
    u = addAiUsage(u, { feature: "invoices", model: "claude-haiku-5-5", inputTokens: 4000, outputTokens: 1000 }, oct);
    u = addAiUsage(u, { feature: "atlas", model: "claude-sonnet-5-5", inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10000 }, oct);
    u = addAiUsage(u, { feature: "atlas", model: "gpt-5-codex", inputTokens: 900, outputTokens: 100, costCents: 0 }, oct);
    u = addAiUsage(u, { feature: "invoices", model: "gpt-4.1", inputTokens: 900, outputTokens: 100 }, new Date("2026-09-03T10:00:00Z"));
    const [sep, now] = aiUsageByMonth(u, 2, oct);
    expect(now!.month).toBe("2026-10");
    expect(now!.calls).toBe(4);
    // haiku: 2 × (4000 × 0.1 + 1000 × 0.5) / 1e6 $ = 0.0018 $ = 0.18 ¢
    expect(now!.byFeature.invoices.costCents).toBeCloseTo(0.18, 5);
    // sonnet: (1000 + 10000 × 0.1) × 2 + 500 × 10 = 9000 / 1e6 $ = 0.9 ¢
    expect(now!.byFeature.atlas.costCents).toBeCloseTo(0.9, 5);
    expect(sep!.byFeature.invoices.unpriced).toBe(1);
    const models = aiUsageByModel(u, "2026-10");
    expect(models[0]!.model).toBe("claude-sonnet-5-5");
    expect(models.find((m) => m.model === "gpt-5-codex")!.bucket.unpriced).toBe(0);
  });

  it("keeps two years", () => {
    let u = AiUsageSchema.parse({});
    for (let m = 0; m < 30; m++) u = addAiUsage(u, { feature: "atlas", model: "x", inputTokens: 1 }, new Date(Date.UTC(2024, m, 5)));
    expect(Object.keys(u.months)).toHaveLength(24);
  });
});
