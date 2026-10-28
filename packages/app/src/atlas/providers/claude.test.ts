import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrdoModule } from "@/modules/types";
import { buildToolset } from "../toolset";
import { createClaudeProvider, DEFAULT_CLAUDE_MODEL } from "./claude";
import type { StepInput } from "./types";

afterEach(() => vi.unstubAllGlobals());

const modules = ["basis", "summa", "projekte", "produkte", "produktion"].map((id) => ({
  id, name: id, title: id, routes: [],
})) as unknown as OrdoModule[];

function response(toolCall: boolean): Response {
  const block = toolCall
    ? { type: "tool_use", id: "tool_1", name: "search", input: {} }
    : { type: "text", text: "" };
  const events = [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: DEFAULT_CLAUDE_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: block },
    { type: "content_block_delta", index: 0, delta: toolCall ? { type: "input_json_delta", partial_json: '{"query":"Website"}' } : { type: "text_delta", text: "Hallo!" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: toolCall ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("Claude tool requests", () => {
  it.each([false, true])("handles the full toolset without grammar compilation (tool call: %s)", async (toolCall) => {
    const tools = buildToolset({ modules, role: "owner", permission: "auto" }).defs;
    expect(tools.some((tool) => tool.strict)).toBe(true);
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.tools.some((tool: { strict?: boolean }) => tool.strict)) {
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools." } }), {
          status: 400, headers: { "content-type": "application/json" },
        });
      }
      return response(toolCall);
    });
    vi.stubGlobal("fetch", fetch);
    const onText = vi.fn();
    const input: StepInput = {
      model: DEFAULT_CLAUDE_MODEL, system: "Du bist Atlas.", tools,
      history: [{ role: "user", text: "hi", toolCalls: [] } as unknown as StepInput["history"][number]],
      effort: "low", maxTokens: 1024, signal: new AbortController().signal, onText,
    };

    const result = await createClaudeProvider("test-key").step(input);

    expect(fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(sent.tools).toHaveLength(tools.length);
    expect(sent.tools.every((tool: Record<string, unknown>) => !("strict" in tool))).toBe(true);
    expect(sent.tools.map((tool: { name: string; input_schema: unknown }) => ({ name: tool.name, schema: tool.input_schema })))
      .toEqual(tools.map(({ name, schema }) => ({ name, schema })));
    if (toolCall) {
      expect(result.stop).toBe("tool_use");
      expect(result.calls).toEqual([{ id: "tool_1", name: "search", input: { query: "Website" } }]);
    } else {
      expect(result.text).toBe("Hallo!");
      expect(result.stop).toBe("end");
      expect(onText).toHaveBeenCalledWith("Hallo!");
    }
  });
});
