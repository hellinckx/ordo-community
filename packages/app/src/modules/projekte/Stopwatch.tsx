import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Play, Square, Timer, X } from "lucide-react";
import { buildTaskTree, flattenTaskTree, timerElapsedMinutes, timerElapsedSeconds, type RunningTimer } from "@ordo/core";
import { Button, ConfirmDialog, Field, Input, Modal, Select } from "@/components/ui";
import { useList, useProfile } from "@/state/hooks";
import { toast } from "@/state/toasts";
import { cls } from "@/lib/format";
import { fmtH, fmtStopwatch } from "./labels";
import { Avatar, DurationInput } from "./parts";
import { discardTimer, startTimer, stopTimer, updateTimer, useMembers, useMyTimer, useProjectRights, useTick, useTimers } from "./hooks";

const LAST_KEY = "ordo.projekte.lastTimerProject";
const LONG_MINUTES = 10 * 60;

function readLast(): string {
  try {
    return localStorage.getItem(LAST_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The stopwatch: pick project/task, start, stop → time entry. One per person; survives reloads (settings.timers). */
export function Stopwatch({ compact }: { compact?: boolean }) {
  const profile = useProfile();
  const projects = useList("projects");
  const tasks = useList("tasks");
  const rights = useProjectRights();
  const me = rights.member;
  const timer = useMyTimer();
  useTick(1000, !!timer);
  const openProjects = useMemo(() => projects.filter((p) => p.status !== "completed" && p.status !== "cancelled").sort((a, b) => a.name.localeCompare(b.name, "de")), [projects]);
  const [projectId, setProjectId] = useState(() => readLast());
  const [taskId, setTaskId] = useState("");
  const [description, setDescription] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [longStop, setLongStop] = useState<number | null>(null);
  const [desc, setDesc] = useState(timer?.description ?? "");
  useEffect(() => setDesc(timer?.description ?? ""), [timer?.description, timer?.startedAt]);
  useEffect(() => {
    if (projectId && !openProjects.some((p) => p.id === projectId)) setProjectId(openProjects.find((p) => p.status === "active")?.id ?? openProjects[0]?.id ?? "");
    if (!projectId && openProjects.length) setProjectId(openProjects.find((p) => p.status === "active")?.id ?? openProjects[0]!.id);
  }, [openProjects, projectId]);
  const taskOptions = useMemo(() => flattenTaskTree(buildTaskTree(tasks.filter((t) => t.projectId === projectId))).filter((n) => !n.isPackage && n.task.status !== "done"), [tasks, projectId]);

  if (!rights.canOwnTime && !rights.canWriteTime) return null;

  const start = () => {
    if (!projectId) return toast.warning("Wähle zuerst ein Projekt");
    startTimer(me?.id, { projectId, taskId: taskId || undefined, description: description.trim() });
    try {
      localStorage.setItem(LAST_KEY, projectId);
    } catch {
      /* private mode */
    }
    setDescription("");
  };

  const stop = (override?: number) => {
    if (!timer) return;
    if (override === undefined && timerElapsedMinutes(timer) > LONG_MINUTES) {
      setLongStop(timerElapsedMinutes(timer));
      return;
    }
    if (desc !== timer.description) updateTimer(me?.id, { description: desc });
    const entry = stopTimer(me?.id, profile.id, override);
    if (entry) toast.success(`${fmtH(entry.minutes)} gebucht`, projects.find((p) => p.id === entry.projectId)?.name);
  };

  const runningProject = timer ? projects.find((p) => p.id === timer.projectId) : undefined;
  const runningTask = timer?.taskId ? tasks.find((t) => t.id === timer.taskId) : undefined;

  return (
    <section className={compact ? "rounded-2xl bg-(--surface-2) p-3" : "surface p-5"}>
      {timer ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400"><Timer className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <span className={cls("font-semibold tabular tracking-tight", compact ? "text-2xl" : "text-[32px] leading-none")}>{fmtStopwatch(timerElapsedSeconds(timer))}</span>
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
            </div>
            <div className="mt-1 truncate text-sm">
              {runningProject ? <Link to={`/projekte/${runningProject.id}`} className="font-medium hover:underline">{runningProject.name}</Link> : <span className="text-(--text-muted)">Projekt gelöscht</span>}
              {runningTask ? <span className="text-(--text-muted)"> · {runningTask.title}</span> : null}
            </div>
            {!compact ? (
              <input value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== timer.description && updateTimer(me?.id, { description: desc })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder="Woran arbeitest du? (optional)" className="mt-1 w-full bg-transparent text-sm text-(--text-muted) outline-none placeholder:text-slate-400 focus:text-(--text)" />
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirmDiscard(true)} aria-label="Verwerfen"><X className="h-4 w-4" />{compact ? null : " Verwerfen"}</Button>
            <Button variant="danger" onClick={() => stop()}><Square className="h-3.5 w-3.5 fill-current" /> Stopp</Button>
          </div>
        </div>
      ) : openProjects.length ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
          className={cls("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end")}
        >
          <Field label={compact ? undefined : "Projekt"}>
            <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId(""); }} aria-label="Projekt">
              {openProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label={compact ? undefined : "Aufgabe"}>
            <Select value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label="Aufgabe">
              <option value="">{taskOptions.length ? "Ohne Aufgabe" : "Keine offenen Aufgaben"}</option>
              {taskOptions.map((n) => <option key={n.task.id} value={n.task.id}>{n.number} {n.task.title}</option>)}
            </Select>
          </Field>
          {!compact ? (
            <Field label="Beschreibung">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Woran arbeitest du? (optional)" />
            </Field>
          ) : null}
          <Button type="submit" className={compact ? "w-full justify-center" : ""}><Play className="h-4 w-4 fill-current" /> Start</Button>
        </form>
      ) : (
        <p className="text-sm text-(--text-muted)">Für die Stoppuhr braucht es ein laufendes Projekt. <Link to="/projekte?neu=1" className="font-medium text-brand-700 hover:underline dark:text-brand-400">Projekt anlegen</Link></p>
      )}
      {!compact ? <TeamTimers /> : null}
      <ConfirmDialog open={confirmDiscard} onClose={() => setConfirmDiscard(false)} danger title="Stoppuhr verwerfen?" body="Die gemessene Zeit wird nicht gebucht." confirmLabel="Verwerfen" onConfirm={() => discardTimer(me?.id)} />
      <LongStopDialog minutes={longStop} onClose={() => setLongStop(null)} onBook={(m) => { setLongStop(null); stop(m); }} />
    </section>
  );
}

function LongStopDialog({ minutes, onClose, onBook }: { minutes: number | null; onClose: () => void; onBook: (m: number) => void }) {
  const [value, setValue] = useState<number | null>(minutes);
  useEffect(() => setValue(minutes), [minutes]);
  return (
    <Modal open={minutes !== null} onClose={onClose} title="Stoppuhr lief sehr lange" size="sm" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button disabled={!value || value <= 0} onClick={() => value && onBook(value)}>Buchen</Button></>}>
      <p className="mb-3 text-sm text-(--text-muted)">Die Stoppuhr lief {minutes !== null ? fmtH(minutes) : ""}. Vielleicht hast du vergessen, sie anzuhalten? Trag ein, wie lange du wirklich gearbeitet hast.</p>
      <Field label="Dauer">
        <DurationInput minutes={value} onChange={setValue} autoFocus onEnter={() => value && onBook(value)} />
      </Field>
    </Modal>
  );
}

