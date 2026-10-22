import type { AtlasMessage } from "@ordo/core";
import { AtlasProviderError, type AssistantRaw, type AtlasProvider, type StepCall, type StepInput, type StepResult, type ToolRaw, type UserRaw } from "./types";
import { TOOL_LABELS } from "../toolset";

const BASE = "https://api.openai.com/v1";

/** Responses API input items Atlas uses (messages, its own function calls and their results). */
type InputItem =
  | { role: "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

interface OutputItem {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type: string; text?: string; refusal?: string }[];
}

/** Translates the stored transcript into Responses API input items. */
export function toOpenAiInput(history: AtlasMessage[]): InputItem[] {
  const out: InputItem[] = [];
  // Calls of other providers' turns are folded into text, so ids never need to line up.
  const foreignCalls = new Set<string>();
  let open: string[] = [];
  const closeOpen = () => {
    for (const id of open) out.push({ type: "function_call_output", call_id: id, output: '{"error":"Nicht ausgeführt"}' });
    open = [];
  };
  for (const m of history) {
    if (m.role === "user") {
      closeOpen();
      const raw = (m.raw ?? {}) as UserRaw;
      out.push({ role: "user", content: [raw.context, m.text || "…"].filter(Boolean).join("\n\n") });
    } else if (m.role === "assistant") {
      const raw = (m.raw ?? {}) as AssistantRaw;
      if (raw.local) continue;
      closeOpen();
      if (raw.provider === "openai" && m.toolCalls.length) {
        if (m.text) out.push({ role: "assistant", content: m.text });
        for (const c of m.toolCalls) out.push({ type: "function_call", call_id: c.id, name: c.name, arguments: JSON.stringify(c.input ?? {}) });
        open = m.toolCalls.map((c) => c.id);
      } else {
        for (const c of m.toolCalls) foreignCalls.add(c.id);
        const calls = m.toolCalls.map((c) => `[${c.name}: ${c.summary || c.status}]`).join(" ");
        const text = [m.text, calls].filter(Boolean).join("\n");
        if (text) out.push({ role: "assistant", content: text });
      }
    } else if (m.role === "tool" && m.toolCallId) {
      if (foreignCalls.has(m.toolCallId) || !open.includes(m.toolCallId)) continue;
      open = open.filter((id) => id !== m.toolCallId);
      const raw = (m.raw ?? {}) as ToolRaw;
      out.push({ type: "function_call_output", call_id: m.toolCallId, output: raw.isError ? JSON.stringify({ error: m.text }) : m.text || "{}" });
    }
  }
  closeOpen();
  while (out.length && !("role" in out[0]! && out[0].role === "user")) out.shift();
  return out;
}

function errorFor(status: number, body: string): AtlasProviderError {
  let msg = body.slice(0, 300);
  try {
    msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? msg;
  } catch {
    /* plain text */
  }
  if (status === 401) return new AtlasProviderError("Der OpenAI-API-Key wird nicht angenommen. Prüf ihn unter Einstellungen → Atlas.", "auth");
  if (status === 403) return new AtlasProviderError(`Dieser OpenAI-Key darf das gewählte Modell nicht verwenden: ${msg}`, "permission");
  if (status === 404) return new AtlasProviderError("Das gewählte OpenAI-Modell gibt es für diesen Schlüssel nicht. Wähl unter Einstellungen → Atlas ein anderes.", "not_found");
  if (status === 429) return new AtlasProviderError(/quota|billing/i.test(msg) ? "Dein OpenAI-Guthaben ist aufgebraucht. Lade es auf platform.openai.com auf." : "Gerade zu viele Anfragen an OpenAI. Versuch es in einer Minute noch einmal.", "rate");
  if (status >= 500) return new AtlasProviderError("OpenAI ist gerade überlastet. Versuch es gleich noch einmal.", "overloaded");
  return new AtlasProviderError(`OpenAI hat die Anfrage abgelehnt: ${msg}`, "bad_request");
}

/** Atlas with the person's own OpenAI API key: Responses API with function tools, straight from the app to OpenAI. */
export function createOpenAiProvider(apiKey: string): AtlasProvider {
  return {
    id: "openai",
    async step(input: StepInput): Promise<StepResult> {
      input.onActivity?.("Denkt nach");
      const body = {
        model: input.model,
        instructions: input.system,
        input: toOpenAiInput(input.history),
        tools: input.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.schema, strict: false })),
        reasoning: { effort: input.effort },
        max_output_tokens: input.maxTokens,
        store: false,
      };
      let res: Response;
      try {
        res = await fetch(`${BASE}/responses`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: input.signal });
      } catch (e) {
        if (input.signal.aborted) throw new AtlasProviderError("Abgebrochen", "aborted", e);
        throw new AtlasProviderError("Keine Verbindung zu OpenAI. Bist du online?", "network", e);
      }
      if (!res.ok) throw errorFor(res.status, await res.text());
      const json = (await res.json()) as { model?: string; status?: string; incomplete_details?: { reason?: string }; output?: OutputItem[]; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } };
      const output = json.output ?? [];
      let text = "";
      let refusal = "";
      const calls: StepCall[] = [];
      for (const item of output) {
        if (item.type === "message") {
          for (const c of item.content ?? []) {
            if (c.type === "output_text" && c.text) text += (text ? "\n\n" : "") + c.text;
            if (c.type === "refusal" && c.refusal) refusal = c.refusal;
          }
        } else if (item.type === "function_call" && item.call_id && item.name) {
          input.onActivity?.(TOOL_LABELS[item.name] ?? item.name);
          try {
            calls.push({ id: item.call_id, name: item.name, input: item.arguments ? JSON.parse(item.arguments) : {} });
          } catch {
            calls.push({ id: item.call_id, name: item.name, input: {}, invalid: "Die Eingabe war kein gültiges JSON." });
          }
        }
      }
      text = text.trim();
      if (text) input.onText(text);
      const usage = { input: json.usage?.input_tokens, output: json.usage?.output_tokens, cacheRead: json.usage?.input_tokens_details?.cached_tokens };
      const model = json.model ?? input.model;
      if (refusal && !text && !calls.length) return { text: "", calls: [], model, stop: "refusal", refusal, usage };
      const stop: StepResult["stop"] = json.status === "incomplete" && json.incomplete_details?.reason === "max_output_tokens" ? "max_tokens" : calls.length ? "tool_use" : "end";
      const raw: AssistantRaw = { provider: "openai", effort: input.effort };
      return { text, calls, raw, model, stop, usage };
    },
  };
}

/** Checks the key and lists the chat models it may use (Einstellungen → "Schlüssel prüfen"). */
export async function checkOpenAiKey(apiKey: string): Promise<{ ok: boolean; message: string; models: string[] }> {
  try {
    const res = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return { ok: false, message: errorFor(res.status, await res.text()).message, models: [] };
    const json = (await res.json()) as { data?: { id: string }[] };
    const models = (json.data ?? [])
      .map((m) => m.id)
      .filter((id) => /^(gpt-|o\d)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(id))
      .sort()
      .reverse();
    return { ok: true, message: `Verbunden – ${models.length} Modelle verfügbar.`, models };
  } catch {
    return { ok: false, message: "Keine Verbindung zu OpenAI. Bist du online?", models: [] };
  }
}
