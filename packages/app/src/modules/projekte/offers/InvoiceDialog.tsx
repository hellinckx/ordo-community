import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ReceiptText } from "lucide-react";
import {
  invoiceBudgetNetCents,
  invoiceFromOffer,
  invoicesForOffer,
  nowIso,
  offerMainVatRate,
  offerTotals,
  projectBillingSuggestion,
  projectInvoiceDraft,
  todayIso,
  type Offer,
  type OfferInvoiceKind,
  type Project,
  type ProjectInvoiceKind,
  type VatRate,
} from "@ordo/core";
import { useContactMap, useList, useProfile, useVault } from "@/state/hooks";
import { toast } from "@/state/toasts";
import { Button, DateInput, Field, Input, Modal, MoneyInput, Select, Tabs } from "@/components/ui";
import { cls, fmtMoney } from "@/lib/format";
import { saveInvoiceDraft } from "./shared";
import { InvoiceModeNotice, Notice } from "./parts";

function Choice({ active, onClick, title, amount, sub, disabled }: { active: boolean; onClick: () => void; title: string; amount?: string; sub?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cls(
        "flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:opacity-50",
        active ? "border-brand-600 bg-brand-50/60 dark:bg-brand-900/20" : "border-(--border) hover:bg-(--surface-2)",
      )}
    >
      <span className={cls("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", active ? "border-brand-600" : "border-slate-300 dark:border-slate-600")}>
        {active ? <span className="h-2 w-2 rounded-full bg-brand-600" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">{title}</span>
          {amount ? <span className="text-sm font-semibold tabular">{amount}</span> : null}
        </span>
        {sub ? <span className="mt-0.5 block text-xs text-(--text-muted)">{sub}</span> : null}
      </span>
    </button>
  );
}

