import { ProviderError, parseJsonFromText, retryAfterMs, type ExtractionProvider, type ProviderAttempt, type ProviderInput, type ProviderResult } from "./types";
import { toBase64 } from "../../vault/crypto";
import type { AiOutput } from "../schema";
import { CLAUDE_AUTO_MODEL, CLAUDE_CHEAP_MODEL, CLAUDE_STRONG_MODEL, assessAiOutput, extractionModelLabel, preferStrong } from "../escalation";

export * from "../escalation";

export interface AnthropicOptions {
  apiKey: string;
  /** A Claude model id, or "auto" (Haiku first, Opus when unsure). */
  model: string;
  baseUrl?: string;
  /** "auto": below this self-reported confidence (or with missing/inconsistent fields) the strong model reads again. */
  escalateBelow?: number;
  /** For tests. */
  fetchImpl?: typeof fetch;
}

type Json = Record<string, unknown>;

const isNullable = (p: Json) => Array.isArray(p.type) && (p.type as unknown[]).includes("null") && (p.type as unknown[]).length > 1;
const nonNullType = (p: Json) => (p.type as unknown[]).filter((t) => t !== "null");
/** A plain nullable text (no enum): sent as a required string, "" stands for "not on the document". */
const isNullableText = (p: Json) => isNullable(p) && nonNullType(p).length === 1 && nonNullType(p)[0] === "string" && !Array.isArray(p.enum);

/**
 * JSON schema → what Claude's structured outputs accept. Claude allows at most 16 union-typed parameters (every
 * `["string", "null"]` counts), and our invoice schema has more than 20 nullable fields. So nothing is sent as a union:
 * nullable texts become required strings where "" means "not on the document", other nullable values (numbers,
 * booleans, enums) become optional properties. `fromClaudeOutput` turns the answer back into the nullable shape.
 */
export function toClaudeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toClaudeSchema);
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as Json;
  const out: Json = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "items" || k === "anyOf" || k === "allOf") out[k] = toClaudeSchema(v);
    else if (k !== "properties") out[k] = v;
  }
  if (s.properties && typeof s.properties === "object") {
    const props: Json = {};
    const dropped = new Set<string>();
    for (const [name, raw] of Object.entries(s.properties as Json)) {
      const p = { ...(raw as Json) };
      if (isNullableText(p)) {
        p.type = "string";
        p.description = `${p.description ? `${String(p.description)} – ` : ""}leerer Text "", wenn nicht vorhanden`;
      } else if (isNullable(p)) {
        const t = nonNullType(p);
        p.type = t.length === 1 ? t[0] : t;
        if (Array.isArray(p.enum)) p.enum = (p.enum as unknown[]).filter((x) => x !== null);
        dropped.add(name);
      }
      props[name] = toClaudeSchema(p);
    }
    out.properties = props;
    if (Array.isArray(s.required)) out.required = (s.required as string[]).filter((r) => !dropped.has(r));
  }
  return out;
}

/** Claude's answer back into the schema's nullable shape: missing optional values and "" texts become null. */
export function fromClaudeOutput(value: unknown, schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return value;
  const s = schema as Json;
  if (Array.isArray(value)) return s.items ? value.map((v) => fromClaudeOutput(v, s.items)) : value;
  if (!value || typeof value !== "object" || !s.properties) return value;
  const out: Json = { ...(value as Json) };
  for (const [name, raw] of Object.entries(s.properties as Json)) {
    const p = raw as Json;
    const v = out[name];
    if (isNullable(p) && (v === undefined || (isNullableText(p) && typeof v === "string" && v.trim() === ""))) out[name] = null;
    else if (v !== undefined) out[name] = fromClaudeOutput(v, p);
  }
  return out;
}

