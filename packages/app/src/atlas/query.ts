import { z } from "zod";
import type { Vault } from "@ordo/core";
import { type CollectionDef, type Rec, fieldValue } from "./data";

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export const FilterSchema = z.object({
  field: z.string().describe("Feldname, z. B. status, date, contactId, grossCents, kind; auch berechnete Felder wie totalCents oder hours"),
  op: z.enum(["eq", "ne", "contains", "gt", "gte", "lt", "lte", "in", "empty", "not_empty"]).describe("eq/ne vergleichen genau, contains sucht Text, gt/gte/lt/lte vergleichen Zahlen oder Daten (YYYY-MM-DD), in = Komma-Liste"),
  value: z.string().describe("Vergleichswert als Text, z. B. \"2026-01-01\", \"income\", \"5000\", \"todo,in_progress\"; bei empty/not_empty leer lassen"),
});
export type Filter = z.infer<typeof FilterSchema>;

const lower = (s: unknown) => String(s ?? "").toLocaleLowerCase("de");

function compare(a: unknown, b: string): number {
  if (typeof a === "number") {
    const n = Number(b.replace(",", "."));
    return Number.isFinite(n) ? a - n : NaN;
  }
  if (typeof a === "boolean") return Number(a) - Number(b === "true");
  const s = String(a ?? "");
  return s < b ? -1 : s > b ? 1 : 0;
}

function test(val: unknown, f: Filter): boolean {
  const empty = val === undefined || val === null || val === "" || (Array.isArray(val) && !val.length);
  switch (f.op) {
    case "empty":
      return empty;
    case "not_empty":
      return !empty;
    case "contains":
      return Array.isArray(val) ? val.some((x) => lower(x).includes(lower(f.value))) : lower(val).includes(lower(f.value));
    case "in": {
      const set = f.value.split(",").map((x) => x.trim().toLocaleLowerCase("de"));
      return Array.isArray(val) ? val.some((x) => set.includes(lower(x))) : set.includes(lower(val));
    }
    case "eq":
      if (Array.isArray(val)) return val.some((x) => lower(x) === lower(f.value));
      if (typeof val === "number" || typeof val === "boolean") return compare(val, f.value) === 0;
      return lower(val) === lower(f.value);
    case "ne":
      if (Array.isArray(val)) return !val.some((x) => lower(x) === lower(f.value));
      if (typeof val === "number" || typeof val === "boolean") return compare(val, f.value) !== 0;
      return lower(val) !== lower(f.value);
    default: {
      if (empty) return false;
      const c = compare(val, f.value);
      if (Number.isNaN(c)) return false;
      return f.op === "gt" ? c > 0 : f.op === "gte" ? c >= 0 : f.op === "lt" ? c < 0 : c <= 0;
    }
  }
}

export function applyFilters(def: CollectionDef, rows: Rec[], filters: Filter[] | undefined, v: Vault): Rec[] {
  if (!filters?.length) return rows;
  return rows.filter((r) => filters.every((f) => test(fieldValue(def, r, f.field, v), f)));
}

export function sortRows(def: CollectionDef, rows: Rec[], v: Vault, sort?: { field: string; direction: "asc" | "desc" }): Rec[] {
  const field = sort?.field ?? def.date;
  if (!field) return rows;
  const dir = sort?.direction ?? (sort ? "asc" : "desc");
  const val = (r: Rec) => fieldValue(def, r, field, v);
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === y) return 0;
    if (x === undefined || x === null || x === "") return 1;
    if (y === undefined || y === null || y === "") return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "de");
    return dir === "asc" ? c : -c;
  });
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

export type Metric = "sum" | "count" | "avg" | "min" | "max";
export type Period = "month" | "quarter" | "year";

export function periodKey(date: string, period: Period): string {
  if (!/^\d{4}-\d{2}/.test(date)) return "ohne Datum";
  const y = date.slice(0, 4);
  if (period === "year") return y;
  const m = Number(date.slice(5, 7));
  return period === "month" ? `${y}-${date.slice(5, 7)}` : `${y}-Q${Math.ceil(m / 3)}`;
}

const MONTHS = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export function periodLabel(key: string): string {
  const m = key.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const q = key.match(/^(\d{4})-Q(\d)$/);
  if (q) return `Q${q[2]} ${q[1]}`;
  return key;
}

export interface AggregateRow {
  period?: string;
  group?: string;
  value: number;
  count: number;
}

