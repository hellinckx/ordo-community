import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ArrowUp, Check, CircleAlert, Loader2, PencilLine, Settings2, Square, X } from "lucide-react";
import type { AtlasChat, AtlasMessage } from "@ordo/core";
import { useSession } from "@/state/session";
import { Button } from "@/components/ui";
import { cls } from "@/lib/format";
import { decideCall, retry, sendMessage, stop, type RunState } from "./engine";
import { useAtlasReadiness, useAtlasRun } from "./hooks";
import { Markdown } from "./markdown";
import { AtlasVisualView } from "./visuals";
import { claudeModelLabel } from "./providers/claude";
import { EFFORT_LABEL } from "./router";
import type { AssistantRaw } from "./providers/types";
import type { AtlasVisual } from "./tools";
import { TOOL_LABELS } from "./toolset";

export const SUGGESTIONS = ["Wie lief das letzte Quartal?", "Welche Aufgaben sind überfällig?", "Erfasse 2 Stunden auf das Projekt Website", "Umsatz pro Kunde als Diagramm"];

const WRITE_TOOLS = new Set(["create_record", "update_record", "delete_record", "log_time", "start_timer", "stop_timer", "create_task", "set_task_status", "create_project", "book_transaction", "create_offer_draft"]);

/** The Atlas mark: a calm brand-blue disc with the sparkles glyph. */
export function AtlasMark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12" : size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const icon = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <span className={cls("inline-flex shrink-0 items-center justify-center rounded-full bg-brand-700 text-white", box, className)} aria-hidden>
      <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.94 14.06 4.5 12l5.44-2.06L12 4.5l2.06 5.44L19.5 12l-5.44 2.06L12 19.5z" />
        <path d="M19 3v4M21 5h-4" />
      </svg>
    </span>
  );
}

export function modelBadge(chat: AtlasChat | undefined, run: RunState | undefined): string | undefined {
  if (run?.route && run.status !== "idle") return run.route.label;
  const last = chat?.messages.slice().reverse().find((m) => m.role === "assistant" && m.model && !((m.raw ?? {}) as AssistantRaw).local);
  if (!last?.model) return run?.route?.label;
  const effort = ((last.raw ?? {}) as AssistantRaw).effort;
  const name = last.model.startsWith("claude-") ? claudeModelLabel(last.model) : last.model;
  return effort ? `${name} · ${EFFORT_LABEL[effort]}` : name;
}

export function ChatView({ chatId, onChatCreated, compact, onNavigate }: { chatId?: string; onChatCreated?: (id: string) => void; compact?: boolean; onNavigate?: () => void }) {
  const chat = useSession((s) => (chatId ? s.vault?.atlasChats.find((c) => c.id === chatId && !c.deletedAt) : undefined));
  const run = useAtlasRun(chatId);
  const ready = useAtlasReadiness();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const busy = run?.status === "running";

  const send = async (text: string) => {
    const id = await sendMessage(chat?.id, text);
    if (id !== chatId) onChatCreated?.(id);
    stick.current = true;
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat?.messages, run?.text, run?.status, run?.activity, run?.error]);

  const empty = !chat || chat.messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className={cls("min-h-0 flex-1 overflow-y-auto overscroll-contain", compact ? "px-4 py-3" : "px-1 py-2 sm:px-2")}
      >
        {!ready.ok ? (
          <SetupNotice message={ready.message} onNavigate={onNavigate} compact={compact} />
        ) : empty && !busy ? (
          <Welcome compact={compact} onPick={(s) => void send(s)} />
        ) : (
          <div className={cls("mx-auto w-full space-y-5", compact ? "" : "max-w-3xl pb-4")}>
            {chat ? <Messages chat={chat} run={run} onNavigate={onNavigate} /> : null}
            {busy ? <Live run={run!} /> : null}
            {run?.error ? <ErrorCard message={run.error} chatId={chatId!} onNavigate={onNavigate} /> : null}
          </div>
        )}
      </div>
      <div className={cls("shrink-0", compact ? "px-3 pb-3" : "pt-2")}>
        <Composer disabled={!ready.ok} busy={busy || run?.status === "awaiting"} running={busy} onSend={send} onStop={() => chatId && stop(chatId)} autoFocus={compact} compact={compact} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Messages({ chat, run, onNavigate }: { chat: AtlasChat; run?: RunState; onNavigate?: () => void }) {
  const results = useMemo(() => new Map(chat.messages.filter((m) => m.role === "tool" && m.toolCallId).map((m) => [m.toolCallId!, m])), [chat.messages]);
  return (
    <>
      {chat.messages.map((m) => {
        if (m.role === "tool") return null;
        if (m.role === "user") return <UserBubble key={m.id} text={m.text} />;
        return <AssistantBlock key={m.id} m={m} chatId={chat.id} results={results} activeCallId={run?.activeCallId} onNavigate={onNavigate} />;
      })}
    </>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-brand-50 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap text-(--text) dark:bg-brand-900/35">{text}</div>
    </div>
  );
}

