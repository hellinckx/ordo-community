import { useEffect, useMemo, useState } from "react";
import { FileDropHint } from "@/components/FileDropHint";
import { useIntake } from "@/components/Intake";
import { useSearchParams } from "react-router";
import { Sparkles, CalendarClock, Check, Download, Filter, Pencil, Plus, Repeat, Search, Trash2, Paperclip } from "lucide-react";
import { INTERVAL_LABELS, ids, nowIso, todayIso, nextOccurrence, type RecurringRule, type Transaction, lineFromGross, type VatRate, missingReceipt } from "@ordo/core";
import { useCategoryMap, useContactMap, useList, useProfile } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { Badge, Button, Card, ConfirmDialog, DateInput, EmptyState, Field, Input, Modal, MoneyInput, PageHeader, Select, Switch, Tabs } from "@/components/ui";
import { TransactionDialog, PAYMENT_OPTIONS } from "@/components/TransactionForm";
import { CategoryPicker, ContactPicker } from "@/components/pickers";
import { CategoryIcon } from "@/lib/icons";
import { cls, fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "@/state/toasts";
import { useNavigate } from "react-router";

export default function Transactions() {
  const navigate = useNavigate();
  const intake = useIntake();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "list" | "recurring") ?? "list";
  return (
    <div className="space-y-4">
      <PageHeader title="Einnahmen & Ausgaben" subtitle="Jede Geldbewegung an einem Ort – automatisch aus deinen Rechnungen oder von Hand eingetragen." actions={<Button variant="outline" onClick={() => navigate("/belege")}><Sparkles className="h-4 w-4" /> Unsichere Rechnungen mit KI prüfen</Button>} />
      <FileDropHint onChoose={() => void intake.upload()}>Rechnungen ins Fenster ziehen oder auswählen – für eine neue Buchung. Zu einer bestehenden Buchung: Buchung öffnen und Datei anhängen.</FileDropHint>
      <Tabs value={tab} onChange={(t) => setParams(t === "list" ? {} : { tab: t })} tabs={[{ id: "list", label: "Alle" }, { id: "recurring", label: <span className="inline-flex items-center gap-1"><Repeat className="h-3.5 w-3.5" /> Regelmäßig (Abos, Miete …)</span> }]} className="w-fit" />
      {tab === "list" ? <TransactionList /> : <RecurringList />}
    </div>
  );
}

