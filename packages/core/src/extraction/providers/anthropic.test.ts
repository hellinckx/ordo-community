import { describe, expect, it, vi } from "vitest";
import { createAnthropicProvider, fromClaudeOutput, toClaudeSchema } from "./anthropic";
import { ProviderError, type ProviderInput } from "./types";
import { AI_OUTPUT_SCHEMA, type AiOutput } from "../schema";
import { aiOutput } from "../aiOutput.fixture";

type Call = { url: string; body: Record<string, unknown> };

/** A fake Messages API: answers per model, records every request. No network. */
function fakeFetch(answers: Record<string, AiOutput | { status: number; body?: unknown; headers?: Record<string, string> } | Error>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    const a = answers[body.model as string];
    if (!a) throw new Error(`unexpected model ${String(body.model)}`);
    if (a instanceof Error) throw a;
    if ("status" in a && typeof a.status === "number") {
      return new Response(JSON.stringify(a.body ?? { type: "error", error: { type: "x", message: "nope" } }), { status: a.status, headers: a.headers });
    }
    const text = JSON.stringify(a);
    return new Response(JSON.stringify({ model: body.model, stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 4000, output_tokens: 900 } }), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const input = (): ProviderInput => ({ prompt: "Lies die Rechnung.", schema: AI_OUTPUT_SCHEMA, images: [new Uint8Array([1, 2, 3])], checkVat: true });
const unsure = aiOutput({ gross_total: null, confidence: { overall: 0.6, vendor_name: 0.9, invoice_date: 0.9, gross_total: 0.2, vat_lines: 0.5, invoice_number: 0.5 } });

describe("Claude schema dialect", () => {
  /** Union-typed and optional parameters, counted the way Claude's structured-output limits do. */
  function complexity(node: unknown): { unions: number; optional: number } {
    let unions = 0;
    let optional = 0;
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const o = n as Record<string, unknown>;
      if (o.properties) {
        const req = new Set((o.required as string[]) ?? []);
        for (const [k, v] of Object.entries(o.properties as Record<string, Record<string, unknown>>)) {
          if (!req.has(k)) optional++;
          if (Array.isArray(v.type) || Array.isArray(v.anyOf)) unions++;
          walk(v);
        }
      }
      if (o.items) walk(o.items);
    };
    walk(node);
    return { unions, optional };
  }

  it("sends no union types at all and stays inside Claude's limits (16 unions, 24 optional)", () => {
    const s = toClaudeSchema(AI_OUTPUT_SCHEMA) as { properties: Record<string, Record<string, unknown>>; required: string[] };
    const c = complexity(s);
    expect(c.unions).toBe(0);
    expect(c.optional).toBeLessThanOrEqual(24);
    expect(JSON.stringify(s)).not.toContain('"null"');
    // nullable text → required string where "" means missing
    expect(s.properties.vendor_name).toMatchObject({ type: "string" });
    expect(String(s.properties.vendor_name!.description)).toContain('""');
    expect(s.required).toContain("vendor_name");
    // nullable number / enum → optional, without null
    expect(s.properties.gross_total).toMatchObject({ type: "number" });
    expect(s.required).not.toContain("gross_total");
    expect(s.properties.payment_method).toMatchObject({ type: "string", enum: ["bank", "cash", "card", "paypal", "direct_debit", "other"] });
    const line = (s.properties.vat_lines as { items: { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean } }).items;
    expect(line.required).toEqual(["rate"]);
    expect(line.additionalProperties).toBe(false);
  });

  it("turns the answer back into the nullable shape", () => {
    const answer = { ...aiOutput({}), vendor_name: "", invoice_number: "RE-1", gross_total: undefined, vat_lines: [{ rate: 20, net: 10 }], line_items: [{ description: "", total: 12 }] } as unknown;
    const back = fromClaudeOutput(answer, AI_OUTPUT_SCHEMA) as AiOutput;
    expect(back.vendor_name).toBeNull();
    expect(back.invoice_number).toBe("RE-1");
    expect(back.gross_total).toBeNull();
    expect(back.vat_lines[0]).toEqual({ rate: 20, net: 10, vat: null });
    expect(back.line_items[0]).toEqual({ description: null, quantity: null, unit_price: null, total: 12, vat_rate: null });
  });
});

