/**
 * Analyses for project leads: how a project runs against its plan (weekly hours, forecast, work packages, people)
 * and how all projects and the team look together (utilisation, risks). Pure functions over vault rows.
 */
import type { Member, Milestone, Project, Task, TimeEntry } from "./schemas";
import { buildTaskTree, flattenTaskTree, isMilestoneOverdue, isTaskOverdue, isoDaysBetween, isoWeekNumber, mondayOfIso, shiftIsoDate, taskRollups, workdaysBetweenIso, type ProjectStats } from "./projects";

export interface WeekPoint {
  /** Monday of the week. */
  week: string;
  /** "KW 42" */
  label: string;
  minutes: number;
  billableMinutes: number;
  /** Booked up to the end of this week. */
  cumulativeMinutes: number;
  /** Hours the plan expects up to the end of this week (straight line from start to end date), null without a plan. */
  planHours: number | null;
}

export interface PersonHours {
  /** undefined = time booked without a person. */
  memberId?: string;
  minutes: number;
  billableMinutes: number;
  /** Booked in the last 28 days. */
  recentMinutes: number;
}

export interface PackageRow {
  taskId: string;
  number: string;
  title: string;
  isPackage: boolean;
  estimateHours: number;
  trackedMinutes: number;
  /** 0..1 */
  progress: number;
  /** Booked hours minus the hours the progress so far "earns" (estimate × progress); positive = more effort than planned. */
  overHours: number;
  overdue: boolean;
}

export interface ProjectForecast {
  /** budgetHours, otherwise the sum of the estimates; 0 = no plan. */
  plannedHours: number;
  trackedHours: number;
  /** 0..1, weighted by estimate. */
  progress: number;
  /** Hours the project will need at the current effort per progress (tracked ÷ progress); null while too little is done. */
  forecastHours: number | null;
  /** forecast − plan, in hours (null without both). */
  overrunHours: number | null;
  /** Average of the last four weeks. */
  weeklyHours: number;
  /** Hours still needed (forecast, otherwise plan, minus booked). */
  remainingHours: number;
  /** When the remaining hours are done at the recent pace; null without pace or remaining work. */
  expectedEnd: string | null;
  /** Expected end is after the planned end date. */
  late: boolean;
}

export interface ProjectAnalytics {
  weeks: WeekPoint[];
  people: PersonHours[];
  packages: PackageRow[];
  forecast: ProjectForecast;
  /** Leaf tasks by status, overdue counted separately (they keep their status as well). */
  status: { todo: number; in_progress: number; review: number; blocked: number; done: number; overdue: number };
}

const MAX_WEEKS = 26;