function TransactionList() {
  const txs = useList("transactions");
  const cats = useCategoryMap();
  const me = useProfile();
  const cons = useContactMap();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | Transaction["kind"]>("all");
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [month, setMonth] = useState<string>("all");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useSearchParams();
  // "+ Neu → Buchung von Hand" lands here with ?neu=1
  useEffect(() => {
    if (params.get("neu") !== "1") return;
    setCreating(true);
    const next = new URLSearchParams(params);
    next.delete("neu");
    setParams(next, { replace: true });
  }, [params, setParams]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const years = useMemo(() => [...new Set(txs.map((t) => t.date.slice(0, 4)))].sort().reverse(), [txs]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return txs
      .filter((t) => {
        if (kind !== "all" && t.kind !== kind) return false;
        if (year !== "all" && !t.date.startsWith(year)) return false;
        if (month !== "all" && t.date.slice(5, 7) !== month) return false;
        if (categoryId !== "all" && t.categoryId !== categoryId) return false;
        if (onlyUnreviewed && t.reviewed) return false;
        if (s) {
          const hay = [t.description, t.invoiceNumber, t.notes, t.tags.join(" "), cons.get(t.contactId ?? "")?.name ?? "", cats.get(t.categoryId ?? "")?.name ?? "", String(t.grossCents / 100)].join(" ").toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [txs, q, kind, year, month, categoryId, onlyUnreviewed, cons, cats]);
  const totals = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const t of filtered) {
      if (t.kind === "income") inc += t.grossCents;
      else if (t.kind === "expense" || t.kind === "private") exp += t.grossCents;
    }
    return { inc, exp };
  }, [filtered]);
  const allCats = useMemo(() => [...cats.values()].filter((c) => !c.deletedAt).sort((a, b) => a.name.localeCompare(b.name, "de")), [cats]);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulkApprove = () => {
    const store = requireStore();
    store.mutate((v) => { v.transactions = v.transactions.map((t) => (selected.has(t.id) ? { ...t, reviewed: true, updatedAt: nowIso() } : t)); });
    toast.success(`${selected.size} Buchungen als geprüft markiert`);
    setSelected(new Set());
  };
  const bulkDelete = () => {
    const store = requireStore();
    store.mutate((v) => { v.transactions = v.transactions.map((t) => (selected.has(t.id) ? { ...t, deletedAt: nowIso() } : t)); }, { audit: { action: "transaction.bulkDelete", entity: "transactions", details: `${selected.size}` } });
    toast.success(`${selected.size} Buchungen gelöscht`);
    setSelected(new Set());
  };

  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen (Text, Betrag, Nummer, Tag) …" className="pl-9" />
        </div>
        <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-36"><option value="all">Alle Arten</option><option value="expense">Ausgaben</option><option value="income">Einnahmen</option><option value="transfer">Umbuchungen</option><option value="private">Privat</option></Select>
        <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-28"><option value="all">Alle Jahre</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <Select value={month} onChange={(e) => setMonth(e.target.value)} className="w-32"><option value="all">Alle Monate</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{new Date(2000, i, 1).toLocaleDateString("de-AT", { month: "long" })}</option>)}</Select>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-48"><option value="all">Alle Kategorien</option>{allCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <button onClick={() => setOnlyUnreviewed((v) => !v)} className={cls("inline-flex h-10 items-center gap-1 rounded-xl border px-3 text-sm", onlyUnreviewed ? "border-amber-400 bg-amber-50 text-amber-800" : "border-(--border)")}><Filter className="h-4 w-4" /> Ungeprüft</button>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Neu</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-(--text-muted)">
        <span>{filtered.length} Buchungen</span>
        <span>Einnahmen <strong className="text-emerald-600">{fmtMoney(totals.inc)}</strong></span>
        <span>Ausgaben <strong>{fmtMoney(totals.exp)}</strong></span>
        <span>Saldo <strong className={totals.inc - totals.exp >= 0 ? "text-emerald-600" : "text-red-600"}>{fmtMoney(totals.inc - totals.exp)}</strong></span>
        {selected.size ? (
          <span className="ml-auto flex items-center gap-2">
            <Badge tone="brand">{selected.size} ausgewählt</Badge>
            <Button size="sm" variant="outline" onClick={bulkApprove}><Check className="h-4 w-4" /> Als geprüft</Button>
            <Button size="sm" variant="outline" className="text-red-600" onClick={() => setConfirmBulkDelete(true)}><Trash2 className="h-4 w-4" /> Löschen</Button>
          </span>
        ) : (
          <button className="ml-auto inline-flex items-center gap-1 hover:text-(--text)" onClick={() => navigate("/export")}><Download className="h-4 w-4" /> Exportieren</button>
        )}
      </div>
      {!filtered.length ? (
        <EmptyState title="Keine Buchungen gefunden" body="Passe die Filter an oder lege eine neue Buchung an." action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Buchung anlegen</Button>} />
      ) : (
        <>
        <ul className="surface divide-y divide-(--border) overflow-hidden md:hidden">
          {filtered.map((t) => {
            const c = t.categoryId ? cats.get(t.categoryId) : undefined;
            return (
              <li key={t.id}>
                <button type="button" onClick={() => setEditing(t)} className={cls("flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-(--surface-2)", !t.reviewed && "bg-amber-50/60 dark:bg-amber-900/10")}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: c?.color ?? "#94a3b8" }}><CategoryIcon name={c?.icon ?? "help-circle"} className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5"><span className="truncate text-sm font-medium">{t.description || c?.name || "–"}</span>{t.documentIds.length ? <Paperclip className="h-3 w-3 shrink-0 text-(--text-muted)" /> : null}{missingReceipt(t, me, c) ? <Badge tone="danger" className="shrink-0">ohne Rechnung</Badge> : null}</span>
                    <span className="block truncate text-xs text-(--text-muted)">{fmtDate(t.date)}{c ? ` · ${c.name}` : ""}{t.contactId ? ` · ${cons.get(t.contactId)?.name ?? ""}` : ""}</span>
                    {!t.reviewed || (t.dueDate && !t.paidDate) ? <span className="mt-0.5 flex gap-1">{!t.reviewed ? <Badge tone="warning">ungeprüft</Badge> : null}{t.dueDate && !t.paidDate ? <Badge tone="warning">offen</Badge> : null}</span> : null}
                  </span>
                  <span className={cls("shrink-0 tabular text-sm font-semibold", t.kind === "income" ? "text-emerald-600" : t.kind === "transfer" ? "text-(--text-muted)" : "")}>{t.kind === "income" ? "+" : t.kind === "transfer" ? "" : "−"}{fmtMoney(t.grossCents)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="surface hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
              <tr>
                <th className="w-8 px-3 py-2"><input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((t) => t.id)) : new Set())} /></th>
                <th className="px-3 py-2">Datum</th>
                <th className="px-3 py-2">Beschreibung</th>
                <th className="hidden px-3 py-2 md:table-cell">Kategorie</th>
                <th className="hidden px-3 py-2 xl:table-cell">Kontakt</th>
                <th className="hidden px-3 py-2 xl:table-cell">Zahlung</th>
                <th className="px-3 py-2 text-right">Betrag</th>
                <th className="w-10 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--border)">
              {filtered.map((t) => {
                const c = t.categoryId ? cats.get(t.categoryId) : undefined;
                return (
                  <tr key={t.id} className={cls("hover:bg-(--surface-2)", !t.reviewed && "bg-amber-50/60 dark:bg-amber-900/10")} onDoubleClick={() => setEditing(t)}>
                    <td className="px-3 py-2"><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></td>
                    <td className="whitespace-nowrap px-3 py-2 tabular">{fmtDate(t.date)}{t.dueDate && !t.paidDate ? <Badge tone="warning" className="ml-1">offen</Badge> : null}</td>
                    <td className="w-full max-w-0 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white md:hidden" style={{ background: c?.color ?? "#94a3b8" }}><CategoryIcon name={c?.icon ?? "help-circle"} className="h-3 w-3" /></span>
                        <span className="truncate font-medium">{t.description || c?.name || "–"}</span>
                        {t.documentIds.length ? <Paperclip className="h-3.5 w-3.5 text-(--text-muted)" /> : null}
                        {!t.reviewed ? <Badge tone="warning">ungeprüft</Badge> : null}
                        {missingReceipt(t, me, c) ? <Badge tone="danger">ohne Rechnung</Badge> : null}
                        {t.recurringRuleId ? <Repeat className="h-3.5 w-3.5 text-(--text-muted)" /> : null}
                      </div>
                      {t.invoiceNumber ? <div className="truncate text-xs text-(--text-muted)">Nr. {t.invoiceNumber}</div> : null}
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      {c ? <span className="flex max-w-[13rem] items-center gap-1.5" title={c.name}><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-white" style={{ background: c.color }}><CategoryIcon name={c.icon} className="h-3 w-3" /></span><span className="truncate">{c.name}</span></span> : <span className="text-(--text-muted)">–</span>}
                    </td>
                    <td className="hidden px-3 py-2 xl:table-cell"><span className="block max-w-[11rem] truncate">{t.contactId ? cons.get(t.contactId)?.name : ""}</span></td>
                    <td className="hidden whitespace-nowrap px-3 py-2 text-(--text-muted) xl:table-cell">{PAYMENT_OPTIONS.find((p) => p.value === t.paymentMethod)?.label.split(" ")[0]}</td>
                    <td className={cls("whitespace-nowrap px-3 py-2 text-right tabular font-semibold", t.kind === "income" ? "text-emerald-600" : t.kind === "transfer" ? "text-(--text-muted)" : "")}>{t.kind === "income" ? "+" : t.kind === "transfer" ? "" : "−"}{fmtMoney(t.grossCents)}</td>
                    <td className="px-2 py-2"><button onClick={() => setEditing(t)} className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface) hover:text-(--text)"><Pencil className="h-4 w-4" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
      <TransactionDialog open={!!editing} onClose={() => setEditing(null)} transaction={editing ?? undefined} />
      <TransactionDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog open={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} danger title={`${selected.size} Buchungen löschen?`} confirmLabel="Löschen" onConfirm={bulkDelete} />
    </div>
  );
}

function RecurringList() {
  const rules = useList("recurringRules");
  const profile = useProfile();
  const cats = useCategoryMap();
  const [editing, setEditing] = useState<RecurringRule | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Dauerauftrag</Button></div>
      {!rules.length ? (
        <EmptyState icon={<Repeat className="h-8 w-8" />} title="Keine wiederkehrenden Buchungen" body={profile.mode === "business" ? "Miete, Versicherung, SVS, Software-Abos oder dein regelmäßiges Honorar – einmal anlegen, Ordo bucht automatisch." : "Gehalt, Miete, Strom, Abos – einmal anlegen, Ordo bucht jeden Monat automatisch."} action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Anlegen</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rules.map((r) => {
            const c = r.template.categoryId ? cats.get(r.template.categoryId) : undefined;
            const next = nextOccurrence(r);
            return (
              <Card key={r.id} className={cls(!r.active && "opacity-60")}>
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: c?.color ?? "#94a3b8" }}><CategoryIcon name={c?.icon ?? "help-circle"} className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="truncate font-medium">{r.name}</span>{!r.active ? <Badge>pausiert</Badge> : null}</div>
                    <div className="text-xs text-(--text-muted)">{INTERVAL_LABELS[r.interval]} am {r.dayOfMonth}. · {c?.name ?? "–"} · {r.autoBook ? "automatisch gebucht" : "mit Erinnerung"}</div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-(--text-muted)"><CalendarClock className="h-3.5 w-3.5" /> Nächste: {next ? fmtDate(next) : "–"}</div>
                  </div>
                  <div className={cls("tabular font-semibold", r.template.kind === "income" ? "text-emerald-600" : "")}>{r.template.kind === "income" ? "+" : "−"}{fmtMoney(r.template.grossCents)}</div>
                  <button className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface-2)" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <RecurringDialog open={creating || !!editing} onClose={() => { setCreating(false); setEditing(null); }} rule={editing ?? undefined} />
    </div>
  );
}

function RecurringDialog({ open, onClose, rule }: { open: boolean; onClose: () => void; rule?: RecurringRule }) {
  const profile = useProfile();
  const cats = useCategoryMap();
  const blank = (): RecurringRule => ({ id: ids.recurring(), profileId: profile.id, name: "", active: true, interval: "monthly", dayOfMonth: 1, startDate: todayIso().slice(0, 8) + "01", autoBook: true, template: { kind: "expense", description: "", vatLines: [], grossCents: 0, vatTreatment: profile.vatRegime === "kleinunternehmer" ? "kleinunternehmer" : "standard", vatDeductiblePct: 100, paymentMethod: "bank", tags: [] }, createdAt: nowIso(), updatedAt: nowIso() });
  const [v, setV] = useState<RecurringRule>(rule ?? blank());
  const [confirmDelete, setConfirmDelete] = useState(false);
  useMemo(() => { if (open) setV(rule ?? blank()); }, [open, rule]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = v.template;
  const setT = (patch: Partial<RecurringRule["template"]>) => setV({ ...v, template: { ...t, ...patch } });
  const rate: VatRate = (t.vatLines[0]?.rate ?? (t.categoryId ? cats.get(t.categoryId)?.defaultVatRate : undefined) ?? 20) as VatRate;
  const save = () => {
    if (!v.name.trim() || !t.grossCents || (!t.categoryId && t.kind !== "transfer")) {
      toast.warning("Name, Betrag und Kategorie sind nötig.");
      return;
    }
    const store = requireStore();
    const next = { ...v, template: { ...t, description: t.description || v.name }, updatedAt: nowIso() };
    if (rule) store.update("recurringRules", rule.id, next);
    else store.insert("recurringRules", next, "recurring.create");
    toast.success("Dauerauftrag gespeichert", "Fällige Buchungen werden beim nächsten Start automatisch angelegt.");
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={rule ? "Dauerauftrag bearbeiten" : "Neuer Dauerauftrag"} size="lg" footer={<>{rule ? <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button> : null}<Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={save}>Speichern</Button></>}>
      <div className="space-y-4">
        <div className="flex gap-1 rounded-xl bg-(--surface-2) p-1">
          {(["expense", "income"] as const).map((k) => <button key={k} onClick={() => setT({ kind: k, categoryId: undefined })} className={cls("flex-1 rounded-lg py-1.5 text-sm font-medium", t.kind === k ? "bg-(--surface) shadow-sm" : "text-(--text-muted)")}>{k === "expense" ? "Ausgabe" : "Einnahme"}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="z. B. Büromiete" /></Field>
          <Field label="Betrag (brutto)" required><MoneyInput value={t.grossCents || null} onChange={(c) => setT({ grossCents: c ?? 0, vatLines: c ? [lineFromGross(c, rate)] : [] })} /></Field>
          <Field label="Kategorie" required><CategoryPicker kind={t.kind === "income" ? "income" : "expense"} value={t.categoryId} onChange={(id, c) => setT({ categoryId: id, vatDeductiblePct: c?.defaultDeductiblePct ?? 100, vatLines: t.grossCents ? [lineFromGross(t.grossCents, c?.defaultVatRate ?? 20)] : [] })} /></Field>
          <Field label="Kontakt"><ContactPicker value={t.contactId} onChange={(id) => setT({ contactId: id })} kind={t.kind === "income" ? "customer" : "vendor"} /></Field>
          <Field label="Intervall"><Select value={v.interval} onChange={(e) => setV({ ...v, interval: e.target.value as RecurringRule["interval"] })}>{Object.entries(INTERVAL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Tag im Monat"><Input type="number" min={1} max={31} value={v.dayOfMonth} onChange={(e) => setV({ ...v, dayOfMonth: Math.max(1, Math.min(31, Number(e.target.value) || 1)) })} /></Field>
          <Field label="Ab"><DateInput value={v.startDate} onChange={(d) => setV({ ...v, startDate: d ?? todayIso() })} /></Field>
          <Field label="Bis (optional)"><DateInput value={v.endDate} onChange={(d) => setV({ ...v, endDate: d })} /></Field>
          {profile.mode === "business" ? <Field label="Steuersatz"><Select value={rate} onChange={(e) => setT({ vatLines: t.grossCents ? [lineFromGross(t.grossCents, Number(e.target.value) as VatRate)] : [] })}><option value={20}>20 %</option><option value={10}>10 %</option><option value={13}>13 %</option><option value={0}>0 %</option></Select></Field> : null}
          <Field label="Zahlungsart"><Select value={t.paymentMethod} onChange={(e) => setT({ paymentMethod: e.target.value as RecurringRule["template"]["paymentMethod"] })}>{PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
        </div>
        <Switch checked={v.autoBook} onChange={(b) => setV({ ...v, autoBook: b })} label="Automatisch buchen" hint="Sonst erinnert Ordo dich und du bestätigst jede Buchung." />
        <Switch checked={v.active} onChange={(b) => setV({ ...v, active: b })} label="Aktiv" />
      </div>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title="Dauerauftrag löschen?" confirmLabel="Löschen" onConfirm={() => { requireStore().softDelete("recurringRules", v.id); onClose(); }} />
    </Modal>
  );
}
