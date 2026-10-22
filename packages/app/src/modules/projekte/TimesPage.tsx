import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Clock, Download, Plus } from "lucide-react";
import { buildTaskTree, flattenTaskTree, timeEntryValueCents, toCsv, todayIso, type TimeEntry } from "@ordo/core";
import { Button, EmptyState, PageHeader, Select, Tabs } from "@/components/ui";
import { useList } from "@/state/hooks";
import { requirePlatform } from "@/state/session";
import { toast } from "@/state/toasts";
import { useMembers, useNewParam, useProjectRights, useProjectsById, useTimeFilter } from "./hooks";
import { Stopwatch } from "./Stopwatch";
import { WeekGrid } from "./WeekGrid";
import { PERIOD_LABELS, PeriodPicker, TimeTable, TimeTotals, inRange, periodRange, type Period } from "./TimeTable";
import { TimeEntryDialog } from "./TimeEntryDialog";

type View = "week" | "list";
const VIEW_KEY = "ordo.projekte.timesView";

export default function TimesPage() {
  const rights = useProjectRights();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<{ entry?: TimeEntry } | null>(null);
  const [view, setViewState] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "week";
    } catch {
      return "week";
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  };
  useNewParam(params, setParams, () => setDialog({}));
  const canBook = rights.canWriteTime || rights.canOwnTime;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Zeiterfassung"
        subtitle="Stoppuhr starten, Woche ausfüllen oder Zeiten nachtragen – alles landet im Projekt."
        actions={canBook ? <Button variant="outline" onClick={() => setDialog({})}><Plus className="h-4 w-4" /> Zeit nachtragen</Button> : undefined}
      />
      <Stopwatch />
      <Tabs value={view} onChange={setView} tabs={[{ id: "week", label: "Woche" }, { id: "list", label: "Liste" }]} className="w-fit" />
      {view === "week" ? <WeekGrid /> : <TimeList onEdit={(e) => setDialog({ entry: e })} onAdd={() => setDialog({})} />}
      <TimeEntryDialog open={!!dialog} onClose={() => setDialog(null)} entry={dialog?.entry} chooseProject />
    </div>
  );
}

function TimeList({ onEdit, onAdd }: { onEdit: (e: TimeEntry) => void; onAdd: () => void }) {
  const visible = useTimeFilter();
  const all = useList("timeEntries");
  const entries = useMemo(() => visible(all), [all, visible]);
  const tasks = useList("tasks");
  const projects = useProjectsById();
  const rights = useProjectRights();
  const { active, byId } = useMembers();
  const [period, setPeriod] = useState<Period>("week");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [projectId, setProjectId] = useState("");
  // people with "own" rights see their own time by default
  const [memberId, setMemberId] = useState(rights.canWriteTime ? "" : rights.member?.id ?? "");
  const [billable, setBillable] = useState<"all" | "yes" | "no">("all");
  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const numbers = useMemo(() => {
    const m = new Map<string, string>();
    const byProject = new Map<string, typeof tasks>();
    for (const t of tasks) (byProject.get(t.projectId) ?? byProject.set(t.projectId, []).get(t.projectId)!).push(t);
    for (const list of byProject.values()) for (const n of flattenTaskTree(buildTaskTree(list))) m.set(n.task.id, n.number);
    return m;
  }, [tasks]);

  const range = periodRange(period, custom);
  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (!inRange(e.date, range)) return false;
        if (projectId && e.projectId !== projectId) return false;
        if (memberId && (e.memberId ?? "") !== (memberId === "none" ? "" : memberId)) return false;
        if (billable === "yes" && !e.billable) return false;
        if (billable === "no" && e.billable) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, range.from, range.to, projectId, memberId, billable],
  );
  const value = useMemo(() => (rights.canSeeMoney ? filtered.filter((e) => e.billable).reduce((s, e) => s + timeEntryValueCents(e, projects.get(e.projectId), byId), 0) : undefined), [filtered, rights.canSeeMoney, projects, byId]);
  const projectOptions = useMemo(() => [...projects.values()].sort((a, b) => a.name.localeCompare(b.name, "de")), [projects]);

  const exportCsv = async () => {
    const rows = [...filtered]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => {
        const p = projects.get(e.projectId);
        const t = e.taskId ? taskMap.get(e.taskId) : undefined;
        const rate = e.rateCents ?? (p?.hourlyRateCents || (e.memberId ? byId.get(e.memberId)?.hourlyRateCents ?? 0 : 0));
        const base: (string | number)[] = [e.date.split("-").reverse().join("."), e.memberId ? byId.get(e.memberId)?.name ?? "" : "", p?.number ?? "", p?.name ?? "", t ? numbers.get(t.id) ?? "" : "", t?.title ?? "", e.description, e.minutes / 60, `${Math.floor(Math.abs(e.minutes) / 60)}:${String(Math.abs(e.minutes) % 60).padStart(2, "0")}`, e.billable ? "Ja" : "Nein"];
        return rights.canSeeMoney ? [...base, rate / 100, e.billable ? timeEntryValueCents(e, p, byId) / 100 : 0] : base;
      });
    const headers = ["Datum", "Person", "Projekt-Nr.", "Projekt", "Nr.", "Aufgabe", "Beschreibung", "Stunden", "Dauer", "Verrechenbar", ...(rights.canSeeMoney ? ["Stundensatz", "Wert"] : [])];
    const label = period === "custom" ? `${range.from ?? "Anfang"}_${range.to ?? "heute"}` : PERIOD_LABELS[period].replace(/\s+/g, "-");
    try {
      const ok = await requirePlatform().saveFile(`Zeiten_${label}_${todayIso()}.csv`, toCsv(headers, rows), "text/csv");
      if (ok) toast.success("CSV gespeichert", `${rows.length} Einträge`);
    } catch (e) {
      toast.error("Export fehlgeschlagen", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center gap-2 p-3">
        <PeriodPicker value={period} onChange={setPeriod} custom={custom} onCustom={setCustom} />
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-52" aria-label="Projekt">
          <option value="">Alle Projekte</option>
          {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        {byId.size && rights.canWriteTime ? (
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="w-40" aria-label="Person">
            <option value="">Alle Personen</option>
            {active.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            <option value="none">Ohne Person</option>
          </Select>
        ) : null}
        <Select value={billable} onChange={(e) => setBillable(e.target.value as typeof billable)} className="w-40" aria-label="Verrechenbar">
          <option value="all">Alle</option>
          <option value="yes">Verrechenbar</option>
          <option value="no">Nicht verrechenbar</option>
        </Select>
        <Button variant="ghost" className="ml-auto" disabled={!filtered.length} onClick={() => void exportCsv()}><Download className="h-4 w-4" /> CSV</Button>
      </div>
      {filtered.length ? <TimeTotals entries={filtered} valueCents={value} /> : null}
      {!entries.length ? (
        <EmptyState icon={<Clock className="h-8 w-8" />} title="Noch keine Zeiten" body="Starte oben die Stoppuhr oder trag Zeiten nach – sie landen direkt im Projekt." action={<Button onClick={onAdd}><Plus className="h-4 w-4" /> Zeit nachtragen</Button>} />
      ) : !filtered.length ? (
        <EmptyState title="Keine Einträge" body={`${PERIOD_LABELS[period]}: nichts gefunden. Wähl einen anderen Zeitraum.`} />
      ) : (
        <TimeTable entries={filtered} showProject projects={projects} tasks={taskMap} numbers={numbers} members={byId} onEdit={onEdit} canEdit={rights.canEditEntry} showValue={rights.canSeeMoney} />
      )}
    </div>
  );
}
