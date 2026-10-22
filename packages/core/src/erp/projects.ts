/* Project logic (Ordo Projekte): task tree numbering, schedule, hours, budget and margin. Pure functions over vault data. */
import type { Invoice } from "../model/types";
import type { Member, Milestone, Project, RunningTimer, Task, TimeEntry } from "./schemas";

/* ================================================================== */
/* Dates (ISO "YYYY-MM-DD", calculated in UTC so DST never shifts a day) */
/* ================================================================== */

const DAY_MS = 86_400_000;

function isoToUtc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function utcToIso(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Date plus/minus whole days. */
export function shiftIsoDate(iso: string, days: number): string {
  return utcToIso(isoToUtc(iso) + days * DAY_MS);
}

/** Calendar days from a to b (b − a). */
export function isoDaysBetween(a: string, b: string): number {
  return Math.round((isoToUtc(b) - isoToUtc(a)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function isoWeekday(iso: string): number {
  return (new Date(isoToUtc(iso)).getUTCDay() + 6) % 7;
}

export function isWeekendIso(iso: string): boolean {
  return isoWeekday(iso) >= 5;
}

/** The same day when it is a workday, otherwise the following Monday. */
export function nextWorkdayIso(iso: string): string {
  let d = iso;
  while (isWeekendIso(d)) d = shiftIsoDate(d, 1);
  return d;
}

/** Moves n workdays forward (n > 0) or back (n < 0), skipping weekends. */
export function addWorkdaysIso(iso: string, n: number): string {
  let d = iso;
  let left = Math.abs(Math.trunc(n));
  const step = n < 0 ? -1 : 1;
  while (left > 0) {
    d = shiftIsoDate(d, step);
    if (!isWeekendIso(d)) left--;
  }
  return d;
}

/** Workdays from a to b, both included (0 when b is before a). */
export function workdaysBetweenIso(a: string, b: string): number {
  if (b < a) return 0;
  let n = 0;
  for (let d = a; d <= b; d = shiftIsoDate(d, 1)) if (!isWeekendIso(d)) n++;
  return n;
}

/** Monday of the week the date is in. */
export function mondayOfIso(iso: string): string {
  return shiftIsoDate(iso, -isoWeekday(iso));
}

/** Monday … Sunday of the week the date is in. */
export function weekOfIso(iso: string): string[] {
  const mon = mondayOfIso(iso);
  return Array.from({ length: 7 }, (_, i) => shiftIsoDate(mon, i));
}

/** ISO 8601 calendar week number ("KW"). */
export function isoWeekNumber(iso: string): number {
  const thursday = shiftIsoDate(mondayOfIso(iso), 3);
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(isoDaysBetween(jan1, thursday) / 7) + 1;
}

/* ================================================================== */
/* Durations                                                           */
/* ================================================================== */

/**
 * Parses what people type for a duration into minutes.
 * "1,5" "1.5" → 90 · "1:30" → 90 · "90m" "90 min" → 90 · "2h" "2 Std" → 120 · "2h 15m" "2h15" → 135.
 * A bare number means hours. Returns null for anything else. Negative values only with allowNegative (corrections).
 */
export function parseDuration(input: string, opts: { allowNegative?: boolean } = {}): number | null {
  let s = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  let sign = 1;
  if (s.startsWith("-") || s.startsWith("−")) {
    if (!opts.allowNegative) return null;
    sign = -1;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) s = s.slice(1).trim();
  if (!s) return null;
  const num = (t: string) => Number(t.replace(",", "."));
  let minutes: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) {
    const mm = Number(m[2]);
    if (mm >= 60) return null;
    minutes = Number(m[1]) * 60 + mm;
  } else if ((m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:h|std\.?|stunden?|hrs?)?$/))) {
    minutes = num(m[1]!) * 60;
  } else if ((m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:m|min\.?|minuten?)$/))) {
    minutes = num(m[1]!);
  } else if ((m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:h|std\.?|stunden?)\s*(\d+)\s*(?:m|min\.?|minuten?)?$/))) {
    minutes = num(m[1]!) * 60 + Number(m[2]);
  }
  if (minutes === null || !Number.isFinite(minutes)) return null;
  return sign * Math.round(minutes);
}

