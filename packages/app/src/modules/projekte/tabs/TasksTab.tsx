import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Clock, Diamond, GripVertical, ListTree, MoreHorizontal, Pencil, Plus, SquareKanban, Trash2 } from "lucide-react";
import { buildTaskTree, cleanTaskTitle, flattenTaskTree, isTaskOverdue, milestoneCode, milestoneTaskIds, moveTaskOrder, overdueDays, placeTaskOrder, taskDescendantIds, taskRollups, todayIso, type Milestone, type Task, type TaskNode, type TaskStatus, type TimeEntry } from "@ordo/core";
import { Badge, Button, ConfirmDialog, EmptyState, Menu, Select, Tabs } from "@/components/ui";
import { useProfile, useVault } from "@/state/hooks";
import { toast } from "@/state/toasts";
import { cls, fmtDate } from "@/lib/format";
import { PRIORITY, TASK_STATUS, TASK_STATUS_ORDER, fmtDayMonth } from "../labels";
import { AvatarStack, HoursBar, ProgressLine, TaskStatusSelect } from "../parts";
import { useMembers, useProjectRights } from "../hooks";
import { applyTaskOrder, bookedMinutesInTree, createTask, deleteTaskTree, setTaskStatus } from "../actions";
import type { DetailContext } from "../ProjectDetail";
import { sortMilestones } from "../data";

type View = "tree" | "board";
const VIEW_KEY = "ordo.projekte.taskView";

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "board" ? "board" : "tree";
  } catch {
    return "tree";
  }
}

