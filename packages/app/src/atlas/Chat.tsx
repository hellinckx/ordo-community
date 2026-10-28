import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ArrowUp, Camera, Check, CircleAlert, Copy, FileText, Image as ImageIcon, Loader2, MessageCircleQuestion, Mic, Paperclip, Pencil, PencilLine, RotateCcw, Settings2, Square, Upload, X } from "lucide-react";
import { can, type AtlasChat, type AtlasMessage } from "@ordo/core";
import { useMe } from "@/modules/registry";
import { useSession } from "@/state/session";
import { Button } from "@/components/ui";
import { cls } from "@/lib/format";
import { answerQuestion, autoContinueOn, currentTool, decideCall, editFrom, regenerate, retry, sendMessage, setAutoContinue, stop, type Readiness, type RunState } from "./engine";
import { requestAtlasConsent } from "./consent";
import { ASK_TOOL } from "./tools-ask";
import { useAtlasReadiness, useAtlasRun } from "./hooks";
import { Markdown } from "./markdown";
import { AtlasVisualView } from "./visuals";
import { claudeModelLabel } from "./providers/claude";
import { EFFORT_LABEL } from "./router";
import type { AssistantRaw } from "./providers/types";
import type { AtlasVisual } from "./tools";
import { TOOL_LABELS, toolContext } from "./toolset";
import { addAttachment, addScreenshot, attachmentLine, getAttachment, pickedFrom, sizeLabel, type Attachment } from "./attachments";
import { captureApp, pageName } from "./screenshot";
import { loadDraft, saveDraft } from "./drafts";
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

