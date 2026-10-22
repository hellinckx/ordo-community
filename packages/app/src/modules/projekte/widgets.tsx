import { useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, CheckSquare, Diamond, FolderKanban, Plus } from "lucide-react";
import { isMilestoneOverdue, mondayOfIso, shiftIsoDate, todayIso, weekOfIso } from "@ordo/core";
import { Badge, Button, Card } from "@/components/ui";
import { useContactMap, useList } from "@/state/hooks";
import { cls, fmtDate } from "@/lib/format";
import { WEEKDAYS_SHORT, fmtDayMonth, fmtH } from "./labels";
import { ProgressLine } from "./parts";
import { useProjectRights } from "./hooks";
import { useAllProjectStats } from "./data";
import { Stopwatch } from "./Stopwatch";

/** Übersicht: active projects with progress. */
export function ActiveProjectsWidget() {
  const projects = useList("projects");
  const contacts = useContactMap();
  const stats = useAllProjectStats();
  const rights = useProjectRights();
  const navigate = useNavigate();
  const list = useMemo(
    () => projects.filter((p) => p.status === "active" || p.status === "on_hold").sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1) || (a.endDate ?? "9999").localeCompare(b.endDate ?? "9999")).slice(0, 5),
    [projects],
  );
  return (
    <Card title="Aktive Projekte" action={<Link to="/projekte" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-400">Alle <ArrowRight className="h-3.5 w-3.5" /></Link>}>
      {list.length ? (
        <ul className="-my-1 space-y-3.5">
          {list.map((p) => {
            const s = stats.get(p.id);
            return (
              <li key={p.id}>
                <Link to={`/projekte/${p.id}`} className="group block">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium group-hover:text-brand-700 dark:group-hover:text-brand-400">{p.name}</span>
                    <span className="shrink-0 text-xs tabular text-(--text-muted)">{s ? `${Math.round(s.progress * 100)} %` : ""}</span>
                  </div>
                  <ProgressLine value={s?.progress ?? 0} />
                  <div className="mt-1 flex items-center gap-2 text-xs text-(--text-muted)">
                    <span className="truncate">{contacts.get(p.customerId ?? "")?.name ?? "Ohne Kunde"}</span>
                    {p.endDate ? <span className={cls("shrink-0 tabular", p.endDate < todayIso() && "text-red-600")}>· bis {fmtDayMonth(p.endDate)}</span> : null}
                    {s?.overdueTaskCount ? <Badge tone="danger" className="ml-auto">{s.overdueTaskCount} überfällig</Badge> : null}
                    {p.status === "on_hold" ? <Badge tone="warning" className="ml-auto">pausiert</Badge> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-3 text-sm text-(--text-muted)">
          <span className="flex items-center gap-2"><FolderKanban className="h-4 w-4" /> Gerade läuft kein Projekt.</span>
          {rights.canWrite ? <Button size="sm" variant="outline" onClick={() => navigate("/projekte?neu=1")}><Plus className="h-4 w-4" /> Neues Projekt</Button> : null}
        </div>
      )}
    </Card>
  );
}

/** Übersicht: my hours this week and the stopwatch. */
export function WeekHoursWidget() {
  const entries = useList("timeEntries");
  const rights = useProjectRights();
  const today = todayIso();
  const days = weekOfIso(today);
  const me = rights.member?.id ?? "";
  const perDay = useMemo(() => days.map((d) => entries.filter((e) => e.date === d && (e.memberId ?? "") === me).reduce((s, e) => s + e.minutes, 0)), [entries, days, me]);
  const total = perDay.reduce((s, m) => s + m, 0);
  const max = Math.max(60, ...perDay);
  const target = rights.member?.weeklyHours;
  return (
    <Card title="Deine Woche" action={<Link to="/zeiten" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-400">Zeiterfassung <ArrowRight className="h-3.5 w-3.5" /></Link>}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[28px] leading-none font-semibold tabular tracking-tight">{fmtH(total)}</div>
          <div className="mt-1 text-xs text-(--text-muted)">{target ? `von ${fmtH(target * 60)} Soll` : `KW ${days[0]!.slice(8, 10)}.${days[0]!.slice(5, 7)}. – ${days[6]!.slice(8, 10)}.${days[6]!.slice(5, 7)}.`}</div>
        </div>
        <div className="flex h-16 items-end gap-1.5" aria-label="Stunden pro Tag">
          {perDay.map((m, i) => (
            <div key={days[i]} className="flex w-5 flex-col items-center gap-1" title={`${WEEKDAYS_SHORT[i]}: ${fmtH(m)}`}>
              <div className="flex h-11 w-full items-end overflow-hidden rounded-[5px] bg-(--surface-2)">
                <div className={cls("w-full rounded-[5px]", days[i] === today ? "bg-brand-700" : "bg-brand-400/70")} style={{ height: `${Math.min(100, (Math.max(0, m) / max) * 100)}%` }} />
              </div>
              <span className={cls("text-[10px]", days[i] === today ? "font-semibold text-(--text)" : "text-(--text-muted)")}>{WEEKDAYS_SHORT[i]}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <Stopwatch compact />
      </div>
    </Card>
  );
}

/** Übersicht: milestones and my tasks that are due soon or overdue. */
export function UpcomingWidget() {
  const milestones = useList("milestones");
  const tasks = useList("tasks");
  const projects = useList("projects");
  const rights = useProjectRights();
  const today = todayIso();
  const horizon = shiftIsoDate(today, 14);
  const weekEnd = shiftIsoDate(mondayOfIso(today), 6);
  const openProjects = useMemo(() => new Map(projects.filter((p) => p.status !== "completed" && p.status !== "cancelled").map((p) => [p.id, p])), [projects]);
  const items = useMemo(() => {
    const me = rights.member?.id;
    const hasParent = new Set(tasks.map((t) => t.parentId).filter(Boolean));
    const ms = milestones
      .filter((m) => m.status !== "done" && m.dueDate && m.dueDate <= horizon && openProjects.has(m.projectId))
      .map((m) => ({ kind: "milestone" as const, id: m.id, title: m.title, date: m.dueDate!, projectId: m.projectId, overdue: isMilestoneOverdue(m, today) }));
    const ts = tasks
      .filter((t) => t.status !== "done" && t.dueDate && t.dueDate <= weekEnd && openProjects.has(t.projectId) && !hasParent.has(t.id) && (!me || !t.assigneeIds.length || t.assigneeIds.includes(me)))
      .map((t) => ({ kind: "task" as const, id: t.id, title: t.title, date: t.dueDate!, projectId: t.projectId, overdue: t.dueDate! < today }));
    return [...ms, ...ts].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "milestone" ? -1 : 1)).slice(0, 8);
  }, [milestones, tasks, openProjects, horizon, weekEnd, today, rights.member?.id]);
  return (
    <Card title="Als Nächstes" action={<Link to="/aufgaben" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-400">Meine Aufgaben <ArrowRight className="h-3.5 w-3.5" /></Link>}>
      {items.length ? (
        <ul className="-my-1 divide-y divide-(--border)">
          {items.map((it) => (
            <li key={it.id}>
              <Link to={`/projekte/${it.projectId}/${it.kind === "milestone" ? "meilensteine" : "aufgaben"}`} className="flex items-center gap-3 py-2 hover:text-brand-700 dark:hover:text-brand-400">
                {it.kind === "milestone" ? <Diamond className={cls("h-4 w-4 shrink-0", it.overdue ? "text-red-500" : "text-brand-600")} /> : <CheckSquare className={cls("h-4 w-4 shrink-0", it.overdue ? "text-red-500" : "text-(--text-muted)")} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{it.title}</span>
                  <span className="block truncate text-xs text-(--text-muted)">{openProjects.get(it.projectId)?.name}</span>
                </span>
                <span className={cls("shrink-0 text-xs tabular", it.overdue ? "font-medium text-red-600 dark:text-red-400" : it.date === today ? "font-medium text-(--text)" : "text-(--text-muted)")}>{it.overdue ? "überfällig" : it.date === today ? "heute" : fmtDate(it.date)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-(--text-muted)">In den nächsten zwei Wochen steht nichts Dringendes an.</p>
      )}
    </Card>
  );
}
