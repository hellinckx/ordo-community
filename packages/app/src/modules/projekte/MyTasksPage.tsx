import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Check, CheckSquare, ChevronDown, ChevronRight, Clock, Play, Plus, Search } from "lucide-react";
import { buildTaskTree, flattenTaskTree, isoDaysBetween, mondayOfIso, shiftIsoDate, todayIso, type Task, type TaskNode } from "@ordo/core";
import { Badge, Button, EmptyState, Input, PageHeader, Select, Tabs } from "@/components/ui";
import { useList, useProfile } from "@/state/hooks";
import { toast } from "@/state/toasts";
import { cls, fmtDate } from "@/lib/format";
import { PRIORITY, fmtDayMonth } from "./labels";
import { AvatarStack, TaskStatusSelect } from "./parts";
import { switchTimer, useMembers, useMyTimer, useNewParam, useProjectRights } from "./hooks";
import { setTaskStatus } from "./actions";
import { TaskDialog } from "./TaskDialog";
import { TimeEntryDialog } from "./TimeEntryDialog";

type Group = "overdue" | "today" | "week" | "later" | "none";
const GROUPS: { id: Group; label: string }[] = [
  { id: "overdue", label: "Überfällig" },
  { id: "today", label: "Heute" },
  { id: "week", label: "Diese Woche" },
  { id: "later", label: "Später" },
  { id: "none", label: "Ohne Datum" },
];
const PRIO_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

interface Row {
  node: TaskNode;
  projectName: string;
  projectNumber: string;
}