/** `screenshot`: the small Atlas window on a page – it can attach a picture of that page. */
export function ChatView({ chatId, onChatCreated, compact, onNavigate, screenshot }: { chatId?: string; onChatCreated?: (id: string) => void; compact?: boolean; onNavigate?: () => void; screenshot?: boolean }) {
  const chat = useSession((s) => (chatId ? s.vault?.atlasChats.find((c) => c.id === chatId && !c.deletedAt) : undefined));
  const run = useAtlasRun(chatId);
  const profileId = useSession((s) => s.vault?.activeProfileId ?? "");
  const ready = useAtlasReadiness();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const busy = run?.status === "running";
  // files for the next message: read on the device, the message carries one line per file
  const [files, setFiles] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  const [dropping, setDropping] = useState(false);
  // small pictures of attached images, shown before sending
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const root = useRef<HTMLDivElement>(null);
  const addFiles = async (picked: PickedFile[]) => {
    if (!picked.length) return;
    setReading(true);
    try {
      const added = await Promise.all(picked.map(addAttachment));
      setFiles((f) => [...f, ...added]);
      const urls = Object.fromEntries(added.filter((a) => a.mime.startsWith("image/")).map((a) => [a.id, URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: a.mime }))]));
      if (Object.keys(urls).length) setPreviews((p) => ({ ...p, ...urls }));
    } finally {
      setReading(false);
    }
  };
  // a picture of the page behind the Atlas window, attached to the message – sent only when the person sends
  const [shooting, setShooting] = useState(false);
  const [shotError, setShotError] = useState("");
  const takeScreenshot = async () => {
    setShooting(true);
    setShotError("");
    try {
      const a = await addScreenshot(await captureApp(), pageName());
      setFiles((f) => [...f, a]);
      setPreviews((p) => ({ ...p, [a.id]: URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: a.mime })) }));
      markScreenshotUsed();
    } catch (e) {
      setShotError(`Das Bildschirmfoto hat nicht geklappt: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setShooting(false);
    }
  };
  const removeFile = (id: string) => {
    setFiles((f) => f.filter((x) => x.id !== id));
    setPreviews((p) => {
      if (p[id]) URL.revokeObjectURL(p[id]);
      const rest = { ...p };
      delete rest[id];
      return rest;
    });
  };
  // Strg+V anywhere in the chat (not only in the text field) adds pasted images and files
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const list = e.clipboardData?.files;
      if (!list?.length || !ready.ok) return;
      const t = e.target as HTMLElement | null;
      const editable = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (editable && !root.current?.contains(t)) return;
      e.preventDefault();
      void pickedFrom(list).then((picked) => addFiles(picked.map((f, i) => (f.name ? f : { ...f, name: `Bild ${i + 1}.${f.mime.split("/")[1] || "png"}` }))));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [ready.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text: string) => {
    const lines = files.map(attachmentLine);
    const fallback = !lines.length ? "" : files.every((f) => f.kind === "screenshot") ? "Was sehe ich hier, und was kann ich auf dieser Seite machen?" : "Was steckt in der Datei, und was kannst du damit für mich anlegen?";
    const body = [text.trim() || fallback, ...lines].filter(Boolean).join("\n\n");
    if (!body) return;
    setFiles([]);
    setPreviews((p) => {
      Object.values(p).forEach((u) => URL.revokeObjectURL(u));
      return {};
    });
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
      ref={root}
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
          <SetupNotice reason={ready.reason} message={ready.message} onNavigate={onNavigate} compact={compact} />
        ) : empty && !busy ? (
          <Welcome compact={compact} onPick={(s) => void send(s)} />
        ) : (
          <div className={cls("mx-auto w-full space-y-5", compact ? "" : "max-w-3xl pb-4")}>
            {chat ? <Messages chat={chat} run={run} busy={busy} onNavigate={onNavigate} /> : null}
            {busy ? <Live run={run!} /> : null}
            {run?.error ? <ErrorCard message={run.error} limit={run.limit} chatId={chatId!} onNavigate={onNavigate} /> : null}
          </div>
        )}
      </div>
      <div className={cls("shrink-0", compact ? "px-3 pb-3" : "pt-2")}>
        {screenshot && ready.ok ? <ScreenshotBar busy={shooting} disabled={busy} error={shotError} onTake={() => void takeScreenshot()} /> : null}
        <Composer draftKey={chatId ?? `${profileId}:new`} disabled={!ready.ok} busy={busy || run?.status === "awaiting"} running={busy} onSend={send} onStop={() => chatId && stop(chatId)} autoFocus={compact} compact={compact} files={files} previews={previews} reading={reading} onAddFiles={addFiles} onRemoveFile={removeFile} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Messages({ chat, run, busy, onNavigate }: { chat: AtlasChat; run?: RunState; busy: boolean; onNavigate?: () => void }) {
  const results = useMemo(() => new Map(chat.messages.filter((m) => m.role === "tool" && m.toolCallId).map((m) => [m.toolCallId!, m])), [chat.messages]);
  // the last answer with text gets "Neu antworten"
  const lastAnswer = useMemo(() => [...chat.messages].reverse().find((m) => m.role === "assistant" && m.text)?.id, [chat.messages]);
  const lastIsAssistant = chat.messages.length > 0 && chat.messages[chat.messages.length - 1]!.role !== "user";
  return (
    <>
      {chat.messages.map((m) => {
        if (m.role === "tool") return null;
        if (m.role === "user") return <UserBubble key={m.id} chatId={chat.id} id={m.id} text={m.text} busy={busy} />;
        return <AssistantBlock key={m.id} m={m} chatId={chat.id} results={results} activeCallId={run?.activeCallId} onNavigate={onNavigate} canRedo={!busy && lastIsAssistant && m.id === lastAnswer} />;
      })}
    </>
  );
}

/** One icon that copies a whole message; it ticks for a moment. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconAction
      label={done ? "Kopiert" : "Kopieren"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </IconAction>
  );
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-(--text-muted) transition-colors hover:bg-(--surface-2) hover:text-(--text) disabled:opacity-40">
      {children}
    </button>
  );
}

const FILE_LINE = /^📎 (.+?) \(([^)]+)\) – (.*?)(?: \[Datei-ID: ([^\]]+)\])?$/;

/** A sent picture while it is still in memory (it is not kept after a restart – then only the line remains). */
function SentImage({ id, name }: { id: string; name: string }) {
  const url = useMemo(() => {
    const a = getAttachment(id);
    return a && a.mime.startsWith("image/") ? URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: a.mime })) : null;
  }, [id]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!url) return null;
  return (
    <div className="max-w-[85%] overflow-hidden rounded-2xl border border-(--border)" title={name}>
      <img src={url} alt={name} className="max-h-48 w-auto object-contain" />
    </div>
  );
}

const isImageName = (name: string) => /\.(png|jpe?g|webp|gif|heic|bmp)$/i.test(name);

function UserBubble({ chatId, id, text, busy }: { chatId: string; id: string; text: string; busy: boolean }) {
  const lines = text.split("\n");
  const attached = lines.map((l) => FILE_LINE.exec(l.trim())).filter((m): m is RegExpExecArray => !!m);
  const fileLines = lines.filter((l) => FILE_LINE.test(l.trim()));
  const rest = lines.filter((l) => !FILE_LINE.test(l.trim())).join("\n").trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rest);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [editing, draft]);
  // sending an edit drops everything after this message and asks again
  const resend = () => {
    const body = [draft.trim(), ...fileLines].filter(Boolean).join("\n\n");
    if (!body) return;
    setEditing(false);
    void editFrom(chatId, id, body);
  };
  return (
    <div className="group flex flex-col items-end gap-1.5">
      {attached.map((m, i) => (m[4] && getAttachment(m[4])?.mime.startsWith("image/") ? <SentImage key={i} id={m[4]} name={m[1]!} /> : (
        <div key={i} className="flex max-w-[85%] items-start gap-2.5 rounded-2xl border border-(--border) bg-(--surface) px-3 py-2 text-left">
          {isImageName(m[1]!) ? <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />}
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-medium">{m[1]} <span className="font-normal text-(--text-muted)">· {m[2]}</span></div>
            <div className="line-clamp-2 text-[12px] text-(--text-muted)">{m[3]}</div>
          </div>
        </div>
      )))}
      {editing ? (
        <div className="w-full max-w-[85%] rounded-[20px] border border-brand-300 bg-(--surface) p-2 dark:border-brand-800">
          <textarea
            ref={ref}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                resend();
              }
            }}
            aria-label="Nachricht bearbeiten"
            className="block max-h-80 w-full resize-none bg-transparent px-2 py-1.5 text-[14.5px] leading-relaxed text-(--text) outline-none"
          />
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto px-2 text-[11.5px] text-(--text-muted)">Alles danach fällt weg, Atlas antwortet neu.</span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Abbrechen</Button>
            <Button size="sm" disabled={!draft.trim() && !fileLines.length} onClick={resend}>Senden</Button>
          </div>
        </div>
      ) : rest ? (
        <div className="max-w-[85%] rounded-[20px] rounded-br-md bg-brand-50 px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap text-(--text) dark:bg-brand-900/35">{rest}</div>
      ) : null}
      {!editing ? (
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
          {rest ? <CopyButton text={rest} /> : null}
          <IconAction label={busy ? "Erst stoppen, dann bearbeiten" : "Bearbeiten und neu senden"} disabled={busy} onClick={() => { setDraft(rest); setEditing(true); }}>
            <Pencil className="h-3.5 w-3.5" />
          </IconAction>
        </div>
      ) : null}
    </div>
  );
}

function AssistantBlock({ m, chatId, results, activeCallId, onNavigate, canRedo }: { m: AtlasMessage; chatId: string; results: Map<string, AtlasMessage>; activeCallId?: string; onNavigate?: () => void; canRedo?: boolean }) {
  const local = ((m.raw ?? {}) as AssistantRaw).local;
  const done = m.toolCalls.filter((t) => t.status !== "pending" && !(t.name === ASK_TOOL && t.status === "done"));
  const asked = m.toolCalls.filter((t) => t.name === ASK_TOOL && t.status === "done");
  const pending = m.toolCalls.filter((t) => t.status === "pending");
  const visuals: AtlasVisual[] = m.toolCalls.flatMap((t) => (results.get(t.id)?.visuals ?? []) as AtlasVisual[]);
  const charts = visuals.filter((v) => v.type !== "link");
  const links = visuals.filter((v) => v.type === "link");
  if (!m.text && !m.toolCalls.length) return null;
  return (
    <div className="group space-y-2.5">
      {m.text ? <Markdown text={m.text} className={cls("text-[14.5px] leading-relaxed", local && "text-(--text-muted)")} /> : null}
      {asked.map((t) => (
        <div key={t.id} className="flex items-start gap-2 text-[13px] text-(--text-muted)">
          <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <span>{t.summary}</span>
        </div>
      ))}
      {done.length ? (
        <div className="flex flex-wrap gap-1.5">
          {done.map((t) => <ToolChip key={t.id} name={t.name} summary={t.summary} status={t.status} running={activeCallId === t.id} />)}
        </div>
      ) : null}
      {charts.map((v, i) => <AtlasVisualView key={i} visual={v} onNavigate={onNavigate} />)}
      {links.length ? <div className="flex flex-wrap gap-1.5">{links.map((v, i) => <AtlasVisualView key={i} visual={v} onNavigate={onNavigate} />)}</div> : null}
      {pending.map((t) => (t.name === ASK_TOOL ? <QuestionCard key={t.id} chatId={chatId} callId={t.id} input={t.input} /> : <ConfirmCard key={t.id} chatId={chatId} callId={t.id} name={t.name} summary={t.summary} input={t.input} onNavigate={onNavigate} />))}
      {m.text && !local ? (
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
          <CopyButton text={m.text} />
          {canRedo ? <IconAction label="Neu antworten" onClick={() => regenerate(chatId)}><RotateCcw className="h-3.5 w-3.5" /></IconAction> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Atlas asks back: ready answers as buttons (A, B, C …), or an own answer. */
function QuestionCard({ chatId, callId, input }: { chatId: string; callId: string; input: unknown }) {
  const q = (input ?? {}) as { question?: string; options?: string[] };
  const options = (q.options ?? []).filter((o) => typeof o === "string" && o.trim()).slice(0, 5);
  const [other, setOther] = useState("");
  const [sent, setSent] = useState(false);
  const answer = (a: string) => {
    if (sent || !a.trim()) return;
    setSent(true);
    answerQuestion(chatId, callId, a);
  };
  return (
    <div className="surface border-brand-200! p-4 dark:border-brand-900!">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <MessageCircleQuestion className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-(--text-muted)">Atlas fragt nach</div>
          <div className="mt-0.5 text-[14.5px] font-medium">{q.question ?? "Wie soll ich weitermachen?"}</div>
          <div className="mt-3 grid gap-1.5">
            {options.map((o, i) => (
              <button key={i} type="button" disabled={sent} onClick={() => answer(o)} className="flex items-center gap-2.5 rounded-xl border border-(--border) bg-(--surface) px-3 py-2 text-left text-[14px] transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:opacity-60 dark:hover:bg-brand-900/30">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-(--surface-2) text-[12px] font-semibold text-(--text-muted)">{String.fromCharCode(65 + i)}</span>
                <span className="min-w-0">{o}</span>
              </button>
            ))}
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-(--border) px-2 py-1">
              <span className="inline-flex h-6 shrink-0 items-center px-1 text-[12px] font-medium text-(--text-muted)">Sonstiges</span>
              <input value={other} disabled={sent} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") answer(other); }} placeholder="Eigene Antwort …" aria-label="Eigene Antwort" className="h-8 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-(--text-muted)" />
              <Button size="sm" variant="outline" disabled={sent || !other.trim()} onClick={() => answer(other)}>Antworten</Button>
            </div>
          </div>
        </div>
      </div>
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
const detailTool = (name: string) => {
  const t = (PARTS.atlasFiles?.tools ?? []).find((x) => x.name === name) ?? currentTool(name);
  return t && (t.details || t.options) ? t : undefined;
};

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
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <PencilLine className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-[1_1_14rem]">
          <div className="text-[12.5px] text-(--text-muted)">Atlas möchte etwas ändern</div>
          <div className="mt-0.5 text-[14.5px] font-medium">{summary}</div>
        </div>
        {/* the choice sits next to the question, not under a long list */}
        <div className="ml-auto flex shrink-0 gap-2">
          <Button size="sm" variant="outline" loading={busy === "no"} disabled={!!busy} onClick={async () => { setBusy("no"); await decideCall(chatId, callId, false); }}>Abbrechen</Button>
          <Button size="sm" loading={busy === "yes"} disabled={!!busy || !!problem} onClick={() => void approve()}>{tool ? "Übernehmen" : "Ausführen"}</Button>
        </div>
      </div>
      <div className="mt-1 sm:pl-11">
        <div className="min-w-0">
          {details ? <div className="mt-3 max-h-96 overflow-y-auto"><AtlasVisualView visual={details} onNavigate={onNavigate} /></div> : null}
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
            <summary className="cursor-pointer text-xs text-(--text-muted) hover:text-(--text)">Technische Details</summary>
            <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg bg-(--surface-2) p-2 font-mono text-[11.5px] whitespace-pre-wrap">{formatInput(input)}</pre>
          </details>
        </div>
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

const fmtTokens = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("de-AT"));

/** What Atlas is doing right now: its thoughts (where the provider shares them), the step, tokens and time. */
function Live({ run }: { run: RunState }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = run.startedAt ? Math.max(0, Math.round((now - run.startedAt) / 1000)) : 0;
  const thoughts = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = thoughts.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.thinking]);
  return (
    <div className="space-y-2">
      {run.thinking ? (
        <details open className="rounded-xl border border-(--border) bg-(--surface-2)/60 px-3 py-2 text-[12.5px] text-(--text-muted)">
          <summary className="cursor-pointer font-medium text-(--text)">Gedanken</summary>
          <p ref={thoughts} className="mt-1 max-h-36 overflow-y-auto leading-relaxed whitespace-pre-wrap">{run.thinking}</p>
        </details>
      ) : null}
      {run.text ? <Markdown text={run.text} className="text-[14.5px] leading-relaxed" /> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-(--text-muted)">
        <span className="inline-flex min-w-0 items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-600" />
          <span className="truncate">{run.activity ? `${run.activity} …` : "Schreibt …"}</span>
        </span>
        <span className="tabular">
          Schritt {Math.max(1, run.steps ?? 1)}
          {run.tokens && (run.tokens.input || run.tokens.output) ? ` · ${fmtTokens(run.tokens.input)} Token gelesen · ${fmtTokens(run.tokens.output)} geschrieben` : ""}
          {` · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}
        </span>
        {run.resumed ? <span>· nach dem Neuladen fortgesetzt</span> : null}
      </div>
    </div>
  );
}

