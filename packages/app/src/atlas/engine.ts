import { create } from "zustand";
import { ids, nowIso, todayIso, type AtlasChat, type AtlasMessage, type Role, type VaultStore } from "@ordo/core";
import { useSession } from "@/state/session";
import { useSync } from "@/services/sync";
import { recordAiUsage } from "@/services/aiUsage";
import { ALL_MODULES, isAllowed, isInstalled } from "@/modules/registry";
import type { OrdoModule } from "@/modules/types";
import { isTauri } from "@/platform";
import type { AtlasVisual } from "./tools";
import { areaLevels, buildToolset, previewCall, runTool, toolContext, type AtlasPermission, type Toolset } from "./toolset";
import { ATLAS_AREAS, areaSetting } from "./areas";
import { systemPrompt, turnContext } from "./prompt";
import { maxTokensFor, route, type Route } from "./router";
import { createClaudeProvider } from "./providers/claude";
import { createCodexProvider } from "./providers/codex";
import { AtlasProviderError, type AssistantRaw, type AtlasProvider, type StepResult, type ToolRaw, type UserRaw } from "./providers/types";

/* ------------------------------------------------------------------ */
/* Live state of running turns (not persisted)                         */
/* ------------------------------------------------------------------ */

export interface RunState {
  status: "running" | "awaiting" | "idle";
  /** Streaming text of the step in progress. */
  text: string;
  activity?: string;
  route?: Route;
  error?: string;
  /** Tool call currently executing. */
  activeCallId?: string;
}

interface RunsStore {
  runs: Record<string, RunState>;
  patch(chatId: string, p: Partial<RunState>): void;
}

export const useAtlasRuns = create<RunsStore>((set) => ({
  runs: {},
  patch: (chatId, p) => set((s) => ({ runs: { ...s.runs, [chatId]: { ...(s.runs[chatId] ?? { status: "idle", text: "" }), ...p } } })),
}));

const patchRun = (chatId: string, p: Partial<RunState>) => useAtlasRuns.getState().patch(chatId, p);
const controllers = new Map<string, AbortController>();

/* ------------------------------------------------------------------ */
/* Where the app is (set by the launcher, which lives inside the router) */
/* ------------------------------------------------------------------ */

let navigateFn: (to: string) => void = () => undefined;
let currentPath = "/";

export function bindNavigation(navigate: (to: string) => void, path: string) {
  navigateFn = navigate;
  currentPath = path;
}

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

export type Readiness =
  | { ok: true; provider: "claude" | "codex" }
  | { ok: false; reason: "off" | "consent" | "key" | "desktop" | "locked"; message: string };

interface Env {
  store: VaultStore;
  modules: OrdoModule[];
  role: Role;
  permission: AtlasPermission;
  /** Per-area access from Einstellungen → Atlas. */
  areas: Record<string, string>;
}

function currentEnv(): Env {
  const store = useSession.getState().store;
  if (!store) throw new AtlasProviderError("Der Tresor ist gesperrt.", "other");
  const v = store.vault;
  const access = useSync.getState().moduleAccess;
  const modules = ALL_MODULES.filter((m) => isInstalled(v.settings, m) && isAllowed(access, m.id));
  const member = v.members.find((m) => m.id === v.settings.meMemberId && !m.deletedAt);
  return { store, modules, role: member?.role ?? "owner", permission: v.settings.atlas.permission, areas: v.settings.atlas.areas ?? {} };
}

/**
 * Areas of the installed modules the owner closed or set to read-only for Atlas (only the settings – role limits are
 * already part of the context line "Rolle"). Goes into the per-message context block, never into the system prompt.
 */
function areaSummary(env: Env): { locked: string[]; readOnly: string[] } {
  const ids = new Set(env.modules.map((m) => m.id));
  const levels = areaLevels(env);
  const locked: string[] = [];
  const readOnly: string[] = [];
  for (const a of ATLAS_AREAS) {
    if (!ids.has(a.module)) continue;
    const set = areaSetting(env.areas, a.id);
    if (set === "none") locked.push(a.label);
    else if (set === "read" && env.permission !== "read" && levels[a.id] === "read") readOnly.push(a.label);
  }
  return { locked, readOnly };
}

