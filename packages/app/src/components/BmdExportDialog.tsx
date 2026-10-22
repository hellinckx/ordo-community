import { useState } from "react";
import { Download } from "lucide-react";
import { bmdBuchungen, type BmdOptions, type BmdSymbolKind, type BmdTaxKind, type DerivedEntry, type Transaction } from "@ordo/core";
import { Button, Checkbox, Field, Input, Modal, Select } from "@/components/ui";
import { requirePlatform } from "@/state/session";
import { toast } from "@/state/toasts";

const KEY = "ordo.bmd.options";

const SYMBOLS: { k: BmdSymbolKind; label: string }[] = [
  { k: "AR", label: "Ausgangsrechnungen" },
  { k: "ER", label: "Eingangsrechnungen" },
  { k: "BK", label: "Bank" },
  { k: "KA", label: "Kassa" },
  { k: "SO", label: "Sonstige" },
];
const CODES: { k: BmdTaxKind; label: string; fallback: string }[] = [
  { k: "output", label: "Umsatzsteuer (Soll)", fallback: "03" },
  { k: "input", label: "Vorsteuer", fallback: "00" },
  { k: "igErwerb", label: "ig. Erwerb", fallback: "09" },
  { k: "reverseCharge", label: "Reverse Charge", fallback: "19" },
];

type Saved = Required<Pick<BmdOptions, "istBesteuerung" | "encoding">> & { symbols: Partial<Record<BmdSymbolKind, string>>; taxCodes: Partial<Record<BmdTaxKind, string>> };

function load(): Saved {
  try {
    return { istBesteuerung: false, encoding: "windows-1252", symbols: {}, taxCodes: {}, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { istBesteuerung: false, encoding: "windows-1252", symbols: {}, taxCodes: {} };
  }
}

/** BMD NTCS booking import – with the client-specific symbols and tax codes the firm uses (remembered on this device). */
export function BmdExportDialog({ onClose, entries, transactions, fileSuffix }: { onClose: () => void; entries: DerivedEntry[]; transactions: Transaction[]; fileSuffix: string }) {
  const [o, setO] = useState<Saved>(load);
  const save = async () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch {
      /* private mode */
    }
    const refs = new Map(transactions.map((t) => [t.id, t.invoiceNumber || t.reference]));
    const r = bmdBuchungen(entries, { ...o, references: refs });
    await requirePlatform().saveFile(`BMD_Buchungen_${fileSuffix}.csv`, r.bytes, "text/csv");
    if (r.warnings.length) toast.warning(`${r.rows} Zeilen exportiert – ${r.warnings.length} Hinweise`, r.warnings.slice(0, 2).join(" "));
    else toast.success(`${r.rows} Zeilen exportiert`, "Datei an die Kanzlei schicken – dort unter Buchen → Buchungen importieren.");
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="BMD-Buchungen exportieren" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={() => void save()} disabled={!entries.length}><Download className="h-4 w-4" /> {entries.length} Buchungen exportieren</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-(--text-muted)">CSV im BMD-Standardformat (satzart, konto, gkto, belegdat, steucod, bucod, betrag, steuer …). Ordo bucht auf die Sammelkonten des Einheitskontenrahmens (2000 Kunden, 3300 Lieferanten); die Kanzlei ordnet bei Bedarf auf Personenkonten um. Buchungssymbole und Steuercodes sind in jeder Kanzlei anders – frag beim ersten Mal kurz nach.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox label="Ist-Besteuerung (USt nach Zahlung)" hint="Für viele Dienstleister; setzt Steuercode 01 statt 03." checked={o.istBesteuerung} onChange={(b) => setO({ ...o, istBesteuerung: b })} />
          <Field label="Zeichensatz"><Select value={o.encoding} onChange={(e) => setO({ ...o, encoding: e.target.value as Saved["encoding"] })}><option value="windows-1252">Windows (ANSI) – Standard für BMD</option><option value="utf-8">UTF-8</option></Select></Field>
        </div>
        <details className="rounded-xl bg-(--surface-2) p-3">
          <summary className="cursor-pointer font-medium">Buchungssymbole und Steuercodes deiner Kanzlei</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-5">
            {SYMBOLS.map((s) => <Field key={s.k} label={s.label}><Input value={o.symbols[s.k] ?? ""} placeholder={s.k} onChange={(e) => setO({ ...o, symbols: { ...o.symbols, [s.k]: e.target.value.trim() || undefined } })} /></Field>)}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            {CODES.map((c) => <Field key={c.k} label={c.label}><Input value={o.taxCodes[c.k] ?? ""} placeholder={c.fallback} onChange={(e) => setO({ ...o, taxCodes: { ...o.taxCodes, [c.k]: e.target.value.trim() || undefined } })} /></Field>)}
          </div>
        </details>
      </div>
    </Modal>
  );
}
