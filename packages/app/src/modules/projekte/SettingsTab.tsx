import { useEffect, useState } from "react";
import { can, formatNumber, todayIso, type ProjectSettings } from "@ordo/core";
import { Button, Card, Field, Input, MoneyInput } from "@/components/ui";
import { useSettingsMutator, useVault } from "@/state/hooks";
import { toast } from "@/state/toasts";
import { useMe } from "@/modules/registry";
import { OfferSettings } from "./offers/OfferSettings";

type Fields = { pattern: string; next: string; hoursPerDay: string; rateCents: number };

const fromSettings = (s: ProjectSettings): Fields => ({ pattern: s.projectNumberPattern, next: String(s.nextProjectNumber), hoursPerDay: String(s.defaultHoursPerDay).replace(".", ","), rateCents: s.defaultHourlyRateCents });

/** Einstellungen → Projekte: numbering and defaults for new projects, then the offer settings. */
export function ProjectSettingsTab() {
  const vault = useVault();
  const mutate = useSettingsMutator();
  const { role } = useMe();
  const editable = can(role, "projects", "admin") || can(role, "settings", "write");
  const current = vault.settings.projects;
  const [d, setD] = useState<Fields>(() => fromSettings(current));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setD(fromSettings(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.projectNumberPattern, current.nextProjectNumber, current.defaultHoursPerDay, current.defaultHourlyRateCents]);
  const set = (p: Partial<Fields>) => {
    setD((x) => ({ ...x, ...p }));
    setDirty(true);
  };
  const next = Math.max(1, Number(d.next) || 1);
  const preview = /\{N+\}/.test(d.pattern) ? formatNumber(d.pattern, next, todayIso()) : "–";

  const save = () => {
    const hours = Number(d.hoursPerDay.replace(",", "."));
    if (!Number.isFinite(hours) || hours < 0.5 || hours > 24) return toast.warning("Stunden pro Tag prüfen", "Bitte einen Wert zwischen 0,5 und 24.");
    if (!/\{N+\}/.test(d.pattern)) return toast.warning("Nummernmuster prüfen", "Das Muster braucht einen Zähler, z. B. {NNNN}.");
    mutate((s) => ({ ...s, projects: { ...s.projects, projectNumberPattern: d.pattern.trim(), nextProjectNumber: next, defaultHoursPerDay: hours, defaultHourlyRateCents: d.rateCents } }));
    setDirty(false);
    toast.success("Einstellungen für Projekte gespeichert");
  };

  return (
    <div className="space-y-5">
      <fieldset disabled={!editable} className="m-0 min-w-0 border-0 p-0">
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Projektnummern">
            <div className="space-y-4">
              <Field label="Muster" hint="{YYYY} Jahr, {YY} kurzes Jahr, {MM} Monat, {NNNN} laufende Nummer (Anzahl N = Stellen).">
                <Input value={d.pattern} onChange={(e) => set({ pattern: e.target.value })} placeholder="P-{NNNN}" />
              </Field>
              <Field label="Nächste Nummer">
                <Input inputMode="numeric" value={d.next} onChange={(e) => set({ next: e.target.value.replace(/\D/g, "") })} className="tabular" />
              </Field>
              <p className="text-sm text-(--text-muted)">Das nächste Projekt bekommt die Nummer <strong className="tabular text-(--text)">{preview}</strong>.</p>
            </div>
          </Card>
          <Card title="Vorgaben für neue Projekte">
            <div className="space-y-4">
              <Field label="Produktive Stunden pro Arbeitstag" hint="So viele Stunden plant „Automatisch planen“ pro Tag ein. Lässt sich je Projekt ändern.">
                <Input inputMode="decimal" value={d.hoursPerDay} onChange={(e) => set({ hoursPerDay: e.target.value })} className="tabular" />
              </Field>
              <Field label="Stundensatz (netto)" hint="Vorschlag für neue Projekte – sonst gilt der Satz der Person.">
                <MoneyInput value={d.rateCents} onChange={(c) => set({ rateCents: c ?? 0 })} />
              </Field>
            </div>
          </Card>
        </div>
        {editable ? (
          <div className="mt-4 flex justify-end">
            <Button disabled={!dirty} onClick={save}>Speichern</Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-(--text-muted)">Diese Einstellungen kann nur die Projektleitung oder die Administration ändern.</p>
        )}
      </fieldset>
      <OfferSettings />
    </div>
  );
}
