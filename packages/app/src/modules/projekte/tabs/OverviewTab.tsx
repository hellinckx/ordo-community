import { useMemo } from "react";
import { ArrowRight, Clock, Diamond, ReceiptText } from "lucide-react";
import { buildTaskTree, flattenTaskTree, isMilestoneOverdue, milestoneCode, milestoneProgress, milestoneTaskIds, projectInvoiceReminder, projectStats, taskRollups, todayIso, type Milestone, type Task, type TimeEntry } from "@ordo/core";
import { Badge, Button, Card, EmptyState, Stat } from "@/components/ui";
import { useContactMap, useList, useVault } from "@/state/hooks";
import { cls, fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import { BILLING, fmtH, fmtHours } from "../labels";
import { Avatar, InfoRow, ProgressLine } from "../parts";
import { useMembers, useProjectRights, useTimeFilter } from "../hooks";
import type { DetailContext } from "../ProjectDetail";
import { sortMilestones } from "../data";

export function OverviewTab({ ctx, tasks, entries, milestones }: { ctx: DetailContext; tasks: Task[]; entries: TimeEntry[]; milestones: Milestone[] }) {
  const { project } = ctx;
  const vault = useVault();
  const invoices = useList("invoices");
  const contacts = useContactMap();
  const { byId } = useMembers();
  const rights = useProjectRights();
  const today = todayIso();
  const s = useMemo(() => projectStats({ project, tasks, timeEntries: entries, milestones, invoices, members: vault.members, today }), [project, tasks, entries, milestones, invoices, vault.members, today]);
  const reminder = useMemo(() => projectInvoiceReminder(project, invoices, today, vault.settings.projects.downpaymentPct), [project, invoices, today, vault.settings.projects.downpaymentPct]);
  const numbers = useMemo(() => new Map(flattenTaskTree(buildTaskTree(tasks)).map((n) => [n.task.id, n.number])), [tasks]);
  const rollups = useMemo(() => taskRollups(tasks, entries), [tasks, entries]);
  const sortedMilestones = useMemo(() => sortMilestones(milestones), [milestones]);
  const upcoming = sortedMilestones.filter((m) => m.status !== "done").slice(0, 4);
  const visible = useTimeFilter();
  const recent = useMemo(() => [...visible(entries)].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 6), [entries, visible]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const plannedHours = project.budgetHours || s.estimateHours;
  const hoursRatio = plannedHours > 0 ? s.trackedMinutes / 60 / plannedHours : 0;
  const customer = project.customerId ? contacts.get(project.customerId) : undefined;
  const durationDays = project.startDate && project.endDate ? Math.round((Date.parse(project.endDate) - Date.parse(project.startDate)) / 86_400_000) + 1 : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Erfasste Zeit" value={fmtH(s.trackedMinutes)} sub={`verrechenbar ${fmtH(s.billableMinutes)} · letzte 7 Tage ${fmtH(s.last7DaysMinutes)}`} />
        <Stat label="Aufgaben erledigt" value={fmtPct(s.tasksDonePct)} sub={s.taskCount ? <>{s.doneTaskCount} von {s.taskCount}{s.overdueTaskCount ? <span className="text-red-600 dark:text-red-400"> · {s.overdueTaskCount} überfällig</span> : null}</> : "Noch keine Aufgaben"} />
        {rights.canSeeMoney ? (
          <>
            <Stat label="Fakturiert (netto)" value={fmtMoney(s.invoicedNetCents)} sub={project.budgetCents ? `von ${fmtMoney(project.budgetCents)} · Rest ${fmtMoney(s.remainingBudgetCents)}` : `${s.invoiceCount} Rechnung${s.invoiceCount === 1 ? "" : "en"}`} />
            <Stat label="Marge" value={project.billing === "internal" ? "–" : fmtMoney(s.marginCents)} tone={project.billing === "internal" ? undefined : s.marginCents < 0 ? "down" : undefined} sub={`Kosten ${fmtMoney(s.costCents)}${s.marginPct !== null ? ` · ${fmtPct(s.marginPct)}` : ""}`} />
          </>
        ) : (
          <>
            <Stat label="Geplant" value={plannedHours ? fmtHours(plannedHours) : "–"} sub={plannedHours ? `${fmtPct(hoursRatio)} verbraucht` : "Keine Schätzung"} />
            <Stat label="Meilensteine offen" value={milestones.filter((m) => m.status !== "done").length} sub={s.overdueMilestoneCount ? <span className="text-red-600">{s.overdueMilestoneCount} überfällig</span> : `${milestones.length} gesamt`} />
          </>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {reminder && rights.canSeeMoney ? (
            <section className="surface flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"><ReceiptText className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{reminder.title}</div>
                <p className="text-sm text-(--text-muted)">{reminder.body} Vorschlag: <strong className="tabular text-(--text)">{fmtMoney(reminder.amountCents)}</strong> netto.</p>
              </div>
              <Button onClick={() => ctx.goTab("rechnungen")}>Zu den Rechnungen <ArrowRight className="h-4 w-4" /></Button>
            </section>
          ) : null}

          <Card title="Budget & Stunden">
            <div className="space-y-5">
              {rights.canSeeMoney && project.billing !== "internal" ? (
                <div>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div><div className="text-xs text-(--text-muted)">{project.billing === "hourly" ? "Budget" : "Projektsumme"}</div><div className="text-lg font-semibold tabular">{project.budgetCents ? fmtMoney(project.budgetCents) : "–"}</div></div>
                    <div><div className="text-xs text-(--text-muted)">Fakturiert</div><div className="text-lg font-semibold tabular">{fmtMoney(s.invoicedNetCents)}</div></div>
                    <div><div className="text-xs text-(--text-muted)">Rest</div><div className={cls("text-lg font-semibold tabular", s.remainingBudgetCents < 0 && "text-red-600")}>{project.budgetCents ? fmtMoney(s.remainingBudgetCents) : "–"}</div></div>
                  </div>
                  {project.budgetCents ? <ProgressLine className="mt-3" value={s.budgetUsedPct} tone={s.budgetUsedPct > 1 ? "danger" : "brand"} /> : null}
                  {project.billing === "hourly" ? <p className="mt-2 text-xs text-(--text-muted)">Verrechenbare Zeit im Wert von {fmtMoney(s.billableValueCents)}{project.hourlyRateCents ? ` (${fmtMoney(project.hourlyRateCents)}/h)` : ""}.</p> : null}
                </div>
              ) : null}
              <div>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="text-(--text-muted)">Stunden</span>
                  <span className="tabular"><strong>{fmtH(s.trackedMinutes)}</strong>{plannedHours ? <span className="text-(--text-muted)"> von {fmtHours(plannedHours)} {project.budgetHours ? "geplant" : "geschätzt"}</span> : null}</span>
                </div>
                <ProgressLine value={hoursRatio} tone={hoursRatio > 1 ? "danger" : "brand"} />
              </div>
            </div>
          </Card>

          <Card title="Zuletzt erfasst" action={<Button size="sm" variant="ghost" onClick={() => ctx.goTab("zeiten")}>Alle Zeiten <ArrowRight className="h-4 w-4" /></Button>} padded={false}>
            {recent.length ? (
              <ul className="divide-y divide-(--border)">
                {recent.map((e) => {
                  const t = e.taskId ? taskById.get(e.taskId) : undefined;
                  return (
                    <li key={e.id}>
                      <button className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-(--surface-2)" onClick={() => ctx.editEntry(e)}>
                        {e.memberId ? <Avatar member={byId.get(e.memberId)} /> : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-(--surface-2)"><Clock className="h-3.5 w-3.5 text-(--text-muted)" /></span>}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{e.description || t?.title || "Ohne Beschreibung"}</span>
                          <span className="block truncate text-xs text-(--text-muted)">{fmtDate(e.date)}{t ? ` · ${numbers.get(t.id) ?? ""} ${t.title}` : ""}</span>
                        </span>
                        <span className={cls("tabular text-sm font-medium", e.minutes < 0 && "text-red-600")}>{fmtH(e.minutes)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState bare title="Noch keine Zeit erfasst" body="Erfasse Zeiten direkt hier oder mit der Stoppuhr unter Zeiterfassung." action={!ctx.locked ? <Button variant="outline" onClick={() => ctx.bookTime()}><Clock className="h-4 w-4" /> Zeit erfassen</Button> : undefined} />
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Nächste Meilensteine" action={<Button size="sm" variant="ghost" onClick={() => ctx.goTab("meilensteine")}>Alle</Button>}>
            {upcoming.length ? (
              <ul className="space-y-3">
                {upcoming.map((m) => {
                  const idx = sortedMilestones.indexOf(m);
                  const code = milestoneCode(milestoneTaskIds(m, tasks).map((id) => numbers.get(id) ?? "").filter(Boolean), idx);
                  const overdue = isMilestoneOverdue(m, today);
                  return (
                    <li key={m.id}>
                      <div className="flex items-start gap-2">
                        <Diamond className={cls("mt-0.5 h-4 w-4 shrink-0", overdue ? "text-red-500" : "text-brand-600")} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{m.title}</span><span className="text-[11px] tabular text-(--text-muted)">{code}</span></div>
                          <div className={cls("text-xs", overdue ? "text-red-600 dark:text-red-400" : "text-(--text-muted)")}>{m.dueDate ? `${overdue ? "Überfällig seit" : "Fällig"} ${fmtDate(m.dueDate)}` : "Ohne Datum"}</div>
                          <ProgressLine className="mt-1.5" value={milestoneProgress(m, tasks, rollups)} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-(--text-muted)">{milestones.length ? "Alle Meilensteine erreicht." : "Noch keine Meilensteine."}</p>
            )}
          </Card>

          <Card title="Projekt">
            <div className="-my-1.5 divide-y divide-(--border)">
              <InfoRow label="Kunde">{customer?.name ?? "–"}</InfoRow>
              <InfoRow label="Zeitraum">{project.startDate || project.endDate ? `${fmtDate(project.startDate)} – ${fmtDate(project.endDate)}` : "–"}</InfoRow>
              {durationDays ? <InfoRow label="Dauer">{durationDays} Tage</InfoRow> : null}
              <InfoRow label="Abrechnung">{BILLING[project.billing].label}</InfoRow>
              {rights.canSeeMoney && project.hourlyRateCents ? <InfoRow label="Stundensatz">{fmtMoney(project.hourlyRateCents)}</InfoRow> : null}
              <InfoRow label="Leitung">{project.managerId ? byId.get(project.managerId)?.name ?? "–" : "–"}</InfoRow>
              <InfoRow label="Std. pro Arbeitstag">{project.hoursPerDay.toLocaleString("de-AT")}</InfoRow>
            </div>
            {project.description ? <p className="mt-3 whitespace-pre-line border-t border-(--border) pt-3 text-sm text-(--text-muted)">{project.description}</p> : null}
            {s.overdueTaskCount ? (
              <button onClick={() => ctx.goTab("aufgaben")} className="mt-3 w-full text-left">
                <Badge tone="danger">{s.overdueTaskCount} Aufgabe{s.overdueTaskCount === 1 ? "" : "n"} überfällig</Badge>
              </button>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
