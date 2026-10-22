/* Settings for offers (settings.projects): numbering, validity, down payment and the PDF texts.
   Meant to be mounted in the "Projekte" settings tab. */
import { useEffect, useState } from "react";
import { allocateOfferNumber, can, todayIso, OFFER_PLACEHOLDERS, DEFAULT_OFFER_COMPLETION_TEMPLATE, DEFAULT_OFFER_CONTRACT_NOTE, DEFAULT_OFFER_SCOPE_TEXT, type ProjectSettings } from "@ordo/core";
import { useList, useSettingsMutator, useVault } from "@/state/hooks";
import { useMe } from "@/modules/registry";
import { toast } from "@/state/toasts";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { NumberInput, TextAction, LabelRow } from "./parts";

type OfferFields = Pick<
  ProjectSettings,
  "offerNumberPattern" | "nextOfferNumber" | "offerValidDays" | "downpaymentPct" | "contractTitle" | "offerIntroText" | "offerScopeText" | "offerCompletionText" | "offerPaymentTermsText" | "offerFooterText"
>;

function pick(s: ProjectSettings): OfferFields {
  return {
    offerNumberPattern: s.offerNumberPattern,
    nextOfferNumber: s.nextOfferNumber,
    offerValidDays: s.offerValidDays,
    downpaymentPct: s.downpaymentPct,
    contractTitle: s.contractTitle,
    offerIntroText: s.offerIntroText,
    offerScopeText: s.offerScopeText,
    offerCompletionText: s.offerCompletionText,
    offerPaymentTermsText: s.offerPaymentTermsText,
    offerFooterText: s.offerFooterText,
  };
}

export function OfferSettings() {
  const vault = useVault();
  const offers = useList("offers");
  const mutate = useSettingsMutator();
  const { role } = useMe();
  const ro = !can(role, "offers", "admin");
  const stored = vault.settings.projects;
  const [v, setV] = useState<OfferFields>(() => pick(stored));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setV(pick(stored));
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<OfferFields>) => {
    setV((x) => ({ ...x, ...p }));
    setDirty(true);
  };
  const save = () => {
    mutate((s) => ({ ...s, projects: { ...s.projects, ...v, offerNumberPattern: v.offerNumberPattern.trim() || "AN-{YYYY}-{NNNN}", nextOfferNumber: Math.max(1, Math.round(v.nextOfferNumber)) } }));
    setDirty(false);
    toast.success("Einstellungen für Angebote gespeichert");
  };
  const preview = allocateOfferNumber({ offerNumberPattern: v.offerNumberPattern || "AN-{YYYY}-{NNNN}", nextOfferNumber: v.nextOfferNumber }, todayIso(), offers.map((o) => o.number)).number;

  return (
    <fieldset disabled={ro} className="m-0 min-w-0 space-y-4 border-0 p-0">
      <Card title="Angebote – Nummern & Fristen">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nummernmuster" hint={`{YYYY} Jahr, {YY}, {MM} Monat, {NNNN} laufende Nummer. Nächste: ${preview}`}>
            <Input value={v.offerNumberPattern} onChange={(e) => set({ offerNumberPattern: e.target.value })} placeholder="AN-{YYYY}-{NNNN}" />
          </Field>
          <Field label="Nächste laufende Nummer">
            <NumberInput value={v.nextOfferNumber} min={1} onChange={(n) => set({ nextOfferNumber: Math.round(n) })} />
          </Field>
          <Field label="Gültig für" hint="Tage ab Angebotsdatum">
            <NumberInput value={v.offerValidDays} min={0} max={365} suffix="Tage" onChange={(n) => set({ offerValidDays: Math.round(n) })} />
          </Field>
          <Field label="Anzahlung" hint="Vorschlag für neue Angebote und die erste Projektrechnung">
            <NumberInput value={v.downpaymentPct} min={0} max={100} suffix="%" onChange={(n) => set({ downpaymentPct: n })} />
          </Field>
          <Field label="Vertragsbezeichnung" hint="z. B. Werkvertrag – leer lassen, wenn du keinen Rahmenvertrag hast">
            <Input value={v.contractTitle} onChange={(e) => set({ contractTitle: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card title="Angebote – Texte im PDF">
        <div className="space-y-4">
          <div>
            <LabelRow label="Einleitung" />
            <Textarea value={v.offerIntroText} rows={2} onChange={(e) => set({ offerIntroText: e.target.value })} />
          </div>
          <div>
            <LabelRow label="Hinweis" hint="Leer = Vertragsbezug (wenn eine Vertragsbezeichnung gesetzt ist) und Leistungsumfang aus den Positionen." action={<TextAction onClick={() => set({ offerScopeText: `${DEFAULT_OFFER_CONTRACT_NOTE}\n${DEFAULT_OFFER_SCOPE_TEXT}` })}>Standardtext einsetzen</TextAction>} />
            <Textarea value={v.offerScopeText} rows={3} placeholder={`${DEFAULT_OFFER_CONTRACT_NOTE}\n${DEFAULT_OFFER_SCOPE_TEXT}`} onChange={(e) => set({ offerScopeText: e.target.value })} />
          </div>
          <div>
            <LabelRow label="Fertigstellung" hint="Leer = Dauer aus den Projektdaten („ca. 6–9 Wochen“) und spätester Termin." action={<TextAction onClick={() => set({ offerCompletionText: DEFAULT_OFFER_COMPLETION_TEMPLATE })}>Standardtext einsetzen</TextAction>} />
            <Textarea value={v.offerCompletionText} rows={3} placeholder={DEFAULT_OFFER_COMPLETION_TEMPLATE} onChange={(e) => set({ offerCompletionText: e.target.value })} />
          </div>
          <div>
            <LabelRow label="Zahlungsbedingungen" hint="Leer = automatisch aus Anzahlung, Schlusszahlung und Zahlungsziel." />
            <Textarea value={v.offerPaymentTermsText} rows={3} placeholder="{downPaymentPercent} % bei Annahme des Angebotes, {finalPaymentPercent} % nach Übergabe. Zahlungsziel {paymentDueDays} Tage netto." onChange={(e) => set({ offerPaymentTermsText: e.target.value })} />
          </div>
          <div>
            <LabelRow label="Fußzeile auf jeder Seite" />
            <Input value={v.offerFooterText} onChange={(e) => set({ offerFooterText: e.target.value })} placeholder="z. B. Preise in EUR zzgl. USt, sofern nicht anders angegeben." />
          </div>
          <details className="rounded-xl border border-(--border) px-3 py-2 text-sm">
            <summary className="cursor-pointer text-(--text-muted)">Platzhalter für die Texte</summary>
            <ul className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              {OFFER_PLACEHOLDERS.map((p) => (
                <li key={p.key}>
                  <code className="rounded bg-(--surface-2) px-1 py-0.5">{`{${p.key}}`}</code> <span className="text-(--text-muted)">{p.label}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </Card>

      {!ro ? (
        <div className="flex justify-end gap-2">
          {dirty ? <Button variant="ghost" onClick={() => { setV(pick(stored)); setDirty(false); }}>Verwerfen</Button> : null}
          <Button disabled={!dirty} onClick={save}>Speichern</Button>
        </div>
      ) : null}
    </fieldset>
  );
}
