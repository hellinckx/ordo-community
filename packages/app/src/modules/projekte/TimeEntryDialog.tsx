import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Sigma, Trash2 } from "lucide-react";
import { buildTaskTree, flattenTaskTree, todayIso, type TimeEntry } from "@ordo/core";
import { Button, ConfirmDialog, DateInput, Field, Input, Modal, Select, Switch } from "@/components/ui";
import { useList, useProfile } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { toast } from "@/state/toasts";
import { fmtH } from "./labels";
import { DurationInput } from "./parts";
import { bookTime, useMembers, useProjectRights } from "./hooks";

interface Draft {
  projectId: string;
  taskId?: string;
  memberId?: string;
  date: string;
  minutes: number | null;
  description: string;
  billable: boolean;
}

/**
 * Add or edit a time entry. "Summe anpassen" books a correction entry for the difference between the
 * current task total and the total you type (like the old ERP) – it may be negative.
 */
export function TimeEntryDialog({ open, onClose, entry, projectId, taskId, date, chooseProject }: { open: boolean; onClose: () => void; entry?: TimeEntry; projectId?: string; taskId?: string; date?: string; chooseProject?: boolean }) {
  const profile = useProfile();
  const projects = useList("projects");
  const tasks = useList("tasks");
  const entries = useList("timeEntries");
  const { active: members, byId } = useMembers();
  const rights = useProjectRights();
  const me = rights.member;
  const [d, setD] = useState<Draft>({ projectId: "", date: todayIso(), minutes: null, description: "", billable: true });
  const [correction, setCorrection] = useState(false);
  const [newTotal, setNewTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    const pid = entry?.projectId ?? projectId ?? (chooseProject ? (projects.find((p) => p.status === "active")?.id ?? "") : "");
    const p = projects.find((x) => x.id === pid);
    setD(
      entry
        ? { projectId: entry.projectId, taskId: entry.taskId, memberId: entry.memberId, date: entry.date, minutes: entry.minutes, description: entry.description, billable: entry.billable }
        : { projectId: pid, taskId, memberId: me?.id, date: date ?? todayIso(), minutes: null, description: "", billable: p ? p.billing !== "internal" : true },
    );
    setCorrection(false);
    setNewTotal(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry?.id]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const project = projects.find((p) => p.id === d.projectId);
  const locked = project?.status === "completed";
  const canEdit = !locked && (entry ? rights.canEditEntry(entry) : rights.canWriteTime || rights.canOwnTime);
  const taskOptions = useMemo(() => flattenTaskTree(buildTaskTree(tasks.filter((t) => t.projectId === d.projectId))), [tasks, d.projectId]);
  const projectMinutes = useMemo(() => entries.filter((e) => e.projectId === d.projectId).reduce((s, e) => s + e.minutes, 0), [entries, d.projectId]);
  const taskMinutes = useMemo(() => (d.taskId ? entries.filter((e) => e.taskId === d.taskId).reduce((s, e) => s + e.minutes, 0) : 0), [entries, d.taskId]);
  const task = tasks.find((t) => t.id === d.taskId);
  const diff = correction && newTotal !== null ? newTotal - taskMinutes : 0;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canEdit) return onClose();
    if (!d.projectId) return setError("Wähle ein Projekt.");
    if (correction) {
      if (!d.taskId) return setError("Wähle die Aufgabe, deren Summe du anpassen willst.");
      if (newTotal === null) return setError("Gib die neue Summe ein.");
      if (diff === 0) return onClose();
      bookTime({ profileId: profile.id, projectId: d.projectId, taskId: d.taskId, memberId: undefined, date: d.date, minutes: diff, description: "Korrektur: Summe angepasst", billable: d.billable });
      toast.success("Summe angepasst", `Korrektur über ${fmtH(diff)} gebucht.`);
      return onClose();
    }
    if (d.minutes === null || d.minutes === 0) return setError("Wie lange? Zum Beispiel „1,5“ oder „1:30“.");
    if (d.minutes < 0 && !rights.canWriteTime) return setError("Negative Zeiten sind nur als Korrektur möglich.");
    if (entry) {
      requireStore().update("timeEntries", entry.id, { projectId: d.projectId, taskId: d.taskId, memberId: d.memberId, date: d.date, minutes: d.minutes, description: d.description.trim(), billable: d.billable }, "time.update");
      toast.success("Zeit gespeichert");
    } else {
      bookTime({ profileId: profile.id, projectId: d.projectId, taskId: d.taskId, memberId: d.memberId, date: d.date, minutes: d.minutes, description: d.description.trim(), billable: d.billable });
      toast.success(`${fmtH(d.minutes)} erfasst`, project?.name);
    }
    onClose();
  };

  return (
    <>
      <Modal
        open={open && !confirmDelete}
        onClose={onClose}
        title={entry ? "Zeit bearbeiten" : correction ? "Summe anpassen" : "Zeit erfassen"}
        footer={
          <>
            {entry && canEdit ? (
              <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" /> Löschen
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>{canEdit ? "Abbrechen" : "Schließen"}</Button>
            {canEdit ? <Button onClick={() => submit()}>{correction ? "Korrektur buchen" : "Speichern"}</Button> : null}
          </>
        }
      >
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {chooseProject || !projectId || entry ? (
            <Field label="Projekt" required className="sm:col-span-2">
              <Select disabled={!canEdit} value={d.projectId} onChange={(e) => {
                const p = projects.find((x) => x.id === e.target.value);
                setD((x) => ({ ...x, projectId: e.target.value, taskId: undefined, billable: p ? p.billing !== "internal" : x.billable }));
              }}>
                <option value="">Projekt wählen …</option>
                {projects.filter((p) => p.id === d.projectId || (p.status !== "completed" && p.status !== "cancelled")).sort((a, b) => a.name.localeCompare(b.name, "de")).map((p) => <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label="Aufgabe" className="sm:col-span-2">
            <Select disabled={!canEdit || !d.projectId} value={d.taskId ?? ""} onChange={(e) => set("taskId", e.target.value || undefined)}>
              <option value="">{taskOptions.length ? "Ohne Aufgabe" : "Keine Aufgaben im Projekt"}</option>
              {taskOptions.map((n) => <option key={n.task.id} value={n.task.id}>{"  ".repeat(n.depth)}{n.number} {n.task.title}</option>)}
            </Select>
          </Field>
          {correction ? (
            <>
              <Field label={`Neue Summe für ${task ? `„${task.title}“` : "die Aufgabe"}`} hint={`Bisher erfasst: ${fmtH(taskMinutes)}`} className="sm:col-span-2">
                <DurationInput minutes={newTotal} onChange={setNewTotal} autoFocus onEnter={() => submit()} />
              </Field>
              {newTotal !== null && d.taskId ? (
                <p className="text-sm text-(--text-muted) sm:col-span-2">
                  {diff === 0 ? "Die Summe stimmt schon." : <>Es wird eine Korrektur über <strong className="tabular text-(--text)">{diff > 0 ? "+" : ""}{fmtH(diff)}</strong> gebucht. Die einzelnen Einträge bleiben, wie sie sind.</>}
                </p>
              ) : null}
              <Field label="Datum der Korrektur">
                <DateInput value={d.date} onChange={(v) => set("date", v ?? todayIso())} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Dauer" required>
                <DurationInput minutes={d.minutes} onChange={(m) => set("minutes", m)} autoFocus={canEdit} allowNegative={rights.canWriteTime} onEnter={() => submit()} />
              </Field>
              <Field label="Datum">
                <DateInput disabled={!canEdit} value={d.date} onChange={(v) => set("date", v ?? todayIso())} />
              </Field>
              {members.length ? (
                <Field label="Person">
                  <Select disabled={!canEdit || !rights.canWriteTime} value={d.memberId ?? ""} onChange={(e) => set("memberId", e.target.value || undefined)}>
                    <option value="">Niemand bestimmt</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    {d.memberId && !members.some((m) => m.id === d.memberId) ? <option value={d.memberId}>{byId.get(d.memberId)?.name ?? "Ehemalig"}</option> : null}
                  </Select>
                </Field>
              ) : null}
              <Field label="Was hast du gemacht?" className={members.length ? "" : "sm:col-span-2"}>
                <Input disabled={!canEdit} value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="Kurz beschreiben (optional)" />
              </Field>
            </>
          )}
          <div className="sm:col-span-2">
            <Switch checked={d.billable} onChange={(v) => set("billable", v)} disabled={!canEdit} label="Verrechenbar" hint={project?.billing === "internal" ? "Internes Projekt – wird nicht verrechnet." : "Zählt zur verrechenbaren Zeit."} />
          </div>
          {d.projectId ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl bg-(--surface-2) px-4 py-2.5 text-xs text-(--text-muted) sm:col-span-2">
              <span>Projekt gesamt <strong className="tabular text-(--text)">{fmtH(projectMinutes)}</strong></span>
              {task ? <span>Aufgabe <strong className="tabular text-(--text)">{fmtH(taskMinutes)}</strong>{task.estimateHours ? ` von ${fmtH(task.estimateHours * 60)}` : ""}</span> : null}
              {!entry && rights.canWriteTime && d.taskId ? (
                <button type="button" onClick={() => { setCorrection((c) => !c); setError(null); }} className="ml-auto inline-flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-400">
                  <Sigma className="h-3.5 w-3.5" /> {correction ? "Normal erfassen" : "Summe anpassen"}
                </button>
              ) : null}
            </div>
          ) : null}
          {locked ? <p className="text-sm text-(--text-muted) sm:col-span-2">Das Projekt ist abgeschlossen – Zeiten lassen sich nicht mehr ändern.</p> : null}
          {error ? <p className="text-sm text-red-600 sm:col-span-2">{error}</p> : null}
          <button type="submit" className="hidden" />
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title="Zeiteintrag löschen?"
        body={entry ? `${fmtH(entry.minutes)} am ${entry.date.split("-").reverse().join(".")} werden gelöscht.` : undefined}
        confirmLabel="Löschen"
        onConfirm={() => {
          if (!entry) return;
          requireStore().softDelete("timeEntries", entry.id, "time.delete");
          toast.success("Zeiteintrag gelöscht");
          onClose();
        }}
      />
    </>
  );
}
