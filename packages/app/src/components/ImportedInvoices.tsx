import { useMemo } from "react";
import { useNavigate } from "react-router";
import { FileInput, Upload } from "lucide-react";
import { documentDirection } from "@ordo/core";
import { useList, useContactMap } from "@/state/hooks";
import { useSession } from "@/state/session";
import { importFiles } from "@/services/importer";
import { Badge, Button, Card, EmptyState, Stat } from "@/components/ui";
import { fmtDate, fmtMoney } from "@/lib/format";
import { isTauri } from "@/platform";
import { FolderLinkButton } from "@/components/FolderLinks";

/** Outgoing invoices that were produced in another program and imported (folder/upload). */
export function ImportedInvoices() {
  const docs = useList("documents");
  const txs = useList("transactions");
  const contacts = useContactMap();
  const vault = useSession((s) => s.vault)!;
  const navigate = useNavigate();
  const profileId = vault.activeProfileId;
  const rows = useMemo(() => {
    const txById = new Map(txs.map((t) => [t.id, t]));
    return docs
      .map((d) => ({ doc: d, tx: d.transactionId ? txById.get(d.transactionId) : undefined }))
      .filter((r) => documentDirection(r.doc, r.tx) === "outgoing")
      .sort((a, b) => (b.tx?.date ?? b.doc.importedAt).localeCompare(a.tx?.date ?? a.doc.importedAt));
  }, [docs, txs]);
  const open = rows.filter((r) => r.tx && !r.tx.paidDate).reduce((s, r) => s + (r.tx?.grossCents ?? 0), 0);
  const total = rows.reduce((s, r) => s + (r.tx?.grossCents ?? 0), 0);
  const upload = async () => {
    const files = await useSession.getState().platform!.pickFiles({ multiple: true });
    if (files.length) importFiles(files, "upload", { direction: "outgoing" });
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Rechnungen" value={rows.length} />
        <Stat label="Summe" value={fmtMoney(total)} />
        <Stat label="Noch nicht bezahlt" value={fmtMoney(open)} tone={open ? "down" : undefined} sub="Wird automatisch erledigt, sobald das Geld am Kontoauszug auftaucht" />
      </div>
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <div className="rounded-xl bg-brand-50 p-2 text-brand-700 dark:bg-brand-950 dark:text-brand-300"><FileInput className="h-6 w-6" /></div>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold">So kommen deine Rechnungen in Ordo</div>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-(--text-muted)">
              <li>Rechnung wie gewohnt in deinem Programm erstellen und als PDF speichern.</li>
              <li>{isTauri ? <>PDF in deinen <strong>Ordner für ausgehende Rechnungen</strong> legen – oder hier hochladen.</> : <>PDF hier hochladen (am Desktop kann ein Ordner automatisch überwacht werden).</>}</li>
              <li>Ordo liest Kunde, Nummer, Betrag und USt, bucht die Einnahme und hakt sie ab, sobald bezahlt wurde.</li>
            </ol>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void upload()}><Upload className="h-4 w-4" /> Rechnungen hochladen</Button>
            <FolderLinkButton kind="outgoing" />
          </div>
        </div>
      </Card>
      {!rows.length ? (
        <EmptyState icon={<FileInput className="h-8 w-8" />} title="Noch keine Rechnungen" body="Lade deine erste Rechnung hoch oder richte den Ordner ein – ab dann läuft es automatisch." />
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)"><tr><th className="px-3 py-2">Datum</th><th className="px-3 py-2">Nummer</th><th className="px-3 py-2">Kunde</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Betrag</th></tr></thead>
            <tbody className="divide-y divide-(--border)">
              {rows.map(({ doc, tx }) => (
                <tr key={doc.id} className="cursor-pointer hover:bg-(--surface-2)" onClick={() => navigate(`/belege/${doc.id}`)}>
                  <td className="whitespace-nowrap px-3 py-2 tabular">{fmtDate(tx?.date ?? doc.extraction?.fields.invoiceDate ?? doc.importedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{tx?.invoiceNumber || doc.extraction?.fields.invoiceNumber || "–"}</td>
                  <td className="w-full max-w-0 px-3 py-2"><span className="block truncate">{(tx?.contactId ? contacts.get(tx.contactId)?.name : undefined) ?? doc.extraction?.fields.customerName ?? doc.originalName}</span></td>
                  <td className="whitespace-nowrap px-3 py-2">{doc.status !== "approved" ? <Badge tone="warning">prüfen</Badge> : tx?.paidDate ? <Badge tone="success">bezahlt</Badge> : tx?.dueDate && tx.dueDate < new Date().toISOString().slice(0, 10) ? <Badge tone="danger">überfällig</Badge> : <Badge tone="info">offen</Badge>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular font-semibold text-emerald-600">{tx ? fmtMoney(tx.grossCents) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
