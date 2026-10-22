import type { AiProvider } from "../../model/types";
import type { AiOutput } from "../schema";

export interface ProviderInput {
  prompt: string;
  schema: object;
  /** PNG images (receipt photo / rendered PDF pages). */
  images: Uint8Array[];
  /** Original PDF bytes for providers that accept PDFs natively. */
  pdf?: Uint8Array;
  signal?: AbortSignal;
  /** VAT matters for this profile (business, not Kleinunternehmer) – part of the "is this sure enough" check. */
  checkVat?: boolean;
  /** Progress for multi-step providers (e.g. "Haiku 5.5", then "Opus 5.5 liest nach"). */
  onStep?: (detail: string) => void;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** One model call of a provider that may ask several models (Claude "Automatisch"). */
export interface ProviderAttempt {
  model: string;
  /** Why this answer was not sure enough (empty = confident). */
  issues: string[];
  usage?: ProviderUsage;
  error?: string;
}

export interface ProviderResult {
  output: AiOutput;
  model: string;
  raw?: string;
  durationMs: number;
  /** Usage of the answer that was kept. */
  usage?: ProviderUsage;
  /** Every call that was made, in order – including a cheaper first answer that was replaced. */
  attempts?: ProviderAttempt[];
}

export interface ExtractionProvider {
  readonly id: AiProvider;
  readonly name: string;
  /** true if the documents leave the device. */
  readonly cloud: boolean;
  available(): Promise<{ ok: boolean; reason?: string; detail?: string }>;
  extract(input: ProviderInput): Promise<ProviderResult>;
}

/**
 * Machine-readable reason of a failed AI call, so callers can retry (rate_limit, overloaded), pause (network) or
 * stop and explain (no_key, auth, billing, consent).
 */
export type ProviderErrorCode =
  | "no_provider"
  | "no_key"
  | "consent"
  | "auth"
  | "billing"
  | "permission"
  | "not_found"
  | "rate_limit"
  | "overloaded"
  | "network"
  | "bad_request"
  | "refusal"
  | "invalid_output"
  | "aborted"
  | "other";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: AiProvider,
    public readonly status?: number,
    public readonly code: ProviderErrorCode = "other",
    /** Server hint (retry-after) for rate limits. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Extracts the first JSON object from a model answer (tolerates ```json fences and prose). */
export function parseJsonFromText(text: string): AiOutput {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s) as AiOutput;
}

/** Generic HTTP status → error code (providers with their own wording may refine the message). */
export function codeFromStatus(status: number): ProviderErrorCode {
  if (status === 401) return "auth";
  if (status === 402) return "billing";
  if (status === 403) return "permission";
  if (status === 404) return "not_found";
  if (status === 408 || status === 429) return "rate_limit";
  if (status >= 500) return "overloaded";
  if (status >= 400) return "bad_request";
  return "other";
}

/** Reads a retry-after header (seconds or HTTP date) as milliseconds. */
export function retryAfterMs(headers: { get(name: string): string | null } | undefined, now = Date.now()): number | undefined {
  const v = headers?.get("retry-after");
  if (!v) return undefined;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.max(0, Math.round(s * 1000));
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : undefined;
}
