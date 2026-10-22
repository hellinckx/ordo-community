import { useMemo } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { projectAnalytics, projectRisk, projectStats, todayIso, type Milestone, type Task, type TimeEntry } from "@ordo/core";
import { Card, EmptyState, Stat } from "@/components/ui";
import { useList, useVault } from "@/state/hooks";
import { cls, fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import { CHART } from "@/components/charts";
import { fmtH, fmtHours } from "../labels";
import { Avatar, ProgressLine } from "../parts";
import { useMembers, useProjectRights } from "../hooks";
import type { DetailContext } from "../ProjectDetail";

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--text)" };
const hours = (v: unknown) => `${Number(v).toLocaleString("de-AT", { maximumFractionDigits: 1 })} h`;
/** Card title with a short explanation underneath. */
function heading(title: string, hint: string) {
  return (
    <span className="block">
      <span className="block">{title}</span>
      <span className="mt-0.5 block text-xs font-normal text-(--text-muted)">{hint}</span>
    </span>
  );
}

const STATUS_LABEL = { todo: "Offen", in_progress: "In Arbeit", review: "Zur Prüfung", blocked: "Blockiert", done: "Erledigt" } as const;
const STATUS_COLOR = { todo: "#a2a19c", in_progress: "#0a5fe0", review: "#5856d6", blocked: "#ff3b30", done: "#34c759" } as const;

