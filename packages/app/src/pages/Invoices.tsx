import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Check, Copy, Download, FileCode, FileText, Mail, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { ids, nowIso, todayIso, invoiceTotals, invoicePdf, buildEbInterface, lineFromNet, normalizeVatLines, isStockTracked, type Invoice, type InvoiceLine, type Product, type Transaction, type VatRate, type VatTreatment } from "@ordo/core";
import { useContactMap, useList, useProfile, useVault } from "@/state/hooks";
import { requirePlatform, requireStore } from "@/state/session";
import { Badge, Button, ConfirmDialog, DateInput, EmptyState, Field, Input, Modal, MoneyInput, PageHeader, Select, Textarea } from "@/components/ui";
import { ContactPicker } from "@/components/pickers";
import { fmtDate, fmtMoney, cls } from "@/lib/format";
import { toast } from "@/state/toasts";
import { invoiceModeOf, INVOICE_MODE_INFO } from "@/lib/invoiceMode";
import { InvoiceModeChooser } from "@/components/InvoiceModeChooser";
import { ImportedInvoices } from "@/components/ImportedInvoices";
import { FolderLinks } from "@/components/FolderLinks";
import { Card } from "@/components/ui";
import { useIsInstalled, useMe } from "@/modules/registry";
import { canMailInvoices } from "@/services/email/send";
import { InvoiceMailDialog } from "@/modules/post/InvoiceMailDialog";
import { fmtQty, ProductPicker, useStockLevels } from "@/modules/produkte/shared";
import { bookInvoiceStock, reverseInvoiceStock } from "@/services/invoiceStock";

const STATUS: Record<Invoice["status"], { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Entwurf", tone: "neutral" },
  sent: { label: "Gesendet", tone: "info" },
  paid: { label: "Bezahlt", tone: "success" },
  overdue: { label: "Überfällig", tone: "danger" },
  cancelled: { label: "Storniert", tone: "neutral" },
};

const LINE_GRID = "grid-cols-[1fr_70px_70px_110px_80px_110px_32px]";
const LINE_GRID_ARTICLE = "grid-cols-[150px_1fr_70px_70px_110px_80px_110px_32px]";

function nextNumber(pattern: string, n: number, date: string): string {
  return pattern.replace("{YYYY}", date.slice(0, 4)).replace("{YY}", date.slice(2, 4)).replace("{MM}", date.slice(5, 7)).replace(/\{N+\}/, (m) => String(n).padStart(m.length - 2, "0"));
}

