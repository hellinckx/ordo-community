import type { AtlasMessage } from "@ordo/core";
import type { ProviderToolDef } from "../toolset";

export type Effort = "low" | "medium" | "high";

export interface StepCall {
  id: string;
  name: string;
  input: unknown;
  /** Set when the model's input could not be read (the tool is not run; the error goes back to the model). */
  invalid?: string;
}

export interface StepResult {
  /** Visible text of this step. */
  text: string;
  calls: StepCall[];
  /** Provider-specific content to store with the assistant message (needed to continue the conversation). */
  raw?: unknown;
  /** Model that produced the answer (can differ from the requested one after a server-side fallback). */
  model: string;
  stop: "end" | "tool_use" | "max_tokens" | "refusal" | "pause";
  /** Shown to the person when the model declined. */
  refusal?: string;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

export interface StepInput {
  system: string;
  tools: ProviderToolDef[];
  history: AtlasMessage[];
  model: string;
  effort: Effort;
  maxTokens: number;
  signal: AbortSignal;
  /** Whole visible text so far (live streaming). */
  onText(snapshot: string): void;
  /** Short status, e.g. "Sucht …". */
  onActivity?(text: string): void;
}

export interface AtlasProvider {
  id: "claude" | "codex";
  step(input: StepInput): Promise<StepResult>;
}

export type ProviderErrorKind = "auth" | "permission" | "rate" | "overloaded" | "network" | "bad_request" | "not_found" | "aborted" | "unavailable" | "other";

export class AtlasProviderError extends Error {
  constructor(message: string, public readonly kind: ProviderErrorKind, public readonly cause?: unknown) {
    super(message);
    this.name = "AtlasProviderError";
  }
}

/** Raw payloads stored on messages (provider-neutral transcript + what each provider needs to continue). */
export interface UserRaw {
  context?: string;
}
export interface AssistantRaw {
  provider?: "claude" | "codex";
  /** Claude: the assistant content blocks exactly as returned (thinking blocks included). */
  content?: unknown[];
  /** Not sent back to the model (notes like "Abgebrochen" or a declined request). */
  local?: boolean;
  effort?: Effort;
}
export interface ToolRaw {
  isError?: boolean;
}