/** "Rechnung erstellen" from an accepted offer: whole offer, down payment, final invoice or a free amount. */
export function OfferInvoiceDialog({ offer, onClose }: { offer: Offer; onClose: () => void }) {
  const profile = useProfile();
  const vault = useVault();
  const invoices = useList("invoices");
  const projects = useList("projects");
  const contacts = useContactMap();
  const navigate = useNavigate();
  const ku = profile.vatRegime === "kleinunternehmer";
  const project = offer.projectId ? projects.find((p) => p.id === offer.projectId) : undefined;
  const totals = offerTotals(offer, { kleinunternehmer: ku });
  const earlier = useMemo(() => invoicesForOffer(offer, invoices), [offer, invoices]);
  const earlierNet = earlier.reduce((s, i) => s + invoiceBudgetNetCents(i), 0);
  const downNet = Math.round((totals.netCents * offer.downpaymentPct) / 100);
  const restNet = totals.netCents - earlierNet;
  const [kind, setKind] = useState<OfferInvoiceKind>(earlier.length ? (restNet > 0 ? "final" : "amount") : offer.downpaymentPct > 0 ? "downpayment" : "full");
  const [amount, setAmount] = useState<number | null>(Math.max(0, restNet));
  const [start, setStart] = useState<string | undefined>(project?.startDate);
  const [end, setEnd] = useState<string | undefined>(project?.endDate);

  const chosenNet = kind === "full" ? totals.netCents : kind === "downpayment" ? downNet : kind === "final" ? restNet : amount ?? 0;
  const vatShare = totals.netCents ? totals.vatCents / totals.netCents : 0;
  const gross = (net: number) => net + Math.round(net * vatShare);
  const billing = project ? projectBillingSuggestion(project, invoices, { downpaymentPct: vault.settings.projects.downpaymentPct, today: todayIso() }) : undefined;
  const overOffer = kind !== "full" && chosenNet > restNet && restNet >= 0;
  const overBudget = billing && billing.budgetCents > 0 && chosenNet > billing.remainingCents;

  const create = () => {
    if (kind === "amount" && !(amount && amount > 0)) {
      toast.warning("Gib einen Betrag ein.");
      return;
    }
    const draft = invoiceFromOffer(offer, {
      profile,
      contact: offer.customerId ? contacts.get(offer.customerId) : undefined,
      usedNumbers: vault.invoices.map((i) => i.number),
      issueDate: todayIso(),
      now: nowIso(),
      servicePeriodStart: start,
      servicePeriodEnd: end,
      kind,
      amountNetCents: amount ?? 0,
      earlierInvoices: earlier,
    });
    const id = saveInvoiceDraft(draft, profile.id, offer.id);
    toast.success(`Rechnung ${draft.invoice.number} angelegt`, "Prüfen, fertigstellen und senden – in Summa.");
    onClose();
    navigate(`/rechnungen/${id}`);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Rechnung aus Angebot ${offer.number}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button onClick={create}><ReceiptText className="h-4 w-4" /> Rechnung erstellen</Button>
        </>
      }
    >
      <div className="space-y-4">
        <InvoiceModeNotice profile={profile} />
        <div className="space-y-2">
          <Choice active={kind === "full"} onClick={() => setKind("full")} title="Gesamt" amount={fmtMoney(totals.netCents)} sub={`Alle Positionen wie im Angebot${totals.discountNetCents ? ", mit Rabatt" : ""} · ${fmtMoney(totals.grossCents)} brutto`} />
          <Choice active={kind === "downpayment"} disabled={!offer.downpaymentPct} onClick={() => setKind("downpayment")} title={`Anzahlung ${String(offer.downpaymentPct).replace(".", ",")} %`} amount={fmtMoney(downNet)} sub={offer.downpaymentPct ? `${fmtMoney(gross(downNet))} brutto` : "Im Angebot ist keine Anzahlung vereinbart."} />
          <Choice
            active={kind === "final"}
            disabled={earlier.length > 0 && restNet <= 0}
            onClick={() => setKind("final")}
            title="Schlussrechnung"
            amount={fmtMoney(restNet)}
            sub={earlier.length && restNet <= 0 ? "Dieses Angebot ist schon ganz verrechnet." : earlier.length ? `Alle Positionen, abzüglich ${earlier.length} bisheriger Rechnung${earlier.length === 1 ? "" : "en"} über ${fmtMoney(earlierNet)} netto` : "Bisher gibt es keine Rechnung zu diesem Angebot – das entspricht „Gesamt“."}
          />
          <Choice active={kind === "amount"} onClick={() => setKind("amount")} title="Freier Betrag" sub="Teilrechnung über einen Betrag, den du selbst festlegst" />
          {kind === "amount" ? (
            <Field label="Betrag netto" className="pl-7">
              <MoneyInput autoFocus value={amount} onChange={setAmount} />
            </Field>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Leistung von"><DateInput value={start} onChange={setStart} /></Field>
          <Field label="bis"><DateInput value={end} onChange={setEnd} /></Field>
        </div>
        {kind === "full" && earlier.length ? <Notice tone="warning">Zu diesem Angebot gibt es schon {earlier.length === 1 ? "eine Rechnung" : `${earlier.length} Rechnungen`}. Meinst du die Schlussrechnung?</Notice> : null}
        {overOffer ? <Notice tone="warning">Das ist mehr, als aus diesem Angebot noch offen ist ({fmtMoney(Math.max(0, restNet))} netto).</Notice> : null}
        {overBudget && billing ? <Notice tone="warning">Damit wird das Projektbudget überschritten – offen sind noch {fmtMoney(Math.max(0, billing.remainingCents))} netto.</Notice> : null}
        <p className="text-xs text-(--text-muted)">Die Rechnung wird als Entwurf in Summa angelegt. Dort prüfst du sie, stellst sie fertig und sendest sie.</p>
      </div>
    </Modal>
  );
}

const KIND_LABEL: Record<ProjectInvoiceKind, string> = { downpayment: "Anzahlung", partial: "Teilrechnung", final: "Schlussrechnung" };

/** "Rechnung erstellen" inside a project: amount suggested from the budget, service period from the project dates. */
export function ProjectInvoiceDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const profile = useProfile();
  const vault = useVault();
  const invoices = useList("invoices");
  const offers = useList("offers");
  const contacts = useContactMap();
  const navigate = useNavigate();
  const pct = vault.settings.projects.downpaymentPct;
  const billing = projectBillingSuggestion(project, invoices, { downpaymentPct: pct, today: todayIso() });
  const accepted = useMemo(() => offers.filter((o) => o.projectId === project.id && o.status === "accepted").sort((a, b) => b.date.localeCompare(a.date)), [offers, project.id]);
  const [offerId, setOfferId] = useState<string>(accepted[0]?.id ?? "");
  const offer = accepted.find((o) => o.id === offerId);
  const initialKind: ProjectInvoiceKind = billing.kind === "downpayment" ? "downpayment" : billing.kind === "final" ? "final" : "partial";
  const [kind, setKind] = useState<ProjectInvoiceKind>(initialKind);
  const [amount, setAmount] = useState<number | null>(billing.suggestedCents || null);
  const [description, setDescription] = useState("");
  const [start, setStart] = useState<string | undefined>(project.startDate);
  const [end, setEnd] = useState<string | undefined>(project.endDate);
  const ku = profile.vatRegime === "kleinunternehmer";
  const noVat = ku || !!offer?.reverseCharge;
  const [rate, setRate] = useState<VatRate>(offer ? offerMainVatRate(offer) : 20);
  const contact = project.customerId ? contacts.get(project.customerId) : undefined;

  const pickKind = (k: ProjectInvoiceKind) => {
    setKind(k);
    if (k === "downpayment" && billing.budgetCents) setAmount(Math.round((billing.budgetCents * pct) / 100));
    if (k === "final") setAmount(Math.max(0, billing.remainingCents) || null);
  };
  const defaultText = kind === "downpayment" ? `Anzahlung ${String(pct).replace(".", ",")} % – ${project.name}` : kind === "final" ? `Schlussrechnung – ${project.name}` : `Teilrechnung – ${project.name}`;
  const over = billing.budgetCents > 0 && (amount ?? 0) > billing.remainingCents;

  const create = () => {
    if (!amount || amount <= 0) {
      toast.warning("Gib einen Betrag ein.");
      return;
    }
    const draft = projectInvoiceDraft(project, {
      profile,
      contact,
      usedNumbers: vault.invoices.map((i) => i.number),
      issueDate: todayIso(),
      now: nowIso(),
      servicePeriodStart: start,
      servicePeriodEnd: end,
      amountNetCents: amount,
      kind,
      description: description.trim() || defaultText,
      vatRate: rate,
      downpaymentPct: pct,
      offer,
    });
    const id = saveInvoiceDraft(draft, profile.id, offer?.id);
    toast.success(`Rechnung ${draft.invoice.number} angelegt`, "Prüfen, fertigstellen und senden – in Summa.");
    onClose();
    navigate(`/rechnungen/${id}`);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Rechnung für das Projekt"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button onClick={create}><ReceiptText className="h-4 w-4" /> Rechnung erstellen</Button>
        </>
      }
    >
      <div className="space-y-4">
        <InvoiceModeNotice profile={profile} />
        {!project.customerId ? <Notice tone="warning">Im Projekt ist kein Kunde eingetragen – du kannst ihn in der Rechnung noch wählen.</Notice> : null}
        <Tabs<ProjectInvoiceKind> value={kind} onChange={pickKind} tabs={(["downpayment", "partial", "final"] as ProjectInvoiceKind[]).map((k) => ({ id: k, label: KIND_LABEL[k] }))} />
        {billing.budgetCents > 0 ? (
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-(--surface-2) px-3 py-2.5 text-xs">
            <div><div className="text-(--text-muted)">Projektsumme</div><div className="mt-0.5 text-sm font-semibold tabular">{fmtMoney(billing.budgetCents)}</div></div>
            <div><div className="text-(--text-muted)">Verrechnet</div><div className="mt-0.5 text-sm font-semibold tabular">{fmtMoney(billing.billedNetCents)}</div></div>
            <div><div className="text-(--text-muted)">Offen</div><div className="mt-0.5 text-sm font-semibold tabular">{fmtMoney(billing.remainingCents)}</div></div>
          </div>
        ) : (
          <p className="text-sm text-(--text-muted)">Im Projekt ist kein Budget eingetragen – gib den Betrag selbst ein.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
          <Field label="Betrag netto" hint={billing.kind !== "none" ? `Vorschlag: ${fmtMoney(billing.suggestedCents)} (${billing.kind === "downpayment" ? `${String(pct).replace(".", ",")} % des Budgets` : "offenes Budget"})` : undefined}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          {noVat ? (
            <Field label="USt"><Input value={ku ? "befreit" : "Reverse Charge"} disabled /></Field>
          ) : (
            <Field label="USt">
              <Select value={rate} onChange={(e) => setRate(Number(e.target.value) as VatRate)}>
                <option value={20}>20 %</option>
                <option value={13}>13 %</option>
                <option value={10}>10 %</option>
                <option value={0}>0 %</option>
              </Select>
            </Field>
          )}
        </div>
        <Field label="Text auf der Rechnung">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={defaultText} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Leistung von"><DateInput value={start} onChange={setStart} /></Field>
          <Field label="bis"><DateInput value={end} onChange={setEnd} /></Field>
        </div>
        {accepted.length > 1 ? (
          <Field label="Gehört zu Angebot">
            <Select
              value={offerId}
              onChange={(e) => {
                setOfferId(e.target.value);
                const o = accepted.find((x) => x.id === e.target.value);
                if (o) setRate(offerMainVatRate(o));
              }}
            >
              <option value="">Keinem Angebot</option>
              {accepted.map((o) => <option key={o.id} value={o.id}>{o.number}{o.subject ? ` · ${o.subject}` : ""}</option>)}
            </Select>
          </Field>
        ) : offer ? (
          <p className="text-xs text-(--text-muted)">Wird dem angenommenen Angebot {offer.number} zugeordnet.</p>
        ) : null}
        {over ? <Notice tone="warning">Das sind {fmtMoney((amount ?? 0) - billing.remainingCents)} mehr als das offene Budget ({fmtMoney(Math.max(0, billing.remainingCents))}). Du kannst trotzdem weitermachen.</Notice> : null}
        <p className="text-xs text-(--text-muted)">Die Rechnung wird als Entwurf in Summa angelegt. Dort prüfst du sie, stellst sie fertig und sendest sie.</p>
      </div>
    </Modal>
  );
}