export default function MyTasksPage() {
  const profile = useProfile();
  const projects = useList("projects");
  const tasks = useList("tasks");
  const rights = useProjectRights();
  const { byId } = useMembers();
  const myTimer = useMyTimer();
  const me = rights.member;
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Task | null>(null);
  const [booking, setBooking] = useState<{ projectId: string; taskId: string } | null>(null);
  const [projectId, setProjectId] = useState("");
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const navigate = useNavigate();
  useNewParam(params, setParams, () => rights.canWrite && setCreating(true));

  const today = todayIso();
  const weekEnd = shiftIsoDate(mondayOfIso(today), 6);
  const openProjects = useMemo(() => projects.filter((p) => p.status !== "completed" && p.status !== "cancelled"), [projects]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // all leaf tasks of open projects with their tree node (for numbering and the package name)
  const all = useMemo(() => {
    const rows: Row[] = [];
    for (const p of openProjects) {
      const nodes = flattenTaskTree(buildTaskTree(tasks.filter((t) => t.projectId === p.id)));
      for (const n of nodes) if (!n.isPackage) rows.push({ node: n, projectName: p.name, projectNumber: p.number });
    }
    return rows;
  }, [openProjects, tasks]);

  const hasMine = !!me && all.some((r) => r.node.task.assigneeIds.includes(me.id));
  const [scopeChoice, setScope] = useState<"mine" | "all" | null>(null);
  const scope = scopeChoice ?? (hasMine ? "mine" : "all");

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((r) => {
      const t = r.node.task;
      if (scope === "mine" && me && !t.assigneeIds.includes(me.id)) return false;
      if (projectId && t.projectId !== projectId) return false;
      if (s && !`${t.title} ${t.description} ${r.projectName} ${r.node.parent?.task.title ?? ""}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [all, scope, me, projectId, q]);

  const groups = useMemo(() => {
    const out = new Map<Group, Row[]>(GROUPS.map((g) => [g.id, []]));
    for (const r of visible) {
      const t = r.node.task;
      if (t.status === "done") continue;
      const g: Group = !t.dueDate ? "none" : t.dueDate < today ? "overdue" : t.dueDate === today ? "today" : t.dueDate <= weekEnd ? "week" : "later";
      out.get(g)!.push(r);
    }
    for (const list of out.values()) list.sort((a, b) => (a.node.task.dueDate ?? "").localeCompare(b.node.task.dueDate ?? "") || PRIO_RANK[a.node.task.priority] - PRIO_RANK[b.node.task.priority] || a.projectName.localeCompare(b.projectName, "de"));
    return out;
  }, [visible, today, weekEnd]);
  const recentlyDone = useMemo(() => visible.filter((r) => r.node.task.status === "done" && (r.node.task.completedAt ?? "").slice(0, 10) >= shiftIsoDate(today, -7)).sort((a, b) => (b.node.task.completedAt ?? "").localeCompare(a.node.task.completedAt ?? "")), [visible, today]);
  const openCount = [...groups.values()].reduce((s, l) => s + l.length, 0);

  const toggleDone = (t: Task) => {
    const next = t.status === "done" ? "todo" : "done";
    setTaskStatus(t, next);
    if (next === "done") toast.success("Erledigt", t.title);
  };

  const start = (t: Task) => {
    const booked = switchTimer(me?.id, profile.id, { projectId: t.projectId, taskId: t.id });
    toast.info("Stoppuhr läuft", booked ? `Vorherige Zeit gebucht. Jetzt: ${t.title}` : t.title);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Meine Aufgaben"
        subtitle={scope === "mine" ? "Was dir zugewiesen ist – über alle Projekte." : "Alle offenen Aufgaben aus laufenden Projekten."}
        actions={rights.canWrite && openProjects.length ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Neue Aufgabe</Button> : undefined}
      />

      {all.length ? (
        <div className="surface flex flex-wrap items-center gap-2 p-3">
          {me ? <Tabs value={scope} onChange={(v) => setScope(v)} tabs={[{ id: "mine", label: "Mir zugewiesen" }, { id: "all", label: "Alle offenen" }]} /> : null}
          <div className="relative min-w-44 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Aufgaben suchen …" className="pl-9" />
          </div>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-52" aria-label="Projekt">
            <option value="">Alle Projekte</option>
            {[...openProjects].sort((a, b) => a.name.localeCompare(b.name, "de")).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
      ) : null}

      {!all.length ? (
        <EmptyState
          icon={<CheckSquare className="h-8 w-8" />}
          title={openProjects.length ? "Keine offenen Aufgaben" : "Noch keine Projekte"}
          body={openProjects.length ? "In deinen laufenden Projekten ist gerade nichts offen." : "Aufgaben entstehen in Projekten. Leg ein Projekt an und teile es in Aufgaben."}
          action={openProjects.length && rights.canWrite ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Neue Aufgabe</Button> : !openProjects.length && rights.canWrite ? <Button onClick={() => navigate("/projekte?neu=1")}><Plus className="h-4 w-4" /> Neues Projekt</Button> : undefined}
        />
      ) : !openCount && !recentlyDone.length ? (
        <EmptyState icon={<Check className="h-8 w-8" />} title="Alles erledigt" body={scope === "mine" ? "Dir ist gerade nichts Offenes zugewiesen." : "Für diese Filter ist nichts offen."} action={scope === "mine" ? <Button variant="outline" onClick={() => setScope("all")}>Alle offenen zeigen</Button> : undefined} />
      ) : (
        <div className="space-y-5">
          {GROUPS.map((g) => {
            const list = groups.get(g.id)!;
            if (!list.length) return null;
            return (
              <section key={g.id}>
                <h2 className={cls("mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold", g.id === "overdue" && "text-red-600 dark:text-red-400")}>
                  {g.label}
                  <span className="font-normal tabular text-(--text-muted)">{list.length}</span>
                </h2>
                <ul className="surface divide-y divide-(--border) overflow-hidden">
                  {list.map((r) => (
                    <TaskRow key={r.node.task.id} row={r} today={today} canEdit={rights.canEditTask(r.node.task) && projectById.get(r.node.task.projectId)?.status !== "completed"} canTime={rights.canWriteTime || rights.canOwnTime} running={myTimer?.taskId === r.node.task.id} onToggle={toggleDone} onOpen={setOpen} onStart={start} onBook={(t) => setBooking({ projectId: t.projectId, taskId: t.id })} byId={byId} showAssignees={scope === "all"} />
                  ))}
                </ul>
              </section>
            );
          })}
          {recentlyDone.length ? (
            <section>
              <button onClick={() => setShowDone((v) => !v)} className="mb-2 flex items-center gap-1 px-1 text-[13px] font-semibold text-(--text-muted) hover:text-(--text)">
                {showDone ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Zuletzt erledigt <span className="font-normal tabular">{recentlyDone.length}</span>
              </button>
              {showDone ? (
                <ul className="surface divide-y divide-(--border) overflow-hidden">
                  {recentlyDone.map((r) => (
                    <TaskRow key={r.node.task.id} row={r} today={today} canEdit={rights.canEditTask(r.node.task)} canTime={false} running={false} onToggle={toggleDone} onOpen={setOpen} onStart={start} onBook={() => undefined} byId={byId} showAssignees={scope === "all"} />
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>
      )}

      <TaskDialog open={creating} onClose={() => setCreating(false)} chooseProject projectId={projectId || undefined} />
      <TaskDialog open={!!open} onClose={() => setOpen(null)} task={open ?? undefined} projectId={open?.projectId} onBookTime={(t) => setBooking({ projectId: t.projectId, taskId: t.id })} />
      <TimeEntryDialog open={!!booking} onClose={() => setBooking(null)} projectId={booking?.projectId} taskId={booking?.taskId} />
    </div>
  );
}

function TaskRow({ row, today, canEdit, canTime, running, onToggle, onOpen, onStart, onBook, byId, showAssignees }: { row: Row; today: string; canEdit: boolean; canTime: boolean; running: boolean; onToggle: (t: Task) => void; onOpen: (t: Task) => void; onStart: (t: Task) => void; onBook: (t: Task) => void; byId: ReturnType<typeof useMembers>["byId"]; showAssignees: boolean }) {
  const t = row.node.task;
  const done = t.status === "done";
  const late = !!t.dueDate && t.dueDate < today && !done;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 hover:bg-(--surface-2) sm:px-4">
      <button disabled={!canEdit} onClick={() => onToggle(t)} aria-label={done ? "Wieder öffnen" : "Erledigt"} className={cls("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors disabled:opacity-50", done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 hover:border-brand-600 dark:border-slate-600")}>
        {done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </button>
      <button onClick={() => onOpen(t)} className="min-w-0 flex-1 text-left">
        <span className={cls("block truncate text-sm font-medium", done && "text-(--text-muted) line-through decoration-(--border)")}>{t.title}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-(--text-muted)">
          <Link to={`/projekte/${t.projectId}/aufgaben`} onClick={(e) => e.stopPropagation()} className="truncate hover:text-brand-700 hover:underline dark:hover:text-brand-400">{row.projectName}</Link>
          {row.node.parent ? <span className="truncate">· {row.node.parent.task.title}</span> : null}
          {t.priority === "high" || t.priority === "urgent" ? <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge> : null}
        </span>
      </button>
      {showAssignees ? <span className="hidden sm:block"><AvatarStack ids={t.assigneeIds} byId={byId} size="xs" /></span> : null}
      <span className={cls("w-14 shrink-0 text-right text-xs tabular", late ? "font-medium text-red-600 dark:text-red-400" : "text-(--text-muted)")} title={t.dueDate ? fmtDate(t.dueDate) : undefined}>
        {t.dueDate ? (late ? `${isoDaysBetween(t.dueDate, today)} T. drüber` : t.dueDate === today ? "heute" : fmtDayMonth(t.dueDate)) : ""}
      </span>
      <span className="hidden sm:block"><TaskStatusSelect value={t.status} disabled={!canEdit} onChange={(s) => setTaskStatus(t, s)} /></span>
      {canTime && !done ? (
        running ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center" title="Stoppuhr läuft"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /></span>
        ) : (
          <span className="flex shrink-0">
            <button onClick={() => onStart(t)} className="flex h-8 w-8 items-center justify-center rounded-lg text-(--text-muted) hover:bg-(--surface) hover:text-brand-700" aria-label="Stoppuhr starten" title="Stoppuhr starten"><Play className="h-4 w-4" /></button>
            <button onClick={() => onBook(t)} className="hidden h-8 w-8 items-center justify-center rounded-lg text-(--text-muted) hover:bg-(--surface) hover:text-brand-700 sm:flex" aria-label="Zeit nachtragen" title="Zeit nachtragen"><Clock className="h-4 w-4" /></button>
          </span>
        )
      ) : null}
    </li>
  );
}
