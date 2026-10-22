import { describe, expect, it } from "vitest";
import { CODEX_AGENT_SCHEMA, parseCodexAgentStep } from "./codex";

describe("Atlas over Codex – JSON protocol", () => {
  it("schema follows the OpenAI structured-output rules", () => {
    expect(CODEX_AGENT_SCHEMA.required).toEqual(["reply", "tool_calls"]);
    expect(CODEX_AGENT_SCHEMA.additionalProperties).toBe(false);
    expect(CODEX_AGENT_SCHEMA.properties.tool_calls.items.required).toEqual(["name", "arguments_json"]);
    expect(CODEX_AGENT_SCHEMA.properties.tool_calls.items.additionalProperties).toBe(false);
  });

  it("reads a final reply", () => {
    expect(parseCodexAgentStep('{"reply":"Alles erledigt.","tool_calls":[]}')).toEqual({ reply: "Alles erledigt.", toolCalls: [] });
  });

  it("reads tool calls with JSON arguments", () => {
    const r = parseCodexAgentStep('```json\n{"reply":null,"tool_calls":[{"name":"search","arguments_json":"{\\"query\\":\\"Website\\"}"}]}\n```');
    expect(r.reply).toBeNull();
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]!.name).toBe("search");
    expect(r.toolCalls[0]!.arguments).toEqual({ query: "Website" });
  });

  it("flags broken arguments instead of throwing", () => {
    const r = parseCodexAgentStep('{"reply":null,"tool_calls":[{"name":"log_time","arguments_json":"{hours: 2"},{"name":"x","arguments_json":"[1]"}]}');
    expect(r.toolCalls[0]!.error).toBeTruthy();
    expect(r.toolCalls[0]!.arguments).toBeUndefined();
    expect(r.toolCalls[1]!.error).toBeTruthy();
  });

  it("falls back to plain text when no JSON came back", () => {
    expect(parseCodexAgentStep("Hallo, wie kann ich helfen?")).toEqual({ reply: "Hallo, wie kann ich helfen?", toolCalls: [] });
  });

  it("treats empty arguments as an empty object and skips nameless calls", () => {
    const r = parseCodexAgentStep('{"reply":"","tool_calls":[{"name":"describe_workspace","arguments_json":""},{"name":"","arguments_json":"{}"}]}');
    expect(r.reply).toBeNull();
    expect(r.toolCalls).toEqual([{ name: "describe_workspace", raw: "", arguments: {} }]);
  });
});