describe("Claude provider", () => {
  it("sends the image with structured output, no forced tool, no prefill", async () => {
    const f = fakeFetch({ "claude-sonnet-5-5": aiOutput() });
    const p = createAnthropicProvider({ apiKey: "test-key", model: "claude-sonnet-5-5", fetchImpl: f.impl });
    const r = await p.extract(input());
    expect(r.output.gross_total).toBe(120);
    expect(r.model).toBe("claude-sonnet-5-5");
    const b = f.calls[0]!.body;
    expect(f.calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(b.tools).toBeUndefined();
    expect(b.tool_choice).toBeUndefined();
    expect(b.thinking).toBeUndefined();
    expect((b.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    const msgs = b.messages as { role: string; content: { type: string }[] }[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[0]!.content.map((c) => c.type)).toEqual(["image", "text"]);
  });

  it("auto: keeps Haiku when it is sure", async () => {
    const f = fakeFetch({ "claude-haiku-5-5": aiOutput() });
    const steps: string[] = [];
    const p = createAnthropicProvider({ apiKey: "k", model: "auto", fetchImpl: f.impl });
    const r = await p.extract({ ...input(), onStep: (s) => steps.push(s) });
    expect(r.model).toBe("claude-haiku-5-5");
    expect(f.calls).toHaveLength(1);
    expect(r.attempts).toHaveLength(1);
    expect(steps).toEqual(["Haiku 5.5"]);
  });

  it("auto: asks Opus when Haiku is unsure and keeps the better answer", async () => {
    const f = fakeFetch({ "claude-haiku-5-5": unsure, "claude-opus-5-5": aiOutput() });
    const steps: string[] = [];
    const p = createAnthropicProvider({ apiKey: "k", model: "auto", fetchImpl: f.impl });
    const r = await p.extract({ ...input(), onStep: (s) => steps.push(s) });
    expect(f.calls.map((c) => c.body.model)).toEqual(["claude-haiku-5-5", "claude-opus-5-5"]);
    expect(r.model).toBe("claude-opus-5-5");
    expect(r.output.gross_total).toBe(120);
    expect(r.attempts!.map((a) => a.model)).toEqual(["claude-haiku-5-5", "claude-opus-5-5"]);
    expect(r.attempts![0]!.issues).toContain("Betrag fehlt");
    expect(r.attempts![1]!.usage).toEqual({ inputTokens: 4000, outputTokens: 900 });
    expect(steps).toEqual(["Haiku 5.5", "Opus 5.5 liest nach"]);
  });

  it("auto: keeps Haiku's answer when Opus is worse or fails", async () => {
    const worse = aiOutput({ gross_total: null, invoice_date: null, vendor_name: null, net_total: null, vat_total: null, vat_lines: [], confidence: { overall: 0.3, vendor_name: 0, invoice_date: 0, gross_total: 0, vat_lines: 0.3, invoice_number: 0 } });
    const f1 = fakeFetch({ "claude-haiku-5-5": unsure, "claude-opus-5-5": worse });
    expect((await createAnthropicProvider({ apiKey: "k", model: "auto", fetchImpl: f1.impl }).extract(input())).model).toBe("claude-haiku-5-5");
    const f2 = fakeFetch({ "claude-haiku-5-5": unsure, "claude-opus-5-5": { status: 500 } });
    const r = await createAnthropicProvider({ apiKey: "k", model: "auto", fetchImpl: f2.impl }).extract(input());
    expect(r.model).toBe("claude-haiku-5-5");
    expect(r.attempts![1]!.error).toMatch(/überlastet/);
  });

  it("auto: an unusable Haiku answer goes straight to Opus", async () => {
    const f = fakeFetch({ "claude-haiku-5-5": { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "bad image" } } }, "claude-opus-5-5": aiOutput() });
    const r = await createAnthropicProvider({ apiKey: "k", model: "auto", fetchImpl: f.impl }).extract(input());
    expect(r.model).toBe("claude-opus-5-5");
  });

  it("auto: does not escalate problems Opus cannot fix", async () => {
    const f = fakeFetch({ "claude-haiku-5-5": { status: 401 } });
    await expect(createAnthropicProvider({ apiKey: "k", model: "auto", fetchImpl: f.impl }).extract(input())).rejects.toMatchObject({ code: "auth" });
    expect(f.calls).toHaveLength(1);
  });

  it("maps errors to plain German with a code", async () => {
    const cases: [unknown, string, RegExp][] = [
      [{ status: 401 }, "auth", /API-Key wird nicht angenommen/],
      [{ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } } }, "billing", /Guthaben/],
      [{ status: 404 }, "not_found", /Haiku 5.5/],
      [{ status: 429, headers: { "retry-after": "12" } }, "rate_limit", /zu viele Anfragen/],
      [{ status: 529 }, "overloaded", /überlastet/],
      [new TypeError("Failed to fetch"), "network", /Bist du online/],
    ];
    for (const [answer, code, msg] of cases) {
      const f = fakeFetch({ "claude-haiku-5-5": answer as never });
      const err = await createAnthropicProvider({ apiKey: "k", model: "claude-haiku-5-5", fetchImpl: f.impl }).extract(input()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe(code);
      expect((err as ProviderError).message).toMatch(msg);
      if (code === "rate_limit") expect((err as ProviderError).retryAfterMs).toBe(12000);
    }
  });

  it("reports a missing key without calling the API", async () => {
    const f = fakeFetch({});
    await expect(createAnthropicProvider({ apiKey: "", model: "auto", fetchImpl: f.impl }).extract(input())).rejects.toMatchObject({ code: "no_key" });
    expect(f.calls).toHaveLength(0);
  });

  it("treats a refusal and broken JSON as errors", async () => {
    const refusal = vi.fn(async () => new Response(JSON.stringify({ model: "claude-haiku-5-5", stop_reason: "refusal", content: [] }), { status: 200 }));
    await expect(createAnthropicProvider({ apiKey: "k", model: "claude-haiku-5-5", fetchImpl: refusal as unknown as typeof fetch }).extract(input())).rejects.toMatchObject({ code: "refusal" });
    const cut = vi.fn(async () => new Response(JSON.stringify({ model: "claude-haiku-5-5", stop_reason: "max_tokens", content: [{ type: "text", text: '{"vendor_name": "Bil' }] }), { status: 200 }));
    await expect(createAnthropicProvider({ apiKey: "k", model: "claude-haiku-5-5", fetchImpl: cut as unknown as typeof fetch }).extract(input())).rejects.toMatchObject({ code: "invalid_output" });
  });
});