/** Whether Atlas can answer right now, and what to fix if not. */
export function readiness(): Readiness {
  const s = useSession.getState();
  const v = s.store?.vault;
  if (!v) return { ok: false, reason: "locked", message: "Der Tresor ist gesperrt." };
  const a = v.settings.atlas;
  if (a.provider === "none") return { ok: false, reason: "off", message: "Atlas ist noch nicht eingerichtet. Wähl unter Einstellungen → Atlas einen KI-Anbieter." };
  if (a.provider === "codex" && (!isTauri || !s.platform?.codex?.chat)) return { ok: false, reason: "desktop", message: "ChatGPT über Codex gibt es nur in der Desktop-App. Hier im Browser geht Atlas mit Claude (API-Key)." };
  if (a.provider === "claude" && !v.settings.ai.anthropicApiKey.trim()) return { ok: false, reason: "key", message: "Für Claude fehlt noch der API-Key (console.anthropic.com)." };
  if (!a.consent) return { ok: false, reason: "consent", message: "Atlas braucht deine Einwilligung, die nötigen Daten an den KI-Anbieter zu senden." };
  return { ok: true, provider: a.provider };
}

function providerFor(r: Route, store: VaultStore): AtlasProvider {
  if (r.provider === "claude") return createClaudeProvider(store.vault.settings.ai.anthropicApiKey.trim());
  return createCodexProvider(useSession.getState().platform?.codex);
}

/* ------------------------------------------------------------------ */
/* Chats                                                               */
/* ------------------------------------------------------------------ */

function store(): VaultStore {
  const s = useSession.getState().store;
  if (!s) throw new AtlasProviderError("Der Tresor ist gesperrt.", "other");
  return s;
}

export function getChat(chatId: string): AtlasChat | undefined {
  return useSession.getState().store?.vault.atlasChats.find((c) => c.id === chatId && !c.deletedAt);
}

export function createChat(): AtlasChat {
  const s = store();
  const now = nowIso();
  const chat: AtlasChat = { id: ids.chat(), createdAt: now, updatedAt: now, title: "Neues Gespräch", profileId: s.activeProfile.id, messages: [], pinned: false };
  s.insert("atlasChats", chat, "atlas.chat");
  return chat;
}

function updateChat(chatId: string, fn: (c: AtlasChat) => AtlasChat) {
  store().update("atlasChats", chatId, fn, "atlas.message");
}

function append(chatId: string, ...msgs: AtlasMessage[]) {
  updateChat(chatId, (c) => ({ ...c, messages: [...c.messages, ...msgs] }));
}

function setCall(chatId: string, callId: string, patch: Partial<AtlasMessage["toolCalls"][number]>) {
  updateChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.toolCalls.some((t) => t.id === callId) ? { ...m, toolCalls: m.toolCalls.map((t) => (t.id === callId ? { ...t, ...patch } : t)) } : m)) }));
}

export function renameChat(chatId: string, title: string) {
  updateChat(chatId, (c) => ({ ...c, title: title.trim() || c.title }));
}

export function pinChat(chatId: string, pinned: boolean) {
  updateChat(chatId, (c) => ({ ...c, pinned }));
}

export function deleteChat(chatId: string) {
  stop(chatId);
  store().softDelete("atlasChats", chatId, "atlas.chat.delete");
}

const msg = (role: AtlasMessage["role"], text: string, extra: Partial<AtlasMessage> = {}): AtlasMessage => ({ id: ids.message(), role, text, at: nowIso(), toolCalls: [], visuals: [], ...extra });

/** A note shown in the chat but never sent to the model. */
const note = (text: string): AtlasMessage => msg("assistant", text, { raw: { local: true } satisfies AssistantRaw });

/* ------------------------------------------------------------------ */
/* Turns                                                               */
/* ------------------------------------------------------------------ */

const MAX_STEPS = 14;

export function isBusy(chatId: string): boolean {
  return controllers.has(chatId);
}

/** Sends a message (creating the chat if needed) and runs Atlas. Returns the chat id. */
export async function sendMessage(chatId: string | undefined, text: string): Promise<string> {
  const t = text.trim();
  if (!t) throw new Error("Leere Nachricht");
  const id = chatId && getChat(chatId) ? chatId : createChat().id;
  if (isBusy(id)) return id;
  denyPending(id, "Die Person hat stattdessen eine neue Nachricht geschrieben.");
  const env = currentEnv();
  const vault = env.store.vault;
  const member = vault.members.find((m) => m.id === vault.settings.meMemberId && !m.deletedAt);
  const context = turnContext({ today: todayIso(), profile: env.store.activeProfile, member, role: env.role, permission: env.permission, page: currentPath, areas: areaSummary(env) });
  const chat = getChat(id)!;
  const isFirst = !chat.messages.some((m) => m.role === "user");
  updateChat(id, (c) => ({ ...c, title: isFirst ? titleFrom(t) : c.title, messages: [...c.messages, msg("user", t, { raw: { context } satisfies UserRaw })] }));
  void runLoop(id);
  return id;
}

