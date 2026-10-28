import { describe, expect, it } from "vitest";
import type { Vault } from "@ordo/core";
import type { AtlasTool } from "./tools";
import type { RunState } from "./engine";
import { activeAtlasRuns, workAreaFor } from "./activity";

describe("Atlas activity outside the chat", () => {
  const tool = (atlasArea?: AtlasTool["atlasArea"]) => ({ atlasArea } as AtlasTool);
  it("uses the actual collection rather than an unrelated or untrusted page suggestion", () => {
    expect(workAreaFor(tool("bookkeeping"), { collection: "assets", path: "https://example.com" })).toEqual({ label: "Anlagen", path: "/anlagen" });
    expect(workAreaFor(tool("incoming"), { collection: "contacts" })?.path).toBe("/kontakte");
  });
  it("falls back to the tool's declared area and does not invent an unknown location", () => {
    expect(workAreaFor(tool("bank"), null)).toEqual({ label: "Kontoauszüge", path: "/bank" });
    expect(workAreaFor(undefined, { collection: "assets" })).toBeUndefined();
    expect(workAreaFor(tool(), { collection: "unknown", path: "/admin" })).toBeUndefined();
  });
  it("only shows active conversations in the current vault and profile", () => {
    const vault = { activeProfileId: "private", atlasChats: [
      { id: "running", profileId: "private", title: "Aktiv" },
      { id: "waiting", profileId: "private", title: "Freigabe" },
      { id: "other", profileId: "business" },
      { id: "deleted", profileId: "private", deletedAt: "2026-10-27" },
      { id: "idle", profileId: "private" },
    ] } as unknown as Vault;
    const runs = Object.fromEntries(["running", "waiting", "other", "deleted", "idle", "orphan"].map((id) => [id, { status: id === "waiting" ? "awaiting" : id === "idle" ? "idle" : "running", text: "", startedAt: id === "waiting" ? 20 : 10 }])) as Record<string, RunState>;
    expect(activeAtlasRuns(vault, runs).map(({ chat }) => chat.id)).toEqual(["waiting", "running"]);
    expect(activeAtlasRuns(null, runs)).toEqual([]);
  });
});
