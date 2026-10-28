import { AssetSchema, nowIso, type Asset } from "../model/types";
import { ids } from "../model/ids";
import { afaForYear, gwgLimitCents } from "../accounting/assets";
import { parseCsvRows } from "../bank/parse";
import { toCsv } from "./csv";

const HEADERS = ["ID", "Bezeichnung", "Anschaffungsdatum", "Inbetriebnahme", "Kosten EUR", "Nutzungsdauer", "Methode", "Degressiver Satz %", "Privatanteil %", "EKR-Konto", "Lieferant", "Lieferantenanschrift", "Inventarnummer", "Abgang", "Erlös EUR", "Eröffnungsdatum", "Buchung-ID", "Notizen", "Verkaufsbuchung-ID", "GFB geprüft"];

/** Full register, including original costs and calculation parameters so it can be imported again. */
export function assetsCsv(assets: Asset[], year: number): Uint8Array {
  return toCsv([...HEADERS, `AfA ${year} EUR`, `Buchwert 31.12.${year} EUR`], assets.filter((a) => !a.deletedAt).map((a) => {
    const r = afaForYear(a, year);
    return [a.id, a.name, a.acquisitionDate, a.inServiceDate, a.costCents / 100, a.usefulLifeYears, a.method, a.degressiveRatePct,
      a.privateUsePct, a.ekrAccount, a.supplierName, a.supplierAddress, a.inventoryNumber, a.disposedAt,
      a.disposalProceedsCents === undefined ? "" : a.disposalProceedsCents / 100, a.openingBalanceDate, a.transactionId, a.notes,
      a.disposalTransactionId, a.gfbEligible ? "ja" : "nein", r.afaCents / 100, r.bookValueEndCents / 100];
  }));
}

export function assetsCsvTemplate(): Uint8Array { return toCsv(HEADERS, []); }

export function validateAsset(asset: Asset): string | null {
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (!asset.name.trim() || !Number.isSafeInteger(asset.costCents) || asset.costCents <= 0) return "Bezeichnung und positive Anschaffungskosten sind nötig.";
  if (![asset.acquisitionDate, asset.inServiceDate, asset.disposedAt, asset.openingBalanceDate].filter((d): d is string => !!d).every(validDate)) return "Bitte gültige Datumswerte eingeben.";
  if (asset.inServiceDate && asset.inServiceDate < asset.acquisitionDate) return "Die Inbetriebnahme darf nicht vor der Anschaffung liegen.";
  if (asset.disposedAt && asset.disposedAt < asset.acquisitionDate) return "Der Abgang darf nicht vor der Anschaffung liegen.";
  if (asset.disposedAt && asset.inServiceDate && asset.disposedAt < asset.inServiceDate) return "Der Abgang darf nicht vor der Inbetriebnahme liegen.";
  if (!Number.isFinite(asset.usefulLifeYears) || asset.usefulLifeYears < 1 || asset.usefulLifeYears > 100) return "Die Nutzungsdauer muss zwischen 1 und 100 Jahren liegen.";
  if (!Number.isFinite(asset.privateUsePct) || asset.privateUsePct < 0 || asset.privateUsePct > 100) return "Der Privatanteil muss zwischen 0 und 100 % liegen.";
  if (asset.method === "degressive" && (!Number.isFinite(asset.degressiveRatePct) || asset.degressiveRatePct <= 0 || asset.degressiveRatePct > 30)) return "Der degressive Satz muss größer als 0 und höchstens 30 % sein.";
  if (asset.method === "gwg" && asset.costCents > gwgLimitCents(Number(asset.acquisitionDate.slice(0, 4)))) return "Die Kosten dieses Wirtschaftsguts überschreiten die GWG-Grenze. Reguläre AfA wählen oder einzelne Wirtschaftsgüter getrennt erfassen.";
  if (asset.method === "degressive" && asset.acquisitionDate < "2020-07-01") return "Degressive AfA ist für Anschaffungen vor dem 1. Juli 2020 nicht vorgesehen.";
  if (asset.gfbEligible && (asset.method === "gwg" || asset.method === "none" || asset.usefulLifeYears < 4)) return "Der investitionsbedingte Gewinnfreibetrag setzt ein begünstigtes abnutzbares Wirtschaftsgut mit mindestens vier Jahren Nutzungsdauer voraus; GWG sind ausgeschlossen.";
  if (!/^0\d{3}$/.test(asset.ekrAccount) || asset.ekrAccount === "0690") return "Bitte ein Anlagekonto der Kontenklasse 0 wählen, kein Abschreibungskonto.";
  if (asset.openingBalanceDate && (!asset.openingBalanceDate.endsWith("-01-01") || asset.acquisitionDate >= asset.openingBalanceDate || asset.transactionId)) return "Eine Eröffnungsbuchung ist nur für ältere Anlagen ohne verknüpfte Anschaffungsbuchung zum 1. Jänner möglich.";
  return null;
}