/** Who else has a stopwatch running (for people who manage time). */
function TeamTimers() {
  const timers = useTimers();
  const rights = useProjectRights();
  const { byId } = useMembers();
  const projects = useList("projects");
  useTick(30_000, timers.length > 1);
  if (!rights.canWriteTime) return null;
  const others: RunningTimer[] = timers.filter((t) => (t.memberId ?? "") !== (rights.member?.id ?? ""));
  if (!others.length) return null;
  return (
    <div className="mt-4 border-t border-(--border) pt-3">
      <div className="mb-2 text-xs font-medium text-(--text-muted)">Läuft gerade bei</div>
      <ul className="flex flex-wrap gap-2">
        {others.map((t) => (
          <li key={`${t.memberId}-${t.startedAt}`} className="inline-flex items-center gap-2 rounded-full bg-(--surface-2) py-1 pl-1 pr-3 text-xs">
            <Avatar member={t.memberId ? byId.get(t.memberId) : undefined} size="xs" />
            <span className="font-medium">{t.memberId ? byId.get(t.memberId)?.name.split(" ")[0] ?? "?" : "Ohne Person"}</span>
            <span className="text-(--text-muted)">{projects.find((p) => p.id === t.projectId)?.name ?? ""} · {fmtH(timerElapsedMinutes(t))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
