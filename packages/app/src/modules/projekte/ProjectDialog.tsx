import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { formatNumber, ids, isoDaysBetween, nowIso, shiftIsoDate, todayIso, type Project } from "@ordo/core";
import { Button, DateInput, Field, Input, Modal, MoneyInput, Select, Textarea } from "@/components/ui";
import { ContactPicker } from "@/components/pickers";
import { useProfile, useVault } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { toast } from "@/state/toasts";
import { BILLING, PROJECT_STATUS, PROJECT_STATUS_ORDER } from "./labels";
import { useMembers } from "./hooks";

interface Draft {
  name: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  durationDays: string;
  budgetCents: number;
  budgetHours: string;
  billing: Project["billing"];
  hourlyRateCents: number;
  managerId?: string;
  description: string;
  status: Project["status"];
  hoursPerDay: string;
}

function draftFrom(p: Project | undefined, defaults: { rate: number; hoursPerDay: number }, customerId?: string): Draft {
  const start = p?.startDate ?? todayIso();
  const end = p?.endDate;
  return {
    name: p?.name ?? "",
    customerId: p?.customerId ?? customerId,
    startDate: p ? p.startDate : start,
    endDate: end,
    durationDays: p?.startDate && end ? String(isoDaysBetween(p.startDate, end) + 1) : "",
    budgetCents: p?.budgetCents ?? 0,
    budgetHours: p?.budgetHours ? String(p.budgetHours).replace(".", ",") : "",
    billing: p?.billing ?? "fixed",
    hourlyRateCents: p?.hourlyRateCents ?? defaults.rate,
    managerId: p?.managerId,
    description: p?.description ?? "",
    status: p?.status ?? "planning",
    hoursPerDay: String(p?.hoursPerDay ?? defaults.hoursPerDay).replace(".", ","),
  };
}

const num = (s: string) => {
  const v = Number(s.replace(",", ".").trim());
  return Number.isFinite(v) ? v : 0;
};

