/**
 * AI usage in numbers only – per month, feature and model – so people see what reading invoices and Atlas cost
 * them at their AI provider. No prompts, no answers, nothing about the documents. Prices are list prices
 * (estimate); the provider's own usage page has the exact bill.
 */
import { z } from "zod";
import { usageCostCents } from "../extraction/escalation";

export const AiUsageBucketSchema = z.object({
  calls: z.number().int().default(0),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  /** Estimated cost in US cents (list price); 0 when the price is unknown (ChatGPT login, Ollama, OpenAI). */
  costCents: z.number().default(0),
  /** Calls whose price is unknown. */
  unpriced: z.number().int().default(0),
});
export type AiUsageBucket = z.infer<typeof AiUsageBucketSchema>;

export const AI_FEATURES = ["invoices", "atlas"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export const AI_FEATURE_LABELS: Record<AiFeature, string> = { invoices: "Rechnungen lesen", atlas: "Atlas" };

export const AiUsageSchema = z.object({
  /** "YYYY-MM" → feature → model → bucket. */
  months: z.record(z.string(), z.record(z.string(), z.record(z.string(), AiUsageBucketSchema))).default({}),
  /** Warn once a month above this estimate (US cents, 0 = no limit). */
  monthlyLimitCents: z.number().int().min(0).default(0),
  /** Month in which the limit warning was shown. */
  warnedMonth: z.string().default(""),
});
export type AiUsage = z.infer<typeof AiUsageSchema>;

export interface AiCall {
  feature: AiFeature;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Prompt-cache tokens (Claude): written at 1.25×, read at 0.1× the input price. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Fixed cost if the caller already knows it (US cents). */
  costCents?: number;
}

/** Adds one call to the statistics (pure – returns the new object). */
export function addAiUsage(usage: AiUsage, call: AiCall, at: Date = new Date()): AiUsage {
  const month = at.toISOString().slice(0, 7);
  const model = call.model || "unbekannt";
  const input = call.inputTokens ?? 0;
  const output = call.outputTokens ?? 0;
  const billedInput = input + (call.cacheWriteTokens ?? 0) * 1.25 + (call.cacheReadTokens ?? 0) * 0.1;
  const cost = call.costCents ?? usageCostCents(model, { inputTokens: billedInput, outputTokens: output });
  const months = { ...usage.months };
  const features = { ...(months[month] ?? {}) };
  const models = { ...(features[call.feature] ?? {}) };
  const b = AiUsageBucketSchema.parse(models[model] ?? {});
  models[model] = {
    calls: b.calls + 1,
    inputTokens: b.inputTokens + input + (call.cacheReadTokens ?? 0) + (call.cacheWriteTokens ?? 0),
    outputTokens: b.outputTokens + output,
    costCents: b.costCents + (cost ?? 0),
    unpriced: b.unpriced + (cost === undefined ? 1 : 0),
  };
  features[call.feature] = models;
  months[month] = features;
  // keep two years – enough for "this year vs. last year"
  const keys = Object.keys(months).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 24))) delete months[k];
  return { ...usage, months };
}

export interface AiUsageSummary {
  month: string;
  costCents: number;
  calls: number;
  byFeature: Record<AiFeature, AiUsageBucket>;
}

/** One row per month (oldest first), the last `count` months up to `until`. */
export function aiUsageByMonth(usage: AiUsage, count = 12, until: Date = new Date()): AiUsageSummary[] {
  const out: AiUsageSummary[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth() - i, 1));
    const month = d.toISOString().slice(0, 7);
    const features = usage.months[month] ?? {};
    const byFeature = Object.fromEntries(AI_FEATURES.map((f) => [f, sumBuckets(Object.values(features[f] ?? {}))])) as Record<AiFeature, AiUsageBucket>;
    out.push({ month, byFeature, costCents: AI_FEATURES.reduce((s, f) => s + byFeature[f].costCents, 0), calls: AI_FEATURES.reduce((s, f) => s + byFeature[f].calls, 0) });
  }
  return out;
}

/** Totals per model over the given months ("YYYY-MM" prefixes, e.g. ["2026-10"] or ["2026"]). */
export function aiUsageByModel(usage: AiUsage, prefix: string): { model: string; feature: AiFeature; bucket: AiUsageBucket }[] {
  const rows: { model: string; feature: AiFeature; bucket: AiUsageBucket }[] = [];
  for (const [month, features] of Object.entries(usage.months)) {
    if (!month.startsWith(prefix)) continue;
    for (const f of AI_FEATURES) {
      for (const [model, b] of Object.entries(features[f] ?? {})) {
        const row = rows.find((r) => r.model === model && r.feature === f);
        if (row) row.bucket = sumBuckets([row.bucket, b]);
        else rows.push({ model, feature: f, bucket: AiUsageBucketSchema.parse(b) });
      }
    }
  }
  return rows.sort((a, b) => b.bucket.costCents - a.bucket.costCents || b.bucket.calls - a.bucket.calls);
}

function sumBuckets(list: AiUsageBucket[]): AiUsageBucket {
  return list.reduce((s, b) => ({ calls: s.calls + b.calls, inputTokens: s.inputTokens + b.inputTokens, outputTokens: s.outputTokens + b.outputTokens, costCents: s.costCents + b.costCents, unpriced: s.unpriced + (b.unpriced ?? 0) }), AiUsageBucketSchema.parse({}));
}
