import { useEffect, useMemo, useState } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import {
  ids,
  nowIso,
  todayIso,
  lineFromGross,
  normalizeVatLines,
  grossOfLines,
  constantsFor,
  SPECIAL_CATEGORIES,
  type Asset,
  type Transaction,
  type VatLine,
  type VatRate,
  type VatTreatment,
  type PaymentMethod,
  type FieldState,
  type FieldStateKey,
} from "@ordo/core";
import { useCategoryMap, useProfile } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { Button, Checkbox, DateInput, Field, Input, Modal, MoneyInput, Select, Textarea, ConfirmDialog } from "@/components/ui";
import { CategoryPicker, ContactPicker } from "@/components/pickers";
import { toast } from "@/state/toasts";
import { cls, fmtMoney } from "@/lib/format";

export const TREATMENT_OPTIONS: { value: VatTreatment; label: string; kinds: ("income" | "expense")[] }[] = [
  { value: "standard", label: "Inland mit USt (Standard)", kinds: ["income", "expense"] },
  { value: "kleinunternehmer", label: "Kleinunternehmer – steuerfrei (KZ 016)", kinds: ["income"] },
  { value: "reverse_charge", label: "Reverse Charge (Leistung aus/ins Ausland, B2B)", kinds: ["income", "expense"] },
  { value: "ig_erwerb", label: "Innergemeinschaftlicher Erwerb (Ware aus EU)", kinds: ["expense"] },
  { value: "ig_lieferung", label: "Innergemeinschaftliche Lieferung (Ware in EU)", kinds: ["income"] },
  { value: "export", label: "Ausfuhr Drittland (steuerfrei)", kinds: ["income"] },
  { value: "exempt", label: "Steuerfrei ohne Vorsteuerabzug", kinds: ["income", "expense"] },
  { value: "private", label: "Privat / nicht steuerrelevant", kinds: ["income", "expense"] },
];

export const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "bank", label: "Überweisung / Bank" },
  { value: "card", label: "Karte (Bankomat/Kreditkarte)" },
  { value: "cash", label: "Bar" },
  { value: "paypal", label: "PayPal / Online-Zahlung" },
  { value: "direct_debit", label: "Lastschrift / Einzug" },
  { value: "other", label: "Sonstige" },
];