function titleFrom(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 56 ? one.slice(0, 54).trimEnd() + " …" : one;
}

/** Runs the agent loop again after an error. */
export function retry(chatId: string) {
  if (isBusy(chatId)) return;
  patchRun(chatId, { error: undefined });
  void runLoop(chatId);
}

export function stop(chatId: string) {
  const ctl = controllers.get(chatId);
  if (ctl) ctl.abort();
  else if (useAtlasRuns.getState().runs[chatId]?.status === "awaiting") {
    denyPending(chatId, "Die Person hat abgebrochen.");
    patchRun(chatId, { status: "idle" });
  }
}

function pendingCalls(chat: AtlasChat) {
  return chat.messages.flatMap((m) => m.toolCalls.filter((t) => t.status === "pending"));
}

function denyPending(chatId: string, reason: string) {
  const chat = getChat(chatId);
  if (!chat) return;
  for (const call of pendingCalls(chat)) {
    setCall(chatId, call.id, { status: "denied", summary: `Abgebrochen: ${call.summary}` });
    append(chatId, msg("tool", JSON.stringify({ denied: true, message: reason }), { toolCallId: call.id, raw: { isError: false } satisfies ToolRaw }));
  }
}

/** Ausführen / Abbrechen on a confirmation card. */
export async function decideCall(chatId: string, callId: string, approve: boolean) {
  const chat = getChat(chatId);
  const call = chat?.messages.flatMap((m) => m.toolCalls).find((t) => t.id === callId);
  if (!chat || !call || call.status !== "pending") return;
  if (approve) {
    const env = currentEnv();
    const toolset = buildToolset({ modules: env.modules, role: env.role, permission: env.permission, areas: env.areas });
    await execute(chatId, toolset, call.id, call.name, call.input, env);
  } else {
    setCall(chatId, callId, { status: "denied", summary: `Abgelehnt: ${call.summary}` });
    append(chatId, msg("tool", JSON.stringify({ denied: true, message: "Die Person hat diese Änderung abgelehnt." }), { toolCallId: callId, raw: { isError: false } satisfies ToolRaw }));
  }
  const left = pendingCalls(getChat(chatId)!);
  if (!left.length) void runLoop(chatId);
}

async function execute(chatId: string, toolset: Toolset, callId: string, name: string, input: unknown, env: Env, invalid?: string) {
  const tool = toolset.byName.get(name);
  const ctx = toolContext(env.store, env.role, navigateFn);
  if (!tool || invalid) {
    const error = invalid ? `Eingabe nicht lesbar: ${invalid}` : `Das Werkzeug ${name} gibt es nicht oder es ist gerade nicht erlaubt.`;
    setCall(chatId, callId, { status: "error", summary: error });
    append(chatId, msg("tool", JSON.stringify({ error }), { toolCallId: callId, raw: { isError: true } satisfies ToolRaw }));
    return;
  }
  patchRun(chatId, { activeCallId: callId, activity: previewCall(tool, input, ctx) });
  const r = await runTool(tool, input, ctx);
  const visuals: AtlasVisual[] = [];
  if (r.result?.visual) visuals.push(r.result.visual);
  if (r.result?.link) visuals.push({ type: "link", to: r.result.link.to, label: r.result.link.label });
  setCall(chatId, callId, { status: r.ok ? "done" : "error", summary: r.ok ? r.result!.summary : r.error ?? "Fehler" });
  append(chatId, msg("tool", r.content, { toolCallId: callId, visuals, raw: { isError: !r.ok } satisfies ToolRaw }));
  patchRun(chatId, { activeCallId: undefined });
}

