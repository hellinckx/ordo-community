import type { Priority, Project, ProjectStatus, TaskStatus } from "@ordo/core";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: Tone }> = {
  planning: { label: "In Planung", tone: "neutral" },
  active: { label: "Aktiv", tone: "brand" },
  on_hold: { label: "Pausiert", tone: "warning" },
  completed: { label: "Abgeschlossen", tone: "success" },
  cancelled: { label: "Abgebrochen", tone: "neutral" },
};
export const PROJECT_STATUS_ORDER: ProjectStatus[] = ["planning", "active", "on_hold", "completed", "cancelled"];

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone; dot: string }> = {
  todo: { label: "Offen", tone: "neutral", dot: "bg-slate-400" },
  in_progress: { label: "In Arbeit", tone: "brand", dot: "bg-brand-600" },
  review: { label: "Zur Abnahme", tone: "info", dot: "bg-sky-400" },
  done: { label: "Erledigt", tone: "success", dot: "bg-emerald-500" },
  blocked: { label: "Blockiert", tone: "danger", dot: "bg-red-500" },
};
export const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "review", "done", "blocked"];

export const PRIORITY: Record<Priority, { label: string; tone: Tone }> = {
  low: { label: "Niedrig", tone: "neutral" },
  medium: { label: "Normal", tone: "neutral" },
  high: { label: "Hoch", tone: "warning" },
  urgent: { label: "Dringend", tone: "danger" },
};
export const PRIORITY_ORDER: Priority[] = ["low", "medium", "high", "urgent"];

export const BILLING: Record<Project["billing"], { label: string; hint: string }> = {
  fixed: { label: "Pauschal", hint: "Vereinbarte Projektsumme" },
  hourly: { label: "Nach Aufwand", hint: "Verrechnet wird die erfasste Zeit mal Stundensatz" },
  internal: { label: "Intern", hint: "Wird nicht verrechnet" },
};

/** Minutes as decimal hours: 90 → "1,5 h". */
export function fmtH(minutes: number, opts: { unit?: boolean } = {}): string {
  const h = minutes / 60;
  const s = h.toLocaleString("de-AT", { minimumFractionDigits: 0, maximumFractionDigits: Math.abs(h) < 10 ? 2 : 1 });
  return opts.unit === false ? s : `${s} h`;
}

/** Hours (number) as "12,5 h". */
export function fmtHours(hours: number): string {
  return `${hours.toLocaleString("de-AT", { maximumFractionDigits: 1 })} h`;
}

/** Seconds as "1:02:03". */
export function fmtStopwatch(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Short date "21.10." for dense views. */
export function fmtDayMonth(iso: string | undefined): string {
  if (!iso) return "–";
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

export const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** A safe file name part: umlauts spelled out, no special characters. */
export function fileSafe(s: string): string {
  return s
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60) || "Projekt";
}