export function TasksTab({ ctx, tasks, entries, milestones }: { ctx: DetailContext; tasks: Task[]; entries: TimeEntry[]; milestones: Milestone[] }) {
  const [view, setViewState] = useState<View>(readView);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hideDone, setHideDone] = useState(false);
  const roots = useMemo(() => buildTaskTree(tasks), [tasks]);
  const rollups = useMemo(() => taskRollups(tasks, entries), [tasks, entries]);
  const numbers = useMemo(() => new Map(flattenTaskTree(roots).map((n) => [n.task.id, n.number])), [roots]);
  const msCode = useMemo(() => {
    const sorted = sortMilestones(milestones);
    return new Map(sorted.map((m, i) => [m.id, { code: milestoneCode(milestoneTaskIds(m, tasks).map((id) => numbers.get(id) ?? "").filter(Boolean), i), title: m.title }]));
  }, [milestones, tasks, numbers]);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  };
  const packages = flattenTaskTree(roots).filter((n) => n.isPackage);
  const allCollapsed = packages.length > 0 && packages.every((n) => collapsed.has(n.task.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onChange={setView} tabs={[{ id: "tree", label: <span className="inline-flex items-center gap-1.5"><ListTree className="h-4 w-4" /> Liste</span> }, { id: "board", label: <span className="inline-flex items-center gap-1.5"><SquareKanban className="h-4 w-4" /> Board</span> }]} />
        {view === "tree" && packages.length ? (
          <Button size="sm" variant="ghost" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(packages.map((n) => n.task.id)))}>
            {allCollapsed ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />} {allCollapsed ? "Alle aufklappen" : "Alle zuklappen"}
          </Button>
        ) : null}
        {tasks.length ? (
          <button onClick={() => setHideDone((v) => !v)} className={cls("h-8 rounded-[9px] px-3 text-[13px] font-medium", hideDone ? "bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200" : "text-(--text-muted) hover:bg-(--surface-2)")}>
            Erledigte {hideDone ? "zeigen" : "ausblenden"}
          </button>
        ) : null}
        <div className="ml-auto flex gap-2">
          {!ctx.locked ? <Button size="sm" variant="outline" onClick={() => ctx.bookTime()}><Clock className="h-4 w-4" /> Zeit erfassen</Button> : null}
          {ctx.canEdit ? <Button size="sm" onClick={() => ctx.newTask()}><Plus className="h-4 w-4" /> Neue Aufgabe</Button> : null}
        </div>
      </div>

      {!tasks.length ? (
        <EmptyState
          icon={<ListTree className="h-8 w-8" />}
          title="Noch keine Aufgaben"
          body="Teile das Projekt in Arbeitspakete und Aufgaben. Ein Arbeitspaket ist eine Aufgabe mit Unteraufgaben – z. B. „Design“ mit „Startseite“ und „Unterseiten“."
          action={ctx.canEdit ? <QuickAdd ctx={ctx} tasks={tasks} roots={roots} standalone /> : undefined}
        />
      ) : view === "tree" ? (
        <TaskTree ctx={ctx} tasks={tasks} roots={roots} rollups={rollups} collapsed={collapsed} setCollapsed={setCollapsed} hideDone={hideDone} msCode={msCode} />
      ) : (
        <TaskBoard ctx={ctx} roots={roots} rollups={rollups} hideDone={hideDone} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tree                                                                */
/* ------------------------------------------------------------------ */

type DropPos = "before" | "after" | "inside";

function TaskTree({ ctx, tasks, roots, rollups, collapsed, setCollapsed, hideDone, msCode }: { ctx: DetailContext; tasks: Task[]; roots: TaskNode[]; rollups: ReturnType<typeof taskRollups>; collapsed: Set<string>; setCollapsed: (s: Set<string>) => void; hideDone: boolean; msCode: Map<string, { code: string; title: string }> }) {
  const rights = useProjectRights();
  const vault = useVault();
  const { byId } = useMembers();
  const today = todayIso();
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);

  const rows = useMemo(() => {
    const flat = flattenTaskTree(roots, collapsed);
    if (!hideDone) return flat;
    return flat.filter((n) => (n.isPackage ? (rollups.get(n.task.id)?.progress ?? 0) < 1 : n.task.status !== "done"));
  }, [roots, collapsed, hideDone, rollups]);

  const blockedFor = useMemo(() => (dragId ? new Set([dragId, ...taskDescendantIds(tasks, dragId)]) : new Set<string>()), [dragId, tasks]);

  const toggle = (id: string) => {
    const n = new Set(collapsed);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setCollapsed(n);
  };

  const move = (t: Task, dir: -1 | 1) => {
    const order = moveTaskOrder(tasks, t.id, dir);
    if (order) applyTaskOrder(order);
  };

  const onDragOver = (e: DragEvent<HTMLLIElement>, n: TaskNode) => {
    if (!dragId || blockedFor.has(n.task.id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const pos: DropPos = y < 0.3 ? "before" : y > 0.7 ? "after" : "inside";
    if (drop?.id !== n.task.id || drop.pos !== pos) setDrop({ id: n.task.id, pos });
  };

  const onDrop = (e: DragEvent<HTMLLIElement>, n: TaskNode) => {
    e.preventDefault();
    const id = dragId;
    const pos = drop?.pos ?? "before";
    setDragId(null);
    setDrop(null);
    if (!id || blockedFor.has(n.task.id)) return;
    if (pos === "inside") {
      applyTaskOrder(placeTaskOrder(tasks, id, n.task.id), { id, parentId: n.task.id });
      setCollapsed(new Set([...collapsed].filter((x) => x !== n.task.id)));
      return;
    }
    const parentId = n.task.parentId && tasks.some((t) => t.id === n.task.parentId) ? n.task.parentId : undefined;
    let beforeId: string | undefined = n.task.id;
    if (pos === "after") {
      const siblings = (n.parent?.children ?? roots).map((c) => c.task.id).filter((x) => x !== id);
      beforeId = siblings[siblings.indexOf(n.task.id) + 1];
    }
    applyTaskOrder(placeTaskOrder(tasks, id, parentId, beforeId), { id, parentId });
  };

  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, n: TaskNode) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") ctx.openTask(n.task);
    else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && ctx.canEdit) {
      e.preventDefault();
      move(n.task, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const sib = e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
      (sib as HTMLElement | null)?.focus();
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && n.isPackage) {
      const isCollapsed = collapsed.has(n.task.id);
      if ((e.key === "ArrowLeft") !== isCollapsed) toggle(n.task.id);
    }
  };

  return (
    <div className="surface overflow-hidden">
      <div className="hidden items-center gap-3 border-b border-(--border) bg-(--surface-2) px-3 py-2 text-xs font-medium text-(--text-muted) md:flex">
        <span className="w-10" />
        <span className="flex-1">Aufgabe</span>
        <span className="w-20">Zuständig</span>
        <span className="w-16">Fällig</span>
        <span className="w-24 text-right">Erfasst / geplant</span>
        <span className="w-32">Status</span>
        <span className="w-8" />
      </div>
      <ul onDragEnd={() => { setDragId(null); setDrop(null); }}>
        {rows.map((n) => {
          const t = n.task;
          const r = rollups.get(t.id);
          const overdue = !n.isPackage && isTaskOverdue(t, today);
          const canStatus = !ctx.locked && rights.canEditTask(t);
          const isDrop = drop?.id === t.id;
          const ms = t.milestoneId ? msCode.get(t.milestoneId) : undefined;
          return (
            <li
              key={t.id}
              tabIndex={0}
              draggable={ctx.canEdit}
              onDragStart={(e) => {
                setDragId(t.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", t.id);
              }}
              onDragOver={(e) => onDragOver(e, n)}
              onDragLeave={() => isDrop && setDrop(null)}
              onDrop={(e) => onDrop(e, n)}
              onKeyDown={(e) => onRowKey(e, n)}
              className={cls(
                "group relative flex items-center gap-2 border-b border-(--border) px-2 py-2 last:border-b-0 hover:bg-(--surface-2) focus-visible:bg-(--surface-2) focus-visible:outline-none md:gap-3 md:px-3",
                dragId === t.id && "opacity-40",
                isDrop && drop.pos === "inside" && "bg-brand-50 ring-2 ring-inset ring-brand-500 dark:bg-brand-900/30",
                n.isPackage && "bg-(--surface-2)/40",
              )}
            >
              {isDrop && drop.pos !== "inside" ? <span className={cls("pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-brand-600", drop.pos === "before" ? "top-0" : "bottom-0")} /> : null}
              <span className="flex w-10 shrink-0 items-center">
                {ctx.canEdit ? <GripVertical className="hidden h-4 w-4 cursor-grab text-(--text-muted) opacity-0 group-hover:opacity-100 md:block" aria-hidden /> : <span className="hidden w-4 md:block" />}
                {n.isPackage ? (
                  <button onClick={() => toggle(t.id)} className="rounded p-0.5 text-(--text-muted) hover:bg-(--surface) hover:text-(--text)" aria-label={collapsed.has(t.id) ? "Aufklappen" : "Zuklappen"}>
                    {collapsed.has(t.id) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                ) : null}
              </span>
              <button onClick={() => ctx.openTask(t)} className="flex min-w-0 flex-1 items-start gap-2 text-left" style={{ paddingLeft: n.depth * 18 }}>
                <span className="mt-px shrink-0 text-xs tabular text-(--text-muted)">{n.number}</span>
                <span className="min-w-0 flex-1">
                  <span className={cls("block truncate text-sm", n.isPackage ? "font-semibold" : "font-medium", !n.isPackage && t.status === "done" && "text-(--text-muted) line-through decoration-(--border)")}>{t.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-(--text-muted)">
                    {n.isPackage ? <span>Arbeitspaket · {r?.doneLeafCount ?? 0}/{r?.leafCount ?? 0} erledigt</span> : null}
                    {t.priority === "high" || t.priority === "urgent" ? <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge> : null}
                    {overdue ? <Badge tone="danger">{overdueDays(t.dueDate, today)} T. überfällig</Badge> : null}
                    {ms ? <span className="inline-flex items-center gap-0.5" title={ms.title}><Diamond className="h-3 w-3" />{ms.code}</span> : null}
                    <span className="md:hidden">{t.dueDate ? `fällig ${fmtDayMonth(t.dueDate)}` : ""}</span>
                  </span>
                </span>
              </button>
              <span className="hidden w-20 md:block"><AvatarStack ids={t.assigneeIds} byId={byId} /></span>
              <span className={cls("hidden w-16 text-xs tabular md:block", overdue ? "font-medium text-red-600 dark:text-red-400" : "text-(--text-muted)")}>{t.dueDate ? fmtDayMonth(t.dueDate) : "–"}</span>
              <span className="hidden w-24 justify-end sm:flex">{r ? <HoursBar trackedMinutes={r.trackedMinutes} estimateHours={r.estimateHours} compact /> : null}</span>
              <span className="flex w-auto shrink-0 justify-end md:w-32 md:justify-start">
                {n.isPackage ? (
                  <span className="hidden w-28 md:block"><ProgressLine value={r?.progress ?? 0} label={<span className="tabular">{Math.round((r?.progress ?? 0) * 100)} %</span>} /></span>
                ) : (
                  <TaskStatusSelect value={t.status} disabled={!canStatus} onChange={(s) => setTaskStatus(t, s)} />
                )}
              </span>
              <span className="flex w-8 shrink-0 justify-end">
                <Menu
                  trigger={<button className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface) hover:text-(--text)" aria-label="Aktionen"><MoreHorizontal className="h-4 w-4" /></button>}
                  items={[
                    { label: "Öffnen", icon: <Pencil className="h-4 w-4" />, onClick: () => ctx.openTask(t) },
                    ...(!ctx.locked && (rights.canWriteTime || rights.canOwnTime) ? [{ label: "Zeit erfassen", icon: <Clock className="h-4 w-4" />, onClick: () => ctx.bookTime({ taskId: t.id }) }] : []),
                    ...(ctx.canEdit
                      ? [
                          { label: "Unteraufgabe anlegen", icon: <Plus className="h-4 w-4" />, onClick: () => ctx.newTask({ parentId: t.id }) },
                          { label: "Nach oben", icon: <ArrowUp className="h-4 w-4" />, onClick: () => move(t, -1) },
                          { label: "Nach unten", icon: <ArrowDown className="h-4 w-4" />, onClick: () => move(t, 1) },
                          { label: "Löschen", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => {
                            if (bookedMinutesInTree(vault, t.id) !== 0) toast.warning("Löschen geht nicht", "Auf dieser Aufgabe ist Zeit gebucht. Korrigiere zuerst die Zeiten.");
                            else setConfirmDelete(t);
                          } },
                        ]
                      : []),
                  ]}
                />
              </span>
            </li>
          );
        })}
      </ul>
      {ctx.canEdit ? (
        <div className="border-t border-(--border) px-3 py-2">
          <QuickAdd ctx={ctx} tasks={tasks} roots={roots} />
        </div>
      ) : null}
      {ctx.canEdit ? <p className="border-t border-(--border) px-4 py-2 text-[11px] text-(--text-muted) max-md:hidden">Ziehen zum Sortieren – in die Mitte einer Zeile ziehen macht sie zum Arbeitspaket. Tastatur: ↑↓ wählen, Enter öffnen, Alt+↑↓ verschieben, ←→ auf-/zuklappen.</p> : null}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        danger
        title="Aufgabe löschen?"
        body={confirmDelete && tasks.some((x) => x.parentId === confirmDelete.id) ? `„${confirmDelete.title}“ wird mit allen Unteraufgaben gelöscht.` : `„${confirmDelete?.title}“ wird gelöscht.`}
        confirmLabel="Löschen"
        onConfirm={() => {
          if (confirmDelete && deleteTaskTree(confirmDelete)) toast.success("Gelöscht");
        }}
      />
    </div>
  );
}

/** One-line add: Enter creates the task (a trailing "4h" becomes the estimate); stays focused for the next one. */
function QuickAdd({ ctx, tasks, roots, standalone }: { ctx: DetailContext; tasks: Task[]; roots: TaskNode[]; standalone?: boolean }) {
  const profile = useProfile();
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const ref = useRef<HTMLInputElement>(null);
  const options = useMemo(() => flattenTaskTree(roots).filter((n) => n.depth < 3), [roots]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable=true]") || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const add = () => {
    let text = title.trim();
    if (!text) return;
    let estimateHours = 0;
    const m = text.match(/\s(\d+(?:[.,]\d+)?)\s?(?:h|std\.?)$/i);
    if (m) {
      estimateHours = Number(m[1]!.replace(",", "."));
      text = text.slice(0, m.index).trim();
    }
    createTask(profile.id, ctx.project.id, { title: cleanTaskTitle(text), estimateHours, parentId: parentId || undefined });
    setTitle("");
    ref.current?.focus();
  };
  return (
    <div className={cls("flex flex-wrap items-center gap-2", standalone && "w-full max-w-lg")}>
      <Plus className="h-4 w-4 shrink-0 text-(--text-muted)" />
      <input
        ref={ref}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Escape") setTitle("");
        }}
        placeholder={standalone ? "Erste Aufgabe, z. B. „Kick-off 2h“ – Enter" : "Neue Aufgabe … (z. B. „Logo entwerfen 4h“) – Enter  ·  Taste N"}
        className="h-9 min-w-40 flex-1 bg-transparent text-sm outline-none placeholder:text-(--text-muted)"
      />
      {tasks.length ? (
        <Select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-44 text-[13px]" aria-label="Gehört zu">
          <option value="">Hauptebene</option>
          {options.map((n) => <option key={n.task.id} value={n.task.id}>{"  ".repeat(n.depth)}{n.number} {n.task.title}</option>)}
        </Select>
      ) : null}
      {title.trim() ? <Button size="sm" onClick={add}>Anlegen</Button> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

function TaskBoard({ ctx, roots, rollups, hideDone }: { ctx: DetailContext; roots: TaskNode[]; rollups: ReturnType<typeof taskRollups>; hideDone: boolean }) {
  const rights = useProjectRights();
  const { byId } = useMembers();
  const today = todayIso();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const leaves = useMemo(() => flattenTaskTree(roots).filter((n) => !n.isPackage), [roots]);
  const columns = TASK_STATUS_ORDER.filter((s) => (s !== "blocked" || leaves.some((n) => n.task.status === "blocked") || dragId) && (!hideDone || s !== "done"));
  const dragged = leaves.find((n) => n.task.id === dragId)?.task;

  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div className="flex min-w-max gap-3">
        {columns.map((status) => {
          const items = leaves.filter((n) => n.task.status === status);
          return (
            <section
              key={status}
              onDragOver={(e) => {
                if (!dragged || !rights.canEditTask(dragged)) return;
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged && dragged.status !== status) setTaskStatus(dragged, status);
                setDragId(null);
                setOver(null);
              }}
              className={cls("flex w-72 shrink-0 flex-col rounded-[18px] bg-(--surface-2) p-2 transition-shadow", over === status && "ring-2 ring-brand-500")}
            >
              <header className="flex items-center gap-2 px-2 pb-2 pt-1 text-[13px] font-semibold">
                <span className={cls("h-2 w-2 rounded-full", TASK_STATUS[status].dot)} />
                {TASK_STATUS[status].label}
                <span className="ml-auto text-xs font-normal tabular text-(--text-muted)">{items.length}</span>
              </header>
              <div className="flex min-h-24 flex-col gap-2">
                {items.map((n) => {
                  const t = n.task;
                  const r = rollups.get(t.id);
                  const overdue = isTaskOverdue(t, today);
                  const canMove = !ctx.locked && rights.canEditTask(t);
                  return (
                    <article
                      key={t.id}
                      draggable={canMove}
                      onDragStart={(e) => {
                        setDragId(t.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", t.id);
                      }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                      className={cls("surface cursor-pointer p-3 text-sm shadow-card", dragId === t.id && "opacity-40")}
                      onClick={() => ctx.openTask(t)}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-px text-xs tabular text-(--text-muted)">{n.number}</span>
                        <span className={cls("min-w-0 flex-1 font-medium", t.status === "done" && "text-(--text-muted)")}>{t.title}</span>
                      </div>
                      {n.parent ? <div className="mt-0.5 truncate pl-6 text-xs text-(--text-muted)">{n.parent.task.title}</div> : null}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {t.priority === "high" || t.priority === "urgent" ? <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge> : null}
                        {t.dueDate ? <span className={cls("text-xs tabular", overdue ? "font-medium text-red-600 dark:text-red-400" : "text-(--text-muted)")}>{overdue ? "überfällig " : ""}{fmtDate(t.dueDate)}</span> : null}
                        <span className="ml-auto flex items-center gap-2">
                          {r && (r.trackedMinutes || r.estimateHours) ? <HoursBar trackedMinutes={r.trackedMinutes} estimateHours={r.estimateHours} compact /> : null}
                          <AvatarStack ids={t.assigneeIds} byId={byId} size="xs" />
                        </span>
                      </div>
                      {canMove ? (
                        <div className="mt-2 md:hidden" onClick={(e) => e.stopPropagation()}>
                          <TaskStatusSelect value={t.status} onChange={(s) => setTaskStatus(t, s)} />
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {!items.length ? <div className="rounded-xl border border-dashed border-(--border) px-3 py-6 text-center text-xs text-(--text-muted)">{dragId ? "Hierher ziehen" : "Leer"}</div> : null}
              </div>
              {status === "todo" && ctx.canEdit ? (
                <button onClick={() => ctx.newTask()} className="mt-2 flex items-center gap-1 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-(--text-muted) hover:bg-(--surface) hover:text-(--text)">
                  <Plus className="h-3.5 w-3.5" /> Aufgabe
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
