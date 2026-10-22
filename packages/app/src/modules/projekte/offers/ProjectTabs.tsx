/** Tabs inside a project: its offers and its invoices. */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { FileSignature, Plus, ReceiptText } from "lucide-react";
import { can, invoiceBudgetNetCents, invoiceTotals, offerDisplayStatus, offerTotals, projectBillingSuggestion, todayIso, type Invoice } from "@ordo/core";
import { useList, useProfile, useVault } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { toast } from "@/state/toasts";
import { useMe } from "@/modules/registry";
import { Badge, Button, EmptyState, Progress } from "@/components/ui";
import { cls, fmtDate, fmtMoney } from "@/lib/format";
import { INVOICE_STATUS, useOfferRights } from "./shared";
import { StatusBadge } from "./OffersPage";
import { ProjectInvoiceDialog } from "./InvoiceDialog";
import { Notice } from "./parts";

export function ProjectOffersTab({ projectId }: { projectId: string }) {
  const offers = useList("offers");
  const projects = useList("projects");
  const profile = useProfile();
  const navigate = useNavigate();
  const rights = useOfferRights();
  const { role } = useMe();
  const today = todayIso();
  const project = projects.find((p) => p.id === projectId);
  const ku = profile.vatRegime === "kleinunternehmer";
  const rows = useMemo(
    () =>
      offers
        .filter((o) => o.projectId === projectId)
        .map((o) => ({ offer: o, shown: offerDisplayStatus(o, today), net: offerTotals(o, { kleinunternehmer: ku }).netCents }))
        .sort((a, b) => b.offer.date.localeCompare(a.offer.date) || b.offer.number.localeCompare(a.offer.number)),
    [offers, projectId, today, ku],
  );

  if (!rights.canRead) return <Notice>Deine Rolle darf Angebote nicht sehen.</Notice>;

  const accepted = rows.filter((r) => r.shown === "accepted");
  const latest = rows.find((r) => r.shown !== "declined");
  const refNet = accepted.length ? accepted.reduce((s, r) => s + r.net, 0) : latest?.net ?? 0;
  const refLabel = accepted.length ? (accepted.length === 1 ? "Angenommenes Angebot" : `${accepted.length} angenommene Angebote`) : "Letztes Angebot";
  const budget = project?.budgetCents ?? 0;
  const diff = refNet - budget;
  const mayEditProject = can(role, "projects", "write");
  const takeAsBudget = () => {
    if (!project) return;
    requireStore().update("projects", project.id, { budgetCents: refNet }, "project.budget");
    toast.success("Projektbudget übernommen", `${fmtMoney(refNet)} netto`);
  };

  const newButton = rights.canWrite ? (
    <Button size="sm" onClick={() => navigate(`/angebote/neu?projekt=${encodeURIComponent(projectId)}`)}>
      <Plus className="h-4 w-4" /> Neues Angebot
    </Button>
  ) : null;

  if (!rows.length) {
    return (
      <EmptyState
        icon={<FileSignature className="h-8 w-8" />}
        title="Noch kein Angebot für dieses Projekt"
        body="Schreib das Angebot direkt hier – Kunde, Projekt und Termine sind schon eingetragen."
        action={newButton}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-(--text-muted)">
          {rows.length} Angebot{rows.length === 1 ? "" : "e"}
          {accepted.length ? ` · ${accepted.length} angenommen` : ""}
        </p>
        {newButton}
      </div>

      {refNet > 0 ? (
        <div className="surface flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm">
          <div className="min-w-0">
            <div>
              <span className="text-(--text-muted)">{refLabel}: </span>
              <span className="font-semibold tabular">{fmtMoney(refNet)}</span>
              <span className="text-(--text-muted)"> netto · Projektbudget </span>
              <span className="font-semibold tabular">{budget ? fmtMoney(budget) : "–"}</span>
            </div>
            <div className={cls("mt-0.5 text-xs", budget && diff > 0 ? "text-amber-700 dark:text-amber-300" : "text-(--text-muted)")}>
              {!budget ? "Im Projekt ist noch kein Budget eingetragen." : diff === 0 ? "Passt genau zum Budget." : diff > 0 ? `${fmtMoney(diff)} über dem Budget.` : `${fmtMoney(-diff)} unter dem Budget.`}
            </div>
          </div>
          {mayEditProject && accepted.length && diff !== 0 ? (
            <Button size="sm" variant="outline" onClick={takeAsBudget}>Als Projektbudget übernehmen</Button>
          ) : mayEditProject && !budget ? (
            <Button size="sm" variant="outline" onClick={takeAsBudget}>Als Projektbudget übernehmen</Button>
          ) : null}
        </div>
      ) : null}

      <div className="surface overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
            <tr>
              <th className="w-[34%] px-4 py-2 sm:w-[18%]">Nummer</th>
              <th className="hidden px-3 py-2 sm:table-cell sm:w-[12%]">Datum</th>
              <th className="hidden px-3 py-2 sm:table-cell sm:w-[12%]">Gültig bis</th>
              <th className="hidden px-3 py-2 md:table-cell">Betreff</th>
              <th className="w-[30%] px-3 py-2 sm:w-[20%]">Status</th>
              <th className="px-4 py-2 text-right sm:w-[16%]">Netto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {rows.map(({ offer: o, shown, net }) => (
              <tr key={o.id} tabIndex={0} onClick={() => navigate(`/angebote/${o.id}`)} onKeyDown={(e) => { if (e.key === "Enter") navigate(`/angebote/${o.id}`); }} className="cursor-pointer hover:bg-(--surface-2) focus-visible:bg-(--surface-2) focus-visible:outline-none">
                <td className="truncate px-4 py-2.5 font-medium tabular">{o.number}</td>
                <td className="hidden px-3 py-2.5 tabular sm:table-cell">{fmtDate(o.date)}</td>
                <td className="hidden px-3 py-2.5 tabular sm:table-cell">{fmtDate(o.validUntil)}</td>
                <td className="hidden truncate px-3 py-2.5 md:table-cell">{o.subject || "–"}</td>
                <td className="px-3 py-2.5"><StatusBadge offer={o} shown={shown} today={today} /></td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular">{fmtMoney(net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function signedGross(i: Invoice): number {
  const g = Math.round(invoiceTotals(i).grossCents * (1 - (i.discountPct || 0) / 100));
  return i.kind === "credit_note" ? -Math.abs(g) : g;
}

function periodOf(i: Invoice): string {
  if (i.servicePeriodStart && i.servicePeriodEnd) return i.servicePeriodStart === i.servicePeriodEnd ? fmtDate(i.servicePeriodStart) : `${fmtDate(i.servicePeriodStart)} – ${fmtDate(i.servicePeriodEnd)}`;
  return i.servicePeriod || "–";
}

export function ProjectInvoicesTab({ projectId }: { projectId: string }) {
  const invoices = useList("invoices");
  const projects = useList("projects");
  const vault = useVault();
  const navigate = useNavigate();
  const rights = useOfferRights();
  const [open, setOpen] = useState(false);
  const project = projects.find((p) => p.id === projectId);
  const list = useMemo(
    () => invoices.filter((i) => i.projectId === projectId && i.kind !== "offer").sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number)),
    [invoices, projectId],
  );

  if (!rights.canSeeInvoices) {
    return <Notice>{rights.summaInstalled ? "Rechnungen sieht nur, wer die Buchhaltung sehen darf." : "Rechnungen schreibst du mit Summa – Buchhaltung. Du findest es unter Module."}</Notice>;
  }
  if (!project) return null;

  const billing = projectBillingSuggestion(project, invoices, { downpaymentPct: vault.settings.projects.downpaymentPct, today: todayIso() });
  const counted = list.filter((i) => i.status !== "cancelled");
  const sumNet = counted.reduce((s, i) => s + invoiceBudgetNetCents(i), 0);
  const sumGross = counted.reduce((s, i) => s + signedGross(i), 0);
  const createButton = rights.canInvoice ? (
    <Button size="sm" onClick={() => setOpen(true)}>
      <ReceiptText className="h-4 w-4" /> Rechnung erstellen
    </Button>
  ) : null;

  return (
    <div className="space-y-4">
      {billing.budgetCents > 0 ? (
        <div className="surface px-5 py-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[13px] font-medium text-(--text-muted)">Projektsumme</div>
              <div className="mt-1 text-lg font-semibold tabular">{fmtMoney(billing.budgetCents)}</div>
            </div>
            <div>
              <div className="text-[13px] font-medium text-(--text-muted)">Verrechnet</div>
              <div className="mt-1 text-lg font-semibold tabular">{fmtMoney(billing.billedNetCents)}</div>
            </div>
            <div>
              <div className="text-[13px] font-medium text-(--text-muted)">Offen</div>
              <div className={cls("mt-1 text-lg font-semibold tabular", billing.remainingCents < 0 && "text-amber-700 dark:text-amber-300")}>{fmtMoney(billing.remainingCents)}</div>
            </div>
          </div>
          <Progress value={Math.min(1, billing.progress)} className="mt-3" />
          <p className="mt-2 text-xs text-(--text-muted)">Alle Beträge netto. Stornierte Rechnungen zählen nicht.</p>
        </div>
      ) : null}

      {billing.reminder && rights.canInvoice ? (
        <Notice action={<Button size="sm" variant="outline" onClick={() => setOpen(true)}>Rechnung erstellen</Button>}>
          {billing.reminder === "start"
            ? `Noch keine Rechnung – Zeit für die Anzahlung über ${fmtMoney(billing.suggestedCents)} netto.`
            : `Das Projektende ist vorbei und es sind noch ${fmtMoney(billing.remainingCents)} offen – Zeit für die Schlussrechnung.`}
        </Notice>
      ) : null}

      {!list.length ? (
        <EmptyState
          icon={<ReceiptText className="h-8 w-8" />}
          title="Noch keine Rechnung"
          body={billing.budgetCents ? `Der Vorschlag für die erste Rechnung: ${fmtMoney(billing.suggestedCents)} netto Anzahlung.` : "Rechnungen zu diesem Projekt erscheinen hier – mit Leistungszeitraum und Status aus Summa."}
          action={createButton}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-(--text-muted)">{list.length} Rechnung{list.length === 1 ? "" : "en"}</p>
            {createButton}
          </div>
          <div className="surface overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
                <tr>
                  <th className="w-[36%] px-4 py-2 sm:w-[17%]">Nummer</th>
                  <th className="hidden px-3 py-2 sm:table-cell sm:w-[12%]">Datum</th>
                  <th className="hidden px-3 py-2 md:table-cell">Leistungszeitraum</th>
                  <th className="w-[28%] px-3 py-2 sm:w-[14%]">Status</th>
                  <th className="hidden px-3 py-2 text-right sm:table-cell sm:w-[15%]">Netto</th>
                  <th className="px-4 py-2 text-right sm:w-[15%]">Brutto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {list.map((i) => (
                  <tr key={i.id} tabIndex={0} onClick={() => navigate(`/rechnungen/${i.id}`)} onKeyDown={(e) => { if (e.key === "Enter") navigate(`/rechnungen/${i.id}`); }} className={cls("cursor-pointer hover:bg-(--surface-2) focus-visible:bg-(--surface-2) focus-visible:outline-none", i.status === "cancelled" && "text-(--text-muted) line-through decoration-(--text-muted)/40")}>
                    <td className="truncate px-4 py-2.5 font-medium tabular">
                      {i.number}
                      {i.kind === "credit_note" ? <Badge className="ml-1.5">Gutschrift</Badge> : null}
                    </td>
                    <td className="hidden px-3 py-2.5 tabular sm:table-cell">{fmtDate(i.issueDate)}</td>
                    <td className="hidden truncate px-3 py-2.5 tabular md:table-cell">{periodOf(i)}</td>
                    <td className="px-3 py-2.5"><Badge tone={INVOICE_STATUS[i.status]?.tone ?? "neutral"}>{INVOICE_STATUS[i.status]?.label ?? i.status}</Badge></td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular sm:table-cell">{fmtMoney(invoiceBudgetNetCents(i))}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular">{fmtMoney(signedGross(i))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-(--border)">
                  <td className="px-4 py-2 text-xs text-(--text-muted)" colSpan={2}>Summe</td>
                  <td className="hidden md:table-cell" />
                  <td className="hidden sm:table-cell" />
                  <td className="hidden whitespace-nowrap px-3 py-2 text-right font-semibold tabular sm:table-cell">{fmtMoney(sumNet)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular">{fmtMoney(sumGross)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      {open ? <ProjectInvoiceDialog project={project} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