export function parseAssetsCsv(text: string, profileId: string): { assets: Asset[]; errors: string[] } {
  const rows = parseCsvRows(text);
  const headers = rows.shift()?.map((h) => h.trim()) ?? [];
  const errors: string[] = [];
  const assets: Asset[] = [];
  for (const required of ["Bezeichnung", "Anschaffungsdatum", "Kosten EUR", "Nutzungsdauer", "Methode"]) if (!headers.includes(required)) errors.push(`Spalte „${required}“ fehlt. Bitte die CSV-Vorlage verwenden.`);
  if (errors.length) return { assets, errors };
  const number = (value: string, fallback = 0) => value.trim() ? Number(value.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(?:\.|,))/g, "").replace(",", ".")) : fallback;
  const date = (value: string) => value.trim().replace(/^(\d{2})\.(\d{2})\.(\d{4})$/, "$3-$2-$1");
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const get = (name: string) => row[headers.indexOf(name)]?.trim() ?? "";
    const now = nowIso();
    const result = AssetSchema.safeParse({ id: get("ID") || ids.asset(), profileId, name: get("Bezeichnung"), acquisitionDate: date(get("Anschaffungsdatum")),
      inServiceDate: date(get("Inbetriebnahme")) || undefined, costCents: Math.round(number(get("Kosten EUR")) * 100), usefulLifeYears: number(get("Nutzungsdauer")),
      method: ({ linear: "linear", degressiv: "degressive", degressive: "degressive", gwg: "gwg", keine: "none", none: "none" } as Record<string, string>)[get("Methode").toLowerCase()] ?? get("Methode"),
      degressiveRatePct: number(get("Degressiver Satz %"), 30), privateUsePct: number(get("Privatanteil %")), ekrAccount: (get("EKR-Konto") || "0620").padStart(4, "0"),
      supplierName: get("Lieferant"), supplierAddress: get("Lieferantenanschrift"), inventoryNumber: get("Inventarnummer"), disposedAt: date(get("Abgang")) || undefined,
      disposalProceedsCents: get("Erlös EUR") ? Math.round(number(get("Erlös EUR")) * 100) : undefined, openingBalanceDate: date(get("Eröffnungsdatum")) || undefined,
      transactionId: get("Buchung-ID") || undefined, disposalTransactionId: get("Verkaufsbuchung-ID") || undefined, gfbEligible: get("GFB geprüft") ? /^(ja|true|1)$/i.test(get("GFB geprüft")) : undefined, notes: get("Notizen"), createdAt: now, updatedAt: now });
    if (!result.success) { errors.push(`Zeile ${index + 2}: Ungültige Anlagendaten (${result.error.issues.map((i) => i.path.join(".")).join(", ")}).`); return; }
    const error = validateAsset(result.data);
    if (error) { errors.push(`Zeile ${index + 2}: ${error}`); return; }
    if (seen.has(result.data.id)) { errors.push(`Zeile ${index + 2}: Die Anlagen-ID kommt mehrfach vor.`); return; }
    seen.add(result.data.id);
    assets.push(result.data);
  });
  if (!rows.length) errors.push("Die Datei enthält noch keine Anlagen. Ergänze unter den Spaltenüberschriften deine Anlagendaten.");
  return { assets, errors };
}