/** Everything the "Auswertung" tab of one project shows. Pass the project's own rows (deleted ones are skipped). */
export function projectAnalytics({ project, tasks, entries, today }: { project: Project; tasks: Task[]; entries: TimeEntry[]; today: string }): ProjectAnalytics {
  const live = entries.filter((e) => !e.deletedAt && e.projectId === project.id);
  const pTasks = tasks.filter((t) => !t.deletedAt && t.projectId === project.id);
  const roots = buildTaskTree(pTasks);
  const flat = flattenTaskTree(roots);
  const leaves = flat.filter((n) => !n.isPackage);
  const rollups = taskRollups(pTasks, live);

  // plan and progress
  const estimate = roots.reduce((s, r) => s + (rollups.get(r.task.id)?.estimateHours ?? 0), 0);
  const plannedHours = project.budgetHours > 0 ? project.budgetHours : estimate;
  const weight = (t: Task) => (t.estimateHours > 0 ? t.estimateHours : 1);
  const totalWeight = leaves.reduce((s, n) => s + weight(n.task), 0);
  const progress = totalWeight > 0 ? leaves.reduce((s, n) => s + (n.task.status === "done" ? weight(n.task) : 0), 0) / totalWeight : 0;
  const trackedMinutes = live.reduce((s, e) => s + e.minutes, 0);
  const trackedHours = trackedMinutes / 60;

  // weeks: from the start (or first booking) to today or the planned end, at most the last half year
  const firstEntry = live.reduce<string | undefined>((m, e) => (!m || e.date < m ? e.date : m), undefined);
  const begin = [project.startDate, firstEntry].filter((d): d is string => !!d).sort()[0] ?? today;
  const finish = [today, project.endDate].filter((d): d is string => !!d && d >= begin).sort().pop() ?? today;
  const mondays: string[] = [];
  for (let m = mondayOfIso(begin); m <= finish; m = shiftIsoDate(m, 7)) mondays.push(m);
  const perWeek = new Map<string, { minutes: number; billable: number }>();
  for (const e of live) {
    const w = mondayOfIso(e.date);
    const cur = perWeek.get(w) ?? { minutes: 0, billable: 0 };
    cur.minutes += e.minutes;
    if (e.billable) cur.billable += e.minutes;
    perWeek.set(w, cur);
  }
  const planStart = project.startDate ?? begin;
  const planEnd = project.endDate;
  const planSpan = planEnd ? Math.max(1, isoDaysBetween(planStart, planEnd) + 1) : 0;
  let acc = 0;
  let weeks: WeekPoint[] = mondays.map((week) => {
    const w = perWeek.get(week) ?? { minutes: 0, billable: 0 };
    const weekEnd = shiftIsoDate(week, 6);
    // bookings before the first shown week still count towards the running total
    acc += w.minutes;
    let planHours: number | null = null;
    if (plannedHours > 0 && planEnd) {
      const days = Math.min(planSpan, Math.max(0, isoDaysBetween(planStart, weekEnd) + 1));
      planHours = Math.round(((plannedHours * days) / planSpan) * 10) / 10;
    }
    return { week, label: `KW ${isoWeekNumber(week)}`, minutes: w.minutes, billableMinutes: w.billable, cumulativeMinutes: acc, planHours };
  });
  if (weeks.length > MAX_WEEKS) weeks = weeks.slice(-MAX_WEEKS);

  // pace of the last four weeks (today's week included)
  const paceFrom = shiftIsoDate(mondayOfIso(today), -21);
  const recentMinutes = live.filter((e) => e.date >= paceFrom && e.date <= today).reduce((s, e) => s + e.minutes, 0);
  const weeklyHours = recentMinutes / 60 / 4;

  const forecastHours = progress >= 0.1 && trackedHours > 0 ? trackedHours / progress : null;
  const target = forecastHours ?? plannedHours;
  const remainingHours = Math.max(0, target - trackedHours);
  const expectedEnd = weeklyHours > 0 && remainingHours > 0 ? shiftIsoDate(today, Math.ceil((remainingHours / weeklyHours) * 7)) : null;
  const forecast: ProjectForecast = {
    plannedHours,
    trackedHours,
    progress,
    forecastHours,
    overrunHours: forecastHours !== null && plannedHours > 0 ? forecastHours - plannedHours : null,
    weeklyHours,
    remainingHours,
    expectedEnd,
    late: !!expectedEnd && !!project.endDate && expectedEnd > project.endDate,
  };

  // people
  const since = shiftIsoDate(today, -27);
  const byPerson = new Map<string, PersonHours>();
  for (const e of live) {
    const key = e.memberId ?? "";
    const p = byPerson.get(key) ?? { memberId: e.memberId, minutes: 0, billableMinutes: 0, recentMinutes: 0 };
    p.minutes += e.minutes;
    if (e.billable) p.billableMinutes += e.minutes;
    if (e.date >= since && e.date <= today) p.recentMinutes += e.minutes;
    byPerson.set(key, p);
  }
  const people = [...byPerson.values()].sort((a, b) => b.minutes - a.minutes);

  // work packages (top level) – or the tasks themselves when the project has no packages
  const rows = roots.some((r) => r.isPackage) ? roots : flat;
  const packages: PackageRow[] = rows.map((n) => {
    const r = rollups.get(n.task.id)!;
    const earned = r.estimateHours * r.progress;
    return {
      taskId: n.task.id,
      number: n.number,
      title: n.task.title,
      isPackage: n.isPackage,
      estimateHours: r.estimateHours,
      trackedMinutes: r.trackedMinutes,
      progress: r.progress,
      overHours: r.estimateHours > 0 ? r.trackedMinutes / 60 - earned : 0,
      overdue: isTaskOverdue(n.task, today),
    };
  });

  const status = { todo: 0, in_progress: 0, review: 0, blocked: 0, done: 0, overdue: 0 };
  for (const n of leaves) {
    status[n.task.status]++;
    if (isTaskOverdue(n.task, today)) status.overdue++;
  }

  return { weeks, people, packages, forecast, status };
}

/* ================================================================== */
/* Team and portfolio                                                  */
/* ================================================================== */

