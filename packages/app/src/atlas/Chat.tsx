import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ArrowUp, Check, CircleAlert, FileText, Loader2, Paperclip, PencilLine, Settings2, Square, Upload, X } from "lucide-react";
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
import { TOOL_LABELS, toolContext } from "./toolset";
import { addAttachment, attachmentLine, pickedFrom, sizeLabel, type Attachment } from "./attachments";
import { PARTS } from "@/operator";
import type { PickedFile } from "@/platform/types";

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
  // files for the next message: read on the device, the message carries one line per file
  const [files, setFiles] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  const [dropping, setDropping] = useState(false);
  const addFiles = async (picked: PickedFile[]) => {
    if (!picked.length) return;
    setReading(true);
    try {
      const added = await Promise.all(picked.map(addAttachment));
      setFiles((f) => [...f, ...added]);
    } finally {
      setReading(false);
    }
  };

  const send = async (text: string) => {
    const lines = files.map(attachmentLine);
    const body = [text.trim() || (lines.length ? "Was steckt in der Datei, und was kannst du damit für mich anlegen?" : ""), ...lines].filter(Boolean).join("\n\n");
    if (!body) return;
    setFiles([]);
    const id = await sendMessage(chat?.id, body);
    if (id !== chatId) onChatCreated?.(id);
    stick.current = true;
  };
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat?.messages, run?.text, run?.status, run?.activity, run?.error]);

  const empty = !chat || chat.messages.length === 0;

  return (
    <div
      data-own-drop="atlas"
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => { if (!hasFiles(e) || !ready.ok) return; e.preventDefault(); setDropping(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false); }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        if (ready.ok) void pickedFrom(e.dataTransfer.files).then(addFiles);
      }}
    >
      {dropping ? (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-500 bg-(--surface)/90 text-center backdrop-blur-sm">
          <Upload className="mb-2 h-8 w-8 text-brand-600" />
          <div className="font-semibold">Datei an Atlas geben</div>
          <div className="mt-0.5 max-w-xs text-sm text-(--text-muted)">Atlas sagt dir, was drin ist, und legt an, was du willst.</div>
        </div>
      ) : null}
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
        <Composer disabled={!ready.ok} busy={busy || run?.status === "awaiting"} running={busy} onSend={send} onStop={() => chatId && stop(chatId)} autoFocus={compact} compact={compact} files={files} reading={reading} onAddFiles={addFiles} onRemoveFile={(id) => setFiles((f) => f.filter((x) => x.id !== id))} />
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

const FILE_LINE = /^📎 (.+?) \(([^)]+)\) – (.*?)(?: \[Datei-ID: [^\]]+\])?$/;

function UserBubble({ text }: { text: string }) {
  const lines = text.split("\n");
  const attached = lines.map((l) => FILE_LINE.exec(l.trim())).filter((m): m is RegExpExecArray => !!m);
  const rest = lines.filter((l) => !FILE_LINE.test(l.trim())).join("\n").trim();
  return (
    <div className="flex flex-col items-end gap-1.5">
      {attached.map((m, i) => (
        <div key={i} className="flex max-w-[85%] items-start gap-2.5 rounded-2xl border border-(--border) bg-(--surface) px-3 py-2 text-left">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-medium">{m[1]} <span className="font-normal text-(--text-muted)">· {m[2]}</span></div>
            <div className="line-clamp-2 text-[12px] text-(--text-muted)">{m[3]}</div>
          </div>
        </div>
      ))}
      {rest ? <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-brand-50 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap text-(--text) dark:bg-brand-900/35">{rest}</div> : null}
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
      {pending.map((t) => <ConfirmCard key={t.id} chatId={chatId} callId={t.id} name={t.name} summary={t.summary} input={t.input} onNavigate={onNavigate} />)}
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

/** A tool whose confirmation card shows a preview and choices (e.g. the import of the old ERP). Looked up on use: the
    operator module imports the chat itself, so it is not ready while this module loads. */
const detailTool = (name: string) => (PARTS.atlasFiles?.tools ?? []).find((t) => t.name === name && (t.details || t.options));

/** Writes the person's choices into the pending call, so "Ausführen" runs exactly what the card shows. */
function patchCallInput(chatId: string, callId: string, input: unknown) {
  useSession.getState().store?.update("atlasChats", chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.toolCalls.some((t) => t.id === callId) ? { ...m, toolCalls: m.toolCalls.map((t) => (t.id === callId ? { ...t, input } : t)) } : m)) }), "atlas.message");
}