function AssistantBlock({ m, chatId, results, activeCallId, onNavigate }: { m: AtlasMessage; chatId: string; results: Map<string, AtlasMessage>; activeCallId?: string; onNavigate?: () => void }) {
  const local = ((m.raw ?? {}) as AssistantRaw).local;
  const done = m.toolCalls.filter((t) => t.status !== "pending");
  const pending = m.toolCalls.filter((t) => t.status === "pending");
  const visuals: AtlasVisual[] = m.toolCalls.flatMap((t) => (results.get(t.id)?.visuals ?? []) as AtlasVisual[]);
  const charts = visuals.filter((v) => v.type !== "link");
  const links = visuals.filter((v) => v.type === "link");
  if (!m.text && !m.toolCalls.length) return null;
  return (
    <div className="space-y-2.5">
      {m.text ? <Markdown text={m.text} className={cls("text-[14.5px] leading-relaxed", local && "text-(--text-muted)")} /> : null}
      {done.length ? (
        <div className="flex flex-wrap gap-1.5">
          {done.map((t) => <ToolChip key={t.id} name={t.name} summary={t.summary} status={t.status} running={activeCallId === t.id} />)}
        </div>
      ) : null}
      {charts.map((v, i) => <AtlasVisualView key={i} visual={v} onNavigate={onNavigate} />)}
      {links.length ? <div className="flex flex-wrap gap-1.5">{links.map((v, i) => <AtlasVisualView key={i} visual={v} onNavigate={onNavigate} />)}</div> : null}
      {pending.map((t) => <ConfirmCard key={t.id} chatId={chatId} callId={t.id} summary={t.summary} input={t.input} />)}
    </div>
  );
}

function ToolChip({ name, summary, status, running }: { name: string; summary: string; status: string; running?: boolean }) {
  const write = WRITE_TOOLS.has(name);
  const icon = running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === "error" ? <CircleAlert className="h-3.5 w-3.5 text-amber-600" /> : status === "denied" ? <X className="h-3.5 w-3.5" /> : write ? <PencilLine className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />;
  return (
    <span
      title={TOOL_LABELS[name] ?? name}
      className={cls(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]",
        write && status === "done" ? "bg-brand-50 font-medium text-brand-800 dark:bg-brand-900/35 dark:text-brand-200" : "bg-(--surface-2) text-(--text-muted)",
        status === "denied" && "line-through",
      )}
    >
      {icon}
      <span className="truncate">{summary || TOOL_LABELS[name] || name}</span>
    </span>
  );
}

function ConfirmCard({ chatId, callId, summary, input }: { chatId: string; callId: string; summary: string; input: unknown }) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  return (
    <div className="surface border-brand-200! p-4 dark:border-brand-900!">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <PencilLine className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-(--text-muted)">Atlas möchte etwas ändern</div>
          <div className="mt-0.5 text-[14.5px] font-medium">{summary}</div>
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs text-(--text-muted) hover:text-(--text)">Details</summary>
            <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg bg-(--surface-2) p-2 font-mono text-[11.5px] whitespace-pre-wrap">{formatInput(input)}</pre>
          </details>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" loading={busy === "no"} disabled={!!busy} onClick={async () => { setBusy("no"); await decideCall(chatId, callId, false); }}>Abbrechen</Button>
        <Button size="sm" loading={busy === "yes"} disabled={!!busy} onClick={async () => { setBusy("yes"); await decideCall(chatId, callId, true); }}>Ausführen</Button>
      </div>
    </div>
  );
}

function formatInput(input: unknown): string {
  const obj = { ...((input ?? {}) as Record<string, unknown>) };
  for (const k of ["data_json", "patch_json"]) {
    if (typeof obj[k] === "string") {
      try {
        obj[k] = JSON.parse(obj[k] as string);
      } catch {
        /* keep text */
      }
    }
  }
  return JSON.stringify(obj, null, 2);
}