interface ClaudeResponse {
  content?: { type: string; text?: string }[];
  model?: string;
  stop_reason?: string;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

function errorFor(status: number, body: string, model: string, headers?: Headers): ProviderError {
  let type = "";
  let message = body;
  try {
    const j = JSON.parse(body) as ClaudeResponse;
    type = j.error?.type ?? "";
    message = j.error?.message ?? body;
  } catch {
    /* not JSON */
  }
  const label = extractionModelLabel(model);
  if (status === 401 || type === "authentication_error") return new ProviderError("Der Claude-API-Key wird nicht angenommen. Prüf ihn unter Einstellungen → KI-Erkennung.", "anthropic", status, "auth");
  if (/credit balance|billing|purchase credits/i.test(message) || type === "billing_error" || status === 402) return new ProviderError("Dein Anthropic-Guthaben ist aufgebraucht. Lade es unter console.anthropic.com → Billing auf.", "anthropic", status, "billing");
  if (status === 403 || type === "permission_error") return new ProviderError(`Dieser API-Key darf ${label} nicht verwenden.`, "anthropic", status, "permission");
  if (status === 404 || type === "not_found_error") return new ProviderError(`Das Modell ${label} ist für diesen API-Key nicht verfügbar.`, "anthropic", status, "not_found");
  if (status === 413 || type === "request_too_large") return new ProviderError("Die Datei ist zu groß, um sie an Claude zu senden.", "anthropic", status, "bad_request");
  if (status === 429 || type === "rate_limit_error") return new ProviderError("Gerade zu viele Anfragen an Claude – kurz warten, dann geht es weiter.", "anthropic", status, "rate_limit", retryAfterMs(headers));
  if (status === 529 || status >= 500 || type === "overloaded_error" || type === "api_error") return new ProviderError("Claude ist gerade überlastet. Bitte gleich noch einmal versuchen.", "anthropic", status, "overloaded", retryAfterMs(headers));
  return new ProviderError(`Claude hat die Anfrage abgelehnt (${status}): ${message.slice(0, 200)}`, "anthropic", status, "bad_request");
}

/**
 * Anthropic Messages API, called straight from the app with the person's own key. Structured output via
 * `output_config.format` (forced tool use is rejected by the current Sonnet/Opus models, prefill by Haiku 5.5);
 * thinking stays at the models' adaptive default, effort is set explicitly.
 */
export function createAnthropicProvider(opts: AnthropicOptions): ExtractionProvider {
  const base = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const auto = !opts.model || opts.model === CLAUDE_AUTO_MODEL;

  async function call(model: string, input: ProviderInput): Promise<ProviderResult> {
    const started = Date.now();
    const content: unknown[] = [];
    for (const img of input.images.slice(0, 4)) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: toBase64(img) } });
    }
    if (!input.images.length && input.pdf) {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(input.pdf) } });
    }
    content.push({ type: "text", text: input.prompt });
    const body = {
      model,
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: toClaudeSchema(input.schema) } },
      messages: [{ role: "user", content }],
    };
    let res: Response;
    try {
      res = await doFetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
        signal: input.signal,
      });
    } catch (e) {
      if (input.signal?.aborted || (e instanceof Error && e.name === "AbortError")) throw new ProviderError("Abgebrochen.", "anthropic", undefined, "aborted");
      throw new ProviderError("Keine Verbindung zu Anthropic. Bist du online?", "anthropic", undefined, "network");
    }
    if (!res.ok) throw errorFor(res.status, await res.text().catch(() => ""), model, res.headers);
    const json = (await res.json()) as ClaudeResponse;
    const usage = { inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens };
    if (json.stop_reason === "refusal") throw new ProviderError("Claude hat das Lesen dieser Datei abgelehnt.", "anthropic", res.status, "refusal");
    const text = (json.content ?? []).filter((c) => c.type === "text" && c.text).map((c) => c.text).join("");
    let output: AiOutput;
    try {
      output = fromClaudeOutput(parseJsonFromText(text), input.schema) as AiOutput;
    } catch {
      const why = json.stop_reason === "max_tokens" ? "Die Antwort wurde zu lang und ist abgeschnitten." : "Die Antwort war kein lesbares Ergebnis.";
      throw new ProviderError(`Claude: ${why}`, "anthropic", res.status, "invalid_output");
    }
    return { output, model: json.model ?? model, raw: text, durationMs: Date.now() - started, usage };
  }

  return {
    id: "anthropic",
    name: auto ? "Claude (automatisch)" : `Claude ${extractionModelLabel(opts.model)}`,
    cloud: true,
    async available() {
      if (!opts.apiKey) return { ok: false, reason: "Kein API-Key hinterlegt." };
      return { ok: true };
    },
    async extract(input: ProviderInput): Promise<ProviderResult> {
      if (!opts.apiKey) throw new ProviderError("Für Claude fehlt der API-Key. Trag ihn unter Einstellungen → KI-Erkennung ein.", "anthropic", undefined, "no_key");
      const threshold = opts.escalateBelow ?? 0.9;
      const judge = (o: AiOutput) => assessAiOutput(o, { threshold, checkVat: input.checkVat });
      if (!auto) {
        input.onStep?.(extractionModelLabel(opts.model));
        const r = await call(opts.model, input);
        return { ...r, attempts: [{ model: r.model, issues: judge(r.output).issues, usage: r.usage }] };
      }

      const started = Date.now();
      const attempts: ProviderAttempt[] = [];
      let first: { r: ProviderResult; a: ReturnType<typeof judge> } | undefined;
      input.onStep?.(extractionModelLabel(CLAUDE_CHEAP_MODEL));
      try {
        const r = await call(CLAUDE_CHEAP_MODEL, input);
        const a = judge(r.output);
        first = { r, a };
        attempts.push({ model: r.model, issues: a.issues, usage: r.usage });
        if (a.confident) return { ...r, attempts };
      } catch (e) {
        // Problems the stronger model cannot fix end the attempt right away.
        if (!(e instanceof ProviderError) || ["auth", "billing", "aborted", "network", "rate_limit", "overloaded", "no_key"].includes(e.code)) throw e;
        attempts.push({ model: CLAUDE_CHEAP_MODEL, issues: [], error: e.message });
      }

      input.onStep?.(`${extractionModelLabel(CLAUDE_STRONG_MODEL)} liest nach`);
      let second: { r: ProviderResult; a: ReturnType<typeof judge> };
      try {
        const r = await call(CLAUDE_STRONG_MODEL, input);
        second = { r, a: judge(r.output) };
        attempts.push({ model: r.model, issues: second.a.issues, usage: r.usage });
      } catch (e) {
        if (!first || (e instanceof ProviderError && e.code === "aborted")) throw e;
        attempts.push({ model: CLAUDE_STRONG_MODEL, issues: [], error: e instanceof Error ? e.message : String(e) });
        return { ...first.r, attempts, durationMs: Date.now() - started };
      }
      const keep = !first || preferStrong(first.a, second.a) ? second.r : first.r;
      return { ...keep, attempts, durationMs: Date.now() - started };
    },
  };
}
