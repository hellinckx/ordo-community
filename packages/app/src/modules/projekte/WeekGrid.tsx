import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Plus, X } from "lucide-react";
import { buildTaskTree, flattenTaskTree, formatMinutesClock, isoWeekNumber, mondayOfIso, nowIso, parseDuration, shiftIsoDate, todayIso, weekGrid, weekOfIso, type TimeEntry } from "@ordo/core";
import { Button, Select } from "@/components/ui";
import { useList, useProfile } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { toast } from "@/state/toasts";
import { cls } from "@/lib/format";
import { WEEKDAYS_SHORT, fmtH } from "./labels";
import { bookTime, useMembers, useProjectRights } from "./hooks";

type Extra = { projectId: string; taskId?: string };

/**
 * Week sheet: one row per project/task, Monday to Sunday. Type "1,5" or "1:30" into a cell to set the day's total –
 * Ordo books, changes or removes entries so the total matches.
 */
export function WeekGrid() {
  const profile = useProfile();
  const projects = useList("projects");
  const tasks = useList("tasks");
  const entries = useList("timeEntries");
  const rights = useProjectRights();
  const { active, byId } = useMembers();
  const today = todayIso();
  const [monday, setMonday] = useState(() => mondayOfIso(today));
  const [personId, setPersonId] = useState<string>(rights.member?.id ?? "");
  const [extra, setExtra] = useState<Extra[]>([]);
  const [adding, setAdding] = useState<{ projectId: string; taskId: string } | null>(null);
  const days = useMemo(() => weekOfIso(monday), [monday]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const numbers = useMemo(() => new Map(flattenTaskTree(buildTaskTree(tasks)).map((n) => [n.task.id, n.number])), [tasks]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const isMe = (personId || "") === (rights.member?.id ?? "");
  const canEditPerson = rights.canWriteTime || (rights.canOwnTime && isMe);

  useEffect(() => setExtra([]), [monday, personId]);

  const mine = useMemo(() => entries.filter((e) => (e.memberId ?? "") === personId), [entries, personId]);
  const rows = useMemo(() => {
    const list = weekGrid(mine, days, extra);
    return list.sort((a, b) => (projectById.get(a.projectId)?.name ?? "").localeCompare(projectById.get(b.projectId)?.name ?? "", "de") || (numbers.get(a.taskId ?? "") ?? "").localeCompare(numbers.get(b.taskId ?? "") ?? "", "de", { numeric: true }));
  }, [mine, days, extra, projectById, numbers]);
  const dayTotals = days.map((_, i) => rows.reduce((s, r) => s + (r.days[i] ?? 0), 0));
  const weekTotal = dayTotals.reduce((s, x) => s + x, 0);
  const person = personId ? byId.get(personId) : undefined;
  const target = person?.weeklyHours;

  const setDayTotal = (projectId: string, taskId: string | undefined, date: string, minutes: number) => {
    const store = requireStore();
    const cell = mine.filter((e) => e.projectId === projectId && (e.taskId ?? "") === (taskId ?? "") && e.date === date).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const current = cell.reduce((s, e) => s + e.minutes, 0);
    const diff = minutes - current;
    if (diff === 0) return;
    const now = nowIso();
    if (minutes === 0) {
      store.mutate((v) => {
        const ids = new Set(cell.map((e) => e.id));
        v.timeEntries = v.timeEntries.map((e) => (ids.has(e.id) ? { ...e, deletedAt: now, updatedAt: now } : e));
      }, { audit: { action: "time.weekClear", entity: "timeEntries" } });
      return;
    }
    if (cell.length === 1) {
      store.update("timeEntries", cell[0]!.id, { minutes }, "time.weekEdit");
      return;
    }
    const last: TimeEntry | undefined = cell.at(-1);
    if (last && last.minutes + diff > 0) {
      store.update("timeEntries", last.id, { minutes: last.minutes + diff }, "time.weekEdit");
      return;
    }
    const p = projectById.get(projectId);
    bookTime({ profileId: profile.id, projectId, taskId, memberId: personId || undefined, date, minutes: diff, description: cell.length ? "Korrektur Wochenansicht" : "", billable: p ? p.billing !== "internal" : true });
  };

  const copyLastWeek = () => {
    const prev = weekOfIso(shiftIsoDate(monday, -7));
    const prevRows = weekGrid(mine, prev).map((r) => ({ projectId: r.projectId, taskId: r.taskId }));
    const have = new Set(rows.map((r) => r.key));
    const add = prevRows.filter((r) => !have.has(`${r.projectId}|${r.taskId ?? ""}`) && projectById.get(r.projectId)?.status !== "completed");
    if (!add.length) return toast.info("Nichts zu übernehmen", "Die Zeilen der Vorwoche sind schon da oder es gab keine.");
    setExtra((x) => [...x, ...add]);
  };

  const openProjects = useMemo(() => projects.filter((p) => p.status !== "completed" && p.status !== "cancelled").sort((a, b) => a.name.localeCompare(b.name, "de")), [projects]);
  const addTaskOptions = useMemo(() => (adding ? flattenTaskTree(buildTaskTree(tasks.filter((t) => t.projectId === adding.projectId))).filter((n) => !n.isPackage) : []), [adding, tasks]);

  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-(--glass-border) px-4 py-2.5">
        <div className="flex items-center">
          <Button size="icon" variant="ghost" onClick={() => setMonday(shiftIsoDate(monday, -7))} aria-label="Vorige Woche"><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-40 text-center text-sm">
            <span className="font-semibold">KW {isoWeekNumber(monday)}</span>
            <span className="text-(--text-muted)"> · {days[0]!.slice(8, 10)}.{days[0]!.slice(5, 7)}. – {days[6]!.slice(8, 10)}.{days[6]!.slice(5, 7)}.{days[6]!.slice(0, 4)}</span>
          </div>
          <Button size="icon" variant="ghost" onClick={() => setMonday(shiftIsoDate(monday, 7))} aria-label="Nächste Woche"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        {monday !== mondayOfIso(today) ? <Button size="sm" variant="ghost" onClick={() => setMonday(mondayOfIso(today))}>Diese Woche</Button> : null}
        {rights.canWriteTime && active.length ? (
          <Select value={personId} onChange={(e) => setPersonId(e.target.value)} className="w-44" aria-label="Person">
            {active.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === rights.member?.id ? " (ich)" : ""}</option>)}
            <option value="">Ohne Person</option>
          </Select>
        ) : null}
        {canEditPerson ? <Button size="sm" variant="ghost" className="ml-auto" onClick={copyLastWeek}><Copy className="h-4 w-4" /> Zeilen der Vorwoche</Button> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-(--surface-2) text-xs font-medium text-(--text-muted)">
            <tr>
              <th className="px-4 py-2 text-left">Projekt / Aufgabe</th>
              {days.map((d, i) => (
                <th key={d} className={cls("w-[4.5rem] px-1 py-2 text-center", d === today && "text-brand-700 dark:text-brand-400", i >= 5 && "text-slate-400")}>
                  <div>{WEEKDAYS_SHORT[i]}</div>
                  <div className="font-normal tabular">{d.slice(8, 10)}.{d.slice(5, 7)}.</div>
                </th>
              ))}
              <th className="w-20 px-3 py-2 text-right">Summe</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {rows.map((r, ri) => {
              const p = projectById.get(r.projectId);
              const t = r.taskId ? taskById.get(r.taskId) : undefined;
              const locked = !p || p.status === "completed" || !canEditPerson;
              const isExtra = r.total === 0 && extra.some((x) => x.projectId === r.projectId && (x.taskId ?? "") === (r.taskId ?? ""));
              return (
                <tr key={r.key}>
                  <td className="max-w-0 px-4 py-1.5">
                    <div className="truncate font-medium">{p?.name ?? "Gelöschtes Projekt"}</div>
                    <div className="truncate text-xs text-(--text-muted)">{t ? `${numbers.get(t.id) ?? ""} ${t.title}` : "Ohne Aufgabe"}</div>
                  </td>
                  {days.map((d, i) => (
                    <td key={d} className={cls("px-1 py-1.5", i >= 5 && "bg-(--surface-2)/50", d === today && "bg-brand-50/60 dark:bg-brand-900/20")}>
                      <Cell minutes={r.days[i] ?? 0} disabled={locked} row={ri} col={i} onCommit={(m) => setDayTotal(r.projectId, r.taskId, d, m)} />
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-semibold tabular">{r.total ? formatMinutesClock(r.total) : "–"}</td>
                  <td className="pr-2">
                    {isExtra ? <button onClick={() => setExtra((x) => x.filter((y) => !(y.projectId === r.projectId && (y.taskId ?? "") === (r.taskId ?? ""))))} className="rounded p-1 text-(--text-muted) hover:bg-(--surface-2)" aria-label="Zeile entfernen"><X className="h-3.5 w-3.5" /></button> : null}
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-(--text-muted)">In dieser Woche ist noch keine Zeit erfasst. Füg unten eine Zeile hinzu und trag die Stunden pro Tag ein.</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot className="border-t border-(--border) bg-(--surface-2) text-sm">
            <tr>
              <td className="px-4 py-2 font-medium">Summe{target ? <span className="font-normal text-(--text-muted)"> · Soll {fmtH(target * 60)}</span> : null}</td>
              {dayTotals.map((m, i) => <td key={i} className="px-1 py-2 text-center tabular font-medium">{m ? formatMinutesClock(m) : ""}</td>)}
              <td className={cls("px-3 py-2 text-right font-semibold tabular", !!target && weekTotal >= target * 60 && "text-emerald-700 dark:text-emerald-400")}>{formatMinutesClock(weekTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {canEditPerson ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-(--border) px-4 py-2.5">
          {adding ? (
            <>
              <Select value={adding.projectId} onChange={(e) => setAdding({ projectId: e.target.value, taskId: "" })} className="w-56" aria-label="Projekt">
                {openProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Select value={adding.taskId} onChange={(e) => setAdding({ ...adding, taskId: e.target.value })} className="w-56" aria-label="Aufgabe">
                <option value="">Ohne Aufgabe</option>
                {addTaskOptions.map((n) => <option key={n.task.id} value={n.task.id}>{n.number} {n.task.title}</option>)}
              </Select>
              <Button size="sm" onClick={() => { setExtra((x) => [...x, { projectId: adding.projectId, taskId: adding.taskId || undefined }]); setAdding(null); }}>Hinzufügen</Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>Abbrechen</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={!openProjects.length} onClick={() => setAdding({ projectId: openProjects[0]?.id ?? "", taskId: "" })}><Plus className="h-4 w-4" /> Zeile hinzufügen</Button>
          )}
          <span className="ml-auto hidden text-[11px] text-(--text-muted) sm:inline">Eingabe: 1,5 · 1:30 · 90m – Enter springt eine Zeile tiefer, leeren löscht.</span>
        </div>
      ) : null}
    </div>
  );
}

function Cell({ minutes, disabled, onCommit, row, col }: { minutes: number; disabled: boolean; onCommit: (m: number) => void; row: number; col: number }) {
  const shown = minutes ? formatMinutesClock(minutes) : "";
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const commit = () => {
    const t = text.trim();
    if (t === shown) return setBad(false);
    const m = t ? parseDuration(t) : 0;
    if (m === null) {
      setBad(true);
      return;
    }
    setBad(false);
    onCommit(m);
    setText(m ? formatMinutesClock(m) : "");
  };
  return (
    <input
      data-cell={`${row}-${col}`}
      value={text}
      disabled={disabled}
      inputMode="decimal"
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          const next = document.querySelector<HTMLInputElement>(`[data-cell="${row + (e.shiftKey ? -1 : 1)}-${col}"]`);
          if (next) next.focus();
          else (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setText(shown);
          setBad(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
      title={bad ? "So nicht lesbar – z. B. 1,5 oder 1:30" : undefined}
      className={cls("h-9 w-full rounded-lg border bg-transparent px-1 text-center text-sm tabular focus:bg-(--surface) focus:focus-ring disabled:cursor-default", bad ? "border-red-400" : "border-transparent hover:border-(--border)", minutes < 0 && "text-red-600")}
    />
  );
}