export function aggregate(
  def: CollectionDef,
  rows: Rec[],
  v: Vault,
  opts: { metric: Metric; field?: string; groupBy?: string; period?: Period; dateField?: string },
): AggregateRow[] {
  const dateField = opts.dateField ?? (def.virtual?.effectiveDate ? "effectiveDate" : def.date);
  const buckets = new Map<string, { period?: string; group?: string; values: number[]; count: number }>();
  for (const r of rows) {
    const period = opts.period && dateField ? periodKey(String(fieldValue(def, r, dateField, v) ?? ""), opts.period) : undefined;
    let groups: string[] = [""];
    if (opts.groupBy) {
      const nameField = opts.groupBy.endsWith("Id") ? opts.groupBy.slice(0, -2) + "Name" : undefined;
      const raw = fieldValue(def, r, opts.groupBy, v);
      if (Array.isArray(raw)) {
        groups = raw.length ? raw.map(String) : ["(keine)"];
        if (opts.groupBy === "assigneeIds" || opts.groupBy === "memberIds") groups = groups.map((id) => v.members.find((m) => m.id === id)?.name ?? id);
      } else {
        const named = nameField ? fieldValue(def, r, nameField, v) : undefined;
        groups = [String((named as string) || raw || "(ohne)")];
      }
    }
    const num = opts.metric === "count" ? 1 : Number(fieldValue(def, r, opts.field ?? "", v));
    if (opts.metric !== "count" && !Number.isFinite(num)) continue;
    for (const g of groups) {
      const key = `${period ?? ""}|${g}`;
      let b = buckets.get(key);
      if (!b) {
        b = { period, group: opts.groupBy ? g : undefined, values: [], count: 0 };
        buckets.set(key, b);
      }
      b.values.push(num);
      b.count++;
    }
  }
  const out: AggregateRow[] = [...buckets.values()].map((b) => {
    const sum = b.values.reduce((s, x) => s + x, 0);
    const value =
      opts.metric === "count" ? b.count : opts.metric === "sum" ? sum : opts.metric === "avg" ? (b.values.length ? sum / b.values.length : 0) : opts.metric === "min" ? Math.min(...b.values) : Math.max(...b.values);
    return { period: b.period, group: b.group, value: Math.round(value * 100) / 100, count: b.count };
  });
  return out.sort((a, b) => (a.period && b.period && a.period !== b.period ? a.period.localeCompare(b.period) : b.value - a.value));
}

/* ------------------------------------------------------------------ */
/* Project figures                                                     */
/* ------------------------------------------------------------------ */

export function projectFigures(v: Vault, projectId: string, today: string) {
  const p = v.projects.find((x) => x.id === projectId)!;
  const tasks = v.tasks.filter((t) => !t.deletedAt && t.projectId === projectId);
  const leaf = tasks.filter((t) => !tasks.some((c) => c.parentId === t.id));
  const done = leaf.filter((t) => t.status === "done");
  const overdue = leaf.filter((t) => t.status !== "done" && t.dueDate && t.dueDate < today);
  const blocked = leaf.filter((t) => t.status === "blocked");
  const entries = v.timeEntries.filter((e) => !e.deletedAt && e.projectId === projectId);
  const minutes = entries.reduce((s, e) => s + e.minutes, 0);
  const billableValue = entries.filter((e) => e.billable).reduce((s, e) => s + Math.round((e.minutes / 60) * (e.rateCents ?? p.hourlyRateCents ?? 0)), 0);
  const timeCost = entries.reduce((s, e) => s + Math.round((e.minutes / 60) * (e.costCents ?? 0)), 0);
  const txs = v.transactions.filter((t) => !t.deletedAt && t.projectId === projectId);
  const net = (t: (typeof txs)[number]) => (t.vatLines.length ? t.vatLines.reduce((s, l) => s + l.netCents, 0) : t.grossCents);
  const expenses = txs.filter((t) => t.kind === "expense").reduce((s, t) => s + net(t), 0);
  const income = txs.filter((t) => t.kind === "income").reduce((s, t) => s + net(t), 0);
  const invoices = v.invoices.filter((i) => !i.deletedAt && i.projectId === projectId && i.status !== "cancelled" && i.kind === "invoice");
  const invoicedNet = invoices.reduce((s, i) => s + i.lines.reduce((x, l) => x + Math.round(l.quantity * l.unitNetCents * (1 - (l.discountPct || 0) / 100)), 0), 0);
  const milestones = v.milestones.filter((m) => !m.deletedAt && m.projectId === projectId);
  const next = milestones.filter((m) => m.status === "open").sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))[0];
  const hours = Math.round((minutes / 60) * 10) / 10;
  const costTotal = timeCost + expenses;
  return {
    id: p.id,
    number: p.number,
    name: p.name,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    customerName: p.customerId ? v.contacts.find((c) => c.id === p.customerId)?.name : undefined,
    tasks: { total: leaf.length, done: done.length, open: leaf.length - done.length, overdue: overdue.length, blocked: blocked.length },
    progressPct: leaf.length ? Math.round((done.length / leaf.length) * 100) : null,
    hoursLogged: hours,
    budgetHours: p.budgetHours || null,
    hoursUsedPct: p.budgetHours ? Math.round((hours / p.budgetHours) * 100) : null,
    budgetCents: p.budgetCents || null,
    billableValueCents: billableValue,
    timeCostCents: timeCost,
    expensesNetCents: expenses,
    incomeNetCents: income,
    invoicedNetCents: invoicedNet,
    costUsedPct: p.budgetCents ? Math.round((costTotal / p.budgetCents) * 100) : null,
    endDatePassed: !!p.endDate && p.endDate < today && p.status !== "completed",
    nextMilestone: next ? { title: next.title, dueDate: next.dueDate } : undefined,
    overdueTasks: overdue
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .slice(0, 6)
      .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, status: t.status })),
  };
}

