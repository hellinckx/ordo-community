import { ProviderError, parseJsonFromText, type ExtractionProvider, type ProviderInput, type ProviderResult } from "./types";
import { toBase64 } from "../../vault/crypto";

export interface OllamaOptions {
  url: string;
  model: string;
}

/** Local Ollama vision model (e.g. qwen3-vl, llama3.2-vision, gemma3) – fully offline. */
export function createOllamaProvider(opts: OllamaOptions): ExtractionProvider {
  const base = opts.url.replace(/\/$/, "");
  return {
    id: "ollama",
    name: "Ollama (lokal)",
    cloud: false,
    async available() {
      try {
        const res = await fetch(`${base}/api/tags`);
        if (!res.ok) return { ok: false, reason: `Ollama antwortet mit ${res.status}` };
        const json = (await res.json()) as { models?: { name: string }[] };
        const has = json.models?.some((m) => m.name === opts.model || m.name.startsWith(opts.model + ":") || m.name.split(":")[0] === opts.model.split(":")[0]);
        return has ? { ok: true } : { ok: false, reason: `Modell „${opts.model}“ nicht installiert (ollama pull ${opts.model}).`, detail: json.models?.map((m) => m.name).join(", ") };
      } catch (e) {
        return { ok: false, reason: `Ollama nicht erreichbar unter ${base} (${e instanceof Error ? e.message : String(e)}).` };
      }
    },
    async extract(input: ProviderInput): Promise<ProviderResult> {
      const started = Date.now();
      const body = {
        model: opts.model,
        stream: false,
        format: input.schema,
        options: { temperature: 0 },
        messages: [{ role: "user", content: input.prompt, images: input.images.slice(0, 3).map(toBase64) }],
      };
      const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: input.signal });
      if (!res.ok) throw new ProviderError(`Ollama: ${res.status} ${(await res.text()).slice(0, 300)}`, "ollama", res.status);
      const json = (await res.json()) as { message?: { content?: string }; model?: string; prompt_eval_count?: number; eval_count?: number };
      const text = json.message?.content ?? "";
      if (!text) throw new ProviderError("Ollama: leere Antwort.", "ollama");
      return { output: parseJsonFromText(text), model: json.model ?? opts.model, raw: text, durationMs: Date.now() - started, usage: { inputTokens: json.prompt_eval_count, outputTokens: json.eval_count } };
    },
  };
}
