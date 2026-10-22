/**
 * Claude model choice for reading invoices: "auto" reads with the cheapest model first and only asks the
 * strongest model when the answer is not sure enough. Also: per-model prices for honest cost estimates.
 */
import type { AiOutput } from "./schema";

export const CLAUDE_AUTO_MODEL = "auto";
/** Cheapest model – reads first in "auto". */
export const CLAUDE_CHEAP_MODEL = "claude-haiku-5-5";
/** Strongest model – reads again in "auto" when the first answer is unsure. */
export const CLAUDE_STRONG_MODEL = "claude-opus-5-5";

export const CLAUDE_EXTRACTION_MODELS = [
  { id: CLAUDE_AUTO_MODEL, label: "Automatisch (günstig & sicher)", hint: "Haiku 5.5 liest zuerst. Ist das Ergebnis unsicher, liest Opus 5.5 noch einmal nach – du zahlst nur dann mehr, wenn es nötig ist." },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Am günstigsten und schnellsten. Reicht für saubere Rechnungen." },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Ausgewogen zwischen Preis und Genauigkeit." },
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Am gründlichsten, auch bei schlechten Fotos – kostet am meisten." },
] as const;

const LABELS: [RegExp, string][] = [
  [/^claude-haiku-5-5/, "Haiku 5.5"],
  [/^claude-sonnet-5-5/, "Sonnet 5.5"],
  [/^claude-opus-5-5/, "Opus 5.5"],
  [/^claude-haiku-4-5/, "Haiku 4.5"],
  [/^claude-sonnet-5(?!-5)/, "Sonnet 5"],
  [/^claude-opus-5(?!-5)/, "Opus 5"],
];

/** Friendly model name for the review header ("Mit KI gelesen (Haiku 5.5)"). */
export function extractionModelLabel(model: string | undefined): string {
  if (!model) return "";
  if (model === CLAUDE_AUTO_MODEL) return "Automatisch";
  for (const [re, label] of LABELS) if (re.test(model)) return label;
  return model.replace(/^claude-/, "");
}

export interface AiAssessment {
  /** Plain-German reasons why the answer is not sure enough. Empty = confident. */
  issues: string[];
  confident: boolean;
  /** Mean of the essential confidences – tie-breaker between two answers. */
  meanConfidence: number;
}

const pct = (n: number) => `${Math.round(n * 100)} %`;
const isIsoDate = (s: string | null | undefined): boolean => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * Is an AI answer sure enough to keep without asking a stronger model? Mirrors what auto-booking needs:
 * the essentials are present and above the threshold, and the numbers add up.
 * Wording avoids the phrases that block auto-booking (see autobook.ts) – this is only about escalation.
 */
export function assessAiOutput(o: AiOutput, opts: { threshold: number; checkVat?: boolean }): AiAssessment {
  const issues: string[] = [];
  const c = o.confidence ?? { overall: 0, vendor_name: 0, invoice_date: 0, gross_total: 0, vat_lines: 0, invoice_number: 0 };
  const t = opts.threshold;
  const outgoing = o.direction === "outgoing";
  const partnerLabel = outgoing ? "Kunde" : "Lieferant";
  const partner = outgoing ? (o.customer_name ?? o.vendor_name) : o.vendor_name;

  if (o.gross_total === null || o.gross_total === undefined || !Number.isFinite(o.gross_total)) issues.push("Betrag fehlt");
  else if ((c.gross_total ?? 0) < t) issues.push(`Betrag unsicher (${pct(c.gross_total ?? 0)})`);
  if (!isIsoDate(o.invoice_date)) issues.push("Datum fehlt");
  else if ((c.invoice_date ?? 0) < t) issues.push(`Datum unsicher (${pct(c.invoice_date ?? 0)})`);
  if (!partner || !partner.trim()) issues.push(`${partnerLabel} fehlt`);
  else if ((c.vendor_name ?? 0) < t) issues.push(`${partnerLabel} unsicher (${pct(c.vendor_name ?? 0)})`);
  if ((c.overall ?? 0) < t) issues.push(`Gesamtsicherheit ${pct(c.overall ?? 0)}`);

  const lines = o.vat_lines ?? [];
  const bookable = o.document_type === "invoice" || o.document_type === "receipt" || o.document_type === "credit_note";
  if (opts.checkVat && bookable && o.reverse_charge !== true && (c.vat_lines ?? 0) < 0.8) issues.push(`Umsatzsteuer unsicher (${pct(c.vat_lines ?? 0)})`);

  // Totals must add up: Σ(net + vat) of the VAT lines, and net + vat, against the gross total.
  const gross = o.gross_total;
  const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol + 1e-9;
  let sumsOff = false;
  if (gross !== null && gross !== undefined && lines.length && lines.every((l) => l.net !== null && l.vat !== null)) {
    const sum = lines.reduce((s, l) => s + (l.net ?? 0) + (l.vat ?? 0), 0);
    if (!near(sum, gross)) sumsOff = true;
  }
  if (gross !== null && gross !== undefined && o.net_total !== null && o.vat_total !== null && o.net_total !== undefined && o.vat_total !== undefined) {
    if (!near(o.net_total + o.vat_total, gross)) sumsOff = true;
  }
  if (sumsOff) issues.push("Summen passen nicht zusammen");

  // VAT per line has to match its rate (rounding on long receipts allowed).
  const vatOff = lines.some((l) => {
    if (l.net === null || l.vat === null || !Number.isFinite(l.rate)) return false;
    const expected = (l.net * l.rate) / 100;
    return Math.abs(l.vat - expected) > Math.max(0.05, Math.abs(expected) * 0.015);
  });
  if (vatOff) issues.push("Steuerbetrag passt nicht zum Steuersatz");

  const meanConfidence = ((c.overall ?? 0) + (c.gross_total ?? 0) + (c.invoice_date ?? 0) + (c.vendor_name ?? 0)) / 4;
  return { issues, confident: issues.length === 0, meanConfidence };
}

