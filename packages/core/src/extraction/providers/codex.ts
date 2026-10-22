import { ProviderError, parseJsonFromText, type ExtractionProvider, type ProviderInput, type ProviderResult } from "./types";

/**
 * Codex (ChatGPT login) runs as a local subprocess (`codex exec`) and is therefore only available in the
 * desktop app. The app implements this bridge via Tauri commands; the core only knows the contract.
 */
export interface CodexStatus {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
  authMode?: "chatgpt" | "apikey" | "none";
  defaultModel?: string;
  error?: string;
}

export interface CodexRunResult {
  text: string;
  model?: string;
  durationMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface CodexChatArgs {
  /** Whole prompt (instructions + transcript); passed to `codex exec` on stdin. */
  prompt: string;
  /** JSON schema for the final answer (OpenAI structured output rules: every property required, no extra properties). */
  schema: object;
  model?: string;
  reasoning?: string;
  /** Lets `cancel` stop exactly this run. */
  requestId?: string;
  signal?: AbortSignal;
}

export interface CodexBridge {
  status(): Promise<CodexStatus>;
  /** Starts `codex login` (opens the browser). Resolves when login completed or failed. */
  login(): Promise<{ ok: boolean; message?: string }>;
  logout(): Promise<void>;
  /** Runs `codex exec` with images + schema and returns the final JSON text. */
  extract(args: { images: Uint8Array[]; prompt: string; schema: object; model?: string; reasoning?: string; signal?: AbortSignal }): Promise<CodexRunResult>;
  /**
   * Text-only run for Atlas: `codex exec` in an empty folder with a read-only sandbox. Codex only answers in the
   * given JSON schema – it never runs Ordo's tools itself; the app executes the tool calls it asks for.
   */
  chat?(args: CodexChatArgs): Promise<CodexRunResult>;
  /** Stops a running `chat` (the stop button). */
  cancel?(requestId: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Atlas over Codex: a small JSON protocol for tool calls              */
/* ------------------------------------------------------------------ */

/**
 * Codex has no tool-use API we can hook into from the outside, so Atlas asks it for one JSON object per step:
 * either a final reply or tool calls (or both – a short note plus the calls). OpenAI structured outputs need every
 * property listed in `required` and `additionalProperties: false`, hence `arguments_json` as a string.
 */
export const CODEX_AGENT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: ["string", "null"], description: "Antwort an die Person (Markdown) oder null, solange noch Werkzeuge laufen sollen." },
    tool_calls: {
      type: "array",
      description: "Werkzeuge, die Ordo jetzt ausführen soll. Leer, wenn die Antwort fertig ist.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name des Werkzeugs" },
          arguments_json: { type: "string", description: "Eingaben als JSON-Objekt in einem String" },
        },
        required: ["name", "arguments_json"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "tool_calls"],
  additionalProperties: false,
} as const;

export interface CodexAgentToolCall {
  name: string;
  /** Parsed arguments, or undefined when `error` is set. */
  arguments?: unknown;
  /** Raw text when the arguments were no valid JSON object. */
  raw: string;
  error?: string;
}

export interface CodexAgentStep {
  reply: string | null;
  toolCalls: CodexAgentToolCall[];
}

/** Reads one Codex answer of the Atlas protocol. Tolerates code fences and prose around the JSON. */
export function parseCodexAgentStep(text: string): CodexAgentStep {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) {
    // No JSON at all: treat the whole text as the reply rather than failing the turn.
    return { reply: text.trim() || null, toolCalls: [] };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(s.slice(start, end + 1));
  } catch {
    return { reply: text.trim() || null, toolCalls: [] };
  }
  const o = (obj ?? {}) as { reply?: unknown; tool_calls?: unknown };
  const reply = typeof o.reply === "string" && o.reply.trim() ? o.reply : null;
  const calls = Array.isArray(o.tool_calls) ? o.tool_calls : [];
  const toolCalls: CodexAgentToolCall[] = [];
  for (const c of calls) {
    const call = (c ?? {}) as { name?: unknown; arguments_json?: unknown; arguments?: unknown };
    const name = typeof call.name === "string" ? call.name.trim() : "";
    if (!name) continue;
    const raw = typeof call.arguments_json === "string" ? call.arguments_json : call.arguments !== undefined ? JSON.stringify(call.arguments) : "{}";
    try {
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) toolCalls.push({ name, raw, error: "arguments_json ist kein JSON-Objekt" });
      else toolCalls.push({ name, raw, arguments: parsed });
    } catch {
      toolCalls.push({ name, raw, error: "arguments_json ist kein gültiges JSON" });
    }
  }
  return { reply, toolCalls };
}

export function createCodexProvider(bridge: CodexBridge, opts: { model?: string; reasoning?: string } = {}): ExtractionProvider {
  return {
    id: "codex",
    name: "ChatGPT / Codex (Anmeldung)",
    cloud: true,
    async available() {
      const s = await bridge.status();
      if (!s.installed) return { ok: false, reason: "Codex CLI ist nicht installiert (npm i -g @openai/codex oder Codex-App).", detail: s.error };
      if (!s.loggedIn) return { ok: false, reason: "Nicht mit ChatGPT angemeldet – „Mit ChatGPT anmelden“ klicken." };
      return { ok: true, detail: `Codex ${s.version ?? ""} · ${s.defaultModel ?? ""}`.trim() };
    },
    async extract(input: ProviderInput): Promise<ProviderResult> {
      if (!input.images.length) throw new ProviderError("Codex benötigt mindestens ein Bild (PDF wird vorher gerendert).", "codex");
      const r = await bridge.extract({ images: input.images.slice(0, 4), prompt: input.prompt, schema: input.schema, model: opts.model || undefined, reasoning: opts.reasoning, signal: input.signal });
      if (!r.text) throw new ProviderError("Codex: leere Antwort.", "codex");
      return { output: parseJsonFromText(r.text), model: r.model ?? opts.model ?? "codex", raw: r.text, durationMs: r.durationMs, usage: r.usage };
    },
  };
}