function ConfirmCard({ chatId, callId, name, summary, input, onNavigate }: { chatId: string; callId: string; name: string; summary: string; input: unknown; onNavigate?: () => void }) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const tool = useMemo(() => detailTool(name), [name]);
  const navigate = useNavigate();
  const parsed = useMemo(() => (tool ? tool.input.safeParse(input ?? {}) : null), [tool, input]);
  const ctx = useMemo(() => {
    const store = useSession.getState().store;
    return store ? toolContext(store, "owner", (to) => { onNavigate?.(); navigate(to); }) : null;
  }, [navigate, onNavigate]);
  const options = useMemo(() => {
    try {
      return tool?.options && parsed?.success && ctx ? tool.options(parsed.data, ctx) : [];
    } catch {
      return [];
    }
  }, [tool, parsed, ctx]);
  const [choice, setChoice] = useState<Record<string, boolean>>(() => Object.fromEntries(options.map((o) => [o.key, o.on])));
  const effective = useMemo(() => (tool?.withOptions && parsed?.success ? tool.withOptions(parsed.data, choice) : parsed?.success ? parsed.data : input), [tool, parsed, choice, input]);
  const [details, problem] = useMemo((): [AtlasVisual | null, string | null] => {
    if (!tool?.details || !ctx || !parsed?.success) return [null, null];
    try {
      return [tool.details(effective, ctx), null];
    } catch (e) {
      return [null, e instanceof Error ? e.message : String(e)];
    }
  }, [tool, ctx, parsed, effective]);
  const approve = async () => {
    setBusy("yes");
    if (tool?.withOptions && parsed?.success) patchCallInput(chatId, callId, effective);
    await decideCall(chatId, callId, true);
  };
  return (
    <div className="surface border-brand-200! p-4 dark:border-brand-900!">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <PencilLine className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-(--text-muted)">Atlas möchte etwas ändern</div>
          <div className="mt-0.5 text-[14.5px] font-medium">{summary}</div>
          {details ? <div className="mt-3"><AtlasVisualView visual={details} onNavigate={onNavigate} /></div> : null}
          {problem ? <div className="mt-2 text-[13px] text-amber-700 dark:text-amber-300">{problem}</div> : null}
          {options.length ? (
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {options.map((o) => (
                <label key={o.key} className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-0.5 text-[13px] hover:bg-(--surface-2)" title={o.hint}>
                  <input type="checkbox" className="mt-0.5 accent-brand-600" checked={choice[o.key] ?? o.on} disabled={!!busy} onChange={(e) => setChoice((c) => ({ ...c, [o.key]: e.target.checked }))} />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          ) : null}
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs text-(--text-muted) hover:text-(--text)">Details</summary>
            <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg bg-(--surface-2) p-2 font-mono text-[11.5px] whitespace-pre-wrap">{formatInput(input)}</pre>
          </details>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" loading={busy === "no"} disabled={!!busy} onClick={async () => { setBusy("no"); await decideCall(chatId, callId, false); }}>Abbrechen</Button>
        <Button size="sm" loading={busy === "yes"} disabled={!!busy || !!problem} onClick={() => void approve()}>{tool ? "Übernehmen" : "Ausführen"}</Button>
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

const ATTACH_TYPES = [".json", ".csv", ".tsv", ".xlsx", ".txt", ".xml", ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".eml"];

function Composer({ disabled, busy, running, onSend, onStop, autoFocus, compact, files, reading, onAddFiles, onRemoveFile }: { disabled: boolean; busy: boolean; running: boolean; onSend: (t: string) => void | Promise<void>; onStop: () => void; autoFocus?: boolean; compact?: boolean; files: Attachment[]; reading: boolean; onAddFiles: (f: PickedFile[]) => void | Promise<void>; onRemoveFile: (id: string) => void }) {
  const [text, setText] = useState("");
  const platform = useSession((s) => s.platform);
  const pick = async () => {
    if (!platform) return;
    await onAddFiles(await platform.pickFiles({ multiple: true, accept: ATTACH_TYPES }));
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!e.clipboardData.files.length) return;
    e.preventDefault();
    void pickedFrom(e.clipboardData.files).then(onAddFiles);
  };
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
    if ((!t && !files.length) || disabled || running || reading) return;
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
      {files.length || reading ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
          {files.map((f) => (
            <span key={f.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-(--border) bg-(--surface) py-1 pr-1 pl-2.5 text-[12.5px]" title={f.summary}>
              <FileText className="h-3.5 w-3.5 shrink-0 text-brand-600" />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-(--text-muted)">{sizeLabel(f.size)}</span>
              <button type="button" onClick={() => onRemoveFile(f.id)} className="rounded-full p-0.5 text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text)" aria-label={`${f.name} entfernen`}><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
          {reading ? <span className="inline-flex items-center gap-1.5 px-1 py-1 text-[12.5px] text-(--text-muted)"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Datei wird gelesen …</span> : null}
        </div>
      ) : null}
      <div className="glass-strong flex items-end gap-2 rounded-[22px] p-1.5 pl-2 shadow-[0_10px_30px_-14px_rgb(0_0_0/0.25)]">
        <button type="button" onClick={() => void pick()} disabled={disabled || running} className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--text-muted) transition-colors hover:bg-(--surface-2) hover:text-(--text) disabled:opacity-50" aria-label="Datei anhängen" title="Datei anhängen – oder einfach hineinziehen">
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          placeholder={disabled ? "Atlas ist noch nicht eingerichtet" : busy && !running ? "Bestätige oder schreib etwas Neues …" : files.length ? "Was soll Atlas damit tun? (oder einfach senden)" : "Frag Atlas …"}
          aria-label="Nachricht an Atlas"
          className="max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-snug text-(--text) outline-none placeholder:text-(--text-muted) disabled:opacity-60"
        />
        {running ? (
          <button type="button" onClick={onStop} className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--text) text-(--surface) transition-transform active:scale-95" aria-label="Stopp" title="Stopp">
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={disabled || reading || (!text.trim() && !files.length)} className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white transition-[transform,background-color] hover:bg-brand-600 active:scale-95 disabled:bg-slate-300 dark:disabled:bg-slate-700" aria-label="Senden" title="Senden">
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
      {!compact ? <p className="mt-1.5 hidden text-center text-[11px] text-(--text-muted) sm:block">Atlas kann sich irren – prüf wichtige Zahlen. Enter sendet, Shift+Enter macht eine neue Zeile. Dateien einfach hineinziehen.</p> : null}
    </div>
  );
}
