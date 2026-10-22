import { useState } from "react";
import { Archive, Database, FileJson, FileSpreadsheet, FileText, HardDriveDownload, Upload } from "lucide-react";
import { transactionsCsv, journalCsv, steuerberaterCsv, buildXlsx, exportJson, parseDataExport, mergeVaults, belegeZip, deriveJournal, fromCents, todayIso, type SheetSpec } from "@ordo/core";
import { BmdExportDialog } from "@/components/BmdExportDialog";
import { useList, useProfile, useVault } from "@/state/hooks";
import { requirePlatform, requireStore, useSession } from "@/state/session";
import { Button, Card, Field, PageHeader, Progress, Select } from "@/components/ui";
import { toast } from "@/state/toasts";
import { fmtMoney } from "@/lib/format";

export default function Exports() {
  const profile = useProfile();
  const vault = useVault();
  const txs = useList("transactions");
  const docs = useList("documents");
  const assets = useList("assets");
  const manual = useList("journalEntries");
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [bmdOpen, setBmdOpen] = useState(false);
  const inYear = (d: string) => year === "all" || d.startsWith(year);
  const txsYear = txs.filter((t) => inYear(t.date));
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error("Export fehlgeschlagen", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };
  const p = () => requirePlatform();
  const suffix = year === "all" ? "alle" : year;

  const exportXlsx = () =>
    run("xlsx", async () => {
      const cats = new Map(vault.categories.map((c) => [c.id, c]));
      const cons = new Map(vault.contacts.map((c) => [c.id, c.name]));
      const sheets: SheetSpec[] = [
        {
          name: "Buchungen",
          columns: [{ header: "Datum", key: "date", width: 12 }, { header: "Bezahlt", key: "paid", width: 12 }, { header: "Art", key: "kind", width: 10 }, { header: "Beschreibung", key: "desc", width: 36 }, { header: "Kontakt", key: "contact", width: 24 }, { header: "Kategorie", key: "cat", width: 28 }, { header: "Netto", key: "net", money: true }, { header: "USt", key: "vat", money: true }, { header: "Brutto", key: "gross", money: true }, { header: "USt-Satz", key: "rate", width: 9 }, { header: "KZ", key: "kz", width: 8 }, { header: "EKR", key: "ekr", width: 8 }, { header: "Zahlung", key: "pay", width: 12 }, { header: "Nr.", key: "no", width: 14 }, { header: "Geprüft", key: "rev", width: 8 }],
          rows: txsYear.sort((a, b) => a.date.localeCompare(b.date)).map((t) => {
            const c = t.categoryId ? cats.get(t.categoryId) : undefined;
            const sign = t.kind === "income" ? 1 : t.kind === "transfer" ? 0 : -1;
            const net = t.vatLines.reduce((s, l) => s + l.netCents, 0) || t.grossCents;
            const vat = t.vatLines.reduce((s, l) => s + l.vatCents, 0);
            return { date: t.date, paid: t.paidDate ?? "", kind: { expense: "Ausgabe", income: "Einnahme", transfer: "Umbuchung", private: "Privat" }[t.kind], desc: t.description, contact: t.contactId ? cons.get(t.contactId) : "", cat: c?.name ?? "", net: sign * net, vat: sign * vat, gross: sign * t.grossCents, rate: [...new Set(t.vatLines.map((l) => l.rate))].join("/"), kz: t.e1aKzOverride ?? c?.e1aKz ?? t.l1KzOverride ?? c?.l1Kz ?? "", ekr: t.ekrAccountOverride ?? c?.ekrAccount ?? "", pay: t.paymentMethod, no: t.invoiceNumber, rev: t.reviewed ? "ja" : "nein" };
          }),
          totals: true,
        },
        {
          name: "Kategorien",
          columns: [{ header: "Kategorie", key: "name", width: 34 }, { header: "Art", key: "kind", width: 10 }, { header: "Anzahl", key: "count", width: 8 }, { header: "Summe brutto", key: "sum", money: true }],
          rows: [...new Set(txsYear.map((t) => t.categoryId ?? ""))].map((id) => { const list = txsYear.filter((t) => (t.categoryId ?? "") === id); const c = cats.get(id); return { name: c?.name ?? "Ohne Kategorie", kind: c?.kind === "income" ? "Einnahme" : "Ausgabe", count: list.length, sum: list.reduce((s, t) => s + t.grossCents, 0) }; }).sort((a, b) => b.sum - a.sum),
          totals: true,
        },
        {
          name: "Anlagen",
          columns: [{ header: "Anlage", key: "name", width: 30 }, { header: "Anschaffung", key: "date", width: 12 }, { header: "Kosten", key: "cost", money: true }, { header: "Nutzungsdauer", key: "nd", width: 10 }, { header: "Methode", key: "method", width: 10 }],
          rows: assets.map((a) => ({ name: a.name, date: a.acquisitionDate, cost: a.costCents, nd: a.usefulLifeYears, method: a.method })),
        },
      ];
      const bytes = await buildXlsx(sheets, { title: `Ordo Export ${suffix}` });
      await p().saveFile(`Ordo_Buchungen_${suffix}.xlsx`, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    });

  const exportBelege = () =>
    run("zip", async () => {
      const store = requireStore();
      const selected = docs.filter((d) => d.status === "approved" || d.status === "review").filter((d) => { const t = d.transactionId ? txs.find((x) => x.id === d.transactionId) : undefined; return inYear(t?.date ?? d.extraction?.fields.invoiceDate ?? d.importedAt); });
      if (!selected.length) {
        toast.info("Keine Rechnungen im Zeitraum");
        return;
      }
      const bytes = await belegeZip({ documents: selected, transactions: txs, contacts: vault.contacts, categories: vault.categories, getBytes: (id) => store.getAttachmentBytes(id), onProgress: (d, t) => setProgress(d / t), extra: [{ path: "Buchungen.csv", bytes: transactionsCsv(txsYear, vault.categories, vault.contacts) }] });
      await p().saveFile(`Ordo_Rechnungen_${suffix}.zip`, bytes, "application/zip");
    });

  const exportVault = () =>
    run("vault", async () => {
      const store = requireStore();
      const bytes = await store.exportSealed();
      await p().saveFile(`Ordo_Sicherung_${todayIso()}.ordo`, bytes, "application/octet-stream");
      toast.success("Verschlüsselte Sicherung gespeichert", "Zum Wiederherstellen brauchst du dein Passwort.");
    });

  const exportJsonFile = () =>
    run("json", async () => {
      if (!confirm("Der JSON-Export ist UNVERSCHLÜSSELT und enthält alle Buchungsdaten (ohne die Rechnungsdateien). Fortfahren?")) return;
      await p().saveFile(`Ordo_Daten_${todayIso()}.json`, exportJson(vault), "application/json");
    });

  const importJsonFile = () =>
    run("import", async () => {
      const files = await p().pickFiles({ multiple: false, accept: [".json"] });
      const f = files[0];
      if (!f) return;
      const incoming = parseDataExport(f.bytes);
      const store = requireStore();
      const { vault: merged, added, updated } = mergeVaults(store.vault, incoming);
      store.mutate((v) => Object.assign(v, { ...merged, settings: v.settings }), { audit: { action: "import.json", entity: "vault", details: `${added} neu, ${updated} aktualisiert` } });
      toast.success("Import abgeschlossen", `${added} neue und ${updated} aktualisierte Einträge.`);
    });

  const journal = () => deriveJournal(profile, txs, assets, vault.categories, manual).filter((e) => inYear(e.date));

  const items = [
    { key: "xlsx", icon: <FileSpreadsheet className="h-5 w-5" />, title: "Excel-Arbeitsmappe", body: "Buchungen, Kategorien-Summen und Anlagen als .xlsx mit Summenzeilen und Filtern.", action: exportXlsx },
    { key: "csv", icon: <FileText className="h-5 w-5" />, title: "Buchungen als CSV", body: "Für Excel/Numbers (Semikolon, deutsches Zahlenformat).", action: () => run("csv", () => p().saveFile(`Summa_Buchungen_${suffix}.csv`, transactionsCsv(txsYear, vault.categories, vault.contacts), "text/csv").then(() => {})) },
    { key: "journal", icon: <FileText className="h-5 w-5" />, title: "Buchungsjournal (Doppik) CSV", body: "Alle Buchungssätze mit EKR-Konten, Soll/Haben.", action: () => run("journal", () => p().saveFile(`Summa_Journal_${suffix}.csv`, journalCsv(journal()), "text/csv").then(() => {})) },
    { key: "bmd", icon: <FileText className="h-5 w-5" />, title: "BMD-Buchungen (für die Kanzlei)", body: "Buchungsimport für BMD NTCS – Konto, Gegenkonto, Steuercode, Buchungssymbol. Codes und Symbole stellst du einmal passend zu deiner Kanzlei ein.", action: () => setBmdOpen(true) },
    { key: "stb", icon: <FileText className="h-5 w-5" />, title: "Export für Steuerberater", body: "Konto/Gegenkonto-Format (BMD/DATEV-ähnlich) zum Einlesen in Kanzleisoftware.", action: () => run("stb", () => p().saveFile(`Summa_Steuerberater_${suffix}.csv`, steuerberaterCsv(journal()), "text/csv").then(() => {})) },
    { key: "zip", icon: <Archive className="h-5 w-5" />, title: "Alle Rechnungen als ZIP", body: "Alle Original-Dateien, sauber benannt (Datum_Lieferant_Betrag), nach Jahr/Monat sortiert, inklusive Index-CSV – ideal für Betriebsprüfung oder Steuerberater.", action: exportBelege },
    { key: "vault", icon: <HardDriveDownload className="h-5 w-5" />, title: "Verschlüsselte Komplettsicherung (.ordo)", body: "Der gesamte Tresor inklusive Einstellungen. Wiederherstellbar auf jedem Gerät mit deinem Passwort. Rechnungsdateien separat über ZIP sichern.", action: exportVault, all: true },
    { key: "json", icon: <FileJson className="h-5 w-5" />, title: "Daten als JSON (unverschlüsselt)", body: "Maschinenlesbarer Rohdaten-Export für Migrationen und eigene Auswertungen.", action: exportJsonFile, all: true },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Export & Sicherung" subtitle={`${txsYear.length} Buchungen · ${fmtMoney(txsYear.reduce((s, t) => s + (t.kind === "income" ? t.grossCents : 0), 0))} Einnahmen im gewählten Zeitraum`} actions={<Field label="Zeitraum"><Select value={year} onChange={(e) => setYear(e.target.value)} className="w-32"><option value="all">Alle Jahre</option>{[...new Set(txs.map((t) => t.date.slice(0, 4)))].sort().reverse().map((y) => <option key={y} value={y}>{y}</option>)}{!txs.length ? <option value={String(new Date().getFullYear())}>{new Date().getFullYear()}</option> : null}</Select></Field>} />
      {progress !== null ? <Progress value={progress} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((it) => (
          <Card key={it.key}>
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="shrink-0 rounded-xl bg-brand-50 p-2 text-brand-700 dark:bg-brand-900/30">{it.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{it.title}</div>
                  <div className="mt-0.5 text-sm text-(--text-muted)">{it.body}</div>
                </div>
              </div>
              <div className="mt-auto flex justify-end">
                <Button size="sm" variant="outline" loading={busy === it.key} onClick={() => void it.action()}>Exportieren</Button>
              </div>
            </div>
          </Card>
        ))}
        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-(--surface-2) p-2"><Upload className="h-5 w-5" /></div>
            <div className="flex-1"><div className="font-medium">JSON-Daten importieren</div><div className="mt-0.5 text-sm text-(--text-muted)">Zusammenführen mit vorhandenen Daten (neuere Einträge gewinnen).</div></div>
            <Button size="sm" variant="outline" loading={busy === "import"} onClick={importJsonFile}>Importieren</Button>
          </div>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-(--surface-2) p-2"><Database className="h-5 w-5" /></div>
            <div className="flex-1"><div className="font-medium">Speicherort</div><div className="mt-0.5 text-sm text-(--text-muted)">{useSession.getState().platform?.storage.describe()} · Tresor-Revision {vault.revision} · zuletzt gespeichert {useSession.getState().store?.lastSavedAt ? new Date(useSession.getState().store!.lastSavedAt!).toLocaleTimeString("de-AT") : "–"}</div></div>
          </div>
        </Card>
      </div>
      {bmdOpen ? <BmdExportDialog onClose={() => setBmdOpen(false)} entries={journal()} transactions={txs} fileSuffix={suffix} /> : null}
      <p className="text-xs text-(--text-muted)">Hinweis: Beträge in CSV/Excel sind in Euro mit Vorzeichen (Einnahmen +, Ausgaben −). {fromCents(0) === 0 ? "" : ""}</p>
    </div>
  );
}