/** Minutes as "1:30" (hours:minutes), negative with a minus sign. */
export function formatMinutesClock(minutes: number): string {
  const sign = minutes < 0 ? "−" : "";
  const abs = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/* ================================================================== */
/* Task tree                                                           */
/* ================================================================== */

export interface TaskNode {
  task: Task;
  /** "1", "1.2", "1.2.3" */
  number: string;
  depth: number;
  parent?: TaskNode;
  children: TaskNode[];
  /** Has children → Arbeitspaket. */
  isPackage: boolean;
}

function bySiblingOrder(a: Task, b: Task): number {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Builds the tree (roots in order). Deleted tasks are left out; missing or looping parents make a task a root. */
export function buildTaskTree(tasks: Task[]): TaskNode[] {
  const live = tasks.filter((t) => !t.deletedAt);
  const byId = new Map(live.map((t) => [t.id, t]));
  // a parent chain that loops back is cut where it repeats
  const effectiveParent = new Map<string, string | undefined>();
  for (const t of live) {
    let p = t.parentId && byId.has(t.parentId) ? t.parentId : undefined;
    const seen = new Set([t.id]);
    let cur = p;
    while (cur) {
      if (seen.has(cur)) {
        p = undefined;
        break;
      }
      seen.add(cur);
      const next = byId.get(cur)?.parentId;
      cur = next && byId.has(next) ? next : undefined;
    }
    effectiveParent.set(t.id, p);
  }
  const buckets = new Map<string | undefined, Task[]>();
  for (const t of live) {
    const p = effectiveParent.get(t.id);
    (buckets.get(p) ?? buckets.set(p, []).get(p)!).push(t);
  }
  for (const list of buckets.values()) list.sort(bySiblingOrder);
  const walk = (parentId: string | undefined, depth: number, prefix: string, parent?: TaskNode): TaskNode[] =>
    (buckets.get(parentId) ?? []).map((task, i) => {
      const number = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const node: TaskNode = { task, number, depth, parent, children: [], isPackage: false };
      node.children = walk(task.id, depth + 1, number, node);
      node.isPackage = node.children.length > 0;
      return node;
    });
  return walk(undefined, 0, "");
}

/** Depth-first list of the tree. Children of collapsed nodes are skipped. */
export function flattenTaskTree(roots: TaskNode[], collapsed?: Set<string>): TaskNode[] {
  const out: TaskNode[] = [];
  const visit = (nodes: TaskNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (!collapsed?.has(n.task.id)) visit(n.children);
    }
  };
  visit(roots);
  return out;
}

/** Task id → "1.2.3". */
export function taskNumbers(tasks: Task[]): Map<string, string> {
  return new Map(flattenTaskTree(buildTaskTree(tasks)).map((n) => [n.task.id, n.number]));
}

/** Removes numbering people type in front of a title ("1.2. Entwurf" → "Entwurf"). */
export function cleanTaskTitle(title: string): string {
  return title.replace(/^\s*(?:\d{1,3}(?:\.\d{1,3})*\.|\d{1,3}(?:\.\d{1,3})+)\s+/, "").trim() || title.trim();
}

/** All descendants of a task (not the task itself). */
export function taskDescendantIds(tasks: Task[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const t of tasks) if (!t.deletedAt && t.parentId) (children.get(t.parentId) ?? children.set(t.parentId, []).get(t.parentId)!).push(t.id);
  const out = new Set<string>();
  const stack = [...(children.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (out.has(c) || c === id) continue;
    out.add(c);
    stack.push(...(children.get(c) ?? []));
  }
  return out;
}

/**
 * New sibling order after moving a task one place up (-1) or down (+1).
 * Returns id → order for every sibling (0, 1, 2 …), or null when the move is not possible.
 */
export function moveTaskOrder(tasks: Task[], id: string, dir: -1 | 1): Map<string, number> | null {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  const siblings = tasks.filter((x) => !x.deletedAt && x.projectId === t.projectId && (x.parentId ?? "") === (t.parentId ?? "")).sort(bySiblingOrder);
  const i = siblings.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= siblings.length) return null;
  [siblings[i], siblings[j]] = [siblings[j]!, siblings[i]!];
  return new Map(siblings.map((s, k) => [s.id, k]));
}

/**
 * Order map for placing a task among new siblings (drag & drop): `id` ends up directly before `beforeId`
 * (or at the end when beforeId is undefined). Returns id → order for all siblings incl. the moved task.
 */
export function placeTaskOrder(tasks: Task[], id: string, parentId: string | undefined, beforeId?: string): Map<string, number> {
  const t = tasks.find((x) => x.id === id);
  const siblings = tasks.filter((x) => !x.deletedAt && x.id !== id && x.projectId === t?.projectId && (x.parentId ?? "") === (parentId ?? "")).sort(bySiblingOrder);
  const at = beforeId ? siblings.findIndex((s) => s.id === beforeId) : -1;
  const ordered = at < 0 ? [...siblings.map((s) => s.id), id] : [...siblings.slice(0, at).map((s) => s.id), id, ...siblings.slice(at).map((s) => s.id)];
  return new Map(ordered.map((x, k) => [x, k]));
}

/** Order value for a new task appended at the end of its siblings. */
export function nextTaskOrder(tasks: Task[], projectId: string, parentId?: string): number {
  const siblings = tasks.filter((x) => !x.deletedAt && x.projectId === projectId && (x.parentId ?? "") === (parentId ?? ""));
  return siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0;
}

/* ================================================================== */
/* Roll-ups                                                            */
/* ================================================================== */

export interface TaskRollup {
  /** Booked minutes on this task and everything below it. */
  trackedMinutes: number;
  /** Booked minutes directly on this task. */
  ownMinutes: number;
  /** Estimate: sum of the children when they have one, otherwise the task's own. */
  estimateHours: number;
  /** 0..1 – done leaves weighted by their estimate (a leaf without estimate weighs one hour). */
  progress: number;
  leafCount: number;
  doneLeafCount: number;
}

/** Weight of a leaf task for progress: its estimate, or one hour when nothing is estimated. */
function leafWeight(t: Task): number {
  return t.estimateHours > 0 ? t.estimateHours : 1;
}

/** Roll-ups for every task in the tree. */
export function taskRollups(tasks: Task[], entries: TimeEntry[]): Map<string, TaskRollup> {
  const own = new Map<string, number>();
  for (const e of entries) if (!e.deletedAt && e.taskId) own.set(e.taskId, (own.get(e.taskId) ?? 0) + e.minutes);
  const out = new Map<string, TaskRollup>();
  const visit = (n: TaskNode): TaskRollup & { weight: number; doneWeight: number } => {
    const ownMinutes = own.get(n.task.id) ?? 0;
    if (!n.children.length) {
      const done = n.task.status === "done";
      const r = { trackedMinutes: ownMinutes, ownMinutes, estimateHours: n.task.estimateHours, progress: done ? 1 : 0, leafCount: 1, doneLeafCount: done ? 1 : 0 };
      out.set(n.task.id, r);
      const weight = leafWeight(n.task);
      return { ...r, weight, doneWeight: done ? weight : 0 };
    }
    const kids = n.children.map(visit);
    const childEstimate = kids.reduce((s, k) => s + k.estimateHours, 0);
    const weight = kids.reduce((s, k) => s + k.weight, 0);
    const doneWeight = kids.reduce((s, k) => s + k.doneWeight, 0);
    const leafCount = kids.reduce((s, k) => s + k.leafCount, 0);
    const doneLeafCount = kids.reduce((s, k) => s + k.doneLeafCount, 0);
    const progress = weight > 0 ? doneWeight / weight : 0;
    const r = {
      trackedMinutes: ownMinutes + kids.reduce((s, k) => s + k.trackedMinutes, 0),
      ownMinutes,
      estimateHours: childEstimate > 0 ? childEstimate : n.task.estimateHours,
      progress,
      leafCount,
      doneLeafCount,
    };
    out.set(n.task.id, r);
    return { ...r, weight, doneWeight };
  };
  buildTaskTree(tasks).forEach(visit);
  return out;
}

/* ================================================================== */
/* Overdue                                                             */
/* ================================================================== */

export function isTaskOverdue(task: Pick<Task, "dueDate" | "status">, today: string): boolean {
  return !!task.dueDate && task.dueDate < today && task.status !== "done";
}

export function isMilestoneOverdue(m: Pick<Milestone, "dueDate" | "status">, today: string): boolean {
  return !!m.dueDate && m.dueDate < today && m.status !== "done";
}

/** Days past the due date (0 when not overdue). */
export function overdueDays(dueDate: string | undefined, today: string): number {
  if (!dueDate || dueDate >= today) return 0;
  return isoDaysBetween(dueDate, today);
}

/* ================================================================== */
/* Milestones                                                          */
/* ================================================================== */

/** Tasks linked to a milestone – from milestone.taskIds and task.milestoneId (both directions count). */
export function milestoneTaskIds(m: Milestone, tasks: Task[]): string[] {
  const live = new Set(tasks.filter((t) => !t.deletedAt).map((t) => t.id));
  const ids = new Set(m.taskIds.filter((id) => live.has(id)));
  for (const t of tasks) if (!t.deletedAt && t.milestoneId === m.id) ids.add(t.id);
  return [...ids];
}

/** Short code from the shared number prefix of the linked tasks: tasks 2.1 + 2.3 → "M2"; otherwise "M<index>". */
export function milestoneCode(linkedNumbers: string[], index: number): string {
  if (!linkedNumbers.length) return `M${index + 1}`;
  const parts = linkedNumbers.map((n) => n.split("."));
  const prefix: string[] = [];
  for (let i = 0; ; i++) {
    const v = parts[0]![i];
    if (v === undefined || parts.some((p) => p[i] !== v)) break;
    prefix.push(v);
  }
  return prefix.length ? `M${prefix.join(".")}` : `M${index + 1}`;
}

/** Progress 0..1 of a milestone from its linked tasks (roll-ups); done milestones are 1. */
export function milestoneProgress(m: Milestone, tasks: Task[], rollups: Map<string, TaskRollup>): number {
  if (m.status === "done") return 1;
  const ids = milestoneTaskIds(m, tasks);
  if (!ids.length) return 0;
  return ids.reduce((s, id) => s + (rollups.get(id)?.progress ?? 0), 0) / ids.length;
}

/* ================================================================== */
/* Money                                                               */
/* ================================================================== */

/** Net amount of an invoice after line and invoice discounts; credit notes count negative. */
export function invoiceNetForProject(inv: Invoice): number {
  const lines = inv.lines.reduce((s, l) => s + Math.round(l.quantity * l.unitNetCents * (1 - (l.discountPct || 0) / 100)), 0);
  const net = Math.round(lines * (1 - (inv.discountPct || 0) / 100));
  return inv.kind === "credit_note" ? -Math.abs(net) : net;
}

/** Invoices of a project that count: not deleted, not cancelled, no offers. */
export function projectInvoices(projectId: string, invoices: Invoice[]): Invoice[] {
  return invoices.filter((i) => !i.deletedAt && i.projectId === projectId && i.status !== "cancelled" && i.kind !== "offer");
}

/** Rates to store on a new time entry: sales rate from the project (hourly) or the member, cost from the member. */
export function timeEntryRates(project: Pick<Project, "billing" | "hourlyRateCents"> | undefined, member: Pick<Member, "hourlyRateCents" | "hourlyCostCents"> | undefined): { rateCents?: number; costCents?: number } {
  const rate = project?.hourlyRateCents || member?.hourlyRateCents || 0;
  const cost = member?.hourlyCostCents || 0;
  return { rateCents: rate || undefined, costCents: cost || undefined };
}

/** Cost of one entry: minutes × hourly cost (snapshot first, then the member's current cost). */
export function timeEntryCostCents(e: TimeEntry, membersById: Map<string, Member>): number {
  const perHour = e.costCents ?? (e.memberId ? membersById.get(e.memberId)?.hourlyCostCents ?? 0 : 0);
  return Math.round((e.minutes * perHour) / 60);
}

/** Sales value of one entry: minutes × rate (snapshot, then project rate, then member rate). */
export function timeEntryValueCents(e: TimeEntry, project: Pick<Project, "hourlyRateCents"> | undefined, membersById: Map<string, Member>): number {
  const perHour = e.rateCents ?? (project?.hourlyRateCents || (e.memberId ? membersById.get(e.memberId)?.hourlyRateCents ?? 0 : 0));
  return Math.round((e.minutes * perHour) / 60);
}

/* ================================================================== */
/* Project stats                                                       */
/* ================================================================== */

export interface ProjectStats {
  trackedMinutes: number;
  billableMinutes: number;
  last7DaysMinutes: number;
  entryCount: number;
  /** Leaf tasks (work packages are not counted twice). */
  taskCount: number;
  doneTaskCount: number;
  /** 0..1 */
  tasksDonePct: number;
  /** 0..1, weighted by estimate. */
  progress: number;
  overdueTaskCount: number;
  overdueMilestoneCount: number;
  estimateHours: number;
  costCents: number;
  /** Value of billable time at the booked rates. */
  billableValueCents: number;
  invoiceCount: number;
  invoicedNetCents: number;
  /** Budget − invoiced (negative = more invoiced than agreed). */
  remainingBudgetCents: number;
  /** 0..1 of budget already invoiced (0 when there is no budget). */
  budgetUsedPct: number;
  /** 0..1 of budget hours booked (0 when there are none). */
  hoursUsedPct: number;
  /** Expected revenue: fixed = max(budget, invoiced), hourly = max(billable value, invoiced), internal = 0. */
  revenueCents: number;
  marginCents: number;
  /** null when there is no revenue. */
  marginPct: number | null;
  nextMilestone?: Milestone;
}

export interface ProjectStatsInput {
  project: Project;
  tasks: Task[];
  timeEntries: TimeEntry[];
  milestones: Milestone[];
  invoices: Invoice[];
  members: Member[];
  today: string;
}

/** Everything the overview shows. Pass all rows – this filters by project and skips deleted ones. */
export function projectStats({ project, tasks, timeEntries, milestones, invoices, members, today }: ProjectStatsInput): ProjectStats {
  const pid = project.id;
  const pTasks = tasks.filter((t) => !t.deletedAt && t.projectId === pid);
  const pEntries = timeEntries.filter((e) => !e.deletedAt && e.projectId === pid);
  const pMilestones = milestones.filter((m) => !m.deletedAt && m.projectId === pid);
  const pInvoices = projectInvoices(pid, invoices);
  const membersById = new Map(members.map((m) => [m.id, m]));

  const weekAgo = shiftIsoDate(today, -6);
  let trackedMinutes = 0;
  let billableMinutes = 0;
  let last7DaysMinutes = 0;
  let costCents = 0;
  let billableValueCents = 0;
  for (const e of pEntries) {
    trackedMinutes += e.minutes;
    if (e.billable) {
      billableMinutes += e.minutes;
      billableValueCents += timeEntryValueCents(e, project, membersById);
    }
    if (e.date >= weekAgo && e.date <= today) last7DaysMinutes += e.minutes;
    costCents += timeEntryCostCents(e, membersById);
  }

  const roots = buildTaskTree(pTasks);
  const flat = flattenTaskTree(roots);
  const leaves = flat.filter((n) => !n.isPackage);
  const rollups = taskRollups(pTasks, pEntries);
  const doneTaskCount = leaves.filter((n) => n.task.status === "done").length;
  const weight = leaves.reduce((s, n) => s + leafWeight(n.task), 0);
  const progress = weight > 0 ? leaves.reduce((s, n) => s + (n.task.status === "done" ? leafWeight(n.task) : 0), 0) / weight : 0;

  const invoicedNetCents = pInvoices.reduce((s, i) => s + invoiceNetForProject(i), 0);
  const revenueCents = project.billing === "internal" ? 0 : project.billing === "hourly" ? Math.max(billableValueCents, invoicedNetCents) : Math.max(project.budgetCents, invoicedNetCents);
  const marginCents = revenueCents - costCents;

  const openMilestones = pMilestones.filter((m) => m.status !== "done").sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  return {
    trackedMinutes,
    billableMinutes,
    last7DaysMinutes,
    entryCount: pEntries.length,
    taskCount: leaves.length,
    doneTaskCount,
    tasksDonePct: leaves.length ? doneTaskCount / leaves.length : 0,
    progress,
    overdueTaskCount: leaves.filter((n) => isTaskOverdue(n.task, today)).length,
    overdueMilestoneCount: pMilestones.filter((m) => isMilestoneOverdue(m, today)).length,
    estimateHours: roots.reduce((s, r) => s + (rollups.get(r.task.id)?.estimateHours ?? 0), 0),
    costCents,
    billableValueCents,
    invoiceCount: pInvoices.length,
    invoicedNetCents,
    remainingBudgetCents: project.budgetCents - invoicedNetCents,
    budgetUsedPct: project.budgetCents > 0 ? invoicedNetCents / project.budgetCents : 0,
    hoursUsedPct: project.budgetHours > 0 ? trackedMinutes / 60 / project.budgetHours : 0,
    revenueCents,
    marginCents,
    marginPct: revenueCents > 0 ? marginCents / revenueCents : null,
    nextMilestone: openMilestones[0],
  };
}

/* ================================================================== */
/* Invoice reminder                                                    */
/* ================================================================== */

export type InvoiceReminder =
  | { kind: "downpayment"; pct: number; amountCents: number; title: string; body: string }
  | { kind: "final"; amountCents: number; title: string; body: string };

/**
 * What to invoice next (from the old ERP): no invoice yet → down payment (default 30 % of the budget);
 * end date passed and budget left → final invoice over the rest. Nothing for internal, completed or cancelled projects.
 */
export function projectInvoiceReminder(project: Project, invoices: Invoice[], today: string, downpaymentPct = 30): InvoiceReminder | null {
  if (project.billing === "internal" || project.status === "completed" || project.status === "cancelled") return null;
  const list = projectInvoices(project.id, invoices);
  const invoiced = list.reduce((s, i) => s + invoiceNetForProject(i), 0);
  if (!list.length && project.budgetCents > 0 && project.status !== "planning") {
    const amountCents = Math.round((project.budgetCents * downpaymentPct) / 100);
    return { kind: "downpayment", pct: downpaymentPct, amountCents, title: `Anzahlung über ${downpaymentPct} % stellen`, body: "Für dieses Projekt gibt es noch keine Rechnung." };
  }
  const rest = project.budgetCents - invoiced;
  if (project.endDate && project.endDate < today && rest > 0) {
    return { kind: "final", amountCents: rest, title: "Schlussrechnung stellen", body: "Das Projektende ist vorbei und es ist noch Budget offen." };
  }
  return null;
}

/* ================================================================== */
/* Automatic schedule                                                  */
/* ================================================================== */

export interface ScheduleOptions {
  /** First day to plan from (default: project start, else today). */
  startDate?: string;
  /** Productive hours per workday (default: project.hoursPerDay). */
  hoursPerDay?: number;
  /** Done tasks keep their dates and are skipped. */
  keepDone?: boolean;
  today?: string;
}

export interface ScheduleResult {
  /** New start/due per task (leaves and work packages). */
  tasks: Map<string, { startDate: string; dueDate: string }>;
  /** Milestones without a date that get one from their linked tasks. */
  milestoneDates: Map<string, string>;
  /** Milestones whose linked tasks now end after their due date. */
  lateMilestones: { id: string; plannedEnd: string }[];
  endDate?: string;
}

/** Workdays a task needs: ceil(estimate / hours per day), at least 1. */
export function workdaysForHours(hours: number, hoursPerDay: number): number {
  return Math.max(1, Math.ceil(Math.max(0, hours) / Math.max(0.5, hoursPerDay)));
}

/**
 * Plans the tasks one after another (port of the old ERP's schedule): leaf tasks in tree order, starting at the
 * first workday, each taking ceil(estimate / hoursPerDay) workdays, weekends skipped. Work packages span their
 * children. Milestones without a date get the end of their linked tasks.
 */
export function autoSchedule(project: Project, tasks: Task[], milestones: Milestone[] = [], opts: ScheduleOptions = {}): ScheduleResult {
  const pTasks = tasks.filter((t) => !t.deletedAt && t.projectId === project.id);
  const hoursPerDay = opts.hoursPerDay ?? project.hoursPerDay ?? 6;
  const start = nextWorkdayIso(opts.startDate ?? project.startDate ?? opts.today ?? new Date().toISOString().slice(0, 10));
  const roots = buildTaskTree(pTasks);
  const result = new Map<string, { startDate: string; dueDate: string }>();
  let cursor = start;
  for (const n of flattenTaskTree(roots)) {
    if (n.isPackage) continue;
    const t = n.task;
    if (opts.keepDone && t.status === "done") {
      if (t.startDate || t.dueDate) result.set(t.id, { startDate: t.startDate ?? t.dueDate!, dueDate: t.dueDate ?? t.startDate! });
      continue;
    }
    const s = nextWorkdayIso(cursor);
    const e = addWorkdaysIso(s, workdaysForHours(t.estimateHours, hoursPerDay) - 1);
    result.set(t.id, { startDate: s, dueDate: e });
    cursor = addWorkdaysIso(e, 1);
  }
  const span = (n: TaskNode): { startDate: string; dueDate: string } | undefined => {
    if (!n.isPackage) return result.get(n.task.id);
    const kids = n.children.map(span).filter((x): x is { startDate: string; dueDate: string } => !!x);
    if (!kids.length) return undefined;
    const r = { startDate: kids.map((k) => k.startDate).sort()[0]!, dueDate: kids.map((k) => k.dueDate).sort().at(-1)! };
    result.set(n.task.id, r);
    return r;
  };
  roots.forEach(span);

  const milestoneDates = new Map<string, string>();
  const lateMilestones: { id: string; plannedEnd: string }[] = [];
  for (const m of milestones) {
    if (m.deletedAt || m.projectId !== project.id) continue;
    const ends = milestoneTaskIds(m, pTasks).map((id) => result.get(id)?.dueDate).filter((d): d is string => !!d);
    if (!ends.length) continue;
    const end = ends.sort().at(-1)!;
    if (!m.dueDate) milestoneDates.set(m.id, end);
    else if (m.status !== "done" && end > m.dueDate) lateMilestones.push({ id: m.id, plannedEnd: end });
  }
  const all = [...result.values()].map((r) => r.dueDate).sort();
  return { tasks: result, milestoneDates, lateMilestones, endDate: all.at(-1) };
}

/* ================================================================== */
/* Timers                                                              */
/* ================================================================== */

/** Whole minutes a stopwatch has been running. */
export function timerElapsedMinutes(timer: Pick<RunningTimer, "startedAt">, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(timer.startedAt).getTime()) / 60_000));
}

