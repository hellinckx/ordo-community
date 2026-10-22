import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Clock, Trash2 } from "lucide-react";
import { buildTaskTree, cleanTaskTitle, flattenTaskTree, taskDescendantIds, taskRollups, type Priority, type Task, type TaskStatus } from "@ordo/core";
import { Button, ConfirmDialog, DateInput, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useList, useProfile, useVault } from "@/state/hooks";
import { toast } from "@/state/toasts";
import { PRIORITY, PRIORITY_ORDER, TASK_STATUS, TASK_STATUS_ORDER, fmtH } from "./labels";
import { MemberChips } from "./parts";
import { useMembers, useProjectRights } from "./hooks";
import { bookedMinutesInTree, createTask, deleteTaskTree, updateTask } from "./actions";

interface Draft {
  projectId: string;
  title: string;
  parentId?: string;
  milestoneId?: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  estimate: string;
  startDate?: string;
  dueDate?: string;
  assigneeIds: string[];
}

const toDraft = (t: Task | undefined, preset: { projectId?: string; parentId?: string; milestoneId?: string; assigneeIds?: string[] }): Draft => ({
  projectId: t?.projectId ?? preset.projectId ?? "",
  title: t?.title ?? "",
  parentId: t ? t.parentId : preset.parentId,
  milestoneId: t ? t.milestoneId : preset.milestoneId,
  description: t?.description ?? "",
  priority: t?.priority ?? "medium",
  status: t?.status ?? "todo",
  estimate: t?.estimateHours ? String(t.estimateHours).replace(".", ",") : "",
  startDate: t?.startDate,
  dueDate: t?.dueDate,
  assigneeIds: t?.assigneeIds ?? preset.assigneeIds ?? [],
});

/**
 * Create or edit a task. With `chooseProject` a project select is shown (Meine Aufgaben).
 * People who may only change their own tasks can change the status, nothing else.
 */