/** Counts down to the next automatic try. */
function useCountdown(at?: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!at) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [at]);
  if (!at) return "";
  const s = Math.max(0, Math.ceil((at - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function ErrorCard({ message, limit, chatId, onNavigate }: { message: string; limit?: RunState["limit"]; chatId: string; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const settings = /Einstellungen|API-Key|Schlüssel|angemeldet|Modell/.test(message);
  const [auto, setAuto] = useState(autoContinueOn);
  const left = useCountdown(limit?.retryAt);
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {limit ? <div className="font-medium">{limit.kind === "rate" ? "Kontingent ausgeschöpft" : "Gerade überlastet"}</div> : null}
        <div>{message}</div>
        {limit ? (
          <>
            <p className="mt-1 text-[13px] opacity-80">Das Gespräch bleibt, wie es ist. Sobald wieder Kontingent da ist, kann Atlas genau hier weitermachen.</p>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={auto} onChange={(e) => { setAuto(e.target.checked); setAutoContinue(e.target.checked, chatId); }} />
              <span>Automatisch fortfahren, sobald wieder Kontingent da ist{auto && left ? <span className="tabular opacity-80"> · nächster Versuch in {left}</span> : null}</span>
            </label>
          </>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => retry(chatId)}>{limit ? "Jetzt versuchen" : "Nochmal versuchen"}</Button>
          {settings ? <Button size="sm" variant="ghost" onClick={() => { onNavigate?.(); navigate("/einstellungen/atlas"); }}><Settings2 className="h-4 w-4" /> Einstellungen</Button> : null}
        </div>
      </div>
    </div>
  );
}

function SetupNotice({ reason, message, onNavigate, compact }: { reason: Extract<Readiness, { ok: false }>["reason"]; message: string; onNavigate?: () => void; compact?: boolean }) {
  const navigate = useNavigate();
  const { role } = useMe();
  const editable = can(role, "settings", "write");
  if (reason === "consent") return <div className={cls("mx-auto flex max-w-md flex-col items-center text-center", compact ? "py-6" : "py-16")}>
    <AtlasMark size="lg" />
    <h2 className="mt-4 text-lg font-semibold">Atlas braucht deine Zustimmung</h2>
    <p className="mt-1.5 text-sm text-(--text-muted)">Bevor Atlas antworten kann, musst du erlauben, dass die für deine Anfrage nötigen Daten an deinen KI-Anbieter gesendet werden.</p>
    {editable ? <>
      <Button className="mt-4" onClick={() => void requestAtlasConsent()}>Zustimmung prüfen</Button>
      <p className="mt-3 text-xs text-(--text-muted)">Du kannst direkt hier zustimmen und danach weitermachen. Jederzeit unter Einstellungen → Atlas widerrufbar.</p>
    </> : <p className="mt-3 text-sm text-(--text-muted)">Bitte Inhaber:in oder Administration, die Einwilligung für diesen Tresor zu erteilen.</p>}
  </div>;
  const ways = [
    { title: "API-Key von Claude oder OpenAI", text: "Funktioniert überall: im Browser, am Handy und in der Desktop-App. Abgerechnet wird nach Nutzung beim Anbieter." },
    { title: "Dein ChatGPT-Abo über Codex", text: "Ohne API-Key, mit deinem Plus- oder Pro-Abo – nur in der Desktop-App für Windows und Mac." },
  ];
  return (
    <div className={cls("mx-auto flex max-w-md flex-col items-center text-center", compact ? "py-6" : "py-16")}>
      <AtlasMark size="lg" />
      <h2 className="mt-4 text-lg font-semibold">Atlas einrichten</h2>
      <p className="mt-1.5 text-sm text-(--text-muted)">{message}</p>
      <p className="mt-1.5 text-xs text-(--text-muted)">Atlas liest deine Projekte, Zahlen und Aufgaben und erledigt Dinge für dich – nur so weit, wie du es erlaubst.</p>
      <div className="mt-4 grid w-full gap-2 text-left">
        {ways.map((w) => (
          <div key={w.title} className="rounded-xl border border-(--border) px-3 py-2">
            <div className="text-[13px] font-medium">{w.title}</div>
            <div className="text-xs text-(--text-muted)">{w.text}</div>
          </div>
        ))}
      </div>
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

const SHOT_USED = "ordo.atlas.screenshotUsed";

function markScreenshotUsed() {
  try {
    localStorage.setItem(SHOT_USED, "1");
  } catch {
    /* storage blocked – the longer explanation simply stays */
  }
}

function screenshotUsed(): boolean {
  try {
    return localStorage.getItem(SHOT_USED) === "1";
  } catch {
    return false;
  }
}

/** "Show Atlas this page": takes the picture and says plainly what happens with it. */
function ScreenshotBar({ busy, disabled, error, onTake }: { busy: boolean; disabled: boolean; error: string; onTake: () => void }) {
  const [known] = useState(screenshotUsed);
  return (
    <div className="mb-2">
      <div className={cls("flex items-center gap-3 rounded-2xl border px-2 py-1.5", known ? "border-transparent" : "border-dashed border-brand-300 bg-brand-50/70 dark:border-brand-800 dark:bg-brand-900/20")}>
        <button
          type="button"
          onClick={onTake}
          disabled={busy || disabled}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-300 bg-(--surface) px-3 py-1.5 text-[13px] font-medium text-brand-800 transition-colors hover:bg-brand-50 disabled:opacity-60 dark:border-brand-800 dark:text-brand-200 dark:hover:bg-brand-900/30"
          title="Macht ein Bild nur vom Ordo-Fenster und hängt es an deine Nachricht an"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {busy ? "Bild wird gemacht …" : "Diese Seite zeigen"}
        </button>
        <span className="min-w-0 text-[12px] leading-snug text-(--text-muted)">
          {known ? "Bild nur von Ordo · geht erst mit deiner Nachricht weg" : "Atlas sieht dann, was du siehst – nur Ordo, sonst nichts. Gesendet wird erst mit deiner Nachricht."}
        </span>
      </div>
      {error ? <div className="mt-1 px-2 text-[12px] text-amber-700 dark:text-amber-300">{error}</div> : null}
    </div>
  );
}

const ATTACH_TYPES = [".json", ".csv", ".tsv", ".xlsx", ".txt", ".xml", ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".eml"];

/** Speech recognition of the browser (Chrome, Edge, Safari) – not in every desktop webview. */
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const SpeechRecognitionCtor = (): (new () => Recognition) | undefined => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

function Composer({ draftKey, disabled, busy, running, onSend, onStop, autoFocus, compact, files, previews, reading, onAddFiles, onRemoveFile }: { draftKey: string; disabled: boolean; busy: boolean; running: boolean; onSend: (t: string) => void | Promise<void>; onStop: () => void; autoFocus?: boolean; compact?: boolean; files: Attachment[]; previews: Record<string, string>; reading: boolean; onAddFiles: (f: PickedFile[]) => void | Promise<void>; onRemoveFile: (id: string) => void }) {
  // what is typed belongs to its chat (or to the new one) and stays when switching, reloading or closing
  const [draft, setDraft] = useState(() => ({ key: draftKey, text: loadDraft(draftKey) }));
  if (draft.key !== draftKey) setDraft({ key: draftKey, text: loadDraft(draftKey) });
  const text = draft.key === draftKey ? draft.text : "";
  const setText = (u: string | ((t: string) => string)) => setDraft((d) => ({ key: d.key, text: typeof u === "function" ? u(d.text) : u }));
  useEffect(() => saveDraft(draft.key, draft.text), [draft]);
  const [zoom, setZoom] = useState<string | null>(null);
  const platform = useSession((s) => s.platform);
  const pick = async () => {
    if (!platform) return;
    await onAddFiles(await platform.pickFiles({ multiple: true, accept: ATTACH_TYPES }));
  };
  // dictation: what is said is added to the text field, nothing is sent on its own
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const Speech = useMemo(SpeechRecognitionCtor, []);
  const toggleMic = () => {
    if (!Speech) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Speech();
    r.lang = "de-AT";
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      let said = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i]!.isFinal) said += e.results[i]![0].transcript;
      if (said.trim()) setText((t) => (t.trim() ? `${t.trimEnd()} ${said.trim()}` : said.trim()));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };
  useEffect(() => () => rec.current?.stop(), []);
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
          {files.map((f) =>
            previews[f.id] ? (
              <span key={f.id} className="group/img relative inline-block" title={f.name}>
                <button type="button" onClick={() => setZoom(previews[f.id]!)} className="block overflow-hidden rounded-xl border border-(--border)" aria-label={`${f.name} groß ansehen`}>
                  <img src={previews[f.id]} alt={f.name} className="h-16 w-16 object-cover" />
                </button>
                <button type="button" onClick={() => onRemoveFile(f.id)} className="absolute -top-1.5 -right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-(--text) text-(--surface) shadow" aria-label={`${f.name} entfernen`}><X className="h-3 w-3" /></button>
              </span>
            ) : (
            <span key={f.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-(--border) bg-(--surface) py-1 pr-1 pl-2.5 text-[12.5px]" title={f.summary}>
              <FileText className="h-3.5 w-3.5 shrink-0 text-brand-600" />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-(--text-muted)">{sizeLabel(f.size)}</span>
              <button type="button" onClick={() => onRemoveFile(f.id)} className="rounded-full p-0.5 text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text)" aria-label={`${f.name} entfernen`}><X className="h-3.5 w-3.5" /></button>
            </span>
            ),
          )}
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
          placeholder={disabled ? "Atlas ist noch nicht eingerichtet" : busy && !running ? "Bestätige oder schreib etwas Neues …" : files.length && files.every((f) => f.kind === "screenshot") ? "Was willst du zu dieser Seite wissen?" : files.length ? "Was soll Atlas damit tun? (oder einfach senden)" : "Frag Atlas …"}
          aria-label="Nachricht an Atlas"
          className="max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-snug text-(--text) outline-none placeholder:text-(--text-muted) disabled:opacity-60"
        />
        {Speech && !running ? (
          <button type="button" onClick={toggleMic} disabled={disabled} className={cls("mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50", listening ? "bg-red-600 text-white" : "text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text)")} aria-label={listening ? "Diktat beenden" : "Diktieren"} title={listening ? "Diktat beenden" : "Diktieren – die Spracherkennung deines Browsers wandelt Sprache in Text (in Chrome über Google)"}>
            <Mic className="h-4 w-4" />
          </button>
        ) : null}
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
      {!disabled ? <button type="button" onClick={() => void pick()} disabled={reading} className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-xs text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text) focus-visible:focus-ring disabled:opacity-60"><Upload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>Dateien in den Chat ziehen oder auswählen · Bilder auch mit Strg+V</span></button> : null}
      {!compact ? <p className="mt-1 hidden text-center text-[11px] text-(--text-muted) sm:block">Atlas kann sich irren – prüf wichtige Zahlen. Enter sendet, Shift+Enter macht eine neue Zeile.</p> : null}
      {zoom ? (
        <div role="dialog" aria-modal="true" aria-label="Bild" onClick={() => setZoom(null)} onKeyDown={(e) => e.key === "Escape" && setZoom(null)} tabIndex={-1} className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm">
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-xl shadow-pop" />
        </div>
      ) : null}
    </div>
  );
}