/** New project (project undefined) or edit. */
export function ProjectDialog({ open, onClose, project, customerId }: { open: boolean; onClose: () => void; project?: Project; customerId?: string }) {
  const vault = useVault();
  const profile = useProfile();
  const navigate = useNavigate();
  const { active: members } = useMembers();
  const settings = vault.settings.projects;
  const [d, setD] = useState<Draft>(() => draftFrom(project, { rate: settings.defaultHourlyRateCents, hoursPerDay: settings.defaultHoursPerDay }, customerId));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setD(draftFrom(project, { rate: settings.defaultHourlyRateCents, hoursPerDay: settings.defaultHoursPerDay }, customerId));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  // start, end and duration stay in sync (duration = calendar days incl. both ends)
  const setStart = (v: string | undefined) =>
    setD((x) => {
      if (!v) return { ...x, startDate: undefined, durationDays: "" };
      const days = parseInt(x.durationDays, 10);
      if (days > 0) return { ...x, startDate: v, endDate: shiftIsoDate(v, days - 1) };
      return { ...x, startDate: v, durationDays: x.endDate && x.endDate >= v ? String(isoDaysBetween(v, x.endDate) + 1) : "" };
    });
  const setEnd = (v: string | undefined) =>
    setD((x) => ({ ...x, endDate: v, durationDays: v && x.startDate && v >= x.startDate ? String(isoDaysBetween(x.startDate, v) + 1) : "" }));
  const setDuration = (v: string) =>
    setD((x) => {
      const days = parseInt(v, 10);
      return { ...x, durationDays: v, endDate: x.startDate && days > 0 ? shiftIsoDate(x.startDate, days - 1) : x.endDate };
    });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!d.name.trim()) return setError("Gib dem Projekt einen Namen.");
    if (d.startDate && d.endDate && d.endDate < d.startDate) return setError("Das Ende liegt vor dem Start.");
    const store = requireStore();
    const fields = {
      name: d.name.trim(),
      customerId: d.customerId,
      startDate: d.startDate,
      endDate: d.endDate,
      budgetCents: d.budgetCents,
      budgetHours: num(d.budgetHours),
      billing: d.billing,
      hourlyRateCents: d.hourlyRateCents,
      managerId: d.managerId,
      description: d.description.trim(),
      hoursPerDay: Math.min(24, Math.max(0.5, num(d.hoursPerDay) || settings.defaultHoursPerDay)),
    };
    if (project) {
      const statusChanged = d.status !== project.status;
      store.update("projects", project.id, { ...fields, status: d.status, completedAt: d.status === "completed" ? project.completedAt ?? nowIso() : undefined }, "project.update");
      toast.success(statusChanged ? `Projekt ist jetzt „${PROJECT_STATUS[d.status].label}“` : "Projekt gespeichert");
      onClose();
      return;
    }
    const now = nowIso();
    const id = ids.project();
    store.mutate((v) => {
      const s = v.settings.projects;
      const number = formatNumber(s.projectNumberPattern, s.nextProjectNumber, todayIso());
      const p: Project = { id, profileId: profile.id, number, status: "planning", memberIds: d.managerId ? [d.managerId] : [], color: "#0a5fe0", tags: [], notes: "", createdAt: now, updatedAt: now, ...fields };
      v.projects = [...v.projects, p];
      v.settings = { ...v.settings, projects: { ...s, nextProjectNumber: s.nextProjectNumber + 1 } };
    }, { audit: { action: "project.create", entity: "projects", entityId: id } });
    toast.success("Projekt angelegt", "Als Nächstes: Aufgaben und Arbeitspakete anlegen.");
    onClose();
    navigate(`/projekte/${id}/aufgaben`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? "Projekt bearbeiten" : "Neues Projekt"}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button onClick={() => submit()}>{project ? "Speichern" : "Projekt anlegen"}</Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          <Input autoFocus value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="z. B. Website-Relaunch" />
        </Field>
        <Field label="Kunde">
          {/* Enter in the picker's search creates a contact – it must not submit this form */}
          <div onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}>
            <ContactPicker value={d.customerId} onChange={(v) => set("customerId", v)} kind="customer" placeholder="Kunde wählen (optional)" />
          </div>
        </Field>
        <Field label="Projektleitung">
          <Select value={d.managerId ?? ""} onChange={(e) => set("managerId", e.target.value || undefined)} disabled={!members.length}>
            <option value="">{members.length ? "Niemand bestimmt" : "Kein Team angelegt"}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_1fr_6rem] gap-3 sm:col-span-2">
          <Field label="Start">
            <DateInput value={d.startDate} onChange={setStart} />
          </Field>
          <Field label="Ende">
            <DateInput value={d.endDate} min={d.startDate} onChange={setEnd} />
          </Field>
          <Field label="Dauer (Tage)">
            <Input inputMode="numeric" value={d.durationDays} onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ""))} placeholder="–" className="tabular" />
          </Field>
        </div>
        <Field label="Abrechnung" hint={BILLING[d.billing].hint}>
          <Select value={d.billing} onChange={(e) => set("billing", e.target.value as Project["billing"])}>
            {(Object.keys(BILLING) as Project["billing"][]).map((k) => <option key={k} value={k}>{BILLING[k].label}</option>)}
          </Select>
        </Field>
        <Field label={d.billing === "fixed" ? "Projektsumme (netto)" : "Budget (netto, optional)"}>
          <MoneyInput value={d.budgetCents} onChange={(c) => set("budgetCents", c ?? 0)} />
        </Field>
        <Field label="Stundensatz (netto)" hint={d.billing === "hourly" ? "Mit diesem Satz wird die Zeit verrechnet." : "Zur Bewertung der Zeit; leer = Satz der Person."}>
          <MoneyInput value={d.hourlyRateCents} onChange={(c) => set("hourlyRateCents", c ?? 0)} />
        </Field>
        <Field label="Geplante Stunden" hint="Optional – für den Vergleich mit der erfassten Zeit.">
          <Input inputMode="decimal" value={d.budgetHours} onChange={(e) => set("budgetHours", e.target.value)} placeholder="z. B. 120" className="tabular" />
        </Field>
        {project ? (
          <>
            <Field label="Status">
              <Select value={d.status} onChange={(e) => set("status", e.target.value as Project["status"])}>
                {PROJECT_STATUS_ORDER.map((s) => <option key={s} value={s}>{PROJECT_STATUS[s].label}</option>)}
              </Select>
            </Field>
            <Field label="Produktive Stunden pro Arbeitstag" hint="Für „Automatisch planen“ im Zeitplan.">
              <Input inputMode="decimal" value={d.hoursPerDay} onChange={(e) => set("hoursPerDay", e.target.value)} className="tabular" />
            </Field>
          </>
        ) : null}
        <Field label="Beschreibung" className="sm:col-span-2">
          <Textarea value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="Worum geht es, was ist vereinbart?" />
        </Field>
        {error ? <p className="text-sm text-red-600 sm:col-span-2">{error}</p> : null}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
