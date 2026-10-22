import type { Profile } from "../../model/types";
import { todayIso } from "../../model/types";

export interface UvaPeriodRef {
  year: number;
  /** 1..12 for monthly, 1..4 for quarterly */
  index: number;
  kind: "monthly" | "quarterly";
}

export interface PeriodRange {
  from: string;
  to: string;
  label: string;
  dueDate: string;
  ref: UvaPeriodRef;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** UVA ist bis zum 15. des zweitfolgenden Monats nach Ende des Voranmeldungszeitraums einzureichen (§ 21 Abs. 1 UStG). */
export function uvaDueDate(ref: UvaPeriodRef): string {
  const endMonth = ref.kind === "monthly" ? ref.index : ref.index * 3;
  let dueMonth = endMonth + 2;
  let dueYear = ref.year;
  if (dueMonth > 12) {
    dueMonth -= 12;
    dueYear += 1;
  }
  return `${dueYear}-${pad(dueMonth)}-15`;
}

export function uvaPeriodRange(ref: UvaPeriodRef): PeriodRange {
  if (ref.kind === "monthly") {
    const from = `${ref.year}-${pad(ref.index)}-01`;
    const to = `${ref.year}-${pad(ref.index)}-${pad(lastDayOfMonth(ref.year, ref.index))}`;
    const label = `${new Date(ref.year, ref.index - 1, 1).toLocaleDateString("de-AT", { month: "long" })} ${ref.year}`;
    return { from, to, label, dueDate: uvaDueDate(ref), ref };
  }
  const startMonth = (ref.index - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const from = `${ref.year}-${pad(startMonth)}-01`;
  const to = `${ref.year}-${pad(endMonth)}-${pad(lastDayOfMonth(ref.year, endMonth))}`;
  return { from, to, label: `${ref.index}. Quartal ${ref.year}`, dueDate: uvaDueDate(ref), ref };
}

export function periodForDate(date: string, kind: "monthly" | "quarterly"): UvaPeriodRef {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return kind === "monthly" ? { year, index: month, kind } : { year, index: Math.ceil(month / 3), kind };
}

export function previousPeriod(ref: UvaPeriodRef): UvaPeriodRef {
  const max = ref.kind === "monthly" ? 12 : 4;
  return ref.index === 1 ? { ...ref, year: ref.year - 1, index: max } : { ...ref, index: ref.index - 1 };
}

export function nextPeriod(ref: UvaPeriodRef): UvaPeriodRef {
  const max = ref.kind === "monthly" ? 12 : 4;
  return ref.index === max ? { ...ref, year: ref.year + 1, index: 1 } : { ...ref, index: ref.index + 1 };
}

/** All periods of a year in order. */
export function periodsOfYear(year: number, kind: "monthly" | "quarterly"): PeriodRange[] {
  const n = kind === "monthly" ? 12 : 4;
  return Array.from({ length: n }, (_, i) => uvaPeriodRange({ year, index: i + 1, kind }));
}

/** Upcoming UVA deadline(s) for a profile – the last closed period that is still open and the current one. */
export function upcomingUvaDeadlines(profile: Profile, today = todayIso()): PeriodRange[] {
  if (profile.mode !== "business" || profile.uvaPeriod === "none") return [];
  const kind = profile.uvaPeriod;
  const current = periodForDate(today, kind);
  const prev = previousPeriod(current);
  const out: PeriodRange[] = [];
  const prevRange = uvaPeriodRange(prev);
  if (prevRange.dueDate >= today) out.push(prevRange);
  out.push(uvaPeriodRange(current));
  return out;
}

/** Einkommensteuererklärung: 30. April (Papier) bzw. 30. Juni (FinanzOnline) des Folgejahres. */
export function estDeadlines(year: number): { paper: string; finanzOnline: string } {
  return { paper: `${year + 1}-04-30`, finanzOnline: `${year + 1}-06-30` };
}

/** Arbeitnehmerveranlagung kann 5 Jahre rückwirkend beantragt werden (bis 31.12.). */
export function anvDeadline(year: number): string {
  return `${year + 5}-12-31`;
}

export function daysUntil(dateIso: string, today = todayIso()): number {
  const a = new Date(dateIso + "T00:00:00");
  const b = new Date(today + "T00:00:00");
  return Math.round((a.getTime() - b.getTime()) / 86400_000);
}