async function runLoop(chatId: string) {
  if (controllers.has(chatId)) return;
  const ctl = new AbortController();
  controllers.set(chatId, ctl);
  let streamed = "";
  try {
    const ready = readiness();
    if (!ready.ok) throw new AtlasProviderError(ready.message, "unavailable");
    const env = currentEnv();
    const chat = getChat(chatId);
    if (!chat) return;
    const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
    const r = route(env.store.vault.settings.atlas, lastUser?.text ?? "");
    patchRun(chatId, { status: "running", text: "", activity: "Denkt nach", route: r, error: undefined, activeCallId: undefined });
    const toolset = buildToolset({ modules: env.modules, role: env.role, permission: env.permission, areas: env.areas });
    const system = systemPrompt(env.modules, env.store.vault.settings.atlas.instructions);
    const provider = providerFor(r, env.store);
    let maxTokens = maxTokensFor(r.effort);
    let raised = false;
    let steps = 0;
    for (;;) {
      if (steps++ >= MAX_STEPS) {
        append(chatId, note(`Ich habe nach ${MAX_STEPS} Schritten aufgehört. Sag mir, ob ich weitermachen soll.`));
        break;
      }
      streamed = "";
      patchRun(chatId, { text: "", activity: "Denkt nach" });
      const res: StepResult = await provider.step({
        system,
        tools: toolset.defs,
        history: getChat(chatId)!.messages,
        model: r.model,
        effort: r.effort,
        maxTokens,
        signal: ctl.signal,
        onText: (t) => {
          streamed = t;
          patchRun(chatId, { text: t });
        },
        onActivity: (a) => patchRun(chatId, { activity: a }),
      });
      if (res.usage) recordAiUsage({ feature: "atlas", model: res.model ?? r.model ?? "atlas", inputTokens: res.usage.input, outputTokens: res.usage.output, cacheReadTokens: res.usage.cacheRead, cacheWriteTokens: res.usage.cacheWrite, costCents: r.provider === "codex" ? 0 : undefined });
      if (res.stop === "refusal") {
        append(chatId, note(res.refusal ?? "Dabei kann ich nicht helfen."));
        break;
      }
      if (res.stop === "max_tokens" && res.calls.length) {
        // A tool input cut off at the limit can still look valid – never run it; retry once with more room.
        if (!raised) {
          raised = true;
          maxTokens = 64_000;
          continue;
        }
        append(chatId, note("Die Antwort wurde zu lang und ist abgebrochen. Versuch es in kleineren Schritten."));
        break;
      }
      const env2 = currentEnv();
      const ctx = toolContext(env2.store, env2.role, navigateFn);
      const confirm = env2.permission === "confirm";
      const toolCalls = res.calls.map((c) => {
        const tool = toolset.byName.get(c.name);
        return { id: c.id, name: c.name, input: c.input, status: (tool?.kind === "write" && (confirm || tool.alwaysConfirm) && !c.invalid ? "pending" : "done") as "pending" | "done", summary: previewCall(tool, c.input, ctx) };
      });
      const assistant = msg("assistant", res.text, { toolCalls, model: res.model, raw: res.raw });
      append(chatId, assistant);
      streamed = "";
      patchRun(chatId, { text: "" });
      if (res.stop === "max_tokens") {
        append(chatId, note("Die Antwort wurde hier abgeschnitten."));
        break;
      }
      if (res.stop === "pause") continue;
      if (!res.calls.length) break;
      for (const c of res.calls) {
        if (ctl.signal.aborted) break;
        if (toolCalls.find((t) => t.id === c.id)?.status === "pending") continue;
        await execute(chatId, toolset, c.id, c.name, c.input, env2, c.invalid);
      }
      if (ctl.signal.aborted) throw new AtlasProviderError("Abgebrochen", "aborted");
      if (pendingCalls(getChat(chatId)!).length) {
        patchRun(chatId, { status: "awaiting", activity: undefined, text: "" });
        return;
      }
    }
    patchRun(chatId, { status: "idle", activity: undefined, text: "" });
  } catch (e) {
    const err = e instanceof AtlasProviderError ? e : new AtlasProviderError(e instanceof Error ? e.message : String(e), "other", e);
    if (err.kind === "aborted") {
      if (getChat(chatId)) {
        // Calls that were never answered get a result, so the conversation stays valid.
        const chat = getChat(chatId)!;
        const answered = new Set(chat.messages.filter((m) => m.role === "tool").map((m) => m.toolCallId));
        for (const m of chat.messages) for (const t of m.toolCalls) if (!answered.has(t.id) && t.status !== "pending") {
          setCall(chatId, t.id, { status: "denied", summary: `Abgebrochen: ${t.summary}` });
          append(chatId, msg("tool", JSON.stringify({ denied: true, message: "Abgebrochen." }), { toolCallId: t.id, raw: { isError: false } satisfies ToolRaw }));
        }
        denyPending(chatId, "Die Person hat abgebrochen.");
        append(chatId, note(streamed ? `${streamed}\n\n_(abgebrochen)_` : "_Abgebrochen._"));
      }
      patchRun(chatId, { status: "idle", activity: undefined, text: "" });
    } else {
      patchRun(chatId, { status: "idle", activity: undefined, text: "", error: err.message });
    }
  } finally {
    controllers.delete(chatId);
  }
}