export interface MemberLoad {
  memberId: string;
  /** Workdays × weeklyHours ÷ 5, in minutes. */
  capacityMinutes: number;
  bookedMinutes: number;
  billableMinutes: number;
  /** booked ÷ capacity (0 without capacity). */
  utilization: number;
  /** billable ÷ booked. */
  billableShare: number;
  /** Minutes per project in the period. */
  byProject: Record<string, number>;
  /** Open leaf tasks assigned to the person (all projects passed in). */
  openTasks: number;
  overdueTasks: number;
}

/** Utilisation of every active person between from and to (both included). */
export function teamLoad({ members, entries, tasks, from, to, today }: { members: Member[]; entries: TimeEntry[]; tasks: Task[]; from: string; to: string; today: string }): MemberLoad[] {
  const workdays = workdaysBetweenIso(from, to);
  const packages = new Set(tasks.filter((t) => !t.deletedAt && t.parentId).map((t) => t.parentId));
  return members
    .filter((m) => !m.deletedAt && m.active)
    .map((m) => {
      const mine = entries.filter((e) => !e.deletedAt && e.memberId === m.id && e.date >= from && e.date <= to);
      const bookedMinutes = mine.reduce((s, e) => s + e.minutes, 0);
      const billableMinutes = mine.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
      const byProject: Record<string, number> = {};
      for (const e of mine) byProject[e.projectId] = (byProject[e.projectId] ?? 0) + e.minutes;
      const capacityMinutes = Math.round(((workdays * m.weeklyHours) / 5) * 60);
      const open = tasks.filter((t) => !t.deletedAt && !packages.has(t.id) && t.status !== "done" && t.assigneeIds.includes(m.id));
      return {
        memberId: m.id,
        capacityMinutes,
        bookedMinutes,
        billableMinutes,
        utilization: capacityMinutes > 0 ? bookedMinutes / capacityMinutes : 0,
        billableShare: bookedMinutes > 0 ? billableMinutes / bookedMinutes : 0,
        byProject,
        openTasks: open.length,
        overdueTasks: open.filter((t) => isTaskOverdue(t, today)).length,
      };
    })
    .sort((a, b) => b.utilization - a.utilization);
}

export interface ProjectRisk {
  level: "high" | "medium";
  /** Plain words, e.g. "Prognose 20 % über Plan". */
  reasons: string[];
}

/**
 * Why a running project needs attention – null when nothing stands out. With money: false the reasons about money
 * (invoiced amount, margin) are left out entirely, so neither they nor the level they would raise give anything away.
 */
export function projectRisk({ project, stats, forecast, milestones, today, money = true }: { project: Project; stats: ProjectStats; forecast: ProjectForecast; milestones: Milestone[]; today: string; money?: boolean }): ProjectRisk | null {
  if (project.status === "completed" || project.status === "cancelled") return null;
  const high: string[] = [];
  const medium: string[] = [];
  const pct = (n: number) => `${Math.round(n * 100)} %`;
  if (forecast.plannedHours > 0) {
    const used = forecast.trackedHours / forecast.plannedHours;
    if (used > 1) high.push(`Stunden ${pct(used - 1)} über Plan`);
    else if (forecast.overrunHours !== null && forecast.overrunHours / forecast.plannedHours > 0.1) (forecast.overrunHours / forecast.plannedHours > 0.25 ? high : medium).push(`Prognose ${pct(forecast.overrunHours / forecast.plannedHours)} über Plan`);
    else if (used > 0.9 && forecast.progress < 0.9) medium.push(`${pct(used)} der Stunden verbraucht, ${pct(forecast.progress)} erledigt`);
  }
  if (money && project.budgetCents > 0 && stats.budgetUsedPct > 1) high.push("Mehr fakturiert als vereinbart");
  if (project.endDate && project.endDate < today) high.push("Enddatum überschritten");
  else if (forecast.late) medium.push("Wird beim jetzigen Tempo nach dem Enddatum fertig");
  const lateMilestones = milestones.filter((m) => !m.deletedAt && m.projectId === project.id && isMilestoneOverdue(m, today)).length;
  if (lateMilestones) high.push(`${lateMilestones} Meilenstein${lateMilestones === 1 ? "" : "e"} überfällig`);
  if (stats.overdueTaskCount) (stats.overdueTaskCount >= 3 ? high : medium).push(`${stats.overdueTaskCount} Aufgabe${stats.overdueTaskCount === 1 ? "" : "n"} überfällig`);
  if (money && project.billing !== "internal" && stats.marginPct !== null && stats.marginPct < 0) high.push("Marge negativ");
  if (!high.length && !medium.length) return null;
  return { level: high.length ? "high" : "medium", reasons: [...high, ...medium] };
}
