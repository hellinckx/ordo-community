import { useEffect, useState } from "react";
import { Link } from "react-router";
import { can, formatNumber, todayIso } from "@ordo/core";
import { useSettings, useSettingsMutator } from "@/state/hooks";
import { useMe } from "@/modules/registry";
import { Button, Card, Field, Input } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/state/toasts";
import { QtyInput } from "@/modules/produkte/shared";
import { useLabourRate } from "./shared";

/** Einstellungen → Fertigung: number range for work orders, where labour cost comes from. */
export function ProductionSettingsTab() {
  const settings = useSettings();
  const mutate = useSettingsMutator();
  const { role } = useMe();
  const rate = useLabourRate();
  const editable = can(role, "settings", "write") || can(role, "production", "admin");
  const [pattern, setPattern] = useState(settings.projects.workOrderNumberPattern);
  const [next, setNext] = useState(settings.projects.nextWorkOrderNumber);
  useEffect(() => {
    setPattern(settings.projects.workOrderNumberPattern);
    setNext(settings.projects.nextWorkOrderNumber);
  }, [settings.projects.workOrderNumberPattern, settings.projects.nextWorkOrderNumber]);
  const dirty = pattern !== settings.projects.workOrderNumberPattern || next !== settings.projects.nextWorkOrderNumber;
  const valid = /\{N+\}/.test(pattern);

  const save = () => {
    if (!valid) return toast.warning("Das Muster braucht einen Zähler", "Zum Beispiel {NNNN} für 0001, 0002 …");
    mutate((s) => ({ ...s, projects: { ...s.projects, workOrderNumberPattern: pattern.trim(), nextWorkOrderNumber: Math.max(1, Math.round(next)) } }));
    toast.success("Gespeichert");
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Nummern für Fertigungsaufträge">
        <fieldset disabled={!editable} className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Muster" hint="{YYYY} Jahr, {MM} Monat, {NNNN} laufende Nummer">
              <Input value={pattern} onChange={(e) => setPattern(e.target.value)} />
            </Field>
            <Field label="Nächste Nummer">
              <QtyInput value={next} onChange={(n) => setNext(Math.round(n))} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-(--surface-2) px-3 py-2.5 text-sm">
            <span className="text-(--text-muted)">So sieht die nächste aus</span>
            <span className="tabular font-semibold">{valid ? formatNumber(pattern, Math.max(1, Math.round(next)), todayIso()) : "–"}</span>
          </div>
          {editable && dirty ? (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setPattern(settings.projects.workOrderNumberPattern); setNext(settings.projects.nextWorkOrderNumber); }}>Verwerfen</Button>
              <Button onClick={save}>Speichern</Button>
            </div>
          ) : null}
        </fieldset>
      </Card>
      <Card title="Kosten der Arbeitszeit">
        <p className="text-sm text-(--text-muted)">
          Für die Herstellkosten rechnet Ordo die Minuten der Arbeitsschritte mit den internen Stundenkosten deines Teams – dem Durchschnitt aller aktiven Personen.
        </p>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-(--surface-2) px-3 py-2.5 text-sm">
          <span className="text-(--text-muted)">Stundenkosten</span>
          <span className="tabular font-semibold">{rate.fromTeam ? `${fmtMoney(rate.cents)} / h` : "noch nicht hinterlegt"}</span>
        </div>
        <Link to="/team" className="mt-3 inline-block text-sm text-brand-700 hover:underline dark:text-brand-400">Im Team anpassen</Link>
      </Card>
    </div>
  );
}
