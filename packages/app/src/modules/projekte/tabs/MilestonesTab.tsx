import { useMemo, useState } from "react";
import { Check, Diamond, Plus } from "lucide-react";
import { buildTaskTree, flattenTaskTree, isMilestoneOverdue, milestoneCode, milestoneProgress, milestoneTaskIds, overdueDays, taskRollups, todayIso, type Milestone, type Task, type TimeEntry } from "@ordo/core";
import { Badge, Button, EmptyState } from "@/components/ui";
import { cls, fmtDate, fmtMoney } from "@/lib/format";
import { TASK_STATUS } from "../labels";
import { ProgressLine } from "../parts";
import { useProjectRights } from "../hooks";
import { setMilestoneStatus } from "../actions";
import { MilestoneDialog } from "../MilestoneDialog";
import type { DetailContext } from "../ProjectDetail";
import { sortMilestones } from "../data";

export function MilestonesTab({ ctx, tasks, entries, milestones }: { ctx: DetailContext; tasks: Task[]; entries: TimeEntry[]; milestones: Milestone[] }) {
  const rights = useProjectRights();
  const [dialog, setDialog] = useState<{ milestone?: Milestone } | null>(null);
  const today = todayIso();
  const flat = useMemo(() => flattenTaskTree(buildTaskTree(tasks)), [tasks]);
  const numbers = useMemo(() => new Map(flat.map((n) => [n.task.id, n.number])), [flat]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const rollups = useMemo(() => taskRollups(tasks, entries), [tasks, entries]);
  const sorted = useMemo(() => sortMilestones(milestones), [milestones]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-(--text-muted)">{milestones.length ? `${milestones.filter((m) => m.status === "done").length} von ${milestones.length} erreicht` : ""}</p>
        {ctx.canEdit ? <Button size="sm" onClick={() => setDialog({})}><Plus className="h-4 w-4" /> Neuer Meilenstein</Button> : null}
      </div>
      {!sorted.length ? (
        <EmptyState
          icon={<Diamond className="h-8 w-8" />}
          title="Noch keine Meilensteine"
          body="Meilensteine sind wichtige Zwischenstände wie „Design freigegeben“ oder „Go-Live“. Ordne ihnen Aufgaben zu, dann siehst du, wie weit sie sind."
          action={ctx.canEdit ? <Button onClick={() => setDialog({})}><Plus className="h-4 w-4" /> Meilenstein anlegen</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((m, i) => {
            const linked = milestoneTaskIds(m, tasks).sort((a, b) => (numbers.get(a) ?? "").localeCompare(numbers.get(b) ?? "", "de", { numeric: true }));
            const code = milestoneCode(linked.map((id) => numbers.get(id) ?? "").filter(Boolean), i);
            const progress = milestoneProgress(m, tasks, rollups);
            const overdue = isMilestoneOverdue(m, today);
            const done = m.status === "done";
            return (
              <article key={m.id} className={cls("surface flex flex-col gap-3 p-4", done && "opacity-80")}>
                <div className="flex items-start gap-3">
                  <span className={cls("mt-0.5 flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg px-1.5 text-xs font-semibold tabular", done ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : overdue ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200" : "bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200")}>{code}</span>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setDialog({ milestone: m })}>
                    <div className="font-semibold leading-snug hover:text-brand-700 dark:hover:text-brand-400">{m.title}</div>
                    <div className={cls("text-xs", overdue ? "font-medium text-red-600 dark:text-red-400" : "text-(--text-muted)")}>
                      {m.dueDate ? (overdue ? `Überfällig seit ${overdueDays(m.dueDate, today)} Tagen · ${fmtDate(m.dueDate)}` : `${done ? "Fällig war" : "Fällig"} ${fmtDate(m.dueDate)}`) : "Ohne Datum"}
                    </div>
                  </button>
                  {done ? <Badge tone="success">Erreicht</Badge> : null}
                </div>
                <ProgressLine value={progress} tone={done ? "success" : overdue ? "danger" : "brand"} label={<><span>{linked.length ? `${linked.filter((id) => taskById.get(id)?.status === "done").length} von ${linked.length} Aufgaben erledigt` : "Keine Aufgaben zugeordnet"}</span><span className="tabular">{Math.round(progress * 100)} %</span></>} />
                {linked.length ? (
                  <ul className="space-y-1">
                    {linked.slice(0, 6).map((id) => {
                      const t = taskById.get(id);
                      if (!t) return null;
                      return (
                        <li key={id}>
                          <button onClick={() => ctx.openTask(t)} className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm hover:bg-(--surface-2)">
                            <span className={cls("h-1.5 w-1.5 shrink-0 rounded-full", TASK_STATUS[t.status].dot)} title={TASK_STATUS[t.status].label} />
                            <span className="shrink-0 text-xs tabular text-(--text-muted)">{numbers.get(id)}</span>
                            <span className={cls("truncate", t.status === "done" && "text-(--text-muted) line-through decoration-(--border)")}>{t.title}</span>
                          </button>
                        </li>
                      );
                    })}
                    {linked.length > 6 ? <li className="px-1 text-xs text-(--text-muted)">und {linked.length - 6} weitere</li> : null}
                  </ul>
                ) : null}
                {m.description ? <p className="line-clamp-3 text-sm text-(--text-muted)">{m.description}</p> : null}
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-(--border) pt-3">
                  {m.invoiceAmountCents && rights.canSeeMoney ? <span className="text-xs text-(--text-muted)">Teilrechnung {fmtMoney(m.invoiceAmountCents)}</span> : null}
                  {ctx.canEdit ? (
                    done ? (
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setMilestoneStatus(m, "open")}>Wieder öffnen</Button>
                    ) : (
                      <Button size="sm" variant={progress >= 1 ? "primary" : "outline"} className="ml-auto" onClick={() => setMilestoneStatus(m, "done")}><Check className="h-4 w-4" /> Erreicht</Button>
                    )
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <MilestoneDialog open={!!dialog} onClose={() => setDialog(null)} milestone={dialog?.milestone} projectId={ctx.project.id} readOnly={!ctx.canEdit} />
    </div>
  );
}
