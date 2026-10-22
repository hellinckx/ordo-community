import type { RecurringRule, Transaction } from "../model/types";
import { nowIso, todayIso } from "../model/types";
import { ids } from "../model/ids";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}

function addInterval(y: number, m: number, interval: RecurringRule["interval"]): [number, number] {
  const months = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12, weekly: 0 }[interval];
  let nm = m + months;
  let ny = y;
  while (nm > 12) {
    nm -= 12;
    ny += 1;
  }
  return [ny, nm];
}

/** All due dates of a rule between (after) `after` and `until` (inclusive). */
export function occurrences(rule: RecurringRule, until: string = todayIso()): string[] {
  const out: string[] = [];
  const start = rule.startDate;
  const after = rule.lastMaterializedDate ?? "";
  const end = rule.endDate && rule.endDate < until ? rule.endDate : until;
  if (rule.interval === "weekly") {
    const d = new Date(start + "T00:00:00");
    for (let i = 0; i < 1000; i++) {
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (iso > end) break;
      if (iso > after) out.push(iso);
      d.setDate(d.getDate() + 7);
    }
    return out;
  }
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  for (let i = 0; i < 1000; i++) {
    const day = Math.min(rule.dayOfMonth, daysInMonth(y, m));
    const iso = `${y}-${pad(m)}-${pad(day)}`;
    if (iso > end) break;
    if (iso >= start && iso > after) out.push(iso);
    [y, m] = addInterval(y, m, rule.interval);
  }
  return out;
}

export function nextOccurrence(rule: RecurringRule, from: string = todayIso()): string | null {
  const far = `${Number(from.slice(0, 4)) + 3}-12-31`;
  const list = occurrences({ ...rule, lastMaterializedDate: rule.lastMaterializedDate && rule.lastMaterializedDate > from ? rule.lastMaterializedDate : from }, far);
  return list[0] ?? null;
}

export function materialize(rule: RecurringRule, date: string): Transaction {
  const now = nowIso();
  const t = rule.template;
  return {
    id: ids.transaction(),
    profileId: rule.profileId,
    kind: t.kind,
    date,
    description: t.description,
    contactId: t.contactId,
    categoryId: t.categoryId,
    vatLines: t.vatLines.map((l) => ({ ...l })),
    grossCents: t.grossCents,
    currency: "EUR",
    vatTreatment: t.vatTreatment,
    vatDeductiblePct: t.vatDeductiblePct,
    paymentMethod: t.paymentMethod,
    paidDate: date,
    invoiceNumber: "",
    reference: "",
    documentIds: [],
    recurringRuleId: rule.id,
    tags: [...t.tags, "wiederkehrend"],
    notes: "",
    origin: "recurring",
    reviewed: rule.autoBook,
    createdAt: now,
    updatedAt: now,
  };
}

/** Returns the transactions to create for all active rules up to today (does not mutate). */
export function dueRecurring(rules: RecurringRule[], until: string = todayIso()): { rule: RecurringRule; transactions: Transaction[] }[] {
  const out: { rule: RecurringRule; transactions: Transaction[] }[] = [];
  for (const rule of rules) {
    if (rule.deletedAt || !rule.active) continue;
    const dates = occurrences(rule, until);
    if (dates.length) out.push({ rule, transactions: dates.map((d) => materialize(rule, d)) });
  }
  return out;
}

export const INTERVAL_LABELS: Record<RecurringRule["interval"], string> = {
  weekly: "wöchentlich",
  monthly: "monatlich",
  quarterly: "vierteljährlich",
  half_yearly: "halbjährlich",
  yearly: "jährlich",
};
