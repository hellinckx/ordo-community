import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ClipboardPaste, Copy, Download, FileText, MoreHorizontal, Package, Plus, ReceiptText, Save, Send, Trash2, Undo2, X } from "lucide-react";
import {
  allocateOfferNumber,
  can,
  duplicateOffer,
  ids,
  invoiceTotals,
  newOfferLine,
  nowIso,
  offerCompletion,
  offerDisplayStatus,
  offerLineFromProduct,
  offerLineNetCents,
  offerTotals,
  offerValidUntil,
  suggestOfferCompletionText,
  suggestOfferPaymentTerms,
  suggestOfferScopeText,
  todayIso,
  OFFER_PAYMENT_PRESETS,
  type Offer,
  type OfferLine,
  type OfferStatus,
  type OfferTextContext,
  type VatRate,
} from "@ordo/core";
import { useContactMap, useList, useProfile, useVault } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { useToasts, toast } from "@/state/toasts";
import { useMe } from "@/modules/registry";
import { Badge, Button, Card, Checkbox, ConfirmDialog, DateInput, EmptyState, Field, Input, Menu, MoneyInput, Select, Switch, Textarea } from "@/components/ui";
import { ContactPicker } from "@/components/pickers";
import { cls, fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { INVOICE_STATUS, OFFER_STATUS, UNITS, downloadOfferPdf, projectLabel, useOfferRights } from "./shared";
import { LabelRow, Notice, NumberInput, SumRow, TextAction, TextBlock } from "./parts";
import { PasteDialog } from "./PasteDialog";
import { ProductPickerDialog } from "./ProductPickerDialog";
import { OfferInvoiceDialog } from "./InvoiceDialog";

/** Fields the editor owns; status, invoices and timestamps are changed on purpose only. */
function editable(v: Offer): Partial<Offer> {
  const { id: _id, profileId: _p, status: _s, invoiceIds: _i, sentAt: _sa, decidedAt: _da, createdAt: _c, updatedAt: _u, deletedAt: _d, legacyRef: _l, ...rest } = v;
  return rest;
}

export function OfferEditorRoute({ id }: { id: string }) {
  const offers = useList("offers");
  const navigate = useNavigate();
  if (id === "neu") return <NewOffer />;
  const offer = offers.find((o) => o.id === id);
  if (!offer) {
    return (
      <EmptyState
        icon={<FileText className="h-8 w-8" />}
        title="Angebot nicht gefunden"
        body="Vielleicht wurde es gelöscht oder gehört zu einem anderen Profil."
        action={<Button variant="outline" onClick={() => navigate("/angebote")}>Zu den Angeboten</Button>}
      />
    );
  }
  return <OfferEditor key={offer.id} initial={offer} />;
}

function NewOffer() {
  const [params] = useSearchParams();
  const profile = useProfile();
  const vault = useVault();
  const offers = useList("offers");
  const projects = useList("projects");
  const contacts = useContactMap();
  const rights = useOfferRights();
  const navigate = useNavigate();
  const initial = useMemo(() => {
    const s = vault.settings.projects;
    const today = todayIso();
    const project = projects.find((p) => p.id === params.get("projekt"));
    const contact = project?.customerId ? contacts.get(project.customerId) : undefined;
    const down = Math.max(0, Math.min(100, s.downpaymentPct));
    const offer: Offer = {
      id: ids.offer(),
      profileId: profile.id,
      number: allocateOfferNumber(s, today, offers.map((o) => o.number)).number,
      customerId: project?.customerId,
      projectId: project?.id,
      date: today,
      validUntil: offerValidUntil(today, s.offerValidDays),
      status: "draft",
      subject: project?.name ?? "",
      contractTitle: s.contractTitle,
      introText: s.offerIntroText,
      scopeText: "",
      completionText: "",
      paymentTermsText: "",
      paymentDueDays: contact?.paymentDueDays ?? 14,
      downpaymentPct: down,
      finalPaymentPct: 100 - down,
      discountPct: 0,
      discountText: "",
      reverseCharge: contact?.defaultVatTreatment === "reverse_charge",
      internalNote: "",
      lines: [newOfferLine({ unit: "Std", unitNetCents: s.defaultHourlyRateCents || 0 })],
      invoiceIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const ctx: OfferTextContext = { offer, companyName: profile.company.name || profile.name, customerName: contact?.name, projectName: project?.name, projectStart: project?.startDate, projectEnd: project?.endDate };
    offer.scopeText = suggestOfferScopeText(s.offerScopeText, ctx);
    offer.completionText = suggestOfferCompletionText(s.offerCompletionText, ctx);
    return offer;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rights.canWrite) {
    return <EmptyState icon={<FileText className="h-8 w-8" />} title="Nur ansehen" body="Deine Rolle darf keine Angebote anlegen." action={<Button variant="outline" onClick={() => navigate("/angebote")}>Zu den Angeboten</Button>} />;
  }
  return <OfferEditor initial={initial} isNew />;
}

function OfferEditor({ initial, isNew }: { initial: Offer; isNew?: boolean }) {
  const profile = useProfile();
  const vault = useVault();
  const settings = vault.settings.projects;
  const offers = useList("offers");
  const projects = useList("projects");
  const products = useList("products");
  const invoices = useList("invoices");
  const contacts = useContactMap();
  const navigate = useNavigate();
  const location = useLocation();
  const rights = useOfferRights();
  const { role } = useMe();
  const [v, setV] = useState<Offer>(initial);
  const [dirty, setDirty] = useState(!!isNew);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const initialNumber = useRef(initial.number);
  const today = todayIso();
  const ro = !rights.canWrite;
  const ku = profile.vatRegime === "kleinunternehmer";

  const stored = offers.find((o) => o.id === v.id);
  const status: OfferStatus = stored?.status ?? v.status;
  const shown = offerDisplayStatus({ status, validUntil: v.validUntil }, today);
  const customer = v.customerId ? contacts.get(v.customerId) : undefined;
  const project = v.projectId ? projects.find((p) => p.id === v.projectId) : undefined;
  const totals = offerTotals(v, { kleinunternehmer: ku });
  const ctx: OfferTextContext = { offer: v, companyName: profile.company.name || profile.name, customerName: customer?.name, projectName: project?.name, projectStart: project?.startDate, projectEnd: project?.endDate };
  const completion = offerCompletion(project?.startDate, project?.endDate);
  const linkedInvoices = useMemo(
    () => invoices.filter((i) => i.offerId === v.id || (stored?.invoiceIds ?? []).includes(i.id)).sort((a, b) => a.issueDate.localeCompare(b.issueDate)),
    [invoices, v.id, stored?.invoiceIds],
  );
  const projectOptions = useMemo(
    () => projects.filter((p) => !v.customerId || !p.customerId || p.customerId === v.customerId || p.id === v.projectId).sort((a, b) => (b.number || b.name).localeCompare(a.number || a.name, "de")),
    [projects, v.customerId, v.projectId],
  );
  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);

  const set = (p: Partial<Offer>) => {
    setV((x) => ({ ...x, ...p }));
    setDirty(true);
  };
  const setLine = (i: number, p: Partial<OfferLine>) => set({ lines: v.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const moveLine = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= v.lines.length) return;
    const lines = [...v.lines];
    [lines[i], lines[j]] = [lines[j]!, lines[i]!];
    set({ lines });
  };
  const addLines = (lines: OfferLine[], replace = false) => {
    // an untouched empty first line is replaced instead of kept
    const keep = replace ? [] : v.lines.filter((l) => l.title.trim() || l.description.trim() || l.unitNetCents);
    set({ lines: [...keep, ...lines] });
  };

  const bumpOfferCounter = (next: number) =>
    requireStore().mutate((vault) => {
      vault.settings = { ...vault.settings, projects: { ...vault.settings.projects, nextOfferNumber: Math.max(vault.settings.projects.nextOfferNumber, next) } };
    });

  /** Saves the editor state (and an optional status patch). New offers get their final number here. */
  const persist = (patch: Partial<Offer> = {}, audit?: string): Offer => {
    const store = requireStore();
    const now = nowIso();
    if (isNew && !stored) {
      let number = v.number.trim();
      if (number === initialNumber.current || !number) {
        const a = allocateOfferNumber(settings, v.date, offers.map((o) => o.number));
        number = a.number;
        bumpOfferCounter(a.next);
      }
      const full: Offer = { ...v, ...patch, number, createdAt: now, updatedAt: now };
      store.insert("offers", full, "offer.create");
      setDirty(false);
      navigate(`/angebote/${full.id}`, { replace: true });
      return full;
    }
    const next = { ...v, ...patch };
    store.update("offers", v.id, (cur) => ({ ...cur, ...editable(v), ...patch, updatedAt: now }), audit ?? "offer.update");
    setV(next);
    setDirty(false);
    return next;
  };

  const save = () => {
    if (ro) return;
    persist();
    toast.success("Angebot gespeichert");
  };

  // ⌘S / Ctrl+S saves
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const changeStatus = (next: OfferStatus) => {
    const now = nowIso();
    const patch: Partial<Offer> = { status: next };
    if (next === "draft") Object.assign(patch, { sentAt: undefined, decidedAt: undefined });
    if (next === "sent") Object.assign(patch, { sentAt: stored?.sentAt ?? now, decidedAt: undefined });
    if (next === "accepted" || next === "declined") Object.assign(patch, { decidedAt: now, sentAt: stored?.sentAt ?? now });
    const saved = persist(patch, `offer.${next}`);
    const labels: Record<OfferStatus, string> = { draft: "Wieder Entwurf", sent: "Als versendet markiert", accepted: "Angebot angenommen", declined: "Als abgelehnt markiert", expired: "Als abgelaufen markiert" };
    if (next === "accepted" && project && !project.budgetCents && can(role, "projects", "write")) {
      const net = offerTotals(saved, { kleinunternehmer: ku }).netCents;
      useToasts.getState().push({
        kind: "success",
        title: labels.accepted,
        body: `Das Projekt hat noch kein Budget. ${fmtMoney(net)} netto übernehmen?`,
        timeout: 9000,
        action: { label: "Als Projektbudget übernehmen", onClick: () => requireStore().update("projects", project.id, { budgetCents: net }, "project.budget") },
      });
    } else toast.success(labels[next]);
  };

  const pdf = async () => {
    setBusyPdf(true);
    try {
      await downloadOfferPdf(v, { profile, customer, project, settings });
    } catch (e) {
      toast.error("PDF ging nicht", e instanceof Error ? e.message : String(e));
    } finally {
      setBusyPdf(false);
    }
  };

  const duplicate = () => {
    const a = allocateOfferNumber(settings, today, offers.map((o) => o.number));
    const copy = duplicateOffer({ ...v, status }, { id: ids.offer(), number: a.number, today, validDays: settings.offerValidDays, now: nowIso() });
    requireStore().insert("offers", copy, "offer.duplicate");
    bumpOfferCounter(a.next);
    toast.success(`Kopie ${copy.number} angelegt`);
    navigate(`/angebote/${copy.id}`);
  };

  const remove = () => {
    requireStore().softDelete("offers", v.id, "offer.delete");
    toast.success(`Angebot ${v.number} gelöscht`);
    navigate("/angebote", { replace: true });
  };

  const goBack = () => {
    if (location.key !== "default") navigate(-1);
    else navigate("/angebote");
  };

  const pickCustomer = (id: string | undefined) => {
    const c = id ? contacts.get(id) : undefined;
    const p: Partial<Offer> = { customerId: id };
    if (project?.customerId && project.customerId !== id) p.projectId = undefined;
    if (c?.paymentDueDays) p.paymentDueDays = c.paymentDueDays;
    if (c?.defaultVatTreatment) p.reverseCharge = c.defaultVatTreatment === "reverse_charge";
    set(p);
  };

  const pickProject = (id: string) => {
    const next = projects.find((p) => p.id === id);
    const p: Partial<Offer> = { projectId: next?.id };
    if (next?.customerId && !v.customerId) p.customerId = next.customerId;
    if (next && !v.subject.trim()) p.subject = next.name;
    // keep the completion text in step with the project dates as long as it is the untouched suggestion
    const oldSuggestion = suggestOfferCompletionText(settings.offerCompletionText, ctx);
    if (!v.completionText.trim() || v.completionText.trim() === oldSuggestion) {
      p.completionText = suggestOfferCompletionText(settings.offerCompletionText, { ...ctx, projectName: next?.name, projectStart: next?.startDate, projectEnd: next?.endDate });
    }
    set(p);
  };

  const setDate = (date: string) => {
    const p: Partial<Offer> = { date };
    if (!v.validUntil || v.validUntil === offerValidUntil(v.date, settings.offerValidDays)) p.validUntil = offerValidUntil(date, settings.offerValidDays);
    set(p);
  };

  const autoPayment = suggestOfferPaymentTerms(settings.offerPaymentTermsText, ctx);
  const sentHint = status === "sent" ? "Schon versendet – Änderungen gelten für das nächste PDF." : status === "accepted" ? "Schon angenommen – ändere nur, was wirklich mit dem Kunden vereinbart ist." : "";

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={() => (dirty && !ro ? setConfirmLeave(true) : goBack())} className="mb-2 inline-flex items-center gap-1 text-sm text-(--text-muted) hover:text-(--text)">
            <ArrowLeft className="h-4 w-4" /> Zurück
          </button>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em]">{isNew && !stored ? "Neues Angebot" : `Angebot ${v.number}`}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-(--text-muted)">
            <Badge tone={OFFER_STATUS[shown].tone}>{OFFER_STATUS[shown].label}</Badge>
            {customer ? <span className="truncate">{customer.name}</span> : null}
            <span className="tabular">{fmtMoney(totals.netCents)} netto</span>
            {dirty && !ro ? <span className="text-amber-700 dark:text-amber-300">· nicht gespeichert</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!ro && stored && status === "draft" ? (
            <Button variant="outline" onClick={() => changeStatus("sent")}><Send className="h-4 w-4" /> Versendet</Button>
          ) : null}
          {!ro && stored && (status === "sent" || status === "expired") ? (
            <Button variant="outline" onClick={() => changeStatus("accepted")}><Check className="h-4 w-4" /> Angenommen</Button>
          ) : null}
          {stored && status === "accepted" && rights.canInvoice ? (
            <Button variant="outline" onClick={() => { if (dirty) persist(); setInvoiceOpen(true); }}><ReceiptText className="h-4 w-4" /> Rechnung erstellen</Button>
          ) : null}
          <Button variant="outline" loading={busyPdf} onClick={pdf}>
            <Download className="h-4 w-4" /> PDF
          </Button>
          {!ro && stored ? (
            <Menu
              trigger={<Button variant="outline" size="icon" aria-label="Mehr"><MoreHorizontal className="h-4 w-4" /></Button>}
              items={[
                { label: "Duplizieren", icon: <Copy className="h-4 w-4" />, onClick: duplicate },
                ...(rights.canDelete ? [{ label: "Löschen", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setConfirmDelete(true) }] : []),
              ]}
            />
          ) : null}
          {!ro ? (
            <Button onClick={save} disabled={!dirty && !!stored}>
              <Save className="h-4 w-4" /> {stored ? "Speichern" : "Angebot anlegen"}
            </Button>
          ) : null}
        </div>
      </div>

      {ro ? <Notice>Du kannst dieses Angebot ansehen und als PDF speichern, aber nicht ändern.</Notice> : sentHint ? <Notice>{sentHint}</Notice> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        {/* main column */}
        <fieldset disabled={ro} className="m-0 min-w-0 space-y-4 border-0 p-0">
          <Card title="Kunde & Projekt">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Kunde">
                <ContactPicker kind="customer" value={v.customerId} onChange={pickCustomer} placeholder="Kunde wählen oder neu anlegen" />
              </Field>
              <Field label="Projekt" hint={v.customerId && !projectOptions.length ? "Für diesen Kunden gibt es noch kein Projekt." : undefined}>
                <Select value={v.projectId ?? ""} onChange={(e) => pickProject(e.target.value)}>
                  <option value="">Ohne Projekt</option>
                  {projectOptions.map((p) => (
                    <option key={p.id} value={p.id}>{projectLabel(p)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Betreff" className="sm:col-span-2">
                <Input value={v.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="z. B. Umbau Werkstatt, Simulation Halle 3" />
              </Field>
              <Field label="Vertragsbezeichnung" hint="Steht im Hinweis-Text, z. B. „Werkvertrag“.">
                <Input value={v.contractTitle} onChange={(e) => set({ contractTitle: e.target.value })} />
              </Field>
              <Field label="Angebotsnummer" hint={isNew && !stored ? "Wird beim Anlegen vergeben." : undefined}>
                <Input value={v.number} onChange={(e) => set({ number: e.target.value })} />
              </Field>
              <Field label="Datum">
                <DateInput value={v.date} onChange={(d) => setDate(d ?? today)} />
              </Field>
              <Field label="Gültig bis" hint={v.validUntil ? `${Math.max(0, Math.round((Date.parse(v.validUntil) - Date.parse(v.date)) / 86_400_000))} Tage ab Angebotsdatum` : undefined}>
                <DateInput value={v.validUntil} onChange={(d) => set({ validUntil: d })} />
              </Field>
            </div>
          </Card>

          <Card
            title="Positionen"
            action={
              <div className="flex flex-wrap justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => setPasteOpen(true)}>
                  <ClipboardPaste className="h-4 w-4" /> <span className="hidden sm:inline">Aus Excel einfügen</span><span className="sm:hidden">Excel</span>
                </Button>
                {activeProducts.length ? (
                  <Button variant="ghost" size="sm" onClick={() => setProductOpen(true)}>
                    <Package className="h-4 w-4" /> Produkt
                  </Button>
                ) : null}
              </div>
            }
          >
            <datalist id="offer-units">
              {UNITS.map((u) => <option key={u} value={u} />)}
            </datalist>
            {!v.lines.length ? (
              <EmptyState bare icon={<ClipboardPaste className="h-7 w-7" />} title="Noch keine Positionen" body="Tipp sie ein, nimm sie aus deinen Produkten oder füg eine Tabelle aus Excel ein." />
            ) : (
              <div className="space-y-3">
                {v.lines.map((l, i) => (
                  <PositionRow
                    key={l.id}
                    index={i}
                    line={l}
                    count={v.lines.length}
                    noVat={totals.noVat}
                    onChange={(p) => setLine(i, p)}
                    onMove={(d) => moveLine(i, d)}
                    onRemove={() => set({ lines: v.lines.filter((_, j) => j !== i) })}
                  />
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={() => set({ lines: [...v.lines, newOfferLine({ unit: v.lines[v.lines.length - 1]?.unit ?? "Std", vatRate: (v.lines[v.lines.length - 1]?.vatRate ?? 20) as VatRate })] })}>
                <Plus className="h-4 w-4" /> Position
              </Button>
              <span className="text-sm text-(--text-muted)">
                Netto <span className="font-semibold tabular text-(--text)">{fmtMoney(totals.netCents)}</span>
                {!totals.noVat ? <> · Brutto <span className="font-semibold tabular text-(--text)">{fmtMoney(totals.grossCents)}</span></> : null}
              </span>
            </div>
          </Card>

          <Card title="Texte im PDF">
            <div className="space-y-4">
              <TextBlock label="Einleitung" value={v.introText} onChange={(t) => set({ introText: t })} suggestion={() => settings.offerIntroText} rows={2} />
              <TextBlock label="Hinweis" value={v.scopeText} onChange={(t) => set({ scopeText: t })} suggestion={() => suggestOfferScopeText(settings.offerScopeText, ctx)} hint="Steht unter der Summe, z. B. Vertragsbezug und Leistungsumfang. Leer = kein Hinweis." />
              <TextBlock
                label="Fertigstellung"
                value={v.completionText}
                onChange={(t) => set({ completionText: t })}
                suggestion={() => suggestOfferCompletionText(settings.offerCompletionText, ctx)}
                hint={project?.startDate && project.endDate ? `Aus den Projektdaten: ${completion.range}, spätestens ${completion.deadlineLabel}.` : "Mit Start- und Enddatum im Projekt wird der Vorschlag genauer."}
              />
              <p className="text-xs text-(--text-muted)">Platzhalter wie {"{customerName}"} oder {"{projectName}"} werden im PDF ersetzt.</p>
            </div>
          </Card>
        </fieldset>

        {/* side column */}
        <div className="min-w-0 space-y-4">
          <Card title="Summe">
            <div className="space-y-1.5 text-sm">
              {totals.discountNetCents > 0 ? <SumRow label="Positionen netto" value={fmtMoney(totals.linesNetCents)} /> : null}
              {totals.discountNetCents > 0 ? <SumRow label={`Rabatt ${String(totals.discountPct).replace(".", ",")} %`} value={`− ${fmtMoney(totals.discountNetCents)}`} /> : null}
              <SumRow label="Netto" value={fmtMoney(totals.netCents)} />
              {totals.noVat ? (
                <SumRow label={ku ? "Ohne USt (Kleinunternehmer)" : "Ohne USt (Reverse Charge)"} value={fmtMoney(0)} />
              ) : (
                totals.byRate.filter((r) => r.rate > 0).map((r) => <SumRow key={r.rate} label={`USt ${r.rate} %`} value={fmtMoney(r.vatCents)} />)
              )}
              <SumRow strong label="Gesamt" value={fmtMoney(totals.grossCents)} />
              {totals.optionalNetCents > 0 ? <p className="pt-1 text-xs text-(--text-muted)">Optionale Positionen über {fmtMoney(totals.optionalNetCents)} netto sind nicht enthalten.</p> : null}
            </div>
          </Card>

          <Card title="Status">
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={OFFER_STATUS[shown].tone}>{OFFER_STATUS[shown].label}</Badge>
                {stored?.sentAt ? <span className="text-xs text-(--text-muted)">versendet {fmtDateTime(stored.sentAt)}</span> : null}
                {stored?.decidedAt ? <span className="text-xs text-(--text-muted)">· entschieden {fmtDate(stored.decidedAt.slice(0, 10))}</span> : null}
              </div>
              {!ro ? (
                <div className="flex flex-wrap gap-2">
                  {status === "draft" ? (
                    <Button size="sm" variant="outline" onClick={() => changeStatus("sent")}><Send className="h-4 w-4" /> Als versendet markieren</Button>
                  ) : null}
                  {status === "sent" || status === "expired" ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => changeStatus("accepted")}><Check className="h-4 w-4" /> Angenommen</Button>
                      <Button size="sm" variant="ghost" onClick={() => changeStatus("declined")}><X className="h-4 w-4" /> Abgelehnt</Button>
                      <Button size="sm" variant="ghost" onClick={() => changeStatus("draft")}><Undo2 className="h-4 w-4" /> Zurück auf Entwurf</Button>
                    </>
                  ) : null}
                  {status === "accepted" || status === "declined" ? (
                    <Button size="sm" variant="ghost" onClick={() => changeStatus("sent")}><Undo2 className="h-4 w-4" /> Wieder offen</Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>

          <Card title="Rechnungen">
            <div className="space-y-3 text-sm">
              {linkedInvoices.length ? (
                <ul className="-mx-2 divide-y divide-(--border)">
                  {linkedInvoices.map((inv) => (
                    <li key={inv.id}>
                      <button type="button" disabled={!rights.canSeeInvoices} onClick={() => navigate(`/rechnungen/${inv.id}`)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-(--surface-2) disabled:hover:bg-transparent">
                        <span className="font-medium tabular">{inv.number}</span>
                        <Badge tone={INVOICE_STATUS[inv.status]?.tone ?? "neutral"}>{INVOICE_STATUS[inv.status]?.label ?? inv.status}</Badge>
                        <span className="ml-auto tabular">{fmtMoney(invoiceTotals(inv).grossCents)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!rights.summaInstalled ? (
                <p className="text-(--text-muted)">Rechnungen schreibst du mit Summa – Buchhaltung. Du findest es unter Module.</p>
              ) : status === "accepted" ? (
                rights.canInvoice ? (
                  <Button className="w-full justify-center" onClick={() => { if (dirty) persist(); setInvoiceOpen(true); }}>
                    <ReceiptText className="h-4 w-4" /> Rechnung erstellen
                  </Button>
                ) : (
                  <p className="text-(--text-muted)">Rechnungen darf nur schreiben, wer in der Buchhaltung ändern darf.</p>
                )
              ) : (
                !linkedInvoices.length && <p className="text-(--text-muted)">Sobald das Angebot angenommen ist, machst du hier mit einem Klick die Rechnung – ganz, als Anzahlung oder als Schlussrechnung.</p>
              )}
            </div>
          </Card>

          <fieldset disabled={ro} className="m-0 min-w-0 space-y-4 border-0 p-0">
            <Card title="Rabatt & Steuer">
              <div className="space-y-3">
                <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                  <Field label="Rabatt">
                    <NumberInput value={v.discountPct} min={0} max={100} suffix="%" onChange={(n) => set({ discountPct: n })} />
                  </Field>
                  <Field label="Rabatt-Text">
                    <Input value={v.discountText} onChange={(e) => set({ discountText: e.target.value })} placeholder="z. B. Treuerabatt" />
                  </Field>
                </div>
                {ku ? (
                  <p className="text-xs text-(--text-muted)">Du bist Kleinunternehmer – das Angebot kommt ohne USt, mit dem passenden Hinweis im PDF.</p>
                ) : (
                  <Switch disabled={ro} checked={v.reverseCharge} onChange={(b) => set({ reverseCharge: b })} label="Reverse Charge" hint="Für Firmenkunden im EU-Ausland mit UID: keine USt, der Hinweis kommt aufs PDF." />
                )}
              </div>
            </Card>

            <Card title="Zahlung">
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Anzahlung">
                    <NumberInput value={v.downpaymentPct} min={0} max={100} suffix="%" onChange={(n) => set({ downpaymentPct: n, finalPaymentPct: Math.max(0, 100 - n) })} />
                  </Field>
                  <Field label="Schluss">
                    <NumberInput value={v.finalPaymentPct} min={0} max={100} suffix="%" onChange={(n) => set({ finalPaymentPct: n })} />
                  </Field>
                  <Field label="Ziel">
                    <NumberInput value={v.paymentDueDays} min={0} max={365} suffix="T." onChange={(n) => set({ paymentDueDays: Math.round(n) })} />
                  </Field>
                </div>
                <div>
                  <LabelRow
                    label="Zahlungsbedingungen"
                    action={
                      <Menu
                        trigger={<TextAction onClick={() => undefined}>Vorlage</TextAction>}
                        items={[
                          { label: "Automatisch (leer lassen)", onClick: () => set({ paymentTermsText: "" }) },
                          { label: "Vorschlag einsetzen", onClick: () => set({ paymentTermsText: autoPayment }) },
                          ...OFFER_PAYMENT_PRESETS.map((p) => ({ label: p.label, onClick: () => set({ paymentTermsText: p.text }) })),
                        ]}
                      />
                    }
                    hint="Leer lassen = automatisch aus Anzahlung, Schlusszahlung und Zahlungsziel."
                  />
                  <Textarea value={v.paymentTermsText} rows={3} placeholder={autoPayment} onChange={(e) => set({ paymentTermsText: e.target.value })} />
                </div>
              </div>
            </Card>

            <Card title="Interne Notiz">
              <Textarea value={v.internalNote} rows={3} onChange={(e) => set({ internalNote: e.target.value })} placeholder="Nur für dich und dein Team – steht nicht im PDF." />
            </Card>
          </fieldset>
        </div>
      </div>

      <PasteDialog open={pasteOpen} onClose={() => setPasteOpen(false)} hasLines={v.lines.some((l) => l.title.trim() || l.unitNetCents)} defaultUnit={v.lines[0]?.unit} onApply={(lines, replace) => addLines(lines, replace)} />
      <ProductPickerDialog open={productOpen} onClose={() => setProductOpen(false)} products={activeProducts} onPick={(p) => addLines([offerLineFromProduct(p)])} />
      {stored && invoiceOpen ? <OfferInvoiceDialog offer={stored} onClose={() => setInvoiceOpen(false)} /> : null}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title={`Angebot ${v.number} löschen?`}
        body={linkedInvoices.length ? "Die Rechnungen, die daraus entstanden sind, bleiben in Summa erhalten." : "Das Angebot landet im Papierkorb des Tresors und verschwindet aus allen Listen."}
        confirmLabel="Löschen"
        onConfirm={remove}
      />
      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Änderungen verwerfen?"
        body="Du hast noch nicht gespeichert."
        confirmLabel="Verwerfen"
        danger
        extra={<Button variant="outline" onClick={() => { persist(); setConfirmLeave(false); goBack(); }}>Speichern</Button>}
        onConfirm={goBack}
      />
    </div>
  );
}

function PositionRow({ index, line: l, count, noVat, onChange, onMove, onRemove }: { index: number; line: OfferLine; count: number; noVat: boolean; onChange: (p: Partial<OfferLine>) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void }) {
  const net = offerLineNetCents(l);
  return (
    <div className={cls("rounded-xl border border-(--border) p-3", l.optional && "border-dashed")}>
      <div className="flex items-start gap-2">
        <span className="mt-2.5 w-5 shrink-0 text-center text-xs font-medium text-(--text-muted) tabular">{index + 1}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <Input value={l.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Titel, z. B. Montage vor Ort" className="font-medium" aria-label="Titel" />
          <Textarea value={l.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="Beschreibung (optional)" rows={l.description.includes("\n") || l.description.length > 70 ? 3 : 1} className="min-h-10!" aria-label="Beschreibung" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[96px_104px_minmax(0,1fr)_96px]">
            <Field label="Menge">
              <NumberInput value={l.quantity} min={0} onChange={(n) => onChange({ quantity: n })} />
            </Field>
            <Field label="Einheit">
              <Input list="offer-units" value={l.unit} onChange={(e) => onChange({ unit: e.target.value })} />
            </Field>
            <Field label="Einzelpreis netto">
              <MoneyInput value={l.unitNetCents || null} onChange={(c) => onChange({ unitNetCents: c ?? 0 })} />
            </Field>
            <Field label="USt">
              <Select value={l.vatRate} onChange={(e) => onChange({ vatRate: Number(e.target.value) as VatRate })} title={noVat ? "Wird ohne USt gerechnet" : undefined}>
                <option value={20}>20 %</option>
                <option value={13}>13 %</option>
                <option value={10}>10 %</option>
                <option value={0}>0 %</option>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <Checkbox checked={l.optional} onChange={(b) => onChange({ optional: b })} label={<span className="font-normal">Optional – nicht in der Summe</span>} />
            <span className={cls("tabular font-semibold", l.optional && "text-(--text-muted)")}>{l.optional ? `(${fmtMoney(net)})` : fmtMoney(net)}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-0.5">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface-2) disabled:opacity-30" aria-label="Nach oben"><ArrowUp className="h-4 w-4" /></button>
          <button type="button" disabled={index === count - 1} onClick={() => onMove(1)} className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface-2) disabled:opacity-30" aria-label="Nach unten"><ArrowDown className="h-4 w-4" /></button>
          <button type="button" onClick={onRemove} className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface-2) hover:text-red-600" aria-label="Position löschen"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}
