import { ProviderError, codeFromStatus, parseJsonFromText, retryAfterMs, type ExtractionProvider, type ProviderInput, type ProviderResult } from "./types";
import { toBase64 } from "../../vault/crypto";

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/** OpenAI Responses API with structured output (JSON schema, strict). */
export function createOpenAiProvider(opts: OpenAiOptions): ExtractionProvider {
  const base = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  return {
    id: "openai",
    name: "OpenAI (API-Key)",
    cloud: true,
    async available() {
      if (!opts.apiKey) return { ok: false, reason: "Kein API-Key hinterlegt." };
      return { ok: true };
    },
    async extract(input: ProviderInput): Promise<ProviderResult> {
      const started = Date.now();
      const content: unknown[] = [{ type: "input_text", text: input.prompt }];
      for (const img of input.images.slice(0, 4)) {
        content.push({ type: "input_image", image_url: `data:image/png;base64,${toBase64(img)}`, detail: "high" });
      }
      if (!input.images.length && input.pdf) {
        content.push({ type: "input_file", filename: "beleg.pdf", file_data: `data:application/pdf;base64,${toBase64(input.pdf)}` });
      }
      const body = {
        model: opts.model,
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: "receipt_extraction", schema: input.schema, strict: true } },
        store: false,
      };
      const res = await fetch(`${base}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify(body),
        signal: input.signal,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new ProviderError(`OpenAI: ${res.status} ${t.slice(0, 300)}`, "openai", res.status, codeFromStatus(res.status), retryAfterMs(res.headers));
      }
      const json = (await res.json()) as { output_text?: string; output?: { type: string; content?: { type: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number }; model?: string };
      let text = json.output_text ?? "";
      if (!text && json.output) {
        for (const o of json.output) {
          if (o.type === "message" && o.content) {
            for (const c of o.content) if (c.type === "output_text" && c.text) text += c.text;
          }
        }
      }
      if (!text) throw new ProviderError("OpenAI: leere Antwort.", "openai");
      return { output: parseJsonFromText(text), model: json.model ?? opts.model, raw: text, durationMs: Date.now() - started, usage: { inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens } };
    },
  };
}
