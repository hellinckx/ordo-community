import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AlertTriangle, CalendarDays, Diamond, FolderKanban, LayoutGrid, List, Plus, Search } from "lucide-react";
import { todayIso, type Project, type ProjectStats } from "@ordo/core";
import { Badge, Button, EmptyState, Input, PageHeader, Select, Stat, Tabs } from "@/components/ui";
import { useContactMap, useList } from "@/state/hooks";
import { cls, fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import { PROJECT_STATUS, PROJECT_STATUS_ORDER, fmtH, fmtHours } from "./labels";
import { ProgressLine, ProjectStatusBadge } from "./parts";
import { useNewParam, useProjectRights } from "./hooks";
import { useAllProjectStats } from "./data";
import { ProjectDialog } from "./ProjectDialog";

type Filter = "open" | "all" | Project["status"];
type View = "cards" | "list";

const VIEW_KEY = "ordo.projekte.view";

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}

export default function ProjectsPage() {
  const projects = useList("projects");
  const entries = useList("timeEntries");
  const contacts = useContactMap();
  const stats = useAllProjectStats();
  const rights = useProjectRights();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [view, setViewState] = useState<View>(readView);
  useNewParam(params, setParams, () => rights.canWrite && setCreating(true));
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  };

  const month = todayIso().slice(0, 7);
  const kpi = useMemo(() => {
    const count = (s: Project["status"]) => projects.filter((p) => p.status === s).length;
    return { active: count("active"), planning: count("planning"), completed: count("completed"), monthMinutes: entries.filter((e) => e.date.startsWith(month)).reduce((s, e) => s + e.minutes, 0) };
  }, [projects, entries, month]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rank: Record<Project["status"], number> = { active: 0, on_hold: 1, planning: 2, completed: 3, cancelled: 4 };
    return projects
      .filter((p) => (filter === "all" ? true : filter === "open" ? p.status !== "completed" && p.status !== "cancelled" : p.status === filter))
      .filter((p) => !s || [p.name, p.number, p.description, contacts.get(p.customerId ?? "")?.name ?? ""].join(" ").toLowerCase().includes(s))
      .sort((a, b) => rank[a.status] - rank[b.status] || (a.endDate ?? "9999").localeCompare(b.endDate ?? "9999") || a.name.localeCompare(b.name, "de"));
  }, [projects, filter, q, contacts]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projekte"
        subtitle="Alle Projekte mit Aufgaben, Zeiten und Budget auf einen Blick."
        actions={rights.canWrite ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Neues Projekt</Button> : undefined}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Aktiv" value={kpi.active} />
        <Stat label="In Planung" value={kpi.planning} />
        <Stat label="Abgeschlossen" value={kpi.completed} />
        <Stat label="Stunden diesen Monat" value={fmtH(kpi.monthMinutes, { unit: false })} sub={new Date().toLocaleDateString("de-AT", { month: "long", year: "numeric" })} />
      </div>

      {projects.length ? (
        <div className="surface flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen (Name, Nummer, Kunde) …" className="pl-9" />
          </div>
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="w-40" aria-label="Status">
            <option value="open">Laufende</option>
            {PROJECT_STATUS_ORDER.map((s) => <option key={s} value={s}>{PROJECT_STATUS[s].label}</option>)}
            <option value="all">Alle</option>
          </Select>
          <Tabs value={view} onChange={setView} tabs={[{ id: "cards", label: <LayoutGrid className="h-4 w-4" aria-label="Karten" /> }, { id: "list", label: <List className="h-4 w-4" aria-label="Liste" /> }]} />
        </div>
      ) : null}

      {!projects.length ? (
        <EmptyState
          icon={<FolderKanban className="h-8 w-8" />}
          title="Noch keine Projekte"
          body="Leg dein erstes Projekt an – mit Kunde, Zeitraum und Budget. Danach planst du Arbeitspakete und Aufgaben und erfasst Zeiten."
          action={rights.canWrite ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Neues Projekt</Button> : undefined}
        />
      ) : !filtered.length ? (
        <EmptyState title="Nichts gefunden" body="Passe Suche oder Filter an." action={<Button variant="outline" onClick={() => { setQ(""); setFilter("all"); }}>Alle zeigen</Button>} />
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => <ProjectCard key={p.id} project={p} stats={stats.get(p.id)} customer={contacts.get(p.customerId ?? "")?.name} showMoney={rights.canSeeMoney} />)}
        </div>
      ) : (
        <ProjectTable projects={filtered} stats={stats} customerName={(id) => contacts.get(id ?? "")?.name} showMoney={rights.canSeeMoney} onOpen={(id) => navigate(`/projekte/${id}`)} />
      )}

      <ProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ProjectCard({ project: p, stats: s, customer, showMoney }: { project: Project; stats?: ProjectStats; customer?: string; showMoney: boolean }) {
  const today = todayIso();
  const hoursRatio = p.budgetHours > 0 && s ? s.trackedMinutes / 60 / p.budgetHours : 0;
  return (
    <Link to={`/projekte/${p.id}`} className="surface group flex flex-col gap-3 p-4 transition-shadow hover:shadow-pop focus-visible:focus-ring">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs tabular text-(--text-muted)">{p.number || "Projekt"}</div>
          <div className="truncate text-[15px] font-semibold tracking-tight group-hover:text-brand-700 dark:group-hover:text-brand-400">{p.name}</div>
          <div className="truncate text-sm text-(--text-muted)">{customer ?? "Ohne Kunde"}</div>
        </div>
        <ProjectStatusBadge status={p.status} />
      </div>
      {s ? (
        <div className="space-y-2.5">
          <ProgressLine value={s.progress} label={<><span>Aufgaben</span><span className="tabular">{s.taskCount ? `${s.doneTaskCount} von ${s.taskCount} erledigt` : "noch keine"}</span></>} tone={p.status === "completed" ? "success" : "brand"} />
          <ProgressLine value={hoursRatio} tone={hoursRatio > 1 ? "danger" : "brand"} label={<><span>Stunden</span><span className="tabular">{fmtH(s.trackedMinutes, { unit: false })}{p.budgetHours ? ` von ${fmtHours(p.budgetHours)}` : " h"}</span></>} />
          {showMoney && p.budgetCents > 0 ? <ProgressLine value={s.budgetUsedPct} tone={s.budgetUsedPct > 1 ? "danger" : "brand"} label={<><span>Fakturiert</span><span className="tabular">{fmtMoney(s.invoicedNetCents)} von {fmtMoney(p.budgetCents)}</span></>} /> : null}
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-(--border) pt-2.5 text-xs text-(--text-muted)">
        {s?.nextMilestone ? (
          <span className={cls("inline-flex min-w-0 items-center gap-1", s.nextMilestone.dueDate && s.nextMilestone.dueDate < today && "text-red-600 dark:text-red-400")}>
            <Diamond className="h-3 w-3 shrink-0" />
            <span className="truncate">{s.nextMilestone.title}</span>
            {s.nextMilestone.dueDate ? <span className="tabular">· {fmtDate(s.nextMilestone.dueDate)}</span> : null}
          </span>
        ) : p.endDate ? (
          <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> bis {fmtDate(p.endDate)}</span>
        ) : (
          <span>Kein Enddatum</span>
        )}
        {s && s.overdueTaskCount ? <Badge tone="danger" className="ml-auto"><AlertTriangle className="mr-1 h-3 w-3" />{s.overdueTaskCount} überfällig</Badge> : null}
      </div>
    </Link>
  );
}

function ProjectTable({ projects, stats, customerName, showMoney, onOpen }: { projects: Project[]; stats: Map<string, ProjectStats>; customerName: (id?: string) => string | undefined; showMoney: boolean; onOpen: (id: string) => void }) {
  return (
    <div className="surface overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
          <tr>
            <th className="px-3 py-2">Nr.</th>
            <th className="px-3 py-2">Projekt</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Fortschritt</th>
            <th className="px-3 py-2 text-right">Stunden</th>
            {showMoney ? <th className="px-3 py-2 text-right">Fakturiert / Budget</th> : null}
            <th className="px-3 py-2">Ende</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-(--border)">
          {projects.map((p) => {
            const s = stats.get(p.id);
            return (
              <tr key={p.id} tabIndex={0} onClick={() => onOpen(p.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(p.id)} className="cursor-pointer hover:bg-(--surface-2) focus-visible:bg-(--surface-2) focus-visible:outline-none">
                <td className="whitespace-nowrap px-3 py-2.5 tabular text-(--text-muted)">{p.number}</td>
                <td className="max-w-0 px-3 py-2.5">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="truncate text-xs text-(--text-muted)">{customerName(p.customerId) ?? "Ohne Kunde"}</div>
                </td>
                <td className="px-3 py-2.5"><ProjectStatusBadge status={p.status} /></td>
                <td className="w-40 px-3 py-2.5">
                  {s ? <ProgressLine value={s.progress} label={<span className="tabular">{fmtPct(s.progress)}{s.overdueTaskCount ? <span className="ml-1 text-red-600">· {s.overdueTaskCount} überfällig</span> : null}</span>} /> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">{s ? fmtH(s.trackedMinutes, { unit: false }) : "0"}{p.budgetHours ? <span className="text-(--text-muted)"> / {fmtHours(p.budgetHours)}</span> : " h"}</td>
                {showMoney ? <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">{s ? fmtMoney(s.invoicedNetCents) : "–"}<span className="text-(--text-muted)"> / {p.budgetCents ? fmtMoney(p.budgetCents) : "–"}</span></td> : null}
                <td className={cls("whitespace-nowrap px-3 py-2.5 tabular", p.endDate && p.endDate < todayIso() && p.status !== "completed" && p.status !== "cancelled" && "text-red-600")}>{fmtDate(p.endDate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