function Live({ run }: { run: RunState }) {
  return (
    <div className="space-y-2">
      {run.text ? <Markdown text={run.text} className="text-[14.5px] leading-relaxed" /> : null}
      <div className="flex items-center gap-2 text-[12.5px] text-(--text-muted)">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />
        <span className="truncate">{run.activity ? `${run.activity} …` : "Schreibt …"}</span>
      </div>
    </div>
  );
}

function ErrorCard({ message, chatId, onNavigate }: { message: string; chatId: string; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const settings = /Einstellungen|API-Key|Schlüssel|angemeldet|Modell/.test(message);
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div>{message}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => retry(chatId)}>Nochmal versuchen</Button>
          {settings ? <Button size="sm" variant="ghost" onClick={() => { onNavigate?.(); navigate("/einstellungen/atlas"); }}><Settings2 className="h-4 w-4" /> Einstellungen</Button> : null}
        </div>
      </div>
    </div>
  );
}

function SetupNotice({ message, onNavigate, compact }: { message: string; onNavigate?: () => void; compact?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className={cls("mx-auto flex max-w-md flex-col items-center text-center", compact ? "py-6" : "py-16")}>
      <AtlasMark size="lg" />
      <h2 className="mt-4 text-lg font-semibold">Atlas einrichten</h2>
      <p className="mt-1.5 text-sm text-(--text-muted)">{message}</p>
      <p className="mt-1.5 text-xs text-(--text-muted)">Atlas liest deine Projekte, Zahlen und Aufgaben und erledigt Dinge für dich – nur so weit, wie du es erlaubst.</p>
      <Button className="mt-4" onClick={() => { onNavigate?.(); navigate("/einstellungen/atlas"); }}>
        <Settings2 className="h-4 w-4" /> Einstellungen → Atlas
      </Button>
    </div>
  );
}

function Welcome({ onPick, compact }: { onPick: (s: string) => void; compact?: boolean }) {
  return (
    <div className={cls("mx-auto flex max-w-xl flex-col items-center text-center", compact ? "py-5" : "py-14 sm:py-20")}>
      <AtlasMark size="lg" />
      <h2 className="mt-4 text-xl font-semibold tracking-tight">Was möchtest du wissen?</h2>
      <p className="mt-1.5 text-sm text-(--text-muted)">Frag nach Zahlen, Projekten und Aufgaben – oder lass Atlas etwas für dich erfassen.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => onPick(s)} className="rounded-full border border-(--border) bg-(--surface) px-3.5 py-1.5 text-[13px] text-(--text) transition-colors hover:border-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({ disabled, busy, running, onSend, onStop, autoFocus, compact }: { disabled: boolean; busy: boolean; running: boolean; onSend: (t: string) => void | Promise<void>; onStop: () => void; autoFocus?: boolean; compact?: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [text]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const submit = () => {
    const t = text.trim();
    if (!t || disabled || running) return;
    setText("");
    void onSend(t);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <div className={cls("mx-auto w-full", compact ? "" : "max-w-3xl")}>
      <div className="glass-strong flex items-end gap-2 rounded-[22px] p-1.5 pl-2 shadow-[0_10px_30px_-14px_rgb(0_0_0/0.25)]">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={disabled ? "Atlas ist noch nicht eingerichtet" : busy && !running ? "Bestätige oder schreib etwas Neues …" : "Frag Atlas …"}
          aria-label="Nachricht an Atlas"
          className="max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-snug text-(--text) outline-none placeholder:text-(--text-muted) disabled:opacity-60"
        />
        {running ? (
          <button type="button" onClick={onStop} className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--text) text-(--surface) transition-transform active:scale-95" aria-label="Stopp" title="Stopp">
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={disabled || !text.trim()} className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white transition-[transform,background-color] hover:bg-brand-600 active:scale-95 disabled:bg-slate-300 dark:disabled:bg-slate-700" aria-label="Senden" title="Senden">
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
      {!compact ? <p className="mt-1.5 hidden text-center text-[11px] text-(--text-muted) sm:block">Atlas kann sich irren – prüf wichtige Zahlen. Enter sendet, Shift+Enter macht eine neue Zeile.</p> : null}
    </div>
  );
}