/** Of two answers, keep the stronger model's unless it has more problems than the cheaper one. */
export function preferStrong(cheap: AiAssessment, strong: AiAssessment): boolean {
  if (strong.issues.length !== cheap.issues.length) return strong.issues.length < cheap.issues.length;
  return strong.meanConfidence >= cheap.meanConfidence - 0.02;
}

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

/** US dollars per million tokens (Claude API list prices; Haiku 5.5 price for prompts ≤ 100K tokens). */
export const CLAUDE_PRICES_USD: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

function priceOf(model: string): { input: number; output: number } | undefined {
  const key = Object.keys(CLAUDE_PRICES_USD).find((k) => model.startsWith(k));
  return key ? CLAUDE_PRICES_USD[key] : undefined;
}

/** Cost of one call in US cents (undefined for models without a known price). */
export function usageCostCents(model: string, usage: { inputTokens?: number; outputTokens?: number } | undefined): number | undefined {
  const p = priceOf(model);
  if (!p || !usage) return undefined;
  return (((usage.inputTokens ?? 0) * p.input + (usage.outputTokens ?? 0) * p.output) / 1_000_000) * 100;
}

/**
 * Typical tokens for one invoice of 1–2 pages read from the image: images (~1,600–4,800 tokens per page) plus
 * instructions/categories, and the answer including the model's thinking.
 */
export const TYPICAL_INVOICE_TOKENS = { input: { low: 3000, high: 8000 }, output: { low: 1000, high: 3000 } };
/** Share of invoices the cheap model is unsure about in "auto" (assumption: clean PDFs rarely, blurry photos often). */
export const AUTO_ESCALATION_SHARE = { low: 0.1, high: 0.3 };

/** Rough cost range in (US) cents for re-reading `count` invoices with the given model setting. */
export function estimateReadCostCents(count: number, model: string): { low: number; high: number; perInvoice: { low: number; high: number } } {
  const one = (m: string, k: "low" | "high") => usageCostCents(m, { inputTokens: TYPICAL_INVOICE_TOKENS.input[k], outputTokens: TYPICAL_INVOICE_TOKENS.output[k] }) ?? 0;
  let low: number;
  let high: number;
  if (model === CLAUDE_AUTO_MODEL) {
    low = one(CLAUDE_CHEAP_MODEL, "low") + AUTO_ESCALATION_SHARE.low * one(CLAUDE_STRONG_MODEL, "low");
    high = one(CLAUDE_CHEAP_MODEL, "high") + AUTO_ESCALATION_SHARE.high * one(CLAUDE_STRONG_MODEL, "high");
  } else {
    low = one(model, "low");
    high = one(model, "high");
  }
  return { low: low * count, high: high * count, perInvoice: { low, high } };
}