export function emptyTransaction(profileId: string, kind: Transaction["kind"] = "expense"): Transaction {
  const now = nowIso();
  return {
    id: ids.transaction(),
    profileId,
    kind,
    date: todayIso(),
    paidDate: todayIso(),
    description: "",
    vatLines: [],
    grossCents: 0,
    currency: "EUR",
    vatTreatment: "standard",
    vatDeductiblePct: 100,
    paymentMethod: "card",
    invoiceNumber: "",
    reference: "",
    documentIds: [],
    tags: [],
    notes: "",
    origin: "manual",
    reviewed: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Controlled transaction form used inline (review) and inside the dialog. */
export function TransactionForm({ value, onChange, confidence, suggestedVendor, compact, fieldStates, openMore }: { value: Transaction; onChange: (t: Transaction) => void; confidence?: Record<string, number>; suggestedVendor?: string | null; compact?: boolean; /** Review verdict per field (rings + focus targets); falls back to raw confidences. */ fieldStates?: FieldState[]; /** Force the "Weitere Angaben" section open (e.g. to focus the invoice number). */ openMore?: boolean }) {
  const profile = useProfile();
  const cats = useCategoryMap();
  const isBusiness = profile.mode === "business";
  const isKu = profile.vatRegime === "kleinunternehmer";
  const cat = value.categoryId ? cats.get(value.categoryId) : undefined;
  const [advancedVat, setAdvancedVat] = useState(value.vatLines.length > 1);
  const [paid, setPaid] = useState(!!value.paidDate || !value.dueDate);
  const [moreOpen, setMoreOpen] = useState(!!value.invoiceNumber || !!value.notes || !!value.tags.length);
  useEffect(() => {
    if (openMore) setMoreOpen(true);
  }, [openMore]);
  const singleRate: VatRate = (value.vatLines[0]?.rate ?? cat?.defaultVatRate ?? (isBusiness ? 20 : 20)) as VatRate;
  const kind = value.kind;
  const taxKind: "income" | "expense" = kind === "income" ? "income" : "expense";
  const treatments = TREATMENT_OPTIONS.filter((t) => t.kinds.includes(taxKind));
  const conf = (k: string) => (confidence ? confidence[k] : undefined);
  const RING = { ok: "ring-1 ring-emerald-400/70", unsure: "ring-1 ring-amber-400/80", missing: "ring-1 ring-red-400/80" } as const;
  const confClass = (k: string, key?: FieldStateKey) => {
    const st = key ? fieldStates?.find((s) => s.key === key)?.state : undefined;
    if (st) return RING[st];
    const c = conf(k);
    if (c === undefined) return "";
    return c >= 0.85 ? RING.ok : c >= 0.6 ? RING.unsure : RING.missing;
  };

  const set = (patch: Partial<Transaction>) => onChange({ ...value, ...patch });
  const setGross = (gross: number | null) => {
    const g = gross ?? 0;
    const rate = value.vatTreatment === "kleinunternehmer" || value.vatTreatment === "exempt" || value.vatTreatment === "private" ? 0 : singleRate;
    set({ grossCents: g, vatLines: advancedVat ? value.vatLines : g ? [lineFromGross(g, rate)] : [] });
  };
  const setRate = (rate: VatRate) => {
    set({ vatLines: value.grossCents ? [lineFromGross(value.grossCents, rate)] : [] });
  };
  const setLines = (lines: VatLine[]) => {
    const norm = lines.map((l) => ({ ...l }));
    set({ vatLines: norm, grossCents: grossOfLines(norm) });
  };
  useEffect(() => {
    if (!paid && !value.dueDate) set({ dueDate: value.date, paidDate: undefined });
    if (paid && !value.paidDate) set({ paidDate: value.date });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid]);

  const net = value.vatLines.reduce((s, l) => s + l.netCents, 0);
  const vat = value.vatLines.reduce((s, l) => s + l.vatCents, 0);
  const c = constantsFor(Number(value.date.slice(0, 4)));
  const assetHint = isBusiness && kind === "expense" && cat?.id === SPECIAL_CATEGORIES.assetPurchase && net > 0 && net <= c.gwgGrenze * 100;
  const gwgHint = isBusiness && kind === "expense" && cat?.id === SPECIAL_CATEGORIES.gwg && net > c.gwgGrenze * 100;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-(--surface-2) p-1 sm:flex">
        {(["expense", "income", "transfer", "private"] as const).filter((k) => isBusiness || k !== "private").map((k) => (
          <button key={k} type="button" onClick={() => set({ kind: k, categoryId: k === value.kind ? value.categoryId : undefined, vatTreatment: k === "income" && isKu ? "kleinunternehmer" : "standard" })} className={cls("min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-sm font-medium transition-colors", value.kind === k ? (k === "income" ? "bg-emerald-600 text-white" : k === "expense" ? "bg-(--surface) shadow-sm" : "bg-(--surface) shadow-sm") : "text-(--text-muted) hover:text-(--text)")}>
            {{ expense: "Ausgabe", income: "Einnahme", transfer: "Umbuchung", private: "Privatentnahme" }[k]}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Datum" required>
          <DateInput id="tf-date" value={value.date} onChange={(d) => set({ date: d ?? todayIso(), paidDate: paid ? d : value.paidDate })} className={confClass("invoiceDate", "date")} />
        </Field>
        <Field label={kind === "income" ? "Betrag (brutto)" : "Betrag (brutto)"} required>
          <MoneyInput id="tf-gross" value={value.grossCents || null} onChange={setGross} className={cls("text-base font-semibold", confClass("grossCents", "gross"))} disabled={advancedVat} />
        </Field>
      </div>

      <Field label="Beschreibung">
        <Input value={value.description} onChange={(e) => set({ description: e.target.value })} placeholder={kind === "income" ? "z. B. Honorar Projekt X" : "z. B. Büromaterial"} />
      </Field>

      {kind !== "transfer" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kategorie" required>
            <CategoryPicker id="tf-category" className={confClass("category", "category")} kind={taxKind} value={value.categoryId} onChange={(id, c2) => {
              const patch: Partial<Transaction> = { categoryId: id };
              if (c2) {
                patch.vatDeductiblePct = c2.defaultDeductiblePct;
                if (!advancedVat && value.grossCents && c2.defaultVatRate !== singleRate && value.vatTreatment === "standard" && !isKu) patch.vatLines = [lineFromGross(value.grossCents, c2.defaultVatRate)];
                if (c2.id === SPECIAL_CATEGORIES.privateWithdrawal || c2.id === SPECIAL_CATEGORIES.privateDeposit) patch.vatTreatment = "private";
              }
              set(patch);
            }} />
          </Field>
          <Field label={kind === "income" ? "Kunde" : "Lieferant / Händler"}>
            <ContactPicker id="tf-contact" kind={kind === "income" ? "customer" : "vendor"} value={value.contactId} onChange={(id) => set({ contactId: id })} suggestedName={suggestedVendor} className={confClass("vendorName", "partner")} />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Von Konto">
            <Select value={value.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as PaymentMethod })}>
              {PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="Auf Konto">
            <Select value={value.counterPaymentMethod ?? "bank"} onChange={(e) => set({ counterPaymentMethod: e.target.value as PaymentMethod })}>
              {PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        </div>
      )}

      {kind !== "transfer" && (isBusiness || kind === "expense") ? (
        <div className="rounded-xl border border-(--border) p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium text-(--text-muted)">Umsatzsteuer</span>
            {isBusiness ? (
              <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => { setAdvancedVat((a) => !a); if (!advancedVat && !value.vatLines.length && value.grossCents) setLines([lineFromGross(value.grossCents, singleRate)]); }}>
                {advancedVat ? "Einfacher Modus" : "Mehrere Steuersätze"}
              </button>
            ) : null}
          </div>
          {!advancedVat ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Steuersatz">
                <Select id="tf-vat" value={singleRate} onChange={(e) => setRate(Number(e.target.value) as VatRate)} className={confClass("vatLines", "vat")} disabled={value.vatTreatment === "kleinunternehmer" || value.vatTreatment === "exempt" || value.vatTreatment === "private"}>
                  <option value={20}>20 %</option>
                  <option value={10}>10 %</option>
                  <option value={13}>13 %</option>
                  <option value={0}>0 % (steuerfrei)</option>
                  <option value={19}>19 % (Jungholz/Mittelberg)</option>
                </Select>
              </Field>
              <div className="text-sm sm:col-span-2 sm:pt-7">
                <span className="text-(--text-muted)">Netto</span> <span className="tabular font-medium">{fmtMoney(net)}</span>
                <span className="mx-2 text-(--text-muted)">·</span>
                <span className="text-(--text-muted)">USt</span> <span className="tabular font-medium">{fmtMoney(vat)}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {normalizeVatLines(value.vatLines).length ? null : null}
              {value.vatLines.map((l, i) => (
                <div key={i} className="grid grid-cols-[90px_1fr_1fr_32px] items-end gap-2">
                  <Select value={l.rate} onChange={(e) => { const lines = [...value.vatLines]; const rate = Number(e.target.value) as VatRate; lines[i] = { ...lineFromGross(l.netCents + l.vatCents, rate) }; setLines(lines); }}>
                    <option value={20}>20 %</option><option value={10}>10 %</option><option value={13}>13 %</option><option value={0}>0 %</option><option value={19}>19 %</option>
                  </Select>
                  <Field label={i === 0 ? "Brutto" : undefined}>
                    <MoneyInput value={l.netCents + l.vatCents || null} onChange={(g) => { const lines = [...value.vatLines]; lines[i] = lineFromGross(g ?? 0, l.rate); setLines(lines); }} />
                  </Field>
                  <Field label={i === 0 ? "USt" : undefined}>
                    <MoneyInput value={l.vatCents || null} onChange={(v) => { const lines = [...value.vatLines]; lines[i] = { ...l, vatCents: v ?? 0 }; setLines(lines); }} />
                  </Field>
                  <button type="button" className="mb-0.5 rounded-lg p-2 text-(--text-muted) hover:bg-(--surface-2)" onClick={() => setLines(value.vatLines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setLines([...value.vatLines, { rate: 10, netCents: 0, vatCents: 0 }])}>+ Steuersatz</Button>
              <div className="text-sm"><span className="text-(--text-muted)">Brutto gesamt</span> <span className="tabular font-semibold">{fmtMoney(grossOfLines(value.vatLines))}</span></div>
            </div>
          )}
          {isBusiness ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="USt-Behandlung">
                <Select value={value.vatTreatment} onChange={(e) => { const t = e.target.value as VatTreatment; const patch: Partial<Transaction> = { vatTreatment: t }; if ((t === "kleinunternehmer" || t === "exempt" || t === "export" || t === "ig_lieferung" || t === "private") && value.grossCents) patch.vatLines = [{ rate: 0, netCents: value.grossCents, vatCents: 0 }]; if ((t === "reverse_charge" || t === "ig_erwerb") && value.grossCents) patch.vatLines = [{ rate: 20, netCents: value.grossCents, vatCents: 0 }]; set(patch); }}>
                  {treatments.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
              {kind === "expense" && !isKu ? (
                <Field label="Vorsteuerabzug" hint={value.vatDeductiblePct < 100 ? "z. B. PKW 0 %, gemischt genutzt anteilig" : undefined}>
                  <Select value={value.vatDeductiblePct} onChange={(e) => set({ vatDeductiblePct: Number(e.target.value) })}>
                    <option value={100}>100 % abzugsfähig</option>
                    <option value={50}>50 %</option>
                    <option value={0}>0 % (kein Vorsteuerabzug)</option>
                  </Select>
                </Field>
              ) : null}
            </div>
          ) : null}
          {assetHint ? <p className="mt-2 text-xs text-amber-700">Netto unter {c.gwgGrenze.toLocaleString("de-AT")} € – als „Geringwertiges Wirtschaftsgut“ sofort absetzbar. Kategorie wechseln?</p> : null}
          {gwgHint ? <p className="mt-2 text-xs text-amber-700">Netto über {c.gwgGrenze.toLocaleString("de-AT")} € – das ist ein Anlagenkauf und wird über die Nutzungsdauer abgeschrieben. Kategorie „Anlagenkauf“ wählen.</p> : null}
        </div>
      ) : null}

      {kind !== "transfer" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Zahlungsart">
            <Select value={value.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as PaymentMethod })} className={confClass("paymentMethod")}>
              {PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <div className="space-y-2 sm:pt-6">
            <Checkbox label={kind === "income" ? "Bereits bezahlt / eingegangen" : "Bereits bezahlt"} checked={paid} onChange={setPaid} />
          </div>
        </div>
      ) : null}

      {!paid && kind !== "transfer" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fällig am">
            <DateInput value={value.dueDate} onChange={(d) => set({ dueDate: d })} className={confClass("dueDate")} />
          </Field>
          <Field label="Bezahlt am (später eintragen)">
            <DateInput value={value.paidDate} onChange={(d) => set({ paidDate: d })} />
          </Field>
        </div>
      ) : null}

      {!compact ? (
        <details className="group" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-sm text-(--text-muted) hover:text-(--text)">Weitere Angaben (Rechnungsnummer, Tags, Notizen)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Rechnungsnummer">
              <Input id="tf-invoiceNumber" value={value.invoiceNumber} onChange={(e) => set({ invoiceNumber: e.target.value })} className={confClass("invoiceNumber", "invoiceNumber")} />
            </Field>
            <Field label="Tags (kommagetrennt)">
              <Input value={value.tags.join(", ")} onChange={(e) => set({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} placeholder="projekt-a, steuerlich prüfen" />
            </Field>
            <Field label="Notizen" className="sm:col-span-2">
              <Textarea value={value.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </div>
        </details>
      ) : null}
      {value.documentIds.length ? <div className="flex items-center gap-1 text-xs text-(--text-muted)"><Paperclip className="h-3.5 w-3.5" /> {value.documentIds.length} {value.documentIds.length === 1 ? "Datei" : "Dateien"} verknüpft</div> : null}
    </div>
  );
}

export function validateTransaction(t: Transaction): string | null {
  if (!t.date) return "Datum fehlt.";
  if (!t.grossCents) return "Betrag fehlt.";
  if (t.kind !== "transfer" && !t.categoryId) return "Bitte eine Kategorie wählen.";
  return null;
}

/** Saves a transaction and – for asset purchases – creates the asset register entry. */
export function saveTransaction(t: Transaction, opts: { isNew: boolean }): Transaction {
  const store = requireStore();
  const cats = new Map(store.vault.categories.map((c) => [c.id, c]));
  const cat = t.categoryId ? cats.get(t.categoryId) : undefined;
  const next: Transaction = { ...t, reviewed: true, updatedAt: nowIso() };
  if (opts.isNew) store.insert("transactions", next, "transaction.create");
  else store.update("transactions", next.id, next, "transaction.update");
  if (cat && (cat.id === SPECIAL_CATEGORIES.assetPurchase || cat.id === SPECIAL_CATEGORIES.gwg) && t.kind === "expense") {
    const existing = store.list("assets", { profileId: t.profileId }).find((a) => a.transactionId === t.id);
    const net = t.vatLines.reduce((s, l) => s + l.netCents, 0) || t.grossCents;
    const vat = t.vatLines.reduce((s, l) => s + l.vatCents, 0);
    const cost = net + Math.round(vat * (1 - t.vatDeductiblePct / 100));
    if (!existing) {
      const now = nowIso();
      const asset: Asset = {
        id: ids.asset(),
        profileId: t.profileId,
        name: t.description || "Anlage",
        acquisitionDate: t.date,
        costCents: cost,
        usefulLifeYears: cat.id === SPECIAL_CATEGORIES.gwg ? 1 : 4,
        method: cat.id === SPECIAL_CATEGORIES.gwg ? "gwg" : "linear",
        degressiveRatePct: 30,
        privateUsePct: 0,
        transactionId: t.id,
        ekrAccount: "0620",
        categoryId: cat.id,
        notes: "",
        createdAt: now,
        updatedAt: now,
      };
      store.insert("assets", asset, "asset.create");
      if (asset.method !== "gwg") toast.info("Anlage angelegt", "Nutzungsdauer und AfA unter „Anlagen“ prüfen.");
    } else {
      store.update("assets", existing.id, { costCents: cost, acquisitionDate: t.date, name: t.description || existing.name });
    }
  }
  return next;
}

export function TransactionDialog({ open, onClose, transaction, initialKind }: { open: boolean; onClose: () => void; transaction?: Transaction; initialKind?: Transaction["kind"] }) {
  const profile = useProfile();
  const [value, setValue] = useState<Transaction>(() => transaction ?? emptyTransaction(profile.id, initialKind));
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (open) setValue(transaction ?? emptyTransaction(profile.id, initialKind));
  }, [open, transaction, profile.id, initialKind]);
  const isNew = !transaction;
  const error = useMemo(() => validateTransaction(value), [value]);
  const save = () => {
    if (error) {
      toast.warning(error);
      return;
    }
    saveTransaction(value, { isNew });
    toast.success(isNew ? "Buchung gespeichert" : "Buchung aktualisiert");
    onClose();
  };
  return (
    <>
      <Modal open={open} onClose={onClose} title={isNew ? "Neue Buchung" : "Buchung bearbeiten"} size="lg" footer={
        <>
          {!isNew ? <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /> Löschen</Button> : null}
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button onClick={save}>{isNew ? "Speichern" : "Aktualisieren"}</Button>
        </>
      }>
        <div onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save(); }}>
          <TransactionForm value={value} onChange={setValue} />
        </div>
      </Modal>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title="Buchung löschen?" body="Die Buchung wird in den Papierkorb verschoben und nach 60 Tagen endgültig entfernt. Verknüpfte Die Rechnungsdateien bleiben erhalten." confirmLabel="Löschen" onConfirm={() => { requireStore().softDelete("transactions", value.id); toast.success("Buchung gelöscht"); onClose(); }} />
    </>
  );
}