export default function Invoices() {
  const invoices = useList("invoices");
  const profile = useProfile();
  const contacts = useContactMap();
  const navigate = useNavigate();
  const { role } = useMe();
  const mailInstalled = useIsInstalled("post") && canMailInvoices(role);
  const [mailing, setMailing] = useState<{ invoice: Invoice; reminder: boolean } | null>(null);
  const { id } = useParams();
  const [confirmDelete, setConfirmDelete] = useState<Invoice | null>(null);
  const stockMoves = useList("stockMoves");
  const produkte = useIsInstalled("produkte");
  const deleteMovesStock = !!confirmDelete && produkte && stockMoves.some((m) => m.invoiceId === confirmDelete.id);
  const editing = id === "neu" ? "new" : id ? invoices.find((i) => i.id === id) : undefined;
  const sorted = useMemo(() => [...invoices].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)), [invoices]);
  const open = sorted.filter((i) => i.status === "sent" || i.status === "overdue").reduce((s, i) => s + invoiceTotals(i).grossCents - i.paidCents, 0);

  const markPaid = (inv: Invoice) => {
    const store = requireStore();
    const total = invoiceTotals(inv).grossCents;
    store.update("invoices", inv.id, { status: "paid", paidDate: todayIso(), paidCents: total });
    if (inv.transactionId) store.update("transactions", inv.transactionId, { paidDate: todayIso(), reviewed: true });
    toast.success(`Rechnung ${inv.number} als bezahlt markiert`);
  };

  const mode = invoiceModeOf(profile, invoices.length);
  if (!mode) {
    return (
      <div className="space-y-4">
        <PageHeader title="Ausgehende Rechnungen" subtitle="Rechnungen, die du deinen Kunden stellst. Wie entstehen sie bei dir? Änderbar unter Einstellungen → Rechnungen." />
        <InvoiceModeChooser profile={profile} value={undefined} />
      </div>
    );
  }
  if (mode === "external") {
    return (
      <div className="space-y-4">
        <PageHeader title="Ausgehende Rechnungen" subtitle="Rechnungen, die du deinen Kunden stellst – in deinem eigenen Programm erstellt, von Summa eingelesen und als Einnahme gebucht." actions={<><FolderLinks kind="outgoing" /><Button variant="ghost" onClick={() => navigate("/einstellungen/rechnungen")}>Rechnungen hier erstellen lassen</Button></>} />
        <ImportedInvoices />
        {sorted.length ? <Card title="Früher in Summa erstellte Rechnungen"><p className="text-sm text-(--text-muted)">{sorted.length} Rechnung(en) – sichtbar, wenn du auf „In Summa schreiben“ umstellst.</p></Card> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Ausgehende Rechnungen" subtitle={open ? `Rechnungen an deine Kunden. Noch offen: ${fmtMoney(open)}` : "Rechnungen an deine Kunden – mit fortlaufender Nummer und allen Pflichtangaben."} actions={<><Button variant="ghost" size="sm" onClick={() => navigate("/einstellungen/rechnungen")}>Nummern & Layout</Button><Button onClick={() => navigate("/rechnungen/neu")}><Plus className="h-4 w-4" /> Neue Rechnung</Button></>} />
      {!profile.company.name || !profile.company.street ? <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">Für vollständige Rechnungen fehlen noch Firmendaten (Adresse, UID, IBAN) – im Menü rechts oben unter „Firmendaten“.</div> : null}
      {!sorted.length ? (
        <EmptyState icon={<FileText className="h-8 w-8" />} title="Noch keine Rechnungen" body="Rechnung schreiben, als PDF speichern – Summa bucht die Einnahme und merkt sich, ob sie schon bezahlt ist." action={<Button onClick={() => navigate("/rechnungen/neu")}><Plus className="h-4 w-4" /> Erste Rechnung</Button>} />
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)"><tr><th className="px-3 py-2">Nummer</th><th className="px-3 py-2">Kunde</th><th className="px-3 py-2">Datum</th><th className="px-3 py-2">Fällig</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Betrag</th><th className="w-28 px-3 py-2"></th></tr></thead>
            <tbody className="divide-y divide-(--border)">
              {sorted.map((inv) => (
                <tr key={inv.id} className="hover:bg-(--surface-2)">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{inv.number}{inv.kind === "credit_note" ? <Badge className="ml-2">Gutschrift</Badge> : inv.kind === "offer" ? <Badge className="ml-2">Angebot</Badge> : null}</td>
                  <td className="w-full max-w-0 px-3 py-2"><span className="block truncate">{inv.customerSnapshot.name || (inv.customerId ? contacts.get(inv.customerId)?.name : "") || "–"}</span></td>
                  <td className="whitespace-nowrap px-3 py-2 tabular">{fmtDate(inv.issueDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular">{fmtDate(inv.dueDate)}</td>
                  <td className="px-3 py-2"><Badge tone={STATUS[inv.status].tone}>{STATUS[inv.status].label}</Badge></td>
                  <td className="px-3 py-2 text-right tabular font-semibold">{fmtMoney(invoiceTotals(inv).grossCents)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    {inv.status === "sent" || inv.status === "overdue" ? <button title="Als bezahlt markieren" className="rounded-md p-1.5 text-emerald-600 hover:bg-(--surface)" onClick={() => markPaid(inv)}><Check className="h-4 w-4" /></button> : null}
                    {mailInstalled && inv.kind !== "offer" && inv.status !== "draft" && inv.status !== "cancelled" ? <button title={inv.emailedAt ? `Per E-Mail senden – zuletzt an ${inv.emailedTo}` : "Per E-Mail senden"} aria-label="Per E-Mail senden" className={cls("rounded-md p-1.5 hover:bg-(--surface)", inv.emailedAt ? "text-brand-700 dark:text-brand-400" : "text-(--text-muted)")} onClick={() => setMailing({ invoice: inv, reminder: inv.status === "overdue" || (inv.status === "sent" && inv.dueDate < todayIso()) })}><Mail className="h-4 w-4" /></button> : null}
                    <button aria-label="Bearbeiten" className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface)" onClick={() => navigate(`/rechnungen/${inv.id}`)}><Pencil className="h-4 w-4" /></button>
                    <button aria-label="Löschen" className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface)" onClick={() => setConfirmDelete(inv)}><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <InvoiceEditor invoice={editing === "new" ? undefined : editing} onClose={() => navigate("/rechnungen")} /> : null}
      <InvoiceMailDialog invoice={mailing?.invoice ?? null} reminder={mailing?.reminder} onClose={() => setMailing(null)} />
      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} danger title={`Rechnung ${confirmDelete?.number} löschen?`} body={`Bei bereits versendeten Rechnungen ist eine Stornierung (Gutschrift) buchhalterisch korrekter.${deleteMovesStock ? " Die Artikel daraus bucht Ordo wieder zurück ins Lager." : ""}`} confirmLabel="Löschen" onConfirm={() => { const store = requireStore(); const inv = confirmDelete!; if (deleteMovesStock) reverseInvoiceStock(inv, "gelöscht"); store.softDelete("invoices", inv.id); if (inv.transactionId) store.softDelete("transactions", inv.transactionId); }} />
    </div>
  );
}

function InvoiceEditor({ invoice, onClose }: { invoice?: Invoice; onClose: () => void }) {
  const profile = useProfile();
  const { role } = useMe();
  const mailInstalled = useIsInstalled("post") && canMailInvoices(role);
  const [mailing, setMailing] = useState(false);
  const produkte = useIsInstalled("produkte");
  const levels = useStockLevels();
  const stockMoves = useList("stockMoves");
  const products = useList("products");
  const vault = useVault();
  const contacts = useContactMap();
  const isKu = profile.vatRegime === "kleinunternehmer";
  const blank = (): Invoice => {
    const issue = todayIso();
    const due = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
    return {
      id: ids.invoice(), profileId: profile.id, number: nextNumber(profile.company.invoiceNumberPattern, profile.company.nextInvoiceNumber, issue), kind: "invoice", customerSnapshot: { name: "", street: "", zip: "", city: "", country: "AT", uid: "", email: "" },
      issueDate: issue, dueDate: due, servicePeriod: "", lines: [{ id: ids.invoice(), description: "", quantity: 1, unit: "Stk", unitNetCents: 0, vatRate: isKu ? 0 : 20, discountPct: 0 }], introText: "", footerText: profile.company.invoiceFooter, status: "draft", paidCents: 0, vatTreatment: isKu ? "kleinunternehmer" : "standard", reference: "", createdAt: nowIso(), updatedAt: nowIso(),
    };
  };
  const [v, setV] = useState<Invoice>(invoice ?? blank());
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(invoice ?? blank()), [invoice?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = invoiceTotals(v);
  const set = (p: Partial<Invoice>) => setV({ ...v, ...p });
  const setLine = (i: number, p: Partial<InvoiceLine>) => set({ lines: v.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const locked = v.status !== "draft";
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const movedStock = useMemo(() => (invoice ? stockMoves.filter((m) => m.invoiceId === invoice.id) : []), [stockMoves, invoice]);
  /** Article picked on a line: takes over its text, unit, price and VAT. */
  const pickProduct = (i: number, p: Product | undefined) => {
    if (!p) return setLine(i, { productId: undefined });
    const text = p.description.trim();
    setLine(i, { productId: p.id, description: text.toLowerCase().startsWith(p.name.toLowerCase()) ? text : [p.name, text].filter(Boolean).join("\n"), unit: p.unit, unitNetCents: p.priceCents, vatRate: v.vatTreatment === "standard" ? p.vatRate : 0 });
  };

  const pickCustomer = (id: string | undefined) => {
    const c = id ? contacts.get(id) : undefined;
    set({ customerId: id, customerSnapshot: c ? { name: c.name, street: c.street, zip: c.zip, city: c.city, country: c.country, uid: c.uid, email: c.email } : v.customerSnapshot });
  };

  const persist = (next: Invoice) => {
    const store = requireStore();
    if (invoice) store.update("invoices", invoice.id, { ...next, updatedAt: nowIso() });
    else {
      store.insert("invoices", next, "invoice.create");
      store.update("profiles", profile.id, (p) => ({ ...p, company: { ...p.company, nextInvoiceNumber: p.company.nextInvoiceNumber + 1 } }));
    }
  };

  const saveDraft = () => {
    persist(v);
    toast.success("Rechnung gespeichert");
    onClose();
  };

  const makePdf = async () => {
    setBusy(true);
    try {
      const store = requireStore();
      const logo = profile.company.logoAttachmentId ? await store.getAttachmentBytes(profile.company.logoAttachmentId) : null;
      return await invoicePdf(v, profile, logo ?? undefined);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    const bytes = await makePdf();
    await requirePlatform().saveFile(`${v.number}.pdf`, bytes, "application/pdf");
  };

  /** ebInterface 6.1 – for the Unternehmensserviceportal (e-Rechnung an den Bund) and firms that want XML. */
  const downloadEInvoice = async () => {
    const { xml, warnings } = buildEbInterface(v, profile);
    if (warnings.length) toast.warning("E-Rechnung gespeichert – bitte prüfen", warnings.slice(0, 2).join(" "));
    await requirePlatform().saveFile(`${v.number}.xml`, new TextEncoder().encode(xml), "application/xml");
  };

  const send = async () => {
    if (!v.customerSnapshot.name || !v.lines.some((l) => l.description && l.unitNetCents)) {
      toast.warning("Kunde und mindestens eine Position mit Betrag sind nötig.");
      return;
    }
    const store = requireStore();
    const bytes = await makePdf();
    const att = await store.putAttachment(profile.id, bytes, { name: `${v.number}.pdf`, mime: "application/pdf" });
    const docId = ids.document();
    const now = nowIso();
    const vatLines = normalizeVatLines(totals.byRate.map((r) => lineFromNet(r.netCents, r.rate as VatRate)));
    const tx: Transaction = {
      id: ids.transaction(), profileId: profile.id, kind: "income", date: v.issueDate, description: `${v.kind === "credit_note" ? "Gutschrift" : "Rechnung"} ${v.number} – ${v.customerSnapshot.name}`, contactId: v.customerId, categoryId: isKu ? "cat_b_in_ku" : v.vatTreatment === "reverse_charge" ? "cat_b_in_rc" : v.vatTreatment === "ig_lieferung" ? "cat_b_in_ig" : v.vatTreatment === "export" ? "cat_b_in_export" : "cat_b_in_20",
      vatLines, grossCents: v.kind === "credit_note" ? -totals.grossCents : totals.grossCents, currency: "EUR", vatTreatment: v.vatTreatment as VatTreatment, vatDeductiblePct: 100, paymentMethod: "bank", dueDate: v.dueDate, invoiceNumber: v.number, reference: "", documentIds: [docId], invoiceId: v.id, tags: ["rechnung"], notes: "", origin: "invoice", reviewed: true, createdAt: now, updatedAt: now,
    };
    store.insert("transactions", tx, "invoice.send");
    store.insert("documents", { id: docId, profileId: profile.id, attachmentId: att.id, originalName: `${v.number}.pdf`, mime: "application/pdf", sha256: att.sha256, source: "invoice", importedAt: now, status: "approved", transactionId: tx.id, invoiceId: v.id, createdAt: now, updatedAt: now }, "document.invoice");
    const next: Invoice = { ...v, status: "sent", transactionId: tx.id, pdfAttachmentId: att.id };
    persist(next);
    const moved = produkte ? bookInvoiceStock(next) : 0;
    await requirePlatform().saveFile(`${v.number}.pdf`, bytes, "application/pdf");
    toast.success(`Rechnung ${v.number} erstellt`, `Einnahme-Buchung (offen) angelegt, PDF gespeichert.${moved ? ` ${moved === 1 ? "Ein Artikel" : `${moved} Artikel`} ${v.kind === "credit_note" ? "zurück ins Lager" : "aus dem Lager"} gebucht.` : ""}`);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={invoice ? `Rechnung ${v.number}` : "Neue Rechnung"} size="xl" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Schließen</Button>
        {locked ? <Button variant="outline" loading={busy} onClick={download}><Download className="h-4 w-4" /> PDF</Button> : null}
        {locked && mailInstalled && v.kind !== "offer" ? <Button variant="outline" onClick={() => setMailing(true)} title={v.emailedAt ? `Zuletzt an ${v.emailedTo} geschickt` : undefined}><Mail className="h-4 w-4" /> Per E-Mail</Button> : null}
        {locked ? <Button variant="outline" onClick={() => void downloadEInvoice()} title="Als E-Rechnung im Format ebInterface 6.1 speichern – z. B. für das Unternehmensserviceportal (Rechnungen an den Bund)"><FileCode className="h-4 w-4" /> E-Rechnung</Button> : null}
        {!locked ? <Button variant="outline" onClick={saveDraft}>Entwurf speichern</Button> : <Button variant="outline" onClick={() => { persist(v); onClose(); }}>Speichern</Button>}
        {!locked ? <Button loading={busy} onClick={send}><Send className="h-4 w-4" /> Fertigstellen & PDF</Button> : null}
      </>
    }>
      <div className="space-y-4">
        {locked ? <div className="rounded-lg bg-(--surface-2) px-3 py-2 text-xs text-(--text-muted)">Diese Rechnung wurde bereits fertiggestellt. Positionen sind gesperrt (fortlaufende Nummerierung, § 11 UStG). Für Korrekturen eine Gutschrift anlegen.</div> : null}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Art"><Select value={v.kind} disabled={locked} onChange={(e) => set({ kind: e.target.value as Invoice["kind"] })}><option value="invoice">Rechnung</option><option value="credit_note">Gutschrift</option><option value="offer">Angebot</option></Select></Field>
          <Field label="Nummer"><Input value={v.number} disabled={locked} onChange={(e) => set({ number: e.target.value })} /></Field>
          <Field label="Datum"><DateInput value={v.issueDate} disabled={locked} onChange={(d) => set({ issueDate: d ?? todayIso() })} /></Field>
          <Field label="Fällig"><DateInput value={v.dueDate} onChange={(d) => set({ dueDate: d ?? v.dueDate })} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kunde"><ContactPicker kind="customer" value={v.customerId} onChange={pickCustomer} placeholder="Kunde wählen oder neu anlegen" /></Field>
          <Field label="Leistungszeitraum"><Input value={v.servicePeriod} disabled={locked} onChange={(e) => set({ servicePeriod: e.target.value })} placeholder="z. B. Jänner 2026" /></Field>
        </div>
        <div className="grid gap-3 rounded-xl border border-(--border) p-3 sm:grid-cols-2">
          <Field label="Rechnungsempfänger" className="sm:col-span-2"><Input value={v.customerSnapshot.name} disabled={locked} onChange={(e) => set({ customerSnapshot: { ...v.customerSnapshot, name: e.target.value } })} /></Field>
          <Field label="Straße"><Input value={v.customerSnapshot.street} disabled={locked} onChange={(e) => set({ customerSnapshot: { ...v.customerSnapshot, street: e.target.value } })} /></Field>
          <div className="grid grid-cols-[90px_1fr] gap-2">
            <Field label="PLZ"><Input value={v.customerSnapshot.zip} disabled={locked} onChange={(e) => set({ customerSnapshot: { ...v.customerSnapshot, zip: e.target.value } })} /></Field>
            <Field label="Ort"><Input value={v.customerSnapshot.city} disabled={locked} onChange={(e) => set({ customerSnapshot: { ...v.customerSnapshot, city: e.target.value } })} /></Field>
          </div>
          <Field label="UID des Kunden" hint="Pflicht bei Rechnungen über 10.000 € und bei Reverse Charge"><Input value={v.customerSnapshot.uid} disabled={locked} onChange={(e) => set({ customerSnapshot: { ...v.customerSnapshot, uid: e.target.value.toUpperCase() } })} /></Field>
          <Field label="USt-Behandlung"><Select value={v.vatTreatment} disabled={locked} onChange={(e) => { const t = e.target.value as VatTreatment; set({ vatTreatment: t, lines: v.lines.map((l) => ({ ...l, vatRate: t === "standard" ? (l.vatRate || 20) : 0 })) }); }}>
            {!isKu ? <option value="standard">Inland mit USt</option> : null}
            {isKu ? <option value="kleinunternehmer">Kleinunternehmer (§ 6 Abs. 1 Z 27)</option> : null}
            <option value="reverse_charge">Reverse Charge (EU-B2B / Ausland)</option>
            <option value="ig_lieferung">Innergemeinschaftliche Lieferung</option>
            <option value="export">Ausfuhr (Drittland)</option>
          </Select></Field>
        </div>
        <div>
          <div className={cls("mb-1 grid gap-2 px-1 text-[11px] font-medium text-(--text-muted)", produkte ? LINE_GRID_ARTICLE : LINE_GRID)}>{produkte ? <span>Artikel</span> : null}<span>Bezeichnung</span><span>Menge</span><span>Einheit</span><span>Einzelpreis</span><span>USt</span><span className="text-right">Betrag</span><span /></div>
          {v.lines.map((l, i) => (
            <div key={l.id} className={cls("mb-2 grid items-center gap-2", produkte ? LINE_GRID_ARTICLE : LINE_GRID)}>
              {produkte ? <ProductPicker value={l.productId} disabled={locked} levels={levels} placeholder="Artikel …" onChange={(_, p) => pickProduct(i, p)} /> : null}
              <Textarea value={l.description} disabled={locked} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Leistung" rows={l.description.includes("\n") ? 3 : 1} className="min-h-10 resize-y" />
              <Input type="number" step="0.01" value={l.quantity} disabled={locked} onChange={(e) => setLine(i, { quantity: Number(e.target.value) || 0 })} />
              <Input value={l.unit} disabled={locked} onChange={(e) => setLine(i, { unit: e.target.value })} />
              <MoneyInput allowNegative value={l.unitNetCents || null} disabled={locked} onChange={(c) => setLine(i, { unitNetCents: c ?? 0 })} />
              <Select value={l.vatRate} disabled={locked || v.vatTreatment !== "standard"} onChange={(e) => setLine(i, { vatRate: Number(e.target.value) as VatRate })}><option value={20}>20 %</option><option value={10}>10 %</option><option value={13}>13 %</option><option value={0}>0 %</option></Select>
              <div className="text-right tabular text-sm" title={l.discountPct ? `inkl. ${l.discountPct} % Rabatt` : undefined}>{fmtMoney(Math.round(l.quantity * l.unitNetCents * (1 - (l.discountPct || 0) / 100)))}{l.discountPct ? <span className="block text-[10px] text-(--text-muted)">-{l.discountPct} %</span> : null}</div>
              <button disabled={locked} className="rounded-md p-1.5 text-(--text-muted) hover:bg-(--surface-2) disabled:opacity-40" onClick={() => set({ lines: v.lines.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {!locked ? <Button variant="outline" size="sm" onClick={() => set({ lines: [...v.lines, { id: ids.invoice(), description: "", quantity: 1, unit: "Stk", unitNetCents: 0, vatRate: v.vatTreatment === "standard" ? 20 : 0, discountPct: 0 }] })}><Plus className="h-4 w-4" /> Position</Button> : null}
          {produkte && !locked && v.kind !== "offer" && v.lines.some((l) => l.productId && productById.get(l.productId) && isStockTracked(productById.get(l.productId)!)) ? <p className="mt-2 text-xs text-(--text-muted)">Beim Fertigstellen {v.kind === "credit_note" ? "kommen die Lagerartikel wieder ins Lager" : "gehen die Lagerartikel aus dem Lager"} – du siehst das beim Artikel unter „Bestand“.</p> : null}
          {produkte && movedStock.length ? <p className="mt-2 text-xs text-(--text-muted)">Lager: {movedStock.map((m) => `${m.quantity > 0 ? "+" : "−"}${fmtQty(Math.abs(m.quantity))} ${productById.get(m.productId)?.unit ?? ""} ${productById.get(m.productId)?.name ?? "Artikel"}`).join(" · ")}</p> : null}
        </div>
        <div className="flex justify-end">
          <div className="w-72 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-(--text-muted)">Netto</span><span className="tabular">{fmtMoney(totals.netCents)}</span></div>
            {totals.byRate.filter((r) => r.rate > 0).map((r) => <div key={r.rate} className="flex justify-between"><span className="text-(--text-muted)">USt {r.rate} %</span><span className="tabular">{fmtMoney(r.vatCents)}</span></div>)}
            <div className="flex justify-between border-t border-(--border) pt-1 text-base font-semibold"><span>Gesamt</span><span className="tabular">{fmtMoney(totals.grossCents)}</span></div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Einleitung"><Textarea value={v.introText} disabled={locked} onChange={(e) => set({ introText: e.target.value })} placeholder="Vielen Dank für Ihren Auftrag. Wir erlauben uns, folgende Leistungen in Rechnung zu stellen:" /></Field>
          <Field label="Schlusstext"><Textarea value={v.footerText} disabled={locked} onChange={(e) => set({ footerText: e.target.value })} /></Field>
        </div>
        {vault.settings.ai.provider ? null : null}
      </div>
      {mailing ? <InvoiceMailDialog invoice={v} onClose={() => setMailing(false)} /> : null}
    </Modal>
  );
}

export { Copy, cls };