/** "Auswertung": how the project runs against its plan – for the project lead. */
export function AnalyticsTab({ ctx, tasks, entries, milestones }: { ctx: DetailContext; tasks: Task[]; entries: TimeEntry[]; milestones: Milestone[] }) {
  const { project } = ctx;
  const vault = useVault();
  const invoices = useList("invoices");
  const { byId } = useMembers();
  const rights = useProjectRights();
  const today = todayIso();
  const a = useMemo(() => projectAnalytics({ project, tasks, entries, today }), [project, tasks, entries, today]);
  const stats = useMemo(() => projectStats({ project, tasks, timeEntries: entries, milestones, invoices, members: vault.members, today }), [project, tasks, entries, milestones, invoices, vault.members, today]);
  const risk = useMemo(() => projectRisk({ project, stats, forecast: a.forecast, milestones, today, money: rights.canSeeMoney }), [project, stats, a.forecast, milestones, today, rights.canSeeMoney]);
  // without the right to see everyone's time, only one's own row
  const people = rights.canSeeTeamTime ? a.people : a.people.filter((p) => p.memberId && p.memberId === rights.member?.id);
  const f = a.forecast;

  if (!entries.length && !tasks.length) {
    return <EmptyState title="Noch nichts auszuwerten" body="Sobald Aufgaben angelegt und Zeiten erfasst sind, siehst du hier Verlauf, Prognose und wer woran arbeitet." />;
  }

  // the running total ends today; the plan line goes on to the end date
  const weekRows = a.weeks.map((w) => ({ label: w.label, woche: w.minutes / 60, verrechenbar: w.billableMinutes / 60, ist: w.week <= today ? w.cumulativeMinutes / 60 : null, plan: w.planHours }));
  const hasPlanLine = a.weeks.some((w) => w.planHours !== null);
  const leafTotal = a.status.todo + a.status.in_progress + a.status.review + a.status.blocked + a.status.done;

  return (
    <div className="space-y-5">
      {risk ? (
        <section className={cls("surface flex items-start gap-3 p-4", risk.level === "high" ? "border-red-300 dark:border-red-900" : "border-amber-300 dark:border-amber-900")}>
          <AlertTriangle className={cls("mt-0.5 h-5 w-5 shrink-0", risk.level === "high" ? "text-red-600" : "text-amber-600")} />
          <div>
            <div className="font-semibold">{risk.level === "high" ? "Dieses Projekt braucht Aufmerksamkeit" : "Darauf solltest du achten"}</div>
            <ul className="mt-1 list-disc pl-5 text-sm text-(--text-muted)">
              {risk.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        </section>
      ) : (
        <section className="surface flex items-center gap-3 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <span>Im Plan: keine Überschreitung, nichts überfällig.</span>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Fortschritt" value={fmtPct(f.progress)} sub={`${a.status.done} von ${leafTotal} Aufgaben erledigt`} />
        <Stat label="Stunden" value={fmtHours(Math.round(f.trackedHours * 10) / 10)} sub={f.plannedHours ? `von ${fmtHours(f.plannedHours)} geplant · ${fmtPct(f.trackedHours / f.plannedHours)}` : "Kein Plan hinterlegt"} />
        <Stat
          label="Prognose"
          value={f.forecastHours !== null ? fmtHours(Math.round(f.forecastHours)) : "–"}
          tone={f.overrunHours !== null && f.overrunHours > 0 ? "down" : undefined}
          sub={f.forecastHours === null ? "Ab 10 % Fortschritt" : f.overrunHours !== null ? `${f.overrunHours > 0 ? "+" : ""}${fmtHours(Math.round(f.overrunHours))} gegenüber Plan` : "Ohne Plan kein Vergleich"}
        />
        <Stat
          label="Voraussichtlich fertig"
          value={f.expectedEnd ? fmtDate(f.expectedEnd) : f.remainingHours === 0 && f.progress >= 1 ? "Fertig" : "–"}
          tone={f.late ? "down" : undefined}
          sub={f.weeklyHours > 0 ? `bei ${fmtHours(Math.round(f.weeklyHours * 10) / 10)} pro Woche${project.endDate ? ` · geplant ${fmtDate(project.endDate)}` : ""}` : "In den letzten 4 Wochen keine Zeit erfasst"}
        />
      </div>

      <Card title={heading("Verlauf: Ist und Plan", hasPlanLine ? "Balken: Stunden pro Woche · Linien: Summe bisher und Plan bis zum Enddatum" : "Balken: Stunden pro Woche · Linie: Summe bisher. Mit Start- und Enddatum und geplanten Stunden zeigt Ordo auch die Plan-Linie.")}>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={weekRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis yAxisId="w" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={36} />
            <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={40} />
            <Tooltip contentStyle={tooltipStyle} formatter={hours} cursor={{ fill: "var(--surface-2)" }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
            <Bar yAxisId="w" dataKey="woche" name="Pro Woche" fill="#c7d7f5" radius={[4, 4, 0, 0]} />
            <Line yAxisId="c" type="monotone" dataKey="ist" name="Summe bisher" stroke={CHART.line} strokeWidth={2.5} dot={false} />
            {hasPlanLine ? <Line yAxisId="c" type="linear" dataKey="plan" name="Plan" stroke="#a2a19c" strokeDasharray="5 4" strokeWidth={2} dot={false} /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={heading("Wer woran arbeitet", "Stunden pro Person in diesem Projekt")} padded={false}>
          {people.length ? (
            <ul className="divide-y divide-(--border)">
              {people.map((p) => {
                const m = p.memberId ? byId.get(p.memberId) : undefined;
                const share = f.trackedHours > 0 ? p.minutes / 60 / f.trackedHours : 0;
                return (
                  <li key={p.memberId ?? "-"} className="flex items-center gap-3 px-5 py-3">
                    <Avatar member={m} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{m?.name ?? "Ohne Person"}</span>
                        <span className="tabular">{fmtH(p.minutes)}</span>
                      </div>
                      <ProgressLine className="mt-1.5" value={share} />
                      <div className="mt-1 text-xs text-(--text-muted)">{fmtPct(share)} der Projektzeit · verrechenbar {fmtH(p.billableMinutes)} · letzte 4 Wochen {fmtH(p.recentMinutes)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-(--text-muted)">Noch keine Zeit erfasst.</p>
          )}
        </Card>

        <Card title={heading("Aufgaben nach Status", a.status.overdue ? `${a.status.overdue} davon überfällig` : "Nichts überfällig")}>
          {leafTotal ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((k) => ({ name: STATUS_LABEL[k], anzahl: a.status[k] }))} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={84} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-2)" }} />
                <Bar dataKey="anzahl" name="Aufgaben" radius={[0, 4, 4, 0]}>
                  {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((k) => <Cell key={k} fill={STATUS_COLOR[k]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-(--text-muted)">Noch keine Aufgaben.</p>
          )}
        </Card>
      </div>

      <Card title={heading(a.packages.some((p) => p.isPackage) ? "Arbeitspakete: Schätzung und Ist" : "Aufgaben: Schätzung und Ist", "Mehraufwand = gebuchte Stunden minus dem Anteil der Schätzung, der schon erledigt ist")} padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-(--text-muted)">
              <tr className="border-b border-(--border)">
                <th className="px-5 py-2 font-medium">Paket</th>
                <th className="px-3 py-2 text-right font-medium">Schätzung</th>
                <th className="px-3 py-2 text-right font-medium">Gebucht</th>
                <th className="w-40 px-3 py-2 font-medium">Erledigt</th>
                <th className="px-5 py-2 text-right font-medium">Mehraufwand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--border)">
              {a.packages.map((p) => (
                <tr key={p.taskId}>
                  <td className="px-5 py-2.5"><span className="mr-2 text-xs tabular text-(--text-muted)">{p.number}</span>{p.title}{p.overdue ? <span className="ml-2 text-xs text-red-600">überfällig</span> : null}</td>
                  <td className="px-3 py-2.5 text-right tabular">{p.estimateHours ? fmtHours(p.estimateHours) : "–"}</td>
                  <td className="px-3 py-2.5 text-right tabular">{fmtH(p.trackedMinutes)}</td>
                  <td className="px-3 py-2.5"><ProgressLine value={p.progress} tone={p.progress >= 1 ? "success" : "brand"} label={fmtPct(p.progress)} /></td>
                  <td className={cls("px-5 py-2.5 text-right tabular", p.overHours > 0.25 ? "text-red-600" : p.overHours < -0.25 ? "text-emerald-700 dark:text-emerald-400" : "text-(--text-muted)")}>{p.estimateHours ? `${p.overHours > 0 ? "+" : ""}${fmtHours(Math.round(p.overHours * 10) / 10)}` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {rights.canSeeMoney && project.billing !== "internal" ? (
        <Card title="Geld">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-(--text-muted)">Erwarteter Umsatz</div><div className="text-lg font-semibold tabular">{fmtMoney(stats.revenueCents)}</div></div>
            <div><div className="text-xs text-(--text-muted)">Kosten bisher</div><div className="text-lg font-semibold tabular">{fmtMoney(stats.costCents)}</div></div>
            <div><div className="text-xs text-(--text-muted)">Marge</div><div className={cls("text-lg font-semibold tabular", stats.marginCents < 0 && "text-red-600")}>{fmtMoney(stats.marginCents)}{stats.marginPct !== null ? <span className="ml-1 text-sm font-normal text-(--text-muted)">{fmtPct(stats.marginPct)}</span> : null}</div></div>
            <div><div className="text-xs text-(--text-muted)">Noch nicht fakturiert</div><div className="text-lg font-semibold tabular">{fmtMoney(Math.max(0, stats.revenueCents - stats.invoicedNetCents))}</div></div>
          </div>
          {f.forecastHours !== null && f.trackedHours > 0 ? <p className="mt-3 text-xs text-(--text-muted)">Hochgerechnet auf {fmtHours(Math.round(f.forecastHours))} kommen voraussichtlich noch Kosten von rund {fmtMoney(Math.round((stats.costCents / f.trackedHours) * Math.max(0, f.forecastHours - f.trackedHours)))} dazu.</p> : null}
        </Card>
      ) : null}
    </div>
  );
}
