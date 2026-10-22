import { useMemo } from "react";
import { Check, Pencil, Timer } from "lucide-react";
import { shiftIsoDate, sumTimeEntries, todayIso, weekOfIso, timeEntryValueCents, type Member, type Project, type Task, type TimeEntry } from "@ordo/core";
import { DateInput, Select } from "@/components/ui";
import { cls, fmtDate, fmtMoney } from "@/lib/format";
import { fmtH } from "./labels";
import { Avatar } from "./parts";

export type Period = "all" | "week" | "lastWeek" | "month" | "lastMonth" | "year" | "custom";

export const PERIOD_LABELS: Record<Period, string> = {
  all: "Gesamter Zeitraum",
  week: "Diese Woche",
  lastWeek: "Letzte Woche",
  month: "Dieser Monat",
  lastMonth: "Letzter Monat",
  year: "Dieses Jahr",
  custom: "Zeitraum …",
};

export function periodRange(p: Period, custom: { from?: string; to?: string }, today = todayIso()): { from?: string; to?: string } {
  switch (p) {
    case "week": {
      const w = weekOfIso(today);
      return { from: w[0], to: w[6] };
    }
    case "lastWeek": {
      const w = weekOfIso(shiftIsoDate(today, -7));
      return { from: w[0], to: w[6] };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-31` };
    case "lastMonth": {
      const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return { from: `${ym}-01`, to: `${ym}-31` };
    }
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case "custom":
      return custom;
    default:
      return {};
  }
}

export function inRange(date: string, r: { from?: string; to?: string }): boolean {
  return (!r.from || date >= r.from) && (!r.to || date <= r.to);
}

/** Period select + custom from/to. */
export function PeriodPicker({ value, onChange, custom, onCustom, allowAll = true }: { value: Period; onChange: (p: Period) => void; custom: { from?: string; to?: string }; onCustom: (c: { from?: string; to?: string }) => void; allowAll?: boolean }) {
  return (
    <>
      <Select value={value} onChange={(e) => onChange(e.target.value as Period)} className="w-44" aria-label="Zeitraum">
        {(Object.keys(PERIOD_LABELS) as Period[]).filter((p) => allowAll || p !== "all").map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
      </Select>
      {value === "custom" ? (
        <span className="flex items-center gap-1.5">
          <DateInput value={custom.from} onChange={(v) => onCustom({ ...custom, from: v })} className="w-38" aria-label="Von" />
          <span className="text-(--text-muted)">–</span>
          <DateInput value={custom.to} onChange={(v) => onCustom({ ...custom, to: v })} className="w-38" aria-label="Bis" />
        </span>
      ) : null}
    </>
  );
}

/** Totals line above a time list. */
export function TimeTotals({ entries, valueCents }: { entries: TimeEntry[]; valueCents?: number }) {
  const t = sumTimeEntries(entries);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-(--text-muted)">
      <span>Gesamt <strong className="tabular text-(--text)">{fmtH(t.minutes)}</strong></span>
      <span>verrechenbar <strong className="tabular text-(--text)">{fmtH(t.billableMinutes)}</strong></span>
      <span>nicht verrechenbar <strong className="tabular text-(--text)">{fmtH(t.nonBillableMinutes)}</strong></span>
      <span>{t.count} Einträge</span>
      {valueCents !== undefined ? <span>Wert <strong className="tabular text-(--text)">{fmtMoney(valueCents)}</strong></span> : null}
    </div>
  );
}

/** Time entries as table (desktop) and list (phone). */
export function TimeTable({ entries, showProject, projects, tasks, numbers, members, onEdit, canEdit, showValue }: { entries: TimeEntry[]; showProject?: boolean; projects: Map<string, Project>; tasks: Map<string, Task>; numbers?: Map<string, string>; members: Map<string, Member>; onEdit: (e: TimeEntry) => void; canEdit: (e: TimeEntry) => boolean; showValue?: boolean }) {
  const sorted = useMemo(() => [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [entries]);
  const hasMembers = members.size > 0;
  const taskLabel = (e: TimeEntry) => {
    const t = e.taskId ? tasks.get(e.taskId) : undefined;
    if (!t) return "";
    const n = numbers?.get(t.id);
    return `${n ? `${n} ` : ""}${t.title}`;
  };
  return (
    <>
      <ul className="surface divide-y divide-(--border) overflow-hidden md:hidden">
        {sorted.map((e) => {
          const p = projects.get(e.projectId);
          return (
            <li key={e.id}>
              <button onClick={() => onEdit(e)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-(--surface-2)">
                {hasMembers ? <Avatar member={e.memberId ? members.get(e.memberId) : undefined} /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.description || taskLabel(e) || "Ohne Beschreibung"}</span>
                  <span className="block truncate text-xs text-(--text-muted)">{fmtDate(e.date)}{showProject && p ? ` · ${p.name}` : ""}{e.description && taskLabel(e) ? ` · ${taskLabel(e)}` : ""}</span>
                </span>
                <span className="text-right">
                  <span className={cls("block tabular text-sm font-semibold", e.minutes < 0 && "text-red-600")}>{fmtH(e.minutes)}</span>
                  {!e.billable ? <span className="block text-[10px] text-(--text-muted)">intern</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="surface hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
            <tr>
              <th className="px-3 py-2">Datum</th>
              {hasMembers ? <th className="px-3 py-2">Person</th> : null}
              {showProject ? <th className="px-3 py-2">Projekt</th> : null}
              <th className="px-3 py-2">Aufgabe</th>
              <th className="px-3 py-2">Beschreibung</th>
              <th className="px-3 py-2 text-right">Dauer</th>
              {showValue ? <th className="px-3 py-2 text-right">Wert</th> : null}
              <th className="px-3 py-2 text-center">Verr.</th>
              <th className="w-10 px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {sorted.map((e) => {
              const m = e.memberId ? members.get(e.memberId) : undefined;
              const p = projects.get(e.projectId);
              return (
                <tr key={e.id} className="hover:bg-(--surface-2)" onDoubleClick={() => onEdit(e)}>
                  <td className="whitespace-nowrap px-3 py-2 tabular">{fmtDate(e.date)}</td>
                  {hasMembers ? <td className="whitespace-nowrap px-3 py-2">{m ? <span className="inline-flex items-center gap-2"><Avatar member={m} size="xs" />{m.name.split(" ")[0]}</span> : <span className="text-(--text-muted)">–</span>}</td> : null}
                  {showProject ? <td className="max-w-[12rem] truncate px-3 py-2">{p?.name ?? "–"}</td> : null}
                  <td className="max-w-[14rem] truncate px-3 py-2 text-(--text-muted)">{taskLabel(e) || "–"}</td>
                  <td className="max-w-[18rem] px-3 py-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {e.startedAt ? <Timer className="h-3.5 w-3.5 shrink-0 text-(--text-muted)" aria-label="Mit Stoppuhr erfasst" /> : null}
                      <span className="truncate">{e.description || <span className="text-(--text-muted)">–</span>}</span>
                    </span>
                  </td>
                  <td className={cls("whitespace-nowrap px-3 py-2 text-right tabular font-medium", e.minutes < 0 && "text-red-600")}>{fmtH(e.minutes)}</td>
                  {showValue ? <td className="whitespace-nowrap px-3 py-2 text-right tabular text-(--text-muted)">{e.billable ? fmtMoney(timeEntryValueCents(e, p, members)) : "–"}</td> : null}
                  <td className="px-3 py-2 text-center">{e.billable ? <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label="verrechenbar" /> : <span className="text-(--text-muted)">–</span>}</td>
                  <td className="px-2 py-2">
                    <button onClick={() => onEdit(e)} className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface) hover:text-(--text)" aria-label={canEdit(e) ? "Bearbeiten" : "Ansehen"}><Pencil className="h-4 w-4" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