/** Seconds a stopwatch has been running (for the live display). */
export function timerElapsedSeconds(timer: Pick<RunningTimer, "startedAt">, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(timer.startedAt).getTime()) / 1000));
}

/** The running stopwatch of a member (or the single user's when memberId is undefined). */
export function timerFor(timers: RunningTimer[], memberId: string | undefined): RunningTimer | undefined {
  return timers.find((t) => (t.memberId ?? "") === (memberId ?? ""));
}

/* ================================================================== */
/* Time summaries                                                      */
/* ================================================================== */

export interface TimeTotals {
  minutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  count: number;
}

export function sumTimeEntries(entries: TimeEntry[]): TimeTotals {
  let minutes = 0;
  let billableMinutes = 0;
  for (const e of entries) {
    if (e.deletedAt) continue;
    minutes += e.minutes;
    if (e.billable) billableMinutes += e.minutes;
  }
  return { minutes, billableMinutes, nonBillableMinutes: minutes - billableMinutes, count: entries.filter((e) => !e.deletedAt).length };
}

/**
 * Week grid: one row per project/task combination that has time in the week (plus `extraRows`),
 * minutes per weekday (Mon..Sun).
 */
export function weekGrid(entries: TimeEntry[], weekDates: string[], extraRows: { projectId: string; taskId?: string }[] = []): { key: string; projectId: string; taskId?: string; days: number[]; total: number }[] {
  const rows = new Map<string, { key: string; projectId: string; taskId?: string; days: number[]; total: number }>();
  const keyOf = (p: string, t?: string) => `${p}|${t ?? ""}`;
  const ensure = (projectId: string, taskId?: string) => {
    const key = keyOf(projectId, taskId);
    return rows.get(key) ?? rows.set(key, { key, projectId, taskId, days: weekDates.map(() => 0), total: 0 }).get(key)!;
  };
  for (const e of entries) {
    if (e.deletedAt) continue;
    const i = weekDates.indexOf(e.date);
    if (i < 0) continue;
    const r = ensure(e.projectId, e.taskId);
    r.days[i] = (r.days[i] ?? 0) + e.minutes;
    r.total += e.minutes;
  }
  for (const x of extraRows) ensure(x.projectId, x.taskId);
  return [...rows.values()];
}