export function TaskDialog({ open, onClose, task, projectId, parentId, milestoneId, chooseProject, readOnly, onBookTime }: { open: boolean; onClose: () => void; task?: Task; projectId?: string; parentId?: string; milestoneId?: string; chooseProject?: boolean; readOnly?: boolean; onBookTime?: (t: Task) => void }) {
  const profile = useProfile();
  const vault = useVault();
  const projects = useList("projects");
  const allTasks = useList("tasks");
  const allMilestones = useList("milestones");
  const entries = useList("timeEntries");
  const { active: members } = useMembers();
  const rights = useProjectRights();
  const [d, setD] = useState<Draft>(() => toDraft(task, { projectId, parentId, milestoneId }));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!open) return;
    const firstOpen = projects.find((p) => p.status === "active") ?? projects.find((p) => p.status !== "completed" && p.status !== "cancelled");
    setD(toDraft(task, { projectId: projectId ?? (chooseProject ? firstOpen?.id : undefined), parentId, milestoneId, assigneeIds: !task && rights.member ? [rights.member.id] : undefined }));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const project = projects.find((p) => p.id === d.projectId);
  const projectLocked = project?.status === "completed";
  const fullEdit = !readOnly && !projectLocked && rights.canWrite;
  const statusEdit = !readOnly && !projectLocked && (task ? rights.canEditTask(task) : rights.canWrite);

  const pTasks = useMemo(() => allTasks.filter((t) => t.projectId === d.projectId), [allTasks, d.projectId]);
  const parentOptions = useMemo(() => {
    const blocked = task ? new Set([task.id, ...taskDescendantIds(pTasks, task.id)]) : new Set<string>();
    return flattenTaskTree(buildTaskTree(pTasks)).filter((n) => !blocked.has(n.task.id));
  }, [pTasks, task]);
  const milestones = useMemo(() => allMilestones.filter((m) => m.projectId === d.projectId).sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9")), [allMilestones, d.projectId]);
  const rollup = useMemo(() => (task ? taskRollups(pTasks, entries.filter((e) => e.projectId === task.projectId)).get(task.id) : undefined), [task, pTasks, entries]);
  const isPackage = !!task && pTasks.some((t) => t.parentId === task.id);
  const canDelete = !!task && fullEdit && bookedMinutesInTree(vault, task.id) === 0;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!statusEdit) return onClose();
    if (task && !fullEdit) {
      updateTask(task, { status: d.status });
      toast.success("Status gespeichert");
      return onClose();
    }
    if (!d.projectId) return setError("Wähle ein Projekt.");
    const title = cleanTaskTitle(d.title);
    if (!title) return setError("Gib der Aufgabe einen Titel.");
    if (d.startDate && d.dueDate && d.dueDate < d.startDate) return setError("Fällig liegt vor dem Start.");
    const estimateHours = Math.max(0, Number(d.estimate.replace(",", ".")) || 0);
    const fields = { title, parentId: d.parentId, milestoneId: d.milestoneId, description: d.description.trim(), priority: d.priority, status: d.status, estimateHours, startDate: d.startDate, dueDate: d.dueDate, assigneeIds: d.assigneeIds };
    if (task) {
      updateTask(task, fields);
      toast.success("Aufgabe gespeichert");
    } else {
      createTask(profile.id, d.projectId, fields);
      toast.success("Aufgabe angelegt");
    }
    onClose();
  };

  return (
    <>
      <Modal
        open={open && !confirmDelete}
        onClose={onClose}
        title={task ? (isPackage ? "Arbeitspaket" : "Aufgabe") : "Neue Aufgabe"}
        size="lg"
        footer={
          <>
            {canDelete ? (
              <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Löschen
              </Button>
            ) : task && fullEdit ? (
              <span className="mr-auto text-xs text-(--text-muted)">Löschen geht erst, wenn keine Zeit mehr darauf gebucht ist.</span>
            ) : null}
            {task && onBookTime && project && !projectLocked && (rights.canWriteTime || rights.canOwnTime) ? (
              <Button variant="outline" onClick={() => { onClose(); onBookTime(task); }}>
                <Clock className="h-4 w-4" /> Zeit erfassen
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>{statusEdit ? "Abbrechen" : "Schließen"}</Button>
            {statusEdit ? <Button onClick={() => submit()}>{task ? "Speichern" : "Anlegen"}</Button> : null}
          </>
        }
      >
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {chooseProject && !task ? (
            <Field label="Projekt" required className="sm:col-span-2">
              <Select value={d.projectId} onChange={(e) => setD((x) => ({ ...x, projectId: e.target.value, parentId: undefined, milestoneId: undefined }))}>
                <option value="">Projekt wählen …</option>
                {projects.filter((p) => p.status !== "completed" && p.status !== "cancelled").sort((a, b) => a.name.localeCompare(b.name, "de")).map((p) => <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label="Titel" required className="sm:col-span-2">
            <Input autoFocus={fullEdit} disabled={!fullEdit} value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="Was ist zu tun?" />
          </Field>
          <Field label="Gehört zu" hint="Eine Aufgabe mit Unteraufgaben ist ein Arbeitspaket.">
            <Select disabled={!fullEdit || !d.projectId} value={d.parentId ?? ""} onChange={(e) => set("parentId", e.target.value || undefined)}>
              <option value="">Hauptebene</option>
              {parentOptions.map((n) => <option key={n.task.id} value={n.task.id}>{"  ".repeat(n.depth)}{n.number} {n.task.title}</option>)}
            </Select>
          </Field>
          <Field label="Meilenstein">
            <Select disabled={!fullEdit || !milestones.length} value={d.milestoneId ?? ""} onChange={(e) => set("milestoneId", e.target.value || undefined)}>
              <option value="">{milestones.length ? "Keiner" : "Noch keine Meilensteine"}</option>
              {milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select disabled={!statusEdit} value={d.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
              {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS[s].label}</option>)}
            </Select>
          </Field>
          <Field label="Priorität">
            <Select disabled={!fullEdit} value={d.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
              {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
            </Select>
          </Field>
          <Field label="Geschätzt (Stunden)" hint={isPackage && rollup ? `Unteraufgaben zusammen: ${fmtH(rollup.estimateHours * 60)}` : undefined}>
            <Input disabled={!fullEdit} inputMode="decimal" value={d.estimate} onChange={(e) => set("estimate", e.target.value)} placeholder="z. B. 4 oder 1,5" className="tabular" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <DateInput disabled={!fullEdit} value={d.startDate} onChange={(v) => set("startDate", v)} />
            </Field>
            <Field label="Fällig">
              <DateInput disabled={!fullEdit} value={d.dueDate} min={d.startDate} onChange={(v) => set("dueDate", v)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <div className="mb-1.5 text-[13px] font-medium text-(--text-muted)">Zuständig</div>
            <MemberChips members={members} value={d.assigneeIds} onChange={(v) => set("assigneeIds", v)} disabled={!fullEdit} />
          </div>
          <Field label="Beschreibung" className="sm:col-span-2">
            <Textarea disabled={!fullEdit} value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="Details, Links, Abnahmekriterien …" />
          </Field>
          {task && rollup ? (
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl bg-(--surface-2) px-4 py-3 text-sm sm:col-span-2">
              <span>Erfasst <strong className="tabular">{fmtH(rollup.trackedMinutes)}</strong></span>
              <span>Geplant <strong className="tabular">{rollup.estimateHours ? fmtH(rollup.estimateHours * 60) : "–"}</strong></span>
              {rollup.estimateHours ? (
                <span className={rollup.trackedMinutes / 60 > rollup.estimateHours ? "text-red-600" : "text-(--text-muted)"}>
                  {rollup.trackedMinutes / 60 > rollup.estimateHours ? `${fmtH(rollup.trackedMinutes - rollup.estimateHours * 60)} drüber` : `${fmtH(rollup.estimateHours * 60 - rollup.trackedMinutes)} übrig`}
                </span>
              ) : null}
              {!vault.members.length ? null : rights.member && task.assigneeIds.includes(rights.member.id) ? <span className="text-(--text-muted)">Dir zugewiesen</span> : null}
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-600 sm:col-span-2">{error}</p> : null}
          <button type="submit" className="hidden" />
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title={isPackage ? "Arbeitspaket löschen?" : "Aufgabe löschen?"}
        body={isPackage ? "Das Arbeitspaket wird mit allen Unteraufgaben gelöscht." : `„${task?.title}“ wird gelöscht.`}
        confirmLabel="Löschen"
        onConfirm={() => {
          if (task && deleteTaskTree(task)) {
            toast.success("Gelöscht");
            onClose();
          } else toast.warning("Nicht gelöscht", "Auf dieser Aufgabe ist Zeit gebucht.");
        }}
      />
    </>
  );
}
