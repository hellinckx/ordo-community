import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, FileSpreadsheet, Lock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { nowIso, type Project, type Task, type TimeEntry } from "@ordo/core";
import { Button, ConfirmDialog, EmptyState, Menu, Select } from "@/components/ui";
import { useContactMap, useList } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { toast } from "@/state/toasts";
import { fmtDate } from "@/lib/format";
import { ProjectOffersTab, ProjectInvoicesTab } from "./offers/ProjectTabs";
import { PROJECT_STATUS, PROJECT_STATUS_ORDER } from "./labels";
import { TabBar } from "./parts";
import { useMembers, useProjectRights } from "./hooks";
import { useProjectData } from "./data";
import { ProjectDialog } from "./ProjectDialog";
import { TaskDialog } from "./TaskDialog";
import { TimeEntryDialog } from "./TimeEntryDialog";
import { OverviewTab } from "./tabs/OverviewTab";
import { TasksTab } from "./tabs/TasksTab";
import { GanttTab } from "./tabs/GanttTab";
import { MilestonesTab } from "./tabs/MilestonesTab";
import { TimesTab } from "./tabs/TimesTab";
import { FilesTab } from "./tabs/FilesTab";
import { exportProjectXlsx } from "./excel";

export type DetailTab = "uebersicht" | "aufgaben" | "zeitplan" | "meilensteine" | "zeiten" | "angebote" | "rechnungen" | "dateien";

const TABS: { id: DetailTab; label: string }[] = [
  { id: "uebersicht", label: "Übersicht" },
  { id: "aufgaben", label: "Aufgaben" },
  { id: "zeitplan", label: "Zeitplan" },
  { id: "meilensteine", label: "Meilensteine" },
  { id: "zeiten", label: "Zeiten" },
  { id: "angebote", label: "Angebote" },
  { id: "rechnungen", label: "Rechnungen" },
  { id: "dateien", label: "Dateien" },
];

/** What every tab may use: open dialogs, rights, read-only state. */
export interface DetailContext {
  project: Project;
  /** Project is completed – nothing can be changed. */
  locked: boolean;
  /** May edit tasks/milestones in this project right now. */
  canEdit: boolean;
  openTask: (t: Task) => void;
  newTask: (preset?: { parentId?: string; milestoneId?: string }) => void;
  bookTime: (preset?: { taskId?: string; date?: string }) => void;
  editEntry: (e: TimeEntry) => void;
  goTab: (t: DetailTab) => void;
}

