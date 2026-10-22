import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CalendarRange, ChevronDown, ChevronRight, CalendarCheck, Minus, Plus, WandSparkles } from "lucide-react";
import {
  addWorkdaysIso,
  autoSchedule,
  buildTaskTree,
  flattenTaskTree,
  isMilestoneOverdue,
  isTaskOverdue,
  isWeekendIso,
  isoDaysBetween,
  isoWeekNumber,
  isoWeekday,
  milestoneCode,
  milestoneTaskIds,
  mondayOfIso,
  nowIso,
  shiftIsoDate,
  taskDescendantIds,
  todayIso,
  workdaysForHours,
  type Milestone,
  type Task,
  type TaskNode,
  type TimeEntry,
} from "@ordo/core";
import { Button, Card, Checkbox, DateInput, EmptyState, Field, Input, Modal } from "@/components/ui";
import { requireStore } from "@/state/session";
import { toast } from "@/state/toasts";
import { cls, fmtDate } from "@/lib/format";
import { MilestoneDialog } from "../MilestoneDialog";
import type { DetailContext } from "../ProjectDetail";
import { sortMilestones } from "../data";

const ZOOMS = [8, 14, 22, 32, 46];
const ZOOM_KEY = "ordo.projekte.ganttZoom";
const ROW = 36;
const HEAD = 46;

type Range = { start: string; end: string };
type DragKind = "move" | "start" | "end" | "ms";
interface Drag {
  id: string;
  kind: DragKind;
  x0: number;
  delta: number;
}

function readZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOMS.includes(v) ? v : 22;
  } catch {
    return 22;
  }
}

/** Display range of a leaf: own dates, the missing end filled from the estimate. */
function leafRange(t: Task, hoursPerDay: number): Range | null {
  if (!t.startDate && !t.dueDate) return null;
  const days = workdaysForHours(t.estimateHours, hoursPerDay);
  const start = t.startDate ?? addWorkdaysIso(t.dueDate!, -(days - 1));
  const end = t.dueDate ?? addWorkdaysIso(t.startDate!, days - 1);
  return end < start ? { start: end, end: start } : { start, end };
}

