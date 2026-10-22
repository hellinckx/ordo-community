import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { offerLinesFromPaste, parseOfferPaste, OFFER_PASTE_LIMITS, OFFER_PASTE_TEMPLATE, type OfferLine } from "@ordo/core";
import { Button, ConfirmDialog, CopyButton, Modal, Textarea } from "@/components/ui";
import { fmtMoney, fmtNumber } from "@/lib/format";

const EXAMPLE = `${OFFER_PASTE_TEMPLATE}\nAnalyse\tDatenaufnahme vor Ort\t8\tStd\t95,00\t20\nModell\tAufbau des Simulationsmodells\t1\tpauschal\t2.400,00\t20`;

/** "Aus Excel einfügen": paste rows, see a preview, append or replace the positions. */
export function PasteDialog({ open, onClose, onApply, hasLines, defaultUnit }: { open: boolean; onClose: () => void; onApply: (lines: OfferLine[], replace: boolean) => void; hasLines: boolean; defaultUnit?: string }) {
  const [text, setText] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const result = useMemo(() => (text.trim() ? parseOfferPaste(text) : null), [text]);
  const rows = result?.rows ?? [];
  const netOf = (r: (typeof rows)[number]) => Math.round(r.quantity * r.unitNetCents);
  const totalNet = rows.reduce((s, r) => s + netOf(r), 0);
  const totalVat = rows.reduce((s, r) => s + Math.round((netOf(r) * r.vatRate) / 100), 0);
  const rowErrors = result?.errors.filter((e) => e.line !== null) ?? [];
  const generalErrors = result?.errors.filter((e) => e.line === null) ?? [];

  const close = () => {
    setText("");
    onClose();
  };
  const apply = (replace: boolean) => {
    onApply(offerLinesFromPaste(rows, { unit: defaultUnit }), replace);
    close();
  };

  return (
    <>
      <Modal
        open={open}
        onClose={close}
        title="Positionen aus Excel einfügen"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={close}>Abbrechen</Button>
            {hasLines ? (
              <Button variant="outline" disabled={!rows.length} onClick={() => setConfirmReplace(true)}>Ersetzen</Button>
            ) : null}
            <Button disabled={!rows.length} onClick={() => apply(false)}>
              {rows.length ? `${rows.length} Position${rows.length === 1 ? "" : "en"} ${hasLines ? "anhängen" : "übernehmen"}` : "Übernehmen"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-(--text-muted)">
            Markiere die Zeilen in Excel oder Numbers, kopiere sie und füge sie hier ein. Spalten: Titel, Beschreibung, Menge, Einheit, Einzelpreis, USt – eine Kopfzeile ist optional, Zahlen dürfen deutsch geschrieben sein (1.234,50).
          </p>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-(--text-muted)">Eingefügte Zeilen</span>
              <CopyButton text={EXAMPLE} label="Vorlage kopieren" />
            </div>
            <Textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              spellCheck={false}
              placeholder={"Titel\tBeschreibung\tMenge\tEinheit\tEinzelpreis\tUSt %\nAnalyse\tDatenaufnahme vor Ort\t8\tStd\t95,00\t20"}
              className="font-mono text-xs"
            />
            <p className="mt-1 text-xs text-(--text-muted)">Höchstens {OFFER_PASTE_LIMITS.maxRows} Positionen und {fmtNumber(OFFER_PASTE_LIMITS.maxChars)} Zeichen auf einmal.</p>
          </div>

          {generalErrors.length || rowErrors.length ? (
            <div className="rounded-xl border border-amber-300/70 px-3 py-2.5 text-sm dark:border-amber-500/40">
              <div className="mb-1 flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                {rowErrors.length ? `${rowErrors.length} Zeile${rowErrors.length === 1 ? "" : "n"} ${rowErrors.length === 1 ? "wird" : "werden"} ausgelassen` : "Bitte prüfen"}
              </div>
              <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-(--text-muted)">
                {generalErrors.map((e, i) => <li key={`g${i}`}>{e.message}</li>)}
                {rowErrors.map((e, i) => <li key={i}><span className="font-medium text-(--text)">Zeile {e.line}:</span> {e.message}</li>)}
              </ul>
            </div>
          ) : null}
          {result?.notes.length ? <p className="text-xs text-(--text-muted)">{result.notes.join(" ")}</p> : null}

          {rows.length ? (
            <div className="overflow-x-auto rounded-xl border border-(--border)">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
                  <tr>
                    <th className="px-3 py-2">Position</th>
                    <th className="px-3 py-2 text-right">Menge</th>
                    <th className="px-3 py-2 text-right">Einzelpreis</th>
                    <th className="px-3 py-2 text-right">USt</th>
                    <th className="px-3 py-2 text-right">Netto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--border)">
                  {rows.map((r) => (
                    <tr key={r.line}>
                      <td className="max-w-[260px] px-3 py-2">
                        <span className="block truncate font-medium">{r.title}</span>
                        {r.description ? <span className="block truncate text-xs text-(--text-muted)">{r.description.replace(/\n/g, " · ")}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular">{r.quantity.toLocaleString("de-AT", { maximumFractionDigits: 3 })} {r.unit ?? defaultUnit ?? "Std"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular">{fmtMoney(r.unitNetCents)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular">{r.vatRate} %</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular">{fmtMoney(netOf(r))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-(--border) text-sm">
                  <tr>
                    <td className="px-3 py-2 text-(--text-muted)" colSpan={3}>Netto {fmtMoney(totalNet)} · USt {fmtMoney(totalVat)}</td>
                    <td className="px-3 py-2 text-right text-(--text-muted)">Brutto</td>
                    <td className="px-3 py-2 text-right font-semibold tabular">{fmtMoney(totalNet + totalVat)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : null}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        danger
        title="Positionen ersetzen?"
        body="Die bisherigen Positionen werden durch die eingefügten ersetzt."
        confirmLabel="Ersetzen"
        onConfirm={() => apply(true)}
      />
    </>
  );
}
