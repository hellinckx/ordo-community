import { useState } from "react";
import { FileUp } from "lucide-react";
import { assetsCsvTemplate, parseAssetsCsv, validateAsset, nowIso, type Asset } from "@ordo/core";
import { requirePlatform, requireStore } from "@/state/session";
import { useList, useProfile } from "@/state/hooks";
import { Button, Checkbox, Field, Input, Modal } from "./ui";
import { FileDropHint } from "./FileDropHint";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/state/toasts";

export function AssetImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useProfile();
  const existing = useList("assets");
  const transactions = useList("transactions");
  const [rows, setRows] = useState<Asset[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [opening, setOpening] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const read = async (files: { name: string; bytes: Uint8Array }[]) => {
    if (!files.length) return;
    try {
      if (files.length !== 1 || !/\.csv$/i.test(files[0]!.name)) throw new Error("Bitte genau eine CSV-Datei mit Anlagendaten auswählen.");
      const parsed = parseAssetsCsv(new TextDecoder().decode(files[0]!.bytes), profile.id);
      setRows(parsed.assets); setErrors(parsed.errors);
    } catch (e) { setRows([]); setErrors([e instanceof Error ? e.message : String(e)]); }
  };
  const select = async () => {
    setBusy(true);
    try { await read(await requirePlatform().pickFiles({ multiple: false, accept: [".csv"] })); }
    catch (e) { toast.error("Datei konnte nicht gelesen werden", e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const prepared = rows.map((a) => ({ ...a, openingBalanceDate: a.openingBalanceDate ?? (opening && !a.transactionId && a.acquisitionDate < `${year}-01-01` && a.method !== "gwg" ? `${year}-01-01` : undefined) }));
  const issues = [...errors, ...(opening && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) ? ["Bitte ein gültiges Eröffnungsjahr bis zum aktuellen Jahr wählen."] : []), ...prepared.flatMap((a) => {
    if (a.profileId !== profile.id) return ["Das Profil wurde gewechselt. Bitte die Datei für dieses Profil erneut auswählen."];
    const issue = validateAsset(a);
    if (issue) return [`${a.name}: ${issue}`];
    if (a.transactionId && !transactions.some((t) => t.id === a.transactionId && t.kind === "expense")) return [`${a.name}: Die verknüpfte Anschaffungsbuchung fehlt in diesem Profil.`];
    if (a.transactionId && (prepared.some((other) => other.id !== a.id && other.transactionId === a.transactionId) || existing.some((other) => other.id !== a.id && other.transactionId === a.transactionId))) return [`${a.name}: Die Buchung gehört bereits zu einer anderen Anlage.`];
    const sale = a.disposalTransactionId ? transactions.find((t) => t.id === a.disposalTransactionId && t.kind === "income") : undefined;
    if (a.disposalTransactionId && (!sale || sale.date !== a.disposedAt)) return [`${a.name}: Verkaufsbuchung fehlt oder ihr Datum stimmt nicht mit dem Abgang überein.`];
    if (a.disposalTransactionId && (prepared.some((other) => other.id !== a.id && other.disposalTransactionId === a.disposalTransactionId) || existing.some((other) => other.id !== a.id && other.disposalTransactionId === a.disposalTransactionId))) return [`${a.name}: Die Verkaufsbuchung gehört bereits zu einer anderen Anlage.`];
    if ((a.disposalProceedsCents ?? 0) > 0 && !a.disposalTransactionId && (!a.disposedAt || a.disposedAt >= `${year}-01-01`)) return [`${a.name}: Für den Anlagenverkauf bitte eine vorhandene Einnahmenbuchung in „Verkaufsbuchung-ID“ angeben.`];
    if (existing.some((old) => old.id !== a.id && ((a.inventoryNumber && old.inventoryNumber === a.inventoryNumber) || (old.name === a.name && old.acquisitionDate === a.acquisitionDate && old.costCents === a.costCents)))) return [`${a.name}: Eine passende Anlage existiert bereits. Zum Aktualisieren bitte deren ID aus dem Export verwenden.`];
    if (requireStore().vault.assets.some((old) => old.id === a.id && old.deletedAt)) return [`${a.name}: Diese Anlage liegt im Papierkorb. Bitte zuerst wiederherstellen.`];
    const collision = requireStore().vault.assets.find((other) => other.id === a.id && other.profileId !== profile.id);
    return collision ? [`${a.name}: Diese Anlagen-ID gehört zu einem anderen Profil.`] : [];
  })];
  const updates = prepared.filter((a) => existing.some((old) => old.id === a.id)).length;
  const save = () => {
    if (!prepared.length || issues.length) return;
    const store = requireStore();
    if (store.activeProfile.id !== profile.id) return;
    store.mutate((v) => {
      const incoming = new Map(prepared.map((a) => [a.id, a]));
      v.assets = [...v.assets.map((old) => incoming.has(old.id) ? { ...old, ...incoming.get(old.id)!, createdAt: old.createdAt, updatedAt: nowIso() } : old), ...prepared.filter((a) => !v.assets.some((old) => old.id === a.id))];
      v.transactions = v.transactions.map((tx) => {
        const a = prepared.find((item) => item.transactionId === tx.id);
        if (a) return { ...tx, assetId: a.id, ekrAccountOverride: a.method === "gwg" ? "7030" : a.ekrAccount, assetSettings: { inServiceDate: a.inServiceDate ?? a.acquisitionDate, method: a.method, usefulLifeYears: a.usefulLifeYears, degressiveRatePct: a.degressiveRatePct, privateUsePct: a.privateUsePct, ekrAccount: a.ekrAccount }, updatedAt: nowIso() };
        return prepared.some((item) => item.disposalTransactionId === tx.id) ? { ...tx, categoryId: "cat_b_in_anlage", ekrAccountOverride: "4600", e1aKzOverride: "9060", updatedAt: nowIso() } : tx;
      });
    }, { audit: { action: "assets.import", entity: "assets", details: `${prepared.length}` } });
    toast.success(`${prepared.length} Anlagen übernommen`, `${updates} aktualisiert, ${prepared.length - updates} neu.`);
    onClose();
  };
  return <Modal open={open} onClose={onClose} title="Anlageverzeichnis importieren" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={save} disabled={busy || !prepared.length || !!issues.length}>{prepared.length ? `${prepared.length} Anlagen übernehmen` : "Übernehmen"}</Button></>}>
    <div className="space-y-4" data-own-drop="asset-import" onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={async (e) => {
      e.preventDefault(); e.stopPropagation();
      try { await read(await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })))); }
      catch (error) { setErrors([error instanceof Error ? error.message : String(error)]); }
    }}>
      <p className="text-sm text-(--text-muted)">CSV mit ursprünglichen Anschaffungskosten, Nutzungsdauer, Lieferant und Abschreibungsmethode. Exportierte Anlagen werden anhand ihrer ID aktualisiert. Die Übernahme erfolgt erst nach deiner Prüfung.</p>
      <FileDropHint disabled={busy} onChoose={() => void select()}>CSV-Datei hierher ziehen oder auswählen</FileDropHint>
      <Button variant="outline" size="sm" onClick={async () => { await requirePlatform().saveFile("Ordo_Anlagen_Vorlage.csv", assetsCsvTemplate(), "text/csv"); }}><FileUp className="h-4 w-4" /> CSV-Vorlage herunterladen</Button>
      <Checkbox label="Für Altanlagen ohne Anschaffungsbuchung eine Eröffnungsbuchung erzeugen" checked={opening} onChange={setOpening} />
      {opening ? <Field label="Eröffnungsjahr" hint="Zum 1. Jänner: ursprüngliche Kosten und bisherige AfA gegen Eigenkapital (9000). Keine erneute Zahlung oder Vorsteuer."><Input type="number" min={1900} max={new Date().getFullYear()} value={year} onChange={(e) => setYear(Number(e.target.value))} /></Field> : null}
      {issues.length ? <ul role="alert" className="max-h-40 overflow-y-auto space-y-1 text-sm text-red-700 dark:text-red-300">{issues.map((error, i) => <li key={i}>{error}</li>)}</ul> : null}
      {rows.length ? <><p className="text-sm">{prepared.length - updates} neue Anlagen · {updates} bestehende Anlagen werden aktualisiert</p><div className="max-h-64 overflow-auto rounded-xl border border-(--border)"><table className="w-full text-sm"><thead><tr className="text-left text-(--text-muted)"><th className="p-2">Anlage</th><th className="p-2">Anschaffung</th><th className="p-2 text-right">Kosten</th><th className="p-2">Methode</th></tr></thead><tbody>{prepared.map((a) => <tr key={a.id} className="border-t border-(--border)"><td className="p-2">{a.name}</td><td className="p-2">{a.acquisitionDate}</td><td className="p-2 text-right tabular whitespace-nowrap">{fmtMoney(a.costCents)}</td><td className="p-2">{a.method === "none" ? "Keine AfA" : a.method}</td></tr>)}</tbody></table></div>
        {prepared.some((a) => !a.transactionId && !a.openingBalanceDate && a.method !== "gwg") ? <p className="text-sm text-amber-700 dark:text-amber-300">Einige Anlagen haben weder eine Anschaffungs- noch eine Eröffnungsbuchung. Verknüpfe sie nach der Übernahme mit ihrer Buchung, damit der Buchwert auch in der Bilanz erfasst ist.</p> : null}</> : null}
    </div>
  </Modal>;
}