export function GanttTab({ ctx, tasks, entries, milestones }: { ctx: DetailContext; tasks: Task[]; entries: TimeEntry[]; milestones: Milestone[] }) {
  const { project } = ctx;
  const today = todayIso();
  const [px, setPx] = useState(readZoom);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [planning, setPlanning] = useState(false);
  const [msDialog, setMsDialog] = useState<Milestone | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);

  const roots = useMemo(() => buildTaskTree(tasks), [tasks]);
  const flat = useMemo(() => flattenTaskTree(roots), [roots]);
  const numbers = useMemo(() => new Map(flat.map((n) => [n.task.id, n.number])), [flat]);
  const sortedMs = useMemo(() => sortMilestones(milestones), [milestones]);

  // dates while dragging
  const affected = useMemo(() => {
    if (!drag || drag.kind === "ms") return new Set<string>();
    const n = flat.find((x) => x.task.id === drag.id);
    return n?.isPackage ? new Set([drag.id, ...taskDescendantIds(tasks, drag.id)]) : new Set([drag.id]);
  }, [drag, flat, tasks]);

  const ranges = useMemo(() => {
    const out = new Map<string, Range>();
    const shift = (r: Range | null, id: string): Range | null => {
      if (!r || !drag || !affected.has(id)) return r;
      if (drag.kind === "move") return { start: shiftIsoDate(r.start, drag.delta), end: shiftIsoDate(r.end, drag.delta) };
      if (drag.kind === "start" && drag.id === id) { const s = shiftIsoDate(r.start, drag.delta); return { start: s > r.end ? r.end : s, end: r.end }; }
      if (drag.kind === "end" && drag.id === id) { const e = shiftIsoDate(r.end, drag.delta); return { start: r.start, end: e < r.start ? r.start : e }; }
      return r;
    };
    const visit = (n: TaskNode): Range | null => {
      if (!n.isPackage) {
        const r = shift(leafRange(n.task, project.hoursPerDay), n.task.id);
        if (r) out.set(n.task.id, r);
        return r;
      }
      const kids = n.children.map(visit).filter((x): x is Range => !!x);
      const own = shift(leafRange(n.task, project.hoursPerDay), n.task.id);
      const all = own ? [...kids, own] : kids;
      if (!all.length) return null;
      const r = { start: all.map((k) => k.start).sort()[0]!, end: all.map((k) => k.end).sort().at(-1)! };
      out.set(n.task.id, r);
      return r;
    };
    roots.forEach(visit);
    return out;
  }, [roots, project.hoursPerDay, drag, affected]);

  const msDate = (m: Milestone) => (drag?.kind === "ms" && drag.id === m.id && m.dueDate ? shiftIsoDate(m.dueDate, drag.delta) : m.dueDate);

  // visible window
  const { from, days } = useMemo(() => {
    const ds: string[] = [today];
    if (project.startDate) ds.push(project.startDate);
    if (project.endDate) ds.push(project.endDate);
    for (const t of tasks) {
      if (t.startDate) ds.push(t.startDate);
      if (t.dueDate) ds.push(t.dueDate);
    }
    for (const m of milestones) if (m.dueDate) ds.push(m.dueDate);
    for (const e of entries) ds.push(e.date);
    ds.sort();
    const start = shiftIsoDate(mondayOfIso(ds[0]!), -7);
    const end = shiftIsoDate(ds.at(-1)!, 21);
    return { from: start, days: Math.min(800, Math.max(56, isoDaysBetween(start, end) + 1)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, project.startDate, project.endDate, tasks, milestones, entries.length]);

  const dates = useMemo(() => Array.from({ length: days }, (_, i) => shiftIsoDate(from, i)), [from, days]);
  const x = (iso: string) => isoDaysBetween(from, iso) * px;
  const width = days * px;

  // actual time per task: merged runs of days with booked time
  const actual = useMemo(() => {
    const byTask = new Map<string, Set<string>>();
    for (const e of entries) {
      if (!e.taskId || e.minutes <= 0) continue;
      (byTask.get(e.taskId) ?? byTask.set(e.taskId, new Set()).get(e.taskId)!).add(e.date);
    }
    const runs = new Map<string, Range[]>();
    for (const [id, set] of byTask) {
      const sorted = [...set].sort();
      const list: Range[] = [];
      for (const d of sorted) {
        const last = list.at(-1);
        if (last && shiftIsoDate(last.end, 1) === d) last.end = d;
        else list.push({ start: d, end: d });
      }
      runs.set(id, list);
    }
    return runs;
  }, [entries]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, x(today) - el.clientWidth / 3);
    // only when the scale changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px]);

  const setZoom = (dir: -1 | 1) => {
    const i = Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(px) + dir));
    setPx(ZOOMS[i]!);
    try {
      localStorage.setItem(ZOOM_KEY, String(ZOOMS[i]));
    } catch {
      /* private mode */
    }
  };

  const visibleRows = useMemo(() => flattenTaskTree(roots, collapsed), [roots, collapsed]);

  /* ---------------- dragging ---------------- */

  const begin = (e: ReactPointerEvent, id: string, kind: DragKind) => {
    if (!ctx.canEdit || e.pointerType === "touch" || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, kind, x0: e.clientX, delta: 0 });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.x0) / px);
    if (delta !== drag.delta) setDrag({ ...drag, delta });
  };
  const end = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (d.delta === 0) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    commit(d);
  };

  const commit = (d: Drag) => {
    const now = nowIso();
    const store = requireStore();
    if (d.kind === "ms") {
      const m = milestones.find((x) => x.id === d.id);
      if (m?.dueDate) store.update("milestones", m.id, { dueDate: shiftIsoDate(m.dueDate, d.delta) }, "milestone.move");
      return;
    }
    const node = flat.find((n) => n.task.id === d.id);
    if (!node) return;
    if (node.isPackage) {
      const scope = new Set([d.id, ...taskDescendantIds(tasks, d.id)]);
      store.mutate((v) => {
        v.tasks = v.tasks.map((t) => (scope.has(t.id) && (t.startDate || t.dueDate) ? { ...t, startDate: t.startDate && shiftIsoDate(t.startDate, d.delta), dueDate: t.dueDate && shiftIsoDate(t.dueDate, d.delta), updatedAt: now } : t));
      }, { audit: { action: "task.move", entity: "tasks", entityId: d.id } });
      return;
    }
    const r = leafRange(node.task, project.hoursPerDay);
    if (!r) return;
    let next: Range = r;
    if (d.kind === "move") next = { start: shiftIsoDate(r.start, d.delta), end: shiftIsoDate(r.end, d.delta) };
    if (d.kind === "start") { const s = shiftIsoDate(r.start, d.delta); next = { start: s > r.end ? r.end : s, end: r.end }; }
    if (d.kind === "end") { const e2 = shiftIsoDate(r.end, d.delta); next = { start: r.start, end: e2 < r.start ? r.start : e2 }; }
    store.update("tasks", node.task.id, { startDate: next.start, dueDate: next.end }, "task.move");
  };

  /** Click on an empty row: give an undated task its first dates. */
  const placeAt = (e: ReactPointerEvent<HTMLDivElement>, t: Task) => {
    if (!ctx.canEdit) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const day = shiftIsoDate(from, Math.floor((e.clientX - rect.left) / px));
    const start = isWeekendIso(day) ? addWorkdaysIso(day, 1) : day;
    requireStore().update("tasks", t.id, { startDate: start, dueDate: addWorkdaysIso(start, workdaysForHours(t.estimateHours, project.hoursPerDay) - 1) }, "task.schedule");
  };

  if (!tasks.length && !milestones.length) {
    return <EmptyState icon={<CalendarRange className="h-8 w-8" />} title="Noch nichts zu planen" body="Leg zuerst Aufgaben an – der Zeitplan zeigt sie dann als Balken. Mit „Automatisch planen“ werden sie nacheinander eingeteilt." action={ctx.canEdit ? <Button onClick={() => ctx.goTab("aufgaben")}>Zu den Aufgaben</Button> : undefined} />;
  }

  const labelW = "w-36 sm:w-60";
  const months: { label: string; start: number; len: number }[] = [];
  dates.forEach((d, i) => {
    const key = d.slice(0, 7);
    const last = months.at(-1);
    if (last && last.label === key) last.len++;
    else months.push({ label: key, start: i, len: 1 });
  });

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-(--glass-border) px-4 py-2.5">
        <div className="flex items-center rounded-[10px] border border-(--border)">
          <button onClick={() => setZoom(-1)} disabled={px === ZOOMS[0]} className="rounded-l-[10px] p-2 text-(--text-muted) hover:bg-(--surface-2) disabled:opacity-40" aria-label="Verkleinern"><Minus className="h-4 w-4" /></button>
          <span className="w-px self-stretch bg-(--border)" />
          <button onClick={() => setZoom(1)} disabled={px === ZOOMS.at(-1)} className="rounded-r-[10px] p-2 text-(--text-muted) hover:bg-(--surface-2) disabled:opacity-40" aria-label="Vergrößern"><Plus className="h-4 w-4" /></button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { const el = scroller.current; if (el) el.scrollTo({ left: Math.max(0, x(today) - el.clientWidth / 3), behavior: "smooth" }); }}>
          <CalendarCheck className="h-4 w-4" /> Heute
        </Button>
        <div className="hidden flex-wrap items-center gap-3 text-xs text-(--text-muted) lg:flex">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-brand-600" /> Aufgabe</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-5 rounded-full bg-slate-500" /> Arbeitspaket</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1 w-5 rounded-full bg-amber-500" /> Erfasste Zeit</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 bg-brand-700" /> Meilenstein</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-red-500" /> Heute</span>
        </div>
        {ctx.canEdit && tasks.length ? (
          <Button size="sm" className="ml-auto" onClick={() => setPlanning(true)}><WandSparkles className="h-4 w-4" /> Automatisch planen</Button>
        ) : null}
      </div>

      <div ref={scroller} className="relative overflow-x-auto overscroll-x-contain" onPointerMove={onMove} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
        <style>{`.gantt-lw{--lw:9rem}@media (min-width:640px){.gantt-lw{--lw:15rem}}`}</style>
        <div className="gantt-lw relative" style={{ width: `calc(var(--lw) + ${width}px)` }}>
            {/* weekend shading + today line */}
            <div className="pointer-events-none absolute bottom-0 z-0" style={{ left: "var(--lw)", top: HEAD, width }}>
              {dates.map((d, i) => (isWeekendIso(d) ? <div key={d} className="absolute inset-y-0 bg-(--surface-2)" style={{ left: i * px, width: px }} /> : null))}
              {today >= from && isoDaysBetween(from, today) < days ? <div className="absolute inset-y-0 w-0.5 bg-red-500/80" style={{ left: x(today) + px / 2 - 1 }} /> : null}
            </div>

            {/* header */}
            <div className="sticky top-0 z-20 flex border-b border-(--border) bg-(--surface)" style={{ height: HEAD }}>
              <div className={cls("sticky left-0 z-30 flex shrink-0 items-end border-r border-(--border) bg-(--surface) px-3 pb-1.5 text-xs font-medium text-(--text-muted)", labelW)}>Aufgabe</div>
              <div className="relative" style={{ width }}>
                {months.map((m) => (
                  <div key={m.label} className="absolute top-0 h-5 truncate border-l border-(--border) px-1.5 text-[11px] font-medium leading-5 text-(--text-muted)" style={{ left: m.start * px, width: m.len * px }}>
                    {m.len * px > 50 ? new Date(`${m.label}-01T00:00:00`).toLocaleDateString("de-AT", { month: m.len * px > 110 ? "long" : "short", year: "numeric" }) : ""}
                  </div>
                ))}
                {dates.map((d, i) => {
                  if (px < 18 && isoWeekday(d) !== 0) return null;
                  return (
                    <div key={d} className={cls("absolute bottom-0 flex h-6 flex-col items-center justify-center text-[10px] leading-none tabular", d === today ? "font-semibold text-red-600" : isWeekendIso(d) ? "text-slate-400" : "text-(--text-muted)")} style={{ left: i * px, width: px < 18 ? px * 7 : px }}>
                      {px < 18 ? <span className="self-start pl-0.5">KW {isoWeekNumber(d)}</span> : <><span>{"MDMDFSS"[isoWeekday(d)]}</span><span>{Number(d.slice(8, 10))}</span></>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* project row */}
            {project.startDate || project.endDate ? (
              <Row label={<span className="truncate text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Projekt</span>} labelW={labelW} width={width}>
                {(() => {
                  const s = project.startDate ?? project.endDate!;
                  const e = project.endDate ?? project.startDate!;
                  return <div title={`${fmtDate(s)} – ${fmtDate(e)}`} className="absolute top-[13px] h-2.5 rounded-full bg-brand-200 dark:bg-brand-900" style={{ left: x(s), width: (isoDaysBetween(s, e) + 1) * px }} />;
                })()}
              </Row>
            ) : null}

            {/* task rows */}
            {visibleRows.map((n) => {
              const t = n.task;
              const r = ranges.get(t.id);
              const done = !n.isPackage && t.status === "done";
              const overdue = !n.isPackage && isTaskOverdue(t, today);
              const runs = actual.get(t.id) ?? [];
              return (
                <Row
                  key={t.id}
                  labelW={labelW}
                  width={width}
                  label={
                    <span className="flex min-w-0 items-center gap-1" style={{ paddingLeft: n.depth * 12 }}>
                      {n.isPackage ? (
                        <button onClick={() => setCollapsed((c) => { const s = new Set(c); if (s.has(t.id)) s.delete(t.id); else s.add(t.id); return s; })} className="shrink-0 rounded p-0.5 text-(--text-muted) hover:bg-(--surface-2)" aria-label="Auf-/zuklappen">
                          {collapsed.has(t.id) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      ) : <span className="w-4.5 shrink-0" />}
                      <button onClick={() => ctx.openTask(t)} className="flex min-w-0 items-baseline gap-1.5 text-left hover:text-brand-700 dark:hover:text-brand-400">
                        <span className="shrink-0 text-[11px] tabular text-(--text-muted)">{n.number}</span>
                        <span className={cls("truncate text-[13px]", n.isPackage ? "font-semibold" : "", done && "text-(--text-muted)")}>{t.title}</span>
                      </button>
                    </span>
                  }
                  onEmptyPointerDown={!r && !n.isPackage && ctx.canEdit ? (e) => placeAt(e, t) : undefined}
                >
                  {runs.map((run) => (
                    <div key={run.start} title={`Zeit erfasst ${fmtDate(run.start)}${run.end !== run.start ? ` – ${fmtDate(run.end)}` : ""}`} className="absolute bottom-[3px] h-1 rounded-full bg-amber-500" style={{ left: x(run.start) + 1, width: (isoDaysBetween(run.start, run.end) + 1) * px - 2 }} />
                  ))}
                  {r ? (
                    n.isPackage ? (
                      <div
                        title={`${t.title}: ${fmtDate(r.start)} – ${fmtDate(r.end)}`}
                        onPointerDown={(e) => begin(e, t.id, "move")}
                        className={cls("absolute top-[14px] h-2 rounded-full bg-slate-500 dark:bg-slate-400", ctx.canEdit && "cursor-grab active:cursor-grabbing")}
                        style={{ left: x(r.start), width: (isoDaysBetween(r.start, r.end) + 1) * px }}
                      />
                    ) : (
                      <div
                        title={`${t.title}: ${fmtDate(r.start)} – ${fmtDate(r.end)}${t.estimateHours ? ` · ${t.estimateHours.toLocaleString("de-AT")} h geplant` : ""}`}
                        onPointerDown={(e) => begin(e, t.id, "move")}
                        onClick={() => !suppressClick.current && ctx.openTask(t)}
                        className={cls(
                          "group absolute top-[8px] flex h-[18px] items-center overflow-hidden rounded-[5px] px-1.5 text-[11px] font-medium text-white select-none",
                          done ? "bg-brand-600/45" : t.status === "blocked" ? "bg-red-500" : "bg-brand-600",
                          overdue && "ring-2 ring-red-500 ring-offset-1 ring-offset-(--surface)",
                          ctx.canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                          drag?.id === t.id && "shadow-pop",
                        )}
                        style={{ left: x(r.start) + 1, width: Math.max(px - 2, (isoDaysBetween(r.start, r.end) + 1) * px - 2) }}
                      >
                        <span className="truncate">{(isoDaysBetween(r.start, r.end) + 1) * px > 70 ? t.title : ""}</span>
                        {ctx.canEdit ? (
                          <>
                            <span onPointerDown={(e) => begin(e, t.id, "start")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize opacity-0 group-hover:bg-white/30 group-hover:opacity-100" />
                            <span onPointerDown={(e) => begin(e, t.id, "end")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize opacity-0 group-hover:bg-white/30 group-hover:opacity-100" />
                          </>
                        ) : null}
                      </div>
                    )
                  ) : !n.isPackage ? (
                    <span className="pointer-events-none absolute top-[10px] text-[11px] text-(--text-muted)" style={{ left: Math.max(4, x(today) + 8) }}>{ctx.canEdit ? "Kein Termin – hier klicken, um ihn zu setzen" : "Kein Termin"}</span>
                  ) : null}
                </Row>
              );
            })}

            {/* milestones */}
            {sortedMs.map((m, i) => {
              const d = msDate(m);
              const overdue = isMilestoneOverdue(m, today);
              const code = milestoneCode(milestoneTaskIds(m, tasks).map((id) => numbers.get(id) ?? "").filter(Boolean), i);
              return (
                <Row
                  key={m.id}
                  labelW={labelW}
                  width={width}
                  label={
                    <button onClick={() => setMsDialog(m)} className="flex min-w-0 items-baseline gap-1.5 pl-5 text-left hover:text-brand-700 dark:hover:text-brand-400">
                      <span className="shrink-0 text-[11px] tabular text-(--text-muted)">{code}</span>
                      <span className={cls("truncate text-[13px] font-medium", m.status === "done" && "text-(--text-muted)")}>{m.title}</span>
                    </button>
                  }
                >
                  {d ? (
                    <div
                      title={`${m.title}: ${fmtDate(d)}`}
                      onPointerDown={(e) => begin(e, m.id, "ms")}
                      onClick={() => !suppressClick.current && setMsDialog(m)}
                      className={cls("absolute top-[11px] h-3.5 w-3.5 rotate-45 rounded-[3px]", m.status === "done" ? "bg-slate-400" : overdue ? "bg-red-500" : "bg-brand-700 dark:bg-brand-400", ctx.canEdit ? "cursor-grab" : "cursor-pointer")}
                      style={{ left: x(d) + px / 2 - 7 }}
                    />
                  ) : (
                    <span className="absolute top-[10px] text-[11px] text-(--text-muted)" style={{ left: Math.max(4, x(today) + 8) }}>Ohne Datum</span>
                  )}
                </Row>
              );
            })}
        </div>
      </div>
      {ctx.canEdit ? <p className="border-t border-(--glass-border) px-4 py-2 text-[11px] text-(--text-muted) max-md:hidden">Balken ziehen verschiebt, an den Enden ziehen ändert Start oder Ende. Arbeitspakete verschieben alle Unteraufgaben mit.</p> : null}

      <AutoPlanDialog open={planning} onClose={() => setPlanning(false)} ctx={ctx} tasks={tasks} milestones={milestones} />
      <MilestoneDialog open={!!msDialog} onClose={() => setMsDialog(null)} milestone={msDialog ?? undefined} projectId={project.id} readOnly={!ctx.canEdit} />
    </Card>
  );
}

function Row({ label, children, labelW, width, onEmptyPointerDown }: { label: React.ReactNode; children?: React.ReactNode; labelW: string; width: number; onEmptyPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void }) {
  return (
    <div className="relative z-[1] flex border-b border-(--border)" style={{ height: ROW }}>
      <div className={cls("sticky left-0 z-10 flex shrink-0 items-center border-r border-(--border) bg-(--surface) px-2", labelW)}>{label}</div>
      <div className={cls("relative", onEmptyPointerDown && "cursor-copy")} style={{ width }} onPointerDown={onEmptyPointerDown}>
        {children}
      </div>
    </div>
  );
}

function AutoPlanDialog({ open, onClose, ctx, tasks, milestones }: { open: boolean; onClose: () => void; ctx: DetailContext; tasks: Task[]; milestones: Milestone[] }) {
  const { project } = ctx;
  const hasDone = tasks.some((t) => t.status === "done");
  const [start, setStart] = useState<string | undefined>(project.startDate ?? todayIso());
  const [hpd, setHpd] = useState(String(project.hoursPerDay).replace(".", ","));
  const [keepDone, setKeepDone] = useState(hasDone);
  const [moveEnd, setMoveEnd] = useState(false);
  useEffect(() => {
    if (!open) return;
    setStart(project.startDate && (project.startDate >= todayIso() || !hasDone) ? project.startDate : todayIso());
    setHpd(String(project.hoursPerDay).replace(".", ","));
    setKeepDone(hasDone);
    setMoveEnd(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const hoursPerDay = Math.min(24, Math.max(0.5, Number(hpd.replace(",", ".")) || project.hoursPerDay));
  const result = useMemo(() => (open ? autoSchedule(project, tasks, milestones, { startDate: start, hoursPerDay, keepDone, today: todayIso() }) : null), [open, project, tasks, milestones, start, hoursPerDay, keepDone]);
  const planned = result ? [...result.tasks.keys()].filter((id) => !tasks.find((t) => t.id === id && keepDone && t.status === "done")).length : 0;
  const lateEnd = result?.endDate && project.endDate && result.endDate > project.endDate;

  const apply = () => {
    if (!result) return;
    const now = nowIso();
    requireStore().mutate((v) => {
      v.tasks = v.tasks.map((t) => {
        const r = result.tasks.get(t.id);
        return r && (t.startDate !== r.startDate || t.dueDate !== r.dueDate) ? { ...t, startDate: r.startDate, dueDate: r.dueDate, updatedAt: now } : t;
      });
      v.milestones = v.milestones.map((m) => (result.milestoneDates.has(m.id) ? { ...m, dueDate: result.milestoneDates.get(m.id), updatedAt: now } : m));
      v.projects = v.projects.map((p) => (p.id === project.id ? { ...p, hoursPerDay, startDate: p.startDate ?? start, endDate: moveEnd && result.endDate ? result.endDate : p.endDate ?? result.endDate, updatedAt: now } : p));
    }, { audit: { action: "project.autoSchedule", entity: "projects", entityId: project.id } });
    const late = result.lateMilestones.map((l) => milestones.find((m) => m.id === l.id)?.title).filter(Boolean);
    if (late.length) toast.warning("Geplant – ein Meilenstein wird knapp", `${late.join(", ")}: die Aufgaben enden nach dem Meilenstein-Datum.`);
    else toast.success("Zeitplan erstellt", result.endDate ? `Voraussichtlich fertig am ${fmtDate(result.endDate)}.` : undefined);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Automatisch planen" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={apply} disabled={!result?.tasks.size}>Termine setzen</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-(--text-muted)">Die Aufgaben werden in ihrer Reihenfolge nacheinander eingeplant – jede braucht so viele Arbeitstage, wie ihre Schätzung bei den Stunden pro Tag ergibt (mindestens einen). Wochenenden bleiben frei, Arbeitspakete reichen über ihre Unteraufgaben. <strong className="font-medium text-(--text)">Bestehende Termine werden überschrieben.</strong></p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Beginnen am">
            <DateInput value={start} onChange={setStart} />
          </Field>
          <Field label="Produktive Stunden pro Arbeitstag">
            <Input inputMode="decimal" value={hpd} onChange={(e) => setHpd(e.target.value)} className="tabular" />
          </Field>
        </div>
        {hasDone ? <Checkbox checked={keepDone} onChange={setKeepDone} label="Erledigte Aufgaben behalten ihre Termine" hint="Geplant wird nur, was noch offen ist." /> : null}
        {result ? (
          <div className="rounded-xl bg-(--surface-2) px-4 py-3 text-sm">
            <div>{planned} Aufgaben werden eingeplant{result.endDate ? <>, fertig voraussichtlich am <strong className="tabular">{fmtDate(result.endDate)}</strong></> : null}.</div>
            {result.milestoneDates.size ? <div className="mt-1 text-(--text-muted)">{result.milestoneDates.size} Meilenstein{result.milestoneDates.size === 1 ? "" : "e"} ohne Datum bekommt das Ende seiner Aufgaben.</div> : null}
            {result.lateMilestones.length ? <div className="mt-1 text-amber-700 dark:text-amber-400">{result.lateMilestones.length} Meilenstein{result.lateMilestones.length === 1 ? " wird" : "e werden"} damit später fertig als geplant.</div> : null}
            {lateEnd ? (
              <div className="mt-2">
                <div className="text-amber-700 dark:text-amber-400">Das ist nach dem Projektende ({fmtDate(project.endDate)}).</div>
                <div className="mt-2"><Checkbox checked={moveEnd} onChange={setMoveEnd} label={`Projektende auf ${fmtDate(result.endDate)} setzen`} /></div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
