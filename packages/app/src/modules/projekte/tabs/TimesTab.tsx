import { useMemo, useState } from "react";
import { Clock, Plus } from "lucide-react";
import { buildTaskTree, flattenTaskTree, taskDescendantIds, timeEntryValueCents, type Task, type TimeEntry } from "@ordo/core";
import { Button, EmptyState, Select } from "@/components/ui";
import { useMembers, useProjectRights, useProjectsById } from "../hooks";
import { PeriodPicker, TimeTable, TimeTotals, inRange, periodRange, type Period } from "../TimeTable";
import type { DetailContext } from "../ProjectDetail";

export function TimesTab({ ctx, tasks, entries }: { ctx: DetailContext; tasks: Task[]; entries: TimeEntry[] }) {
  const rights = useProjectRights();
  const { active, byId } = useMembers();
  const projects = useProjectsById();
  const [period, setPeriod] = useState<Period>("all");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [memberId, setMemberId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [billable, setBillable] = useState<"all" | "yes" | "no">("all");
  const flat = useMemo(() => flattenTaskTree(buildTaskTree(tasks)), [tasks]);
  const numbers = useMemo(() => new Map(flat.map((n) => [n.task.id, n.number])), [flat]);
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const filtered = useMemo(() => {
    const r = periodRange(period, custom);
    const scope = taskId === "none" ? null : taskId ? new Set([taskId, ...taskDescendantIds(tasks, taskId)]) : undefined;
    return entries.filter((e) => {
      if (!inRange(e.date, r)) return false;
      if (memberId && (e.memberId ?? "") !== (memberId === "none" ? "" : memberId)) return false;
      if (scope === null && e.taskId) return false;
      if (scope && (!e.taskId || !scope.has(e.taskId))) return false;
      if (billable === "yes" && !e.billable) return false;
      if (billable === "no" && e.billable) return false;
      return true;
    });
  }, [entries, period, custom, memberId, taskId, billable, tasks]);
  const value = useMemo(() => (rights.canSeeMoney ? filtered.filter((e) => e.billable).reduce((s, e) => s + timeEntryValueCents(e, ctx.project, byId), 0) : undefined), [filtered, rights.canSeeMoney, ctx.project, byId]);
  const canBook = !ctx.locked && (rights.canWriteTime || rights.canOwnTime);

  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center gap-2 p-3">
        <PeriodPicker value={period} onChange={setPeriod} custom={custom} onCustom={setCustom} />
        {byId.size ? (
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="w-40" aria-label="Person">
            <option value="">Alle Personen</option>
            {active.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            <option value="none">Ohne Person</option>
          </Select>
        ) : null}
        <Select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="w-52" aria-label="Aufgabe">
          <option value="">Alle Aufgaben</option>
          <option value="none">Ohne Aufgabe</option>
          {flat.map((n) => <option key={n.task.id} value={n.task.id}>{"  ".repeat(n.depth)}{n.number} {n.task.title}</option>)}
        </Select>
        <Select value={billable} onChange={(e) => setBillable(e.target.value as typeof billable)} className="w-40" aria-label="Verrechenbar">
          <option value="all">Alle</option>
          <option value="yes">Verrechenbar</option>
          <option value="no">Nicht verrechenbar</option>
        </Select>
        {canBook ? <Button className="ml-auto" onClick={() => ctx.bookTime(taskId && taskId !== "none" ? { taskId } : undefined)}><Plus className="h-4 w-4" /> Zeit erfassen</Button> : null}
      </div>
      {entries.length ? <TimeTotals entries={filtered} valueCents={value} /> : null}
      {!entries.length ? (
        <EmptyState icon={<Clock className="h-8 w-8" />} title="Noch keine Zeiten" body="Erfasse Zeiten hier, in der Aufgabenliste oder mit der Stoppuhr unter Zeiterfassung." action={canBook ? <Button onClick={() => ctx.bookTime()}><Plus className="h-4 w-4" /> Zeit erfassen</Button> : undefined} />
      ) : !filtered.length ? (
        <EmptyState title="Keine Einträge" body="Für diese Filter gibt es keine Zeiten." />
      ) : (
        <TimeTable entries={filtered} projects={projects} tasks={taskMap} numbers={numbers} members={byId} onEdit={ctx.editEntry} canEdit={rights.canEditEntry} showValue={rights.canSeeMoney} />
      )}
      {rights.canWriteTime && !ctx.locked && entries.length ? <p className="text-xs text-(--text-muted)">Tipp: Im Dialog „Zeit erfassen“ kannst du nach Wahl einer Aufgabe mit „Summe anpassen“ die Gesamtzeit korrigieren – es wird ein Korrektureintrag gebucht.</p> : null}
    </div>
  );
}
