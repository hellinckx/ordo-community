import { useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { isoWeekNumber, mondayOfIso, projectAnalytics, projectRisk, shiftIsoDate, teamLoad, todayIso, type Project, type ProjectAnalytics, type ProjectRisk } from "@ordo/core";
import { Card, EmptyState, PageHeader, Stat, Tabs } from "@/components/ui";
import { useList, useVault } from "@/state/hooks";
import { cls, fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import { fmtH, fmtHours } from "./labels";
import { Avatar, ProgressLine, ProjectStatusBadge } from "./parts";
import { useMembers, useProjectRights, useTimeFilter } from "./hooks";
import { useAllProjectStats } from "./data";

type Period = "monat" | "vormonat" | "wochen" | "quartal";
const PERIODS: { id: Period; label: string }[] = [
  { id: "monat", label: "Dieser Monat" },
  { id: "vormonat", label: "Letzter Monat" },
  { id: "wochen", label: "Letzte 4 Wochen" },
  { id: "quartal", label: "Dieses Quartal" },
];

function range(period: Period, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  if (period === "monat") return { from: iso(y, m, 1), to: today };
  if (period === "vormonat") {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return { from: iso(py, pm, 1), to: shiftIsoDate(iso(y, m, 1), -1) };
  }
  if (period === "wochen") return { from: shiftIsoDate(today, -27), to: today };
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return { from: iso(y, q, 1), to: today };
}

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--text)" };
const PALETTE = ["#0a5fe0", "#5856d6", "#0f9d8a", "#ff9500", "#ff3b30", "#a2a19c"];

/** Projekte → Auswertung: all projects and the team at a glance – for project leads and owners. */
export default function ReportPage() {
  const vault = useVault();
  const projects = useList("projects");
  const tasks = useList("tasks");
  const entries = useList("timeEntries");
  const milestones = useList("milestones");
  const stats = useAllProjectStats();
  const { byId } = useMembers();
  const rights = useProjectRights();
  const [period, setPeriod] = useState<Period>("monat");
  const today = todayIso();
  const { from, to } = range(period, today);

  const running = useMemo(() => projects.filter((p) => p.status === "active" || p.status === "planning" || p.status === "on_hold"), [projects]);
  const analysis = useMemo(() => {
    const out = new Map<string, { a: ProjectAnalytics; risk: ProjectRisk | null }>();
    for (const p of running) {
      const a = projectAnalytics({ project: p, tasks: tasks.filter((t) => t.projectId === p.id), entries: entries.filter((e) => e.projectId === p.id), today });
      const s = stats.get(p.id);
      out.set(p.id, { a, risk: s ? projectRisk({ project: p, stats: s, forecast: a.forecast, milestones, today, money: rights.canSeeMoney }) : null });
    }
    return out;
  }, [running, tasks, entries, milestones, stats, today, rights.canSeeMoney]);
  const load = useMemo(() => teamLoad({ members: vault.members, entries, tasks, from, to, today }), [vault.members, entries, tasks, from, to, today]);

  const visible = useTimeFilter();
  const mine = visible(entries);
  const inPeriod = mine.filter((e) => e.date >= from && e.date <= to);
  const periodMinutes = inPeriod.reduce((s, e) => s + e.minutes, 0);
  const periodBillable = inPeriod.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
  const risky = running.filter((p) => analysis.get(p.id)?.risk).sort((a, b) => Number(analysis.get(b.id)!.risk!.level === "high") - Number(analysis.get(a.id)!.risk!.level === "high"));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // hours per project and week, the last eight weeks – the busiest five projects, the rest together
  const weeks = Array.from({ length: 8 }, (_, i) => shiftIsoDate(mondayOfIso(today), (i - 7) * 7));
  const recent = mine.filter((e) => e.date >= weeks[0]!);
  const totals = new Map<string, number>();
  for (const e of recent) totals.set(e.projectId, (totals.get(e.projectId) ?? 0) + e.minutes);
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  const weekRows = weeks.map((w) => {
    const row: Record<string, number | string> = { label: `KW ${isoWeekNumber(w)}` };
    for (const e of recent) {
      if (mondayOfIso(e.date) !== w) continue;
      const key = top.includes(e.projectId) ? e.projectId : "rest";
      row[key] = ((row[key] as number | undefined) ?? 0) + e.minutes / 60;
    }
    return row;
  });

  if (!projects.length) return <><PageHeader title="Projekt-Auswertung" /><EmptyState title="Noch keine Projekte" body="Leg ein Projekt an und erfasse Zeiten – dann siehst du hier, wie alle Projekte und dein Team laufen." /></>;

  return (
    <div className="space-y-5">
      <PageHeader title="Projekt-Auswertung" subtitle="Wie deine Projekte laufen und wie ausgelastet dein Team ist." />
      <Tabs tabs={PERIODS} value={period} onChange={setPeriod} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label={rights.canSeeTeamTime ? "Erfasste Stunden" : "Deine erfassten Stunden"} value={fmtH(periodMinutes)} sub={`${fmtDate(from)} – ${fmtDate(to)}`} />
        <Stat label="Davon verrechenbar" value={periodMinutes ? fmtPct(periodBillable / periodMinutes) : "–"} sub={fmtH(periodBillable)} />
        <Stat label="Laufende Projekte" value={running.length} sub={`${projects.filter((p) => p.status === "completed").length} abgeschlossen`} />
        <Stat label="Brauchen Aufmerksamkeit" value={risky.length} tone={risky.some((p) => analysis.get(p.id)!.risk!.level === "high") ? "down" : undefined} sub={risky.length ? `${risky.filter((p) => analysis.get(p.id)!.risk!.level === "high").length} davon dringend` : "Alles im Plan"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Auslastung im Team" padded={false}>
          {!rights.canSeeTeamTime ? (
            <p className="px-5 py-4 text-sm text-(--text-muted)">Die Auslastung des Teams sehen Inhaber:in, Administration und Projektleitung.</p>
          ) : load.length ? (
            <ul className="divide-y divide-(--border)">
              {load.map((l) => {
                const m = byId.get(l.memberId);
                const projectsOf = Object.entries(l.byProject).sort((a, b) => b[1] - a[1]).slice(0, 3);
                return (
                  <li key={l.memberId} className="flex items-start gap-3 px-5 py-3">
                    <Avatar member={m} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{m?.name}</span>
                        <span className={cls("tabular", l.utilization > 1.05 && "text-red-600")}>{fmtH(l.bookedMinutes)} <span className="text-(--text-muted)">von {fmtH(l.capacityMinutes)}</span></span>
                      </div>
                      <ProgressLine className="mt-1.5" value={l.utilization} tone={l.utilization > 1.05 ? "danger" : "brand"} />
                      <div className="mt-1 text-xs text-(--text-muted)">
                        {fmtPct(l.utilization)} ausgelastet · {fmtPct(l.billableShare)} verrechenbar · {l.openTasks} offene Aufgaben{l.overdueTasks ? <span className="text-red-600"> ({l.overdueTasks} überfällig)</span> : null}
                      </div>
                      {projectsOf.length ? <div className="mt-1 truncate text-xs text-(--text-muted)">{projectsOf.map(([pid, min]) => `${projectById.get(pid)?.name ?? "?"} ${fmtH(min)}`).join(" · ")}</div> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-4 text-sm text-(--text-muted)">Unter Team legst du die Personen mit ihren Wochenstunden an – dann siehst du hier, wer wie ausgelastet ist.</p>
          )}
        </Card>

        <Card title="Brauchen Aufmerksamkeit" padded={false}>
          {risky.length ? (
            <ul className="divide-y divide-(--border)">
              {risky.map((p) => {
                const r = analysis.get(p.id)!.risk!;
                return (
                  <li key={p.id}>
                    <Link to={`/projekte/${p.id}/auswertung`} className="flex items-start gap-3 px-5 py-3 hover:bg-(--surface-2)">
                      <AlertTriangle className={cls("mt-0.5 h-4 w-4 shrink-0", r.level === "high" ? "text-red-600" : "text-amber-600")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block text-xs text-(--text-muted)">{r.reasons.join(" · ")}</span>
                      </span>
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-(--text-muted)" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex items-center gap-2 px-5 py-4 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Alle laufenden Projekte sind im Plan.</div>
          )}
        </Card>
      </div>

      <Card title={rights.canSeeTeamTime ? "Stunden pro Projekt, letzte 8 Wochen" : "Deine Stunden pro Projekt, letzte 8 Wochen"}>
        {recent.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={weekRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={36} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toLocaleString("de-AT", { maximumFractionDigits: 1 })} h`} cursor={{ fill: "var(--surface-2)" }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
              {top.map((id, i) => <Bar key={id} dataKey={id} stackId="h" name={projectById.get(id)?.name ?? "?"} fill={projectById.get(id)?.color || PALETTE[i % PALETTE.length]} />)}
              {totals.size > top.length ? <Bar dataKey="rest" stackId="h" name="Andere" fill="#a2a19c" /> : null}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-(--text-muted)">In den letzten acht Wochen wurde keine Zeit erfasst.</p>
        )}
      </Card>

      <Card title="Alle laufenden Projekte" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-(--text-muted)">
              <tr className="border-b border-(--border)">
                <th className="px-5 py-2 font-medium">Projekt</th>
                <th className="px-3 py-2 font-medium">Leitung</th>
                <th className="w-36 px-3 py-2 font-medium">Erledigt</th>
                <th className="px-3 py-2 text-right font-medium">Stunden</th>
                <th className="px-3 py-2 text-right font-medium">Prognose</th>
                <th className="px-3 py-2 font-medium">Ende</th>
                {rights.canSeeMoney ? <th className="px-5 py-2 text-right font-medium">Marge</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-(--border)">
              {running.map((p: Project) => {
                const a = analysis.get(p.id)!.a;
                const s = stats.get(p.id);
                const f = a.forecast;
                return (
                  <tr key={p.id} className="hover:bg-(--surface-2)">
                    <td className="px-5 py-2.5">
                      <Link to={`/projekte/${p.id}/auswertung`} className="font-medium hover:underline">{p.name}</Link>
                      <div className="mt-0.5"><ProjectStatusBadge status={p.status} /></div>
                    </td>
                    <td className="px-3 py-2.5 text-(--text-muted)">{p.managerId ? byId.get(p.managerId)?.name ?? "–" : "–"}</td>
                    <td className="px-3 py-2.5"><ProgressLine value={f.progress} label={fmtPct(f.progress)} /></td>
                    <td className={cls("px-3 py-2.5 text-right tabular", f.plannedHours > 0 && f.trackedHours > f.plannedHours && "text-red-600")}>{fmtHours(Math.round(f.trackedHours))}{f.plannedHours ? <span className="text-(--text-muted)"> / {fmtHours(f.plannedHours)}</span> : null}</td>
                    <td className={cls("px-3 py-2.5 text-right tabular", f.overrunHours !== null && f.overrunHours > 0 && "text-red-600")}>{f.forecastHours !== null ? fmtHours(Math.round(f.forecastHours)) : "–"}</td>
                    <td className={cls("px-3 py-2.5 tabular", f.late && "text-red-600")}>{p.endDate ? fmtDate(p.endDate) : "–"}{f.expectedEnd && f.late ? <div className="text-xs">voraussichtlich {fmtDate(f.expectedEnd)}</div> : null}</td>
                    {rights.canSeeMoney ? <td className={cls("px-5 py-2.5 text-right tabular", s && s.marginCents < 0 && "text-red-600")}>{p.billing === "internal" || !s ? "–" : <>{fmtMoney(s.marginCents)}{s.marginPct !== null ? <div className="text-xs text-(--text-muted)">{fmtPct(s.marginPct)}</div> : null}</>}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