export default function ProjectDetail() {
  const { id, tab } = useParams();
  const navigate = useNavigate();
  const { project, tasks, entries, milestones } = useProjectData(id);
  const invoices = useList("invoices");
  const contacts = useContactMap();
  const { byId } = useMembers();
  const rights = useProjectRights();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [taskDialog, setTaskDialog] = useState<{ task?: Task; parentId?: string; milestoneId?: string } | null>(null);
  const [timeDialog, setTimeDialog] = useState<{ entry?: TimeEntry; taskId?: string; date?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const current: DetailTab = TABS.some((t) => t.id === tab) ? (tab as DetailTab) : "uebersicht";
  const projectInvoices = useMemo(() => invoices.filter((i) => i.projectId === id), [invoices, id]);

  if (!project) {
    return (
      <EmptyState
        title="Projekt nicht gefunden"
        body="Vielleicht wurde es gelöscht oder gehört zu einem anderen Profil."
        action={<Button variant="outline" onClick={() => navigate("/projekte")}><ArrowLeft className="h-4 w-4" /> Zu den Projekten</Button>}
      />
    );
  }

  const locked = project.status === "completed";
  const ctx: DetailContext = {
    project,
    locked,
    canEdit: rights.canWrite && !locked,
    openTask: (t) => setTaskDialog({ task: t }),
    newTask: (preset) => setTaskDialog({ ...preset }),
    bookTime: (preset) => setTimeDialog({ ...preset }),
    editEntry: (e) => setTimeDialog({ entry: e }),
    goTab: (t) => navigate(`/projekte/${project.id}/${t}`),
  };

  const setStatus = (status: Project["status"]) => {
    requireStore().update("projects", project.id, { status, completedAt: status === "completed" ? project.completedAt ?? nowIso() : undefined }, "project.status");
    toast.success(`Projekt ist jetzt „${PROJECT_STATUS[status].label}“`, status === "completed" ? "Aufgaben, Zeiten und Meilensteine sind jetzt schreibgeschützt." : undefined);
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const saved = await exportProjectXlsx(project.id);
      if (saved) toast.success("Excel-Datei gespeichert");
    } catch (e) {
      toast.error("Export fehlgeschlagen", e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const remove = () => {
    const now = nowIso();
    requireStore().mutate((v) => {
      v.projects = v.projects.map((p) => (p.id === project.id ? { ...p, deletedAt: now, updatedAt: now } : p));
      v.tasks = v.tasks.map((t) => (t.projectId === project.id && !t.deletedAt ? { ...t, deletedAt: now, updatedAt: now } : t));
      v.milestones = v.milestones.map((m) => (m.projectId === project.id && !m.deletedAt ? { ...m, deletedAt: now, updatedAt: now } : m));
      v.timeEntries = v.timeEntries.map((e) => (e.projectId === project.id && !e.deletedAt ? { ...e, deletedAt: now, updatedAt: now } : e));
      v.settings = { ...v.settings, timers: v.settings.timers.filter((t) => t.projectId !== project.id) };
    }, { audit: { action: "project.delete", entity: "projects", entityId: project.id } });
    toast.success("Projekt gelöscht");
    navigate("/projekte");
  };

  const customer = project.customerId ? contacts.get(project.customerId) : undefined;
  const manager = project.managerId ? byId.get(project.managerId) : undefined;
  const canDelete = rights.canAdmin && projectInvoices.length === 0;

  return (
    <div className="space-y-5">
      <div>
        <Link to="/projekte" className="mb-2 inline-flex items-center gap-1 text-sm text-(--text-muted) hover:text-(--text)">
          <ArrowLeft className="h-4 w-4" /> Projekte
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm tabular text-(--text-muted)">{project.number}</div>
            <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] sm:text-[28px]">{project.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-(--text-muted)">
              {customer ? <Link to={`/kontakte/${customer.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">{customer.name}</Link> : <span>Ohne Kunde</span>}
              {project.startDate || project.endDate ? <span>· {fmtDate(project.startDate)} – {fmtDate(project.endDate)}</span> : null}
              {manager ? <span>· Leitung {manager.name}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rights.canWrite ? (
              <Select value={project.status} onChange={(e) => setStatus(e.target.value as Project["status"])} className="w-40" aria-label="Status">
                {PROJECT_STATUS_ORDER.map((s) => <option key={s} value={s}>{PROJECT_STATUS[s].label}</option>)}
              </Select>
            ) : null}
            {rights.canWrite ? <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Bearbeiten</Button> : null}
            <Button variant="outline" loading={exporting} onClick={() => void runExport()}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
            {rights.canAdmin ? (
              <Menu
                trigger={<Button variant="ghost" size="icon" aria-label="Mehr"><MoreHorizontal className="h-4 w-4" /></Button>}
                items={[
                  {
                    label: canDelete ? "Projekt löschen" : "Löschen geht nicht – es gibt Rechnungen",
                    icon: <Trash2 className="h-4 w-4" />,
                    danger: canDelete,
                    disabled: !canDelete,
                    onClick: () => setConfirmDelete(true),
                  },
                ]}
              />
            ) : null}
          </div>
        </div>
      </div>

      {locked ? (
        <div className="surface flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <Lock className="h-4 w-4 text-(--text-muted)" />
          <span className="flex-1">Abgeschlossen{project.completedAt ? ` am ${fmtDate(project.completedAt.slice(0, 10))}` : ""} – Aufgaben, Zeiten und Meilensteine sind schreibgeschützt.</span>
          {rights.canWrite ? <Button size="sm" variant="outline" onClick={() => setStatus("active")}>Wieder öffnen</Button> : null}
        </div>
      ) : null}

      <TabBar
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, badge: t.id === "aufgaben" && tasks.length ? <span className="tabular text-[11px] text-(--text-muted)">{tasks.filter((x) => x.status !== "done").length}</span> : undefined }))}
        value={current}
        onChange={(t) => navigate(`/projekte/${project.id}/${t}`, { replace: true })}
      />

      {current === "uebersicht" ? <OverviewTab ctx={ctx} tasks={tasks} entries={entries} milestones={milestones} /> : null}
      {current === "aufgaben" ? <TasksTab ctx={ctx} tasks={tasks} entries={entries} milestones={milestones} /> : null}
      {current === "zeitplan" ? <GanttTab ctx={ctx} tasks={tasks} entries={entries} milestones={milestones} /> : null}
      {current === "meilensteine" ? <MilestonesTab ctx={ctx} tasks={tasks} entries={entries} milestones={milestones} /> : null}
      {current === "zeiten" ? <TimesTab ctx={ctx} tasks={tasks} entries={entries} /> : null}
      {current === "angebote" ? <ProjectOffersTab projectId={project.id} /> : null}
      {current === "rechnungen" ? <ProjectInvoicesTab projectId={project.id} /> : null}
      {current === "dateien" ? <FilesTab ctx={ctx} /> : null}

      <ProjectDialog open={editing} onClose={() => setEditing(false)} project={project} />
      <TaskDialog
        open={!!taskDialog}
        onClose={() => setTaskDialog(null)}
        task={taskDialog?.task}
        projectId={project.id}
        parentId={taskDialog?.parentId}
        milestoneId={taskDialog?.milestoneId}
        readOnly={locked}
        onBookTime={(t) => setTimeDialog({ taskId: t.id })}
      />
      <TimeEntryDialog open={!!timeDialog} onClose={() => setTimeDialog(null)} entry={timeDialog?.entry} projectId={project.id} taskId={timeDialog?.taskId} date={timeDialog?.date} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title="Projekt löschen?"
        body={`„${project.name}“ wird mit ${tasks.length} Aufgaben, ${milestones.length} Meilensteinen und ${entries.length} Zeiteinträgen gelöscht. Dateien bleiben in der Ablage.`}
        confirmLabel="Löschen"
        onConfirm={remove}
      />
    </div>
  );
}
