import { CODEX_AGENT_SCHEMA, parseCodexAgentStep, type AtlasMessage, type CodexBridge } from "@ordo/core";
import { AtlasProviderError, type AssistantRaw, type AtlasProvider, type StepInput, type StepResult, type UserRaw } from "./types";

const MAX_RESULT = 6_000;
const MAX_TRANSCRIPT = 140_000;

function toolCatalogue(input: StepInput): string {
  return input.tools.map((t) => `### ${t.name}${t.kind === "write" ? " (ändert Daten)" : ""}\n${t.description}\nEingabe (JSON-Schema): ${JSON.stringify(t.schema)}`).join("\n\n");
}

/** Renders the stored conversation as plain text for a stateless `codex exec` run. */
function transcript(history: AtlasMessage[]): string {
  const parts: string[] = [];
  for (const m of history) {
    if (m.role === "user") {
      const raw = (m.raw ?? {}) as UserRaw;
      parts.push(`### Person\n${raw.context ? raw.context + "\n" : ""}${m.text}`);
    } else if (m.role === "assistant") {
      if (((m.raw ?? {}) as AssistantRaw).local) continue;
      const calls = m.toolCalls.map((c) => `→ Werkzeug ${c.name} ${JSON.stringify(c.input ?? {})} (id ${c.id})`).join("\n");
      parts.push(`### Atlas\n${[m.text, calls].filter(Boolean).join("\n") || "(keine Antwort)"}`);
    } else if (m.role === "tool") {
      const text = m.text.length > MAX_RESULT ? m.text.slice(0, MAX_RESULT) + " …(gekürzt)" : m.text;
      parts.push(`### Ergebnis ${m.toolCallId ?? ""}\n${text}`);
    }
  }
  // Keep the newest part of long conversations.
  let total = parts.reduce((s, p) => s + p.length, 0);
  while (total > MAX_TRANSCRIPT && parts.length > 2) total -= parts.shift()!.length;
  return parts.join("\n\n");
}

export function codexPrompt(input: StepInput): string {
  return `${input.system}

## Werkzeuge
Du führst Werkzeuge nicht selbst aus. Fordere sie in "tool_calls" an; Ordo führt sie aus und ruft dich danach mit den Ergebnissen erneut auf. Du hast keine Shell und keine Dateien – führe keine Befehle aus und lies nichts von der Festplatte.

${toolCatalogue(input)}

## Antwortformat
Antworte mit genau einem JSON-Objekt: {"reply": string oder null, "tool_calls": [{"name": "...", "arguments_json": "{...}"}]}.
- Brauchst du Daten oder willst du etwas ändern: tool_calls füllen; reply ist null oder ein kurzer Satz, was du gerade tust.
- Bist du fertig: reply enthält die Antwort an die Person (Markdown), tool_calls ist leer.
- arguments_json ist ein JSON-Objekt als Text und folgt dem Eingabe-Schema des Werkzeugs.

## Gespräch bisher
${transcript(input.history)}

## Deine nächste Antwort (nur das JSON-Objekt)`;
}

let seq = 0;

export function createCodexProvider(bridge: CodexBridge | undefined): AtlasProvider {
  return {
    id: "codex",
    async step(input: StepInput): Promise<StepResult> {
      if (!bridge?.chat) throw new AtlasProviderError("ChatGPT über Codex gibt es nur in der Desktop-App.", "unavailable");
      input.onActivity?.("ChatGPT denkt nach");
      let r;
      try {
        r = await bridge.chat({ prompt: codexPrompt(input), schema: CODEX_AGENT_SCHEMA, model: input.model || undefined, reasoning: input.effort, signal: input.signal });
      } catch (e) {
        if (input.signal.aborted) throw new AtlasProviderError("Abgebrochen", "aborted", e);
        const msg = e instanceof Error ? e.message : String(e);
        if (/nicht gefunden|not found/i.test(msg)) throw new AtlasProviderError("Die Codex-App wurde nicht gefunden. Installier sie und melde dich unter Einstellungen → Atlas mit ChatGPT an.", "unavailable", e);
        if (/log ?in|anmeld|auth/i.test(msg)) throw new AtlasProviderError("Codex ist nicht mit ChatGPT angemeldet. Melde dich unter Einstellungen → Atlas an.", "auth", e);
        throw new AtlasProviderError(`Codex meldet einen Fehler: ${msg}`, "other", e);
      }
      const step = parseCodexAgentStep(r.text);
      const calls = step.toolCalls.map((c) => ({ id: `call_${Date.now().toString(36)}_${(seq++).toString(36)}`, name: c.name, input: c.arguments ?? {}, ...(c.error ? { invalid: c.error } : {}) }));
      const text = (step.reply ?? "").trim();
      if (text) input.onText(text);
      const raw: AssistantRaw = { provider: "codex", effort: input.effort };
      return { text, calls, raw, model: r.model || input.model || "codex", stop: calls.length ? "tool_use" : "end", usage: { input: r.usage?.inputTokens, output: r.usage?.outputTokens } };
    },
  };
}
