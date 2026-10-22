import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { buildTaskTree, flattenTaskTree, ids, milestoneTaskIds, nowIso, type Milestone } from "@ordo/core";
import { Button, Checkbox, ConfirmDialog, DateInput, Field, Input, Modal, MoneyInput, Select, Textarea } from "@/components/ui";
import { useList, useProfile } from "@/state/hooks";
import { toast } from "@/state/toasts";
import { cls } from "@/lib/format";
import { TASK_STATUS } from "./labels";
import { deleteMilestone, saveMilestone } from "./actions";

export function MilestoneDialog({ open, onClose, milestone, projectId, readOnly }: { open: boolean; onClose: () => void; milestone?: Milestone; projectId: string; readOnly?: boolean }) {
  const profile = useProfile();
  const allTasks = useList("tasks");
  const tasks = useMemo(() => allTasks.filter((t) => t.projectId === projectId), [allTasks, projectId]);
  const flat = useMemo(() => flattenTaskTree(buildTaskTree(tasks)), [tasks]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string | undefined>();
  const [status, setStatus] = useState<Milestone["status"]>("open");
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [invoiceCents, setInvoiceCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(milestone?.title ?? "");
    setDescription(milestone?.description ?? "");
    setDueDate(milestone?.dueDate);
    setStatus(milestone?.status ?? "open");
    setTaskIds(milestone ? milestoneTaskIds(milestone, tasks) : []);
    setInvoiceCents(milestone?.invoiceAmountCents ?? null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, milestone?.id]);

  const toggle = (id: string) => setTaskIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (readOnly) return onClose();
    if (!title.trim()) return setError("Gib dem Meilenstein einen Namen.");
    const now = nowIso();
    const m: Milestone = {
      ...(milestone ?? { id: ids.milestone(), profileId: profile.id, projectId, createdAt: now, taskIds: [] }),
      title: title.trim(),
      description: description.trim(),
      dueDate,
      status,
      completedAt: status === "done" ? milestone?.completedAt ?? now : undefined,
      invoiceAmountCents: invoiceCents ?? undefined,
      taskIds,
      updatedAt: now,
    };
    saveMilestone(m, taskIds);
    toast.success(milestone ? "Meilenstein gespeichert" : "Meilenstein angelegt");
    onClose();
  };

  return (
    <>
      <Modal
        open={open && !confirmDelete}
        onClose={onClose}
        title={milestone ? "Meilenstein" : "Neuer Meilenstein"}
        size="lg"
        footer={
          <>
            {milestone && !readOnly ? (
              <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Löschen
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>{readOnly ? "Schließen" : "Abbrechen"}</Button>
            {!readOnly ? <Button onClick={() => submit()}>{milestone ? "Speichern" : "Anlegen"}</Button> : null}
          </>
        }
      >
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <p className="-mt-1 text-sm text-(--text-muted) sm:col-span-2">Ein Meilenstein ist ein wichtiger Zwischenstand, z. B. „Design freigegeben“. Er ist erreicht, wenn die zugehörigen Aufgaben erledigt sind.</p>
          <Field label="Name" required className="sm:col-span-2">
            <Input autoFocus disabled={readOnly} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Design freigegeben" />
          </Field>
          <Field label="Fällig am">
            <DateInput disabled={readOnly} value={dueDate} onChange={setDueDate} />
          </Field>
          <Field label="Status">
            <Select disabled={readOnly} value={status} onChange={(e) => setStatus(e.target.value as Milestone["status"])}>
              <option value="open">Offen</option>
              <option value="done">Erreicht</option>
            </Select>
          </Field>
          <Field label="Teilrechnung bei Erreichen (netto, optional)" className="sm:col-span-2" hint="Nur als Merker – die Rechnung schreibst du im Projekt unter Rechnungen.">
            <MoneyInput disabled={readOnly} value={invoiceCents} onChange={setInvoiceCents} />
          </Field>
          <div className="sm:col-span-2">
            <div className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-(--text-muted)">
              <span>Zugehörige Aufgaben</span>
              <span className="tabular">{taskIds.length} gewählt</span>
            </div>
            {flat.length ? (
              <div className="max-h-64 overflow-y-auto rounded-xl border border-(--border) p-2">
                {flat.map((n) => (
                  <div key={n.task.id} style={{ paddingLeft: n.depth * 16 }} className={cls("py-0.5", n.isPackage && "font-medium")}>
                    <Checkbox
                      disabled={readOnly}
                      checked={taskIds.includes(n.task.id)}
                      onChange={() => toggle(n.task.id)}
                      label={
                        <span className="inline-flex items-center gap-2">
                          <span className="tabular text-(--text-muted)">{n.number}</span>
                          {n.task.title}
                          <span className={cls("h-1.5 w-1.5 rounded-full", TASK_STATUS[n.task.status].dot)} title={TASK_STATUS[n.task.status].label} />
                        </span>
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-(--surface-2) px-3 py-2 text-sm text-(--text-muted)">Noch keine Aufgaben im Projekt. Du kannst sie später zuordnen.</p>
            )}
          </div>
          <Field label="Beschreibung" className="sm:col-span-2">
            <Textarea disabled={readOnly} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Was gehört dazu, wer gibt frei?" />
          </Field>
          {error ? <p className="text-sm text-red-600 sm:col-span-2">{error}</p> : null}
          <button type="submit" className="hidden" />
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title="Meilenstein löschen?"
        body="Die Aufgaben bleiben erhalten, nur die Zuordnung fällt weg."
        confirmLabel="Löschen"
        onConfirm={() => {
          if (milestone) deleteMilestone(milestone);
          toast.success("Meilenstein gelöscht");
          onClose();
        }}
      />
    </>
  );
}
