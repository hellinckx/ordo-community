import type { Asset, Contact, Profile, SummaDocument, Transaction } from "../model/types";
import { ids } from "../model/ids";
import { nowIso } from "../model/types";
import { SPECIAL_CATEGORIES } from "../model/defaults";
import { roundCents, type Cents } from "../model/money";

export interface AfaYearResult {
  year: number;
  afaCents: Cents;
  bookValueStartCents: Cents;
  bookValueEndCents: Cents;
  /** Privatanteil der AfA (Korrektur KZ 9240 / 9260). */
  privateShareCents: Cents;
  /** Set in the disposal year: remaining book value expensed as "Buchwert abgegangener Anlagen". */
  bookValueAtDisposalCents?: Cents;
  /** "voll" (Ganzjahres-AfA) oder "halb" (Halbjahres-AfA, § 7 Abs. 2 EStG) */
  mode: "voll" | "halb" | "gwg" | "none";
}

function monthOf(iso: string) {
  return Number(iso.slice(5, 7));
}
function yearOf(iso: string) {
  return Number(iso.slice(0, 4));
}

/**
 * AfA-Plan nach § 7 EStG: lineare AfA über die Nutzungsdauer, Halbjahresregel bei Inbetriebnahme/Abgang
 * in der zweiten Jahreshälfte, degressive AfA (§ 7 Abs. 1a) mit max. 30 % vom Restbuchwert,
 * GWG (§ 13) sofort im Anschaffungsjahr.
 */
export function afaSchedule(asset: Asset): AfaYearResult[] {
  const out: AfaYearResult[] = [];
  const startDate = asset.inServiceDate ?? asset.acquisitionDate;
  const startYear = yearOf(startDate);
  const disposalYear = asset.disposedAt ? yearOf(asset.disposedAt) : undefined;
  const privatePct = Math.max(0, Math.min(100, asset.privateUsePct)) / 100;
  let book = asset.costCents;
  if (asset.method === "none") return out;

  if (asset.method === "gwg") {
    const afa = book;
    out.push({ year: yearOf(asset.acquisitionDate), afaCents: afa, bookValueStartCents: book, bookValueEndCents: 0, privateShareCents: roundCents(afa * privatePct), mode: "gwg" });
    return out;
  }

  const years = Math.max(1, asset.usefulLifeYears);
  const annualLinear = roundCents(asset.costCents / years);
  const lastYear = disposalYear ?? startYear + Math.ceil(years) + 1;
  let switchedLinear: number | undefined;

  for (let y = startYear; y <= lastYear && book > 0; y++) {
    let afa: Cents;
    let mode: AfaYearResult["mode"] = "voll";
    if (asset.method === "degressive") {
      afa = roundCents(book * (Math.min(30, asset.degressiveRatePct) / 100));
      // switch to linear when it yields more (allowed once)
      const elapsed = y - startYear - (y > startYear && monthOf(startDate) > 6 ? 0.5 : 0);
      const remainingYears = Math.max(0.5, years - elapsed);
      const linearRest = roundCents(book / remainingYears);
      if (switchedLinear === undefined && linearRest > afa) switchedLinear = linearRest;
      if (switchedLinear !== undefined) afa = switchedLinear;
    } else {
      afa = annualLinear;
    }
    if ((y === startYear && monthOf(startDate) > 6) || (disposalYear === y && asset.disposedAt && monthOf(asset.disposedAt) <= 6)) {
      afa = roundCents(afa / 2);
      mode = "halb";
    }
    if (afa > book) afa = book;
    const start = book;
    book -= afa;
    // Erinnerungswert: letztes Jahr voll abschreiben, wenn Rest minimal
    if (book > 0 && book < 100 && disposalYear === undefined) {
      afa += book;
      book = 0;
    }
    const row: AfaYearResult = { year: y, afaCents: afa, bookValueStartCents: start, bookValueEndCents: book, privateShareCents: roundCents(afa * privatePct), mode };
    if (disposalYear === y) {
      row.bookValueAtDisposalCents = book;
      book = 0;
      row.bookValueEndCents = 0;
    }
    out.push(row);
  }
  return out;
}

export function gwgLimitCents(year: number): number { return (year >= 2023 ? 1000 : year >= 2020 ? 800 : 400) * 100; }

export function afaForYear(asset: Asset, year: number): AfaYearResult {
  const schedule = afaSchedule(asset);
  const row = schedule.find((r) => r.year === year);
  return row ?? { year, afaCents: 0, bookValueStartCents: bookValueAt(asset, year - 1), bookValueEndCents: bookValueAt(asset, year), privateShareCents: 0, mode: "none",
    ...(asset.disposedAt?.startsWith(String(year)) ? { bookValueAtDisposalCents: asset.costCents - schedule.filter((r) => r.year <= year).reduce((sum, r) => sum + r.afaCents, 0) } : {}) };
}

/** Restbuchwert am Ende des Jahres. */
export function bookValueAt(asset: Asset, year: number): Cents {
  if (year < yearOf(asset.acquisitionDate)) return 0;
  if (asset.disposedAt && year >= yearOf(asset.disposedAt)) return 0;
  const rows = afaSchedule(asset);
  let book = asset.costCents;
  for (const r of rows) {
    if (r.year > year) break;
    book = r.bookValueEndCents;
  }
  return book;
}

/** Capitalised cost: includes non-deductible VAT, also under reverse charge and for small businesses. */
export function assetPurchaseCost(tx: Transaction, profile: Profile): Cents {
  const deductible = profile.vatRegime === "kleinunternehmer" ? 0 : Math.max(0, Math.min(100, tx.vatDeductiblePct)) / 100;
  const net = tx.vatLines.reduce((s, l) => s + l.netCents, 0) || tx.grossCents;
  const vat = tx.vatLines.reduce((s, l) => s + l.vatCents, 0);
  if (tx.vatTreatment === "reverse_charge" || tx.vatTreatment === "ig_erwerb") return net + roundCents(net * (tx.vatLines[0]?.rate || 20) / 100 * (1 - deductible));
  return tx.grossCents - roundCents(vat * deductible);
}

export function defaultAssetSettings(tx: Transaction): NonNullable<Transaction["assetSettings"]> {
  const name = tx.description.toLocaleLowerCase("de");
  const vehicle = /\b(pkw|auto|fahrzeug)\b/.test(name);
  const furniture = /möbel|schreibtisch|büroeinrichtung|schrank/.test(name);
  const machine = /maschine/.test(name);
  const none = /grundstück|grund und boden|kunstwerk/.test(name);
  return { inServiceDate: tx.date, usefulLifeYears: vehicle ? 8 : furniture ? 10 : machine ? 8 : 4,
    method: tx.categoryId === SPECIAL_CATEGORIES.gwg ? "gwg" : none ? "none" : "linear",
    degressiveRatePct: 30, privateUsePct: 0, ekrAccount: none ? "0200" : vehicle ? "0640" : machine ? "0400" : "0620" };
}

/** One linked asset per reviewed purchase. Parameter edits and later capitalised costs survive booking corrections. */
export function assetFromTransaction(tx: Transaction, profile: Profile, existing?: Asset, supplier?: Contact, document?: SummaDocument): Asset {
  const cost = assetPurchaseCost(tx, profile);
  const setup = tx.assetSettings ?? (existing ? {
    inServiceDate: existing.inServiceDate ?? existing.acquisitionDate, usefulLifeYears: existing.usefulLifeYears,
    method: existing.method, degressiveRatePct: existing.degressiveRatePct, privateUsePct: existing.privateUsePct, ekrAccount: existing.ekrAccount,
  } : defaultAssetSettings(tx));
  const now = nowIso();
  return { ...existing, ...setup, id: existing?.id ?? ids.asset(), profileId: tx.profileId,
    name: tx.description || existing?.name || "Anlage", acquisitionDate: tx.date,
    costCents: cost + (existing?.purchaseCostCents !== undefined ? existing.costCents - existing.purchaseCostCents : 0),
    purchaseCostCents: cost, transactionId: tx.id, categoryId: tx.categoryId,
    supplierName: supplier?.name ?? document?.extraction?.fields.vendorName ?? existing?.supplierName ?? "",
    supplierAddress: supplier && (supplier.street || supplier.zip || supplier.city) ? [supplier.street, [supplier.zip, supplier.city].filter(Boolean).join(" "), supplier.country].filter(Boolean).join(", ") : document?.extraction?.fields.vendorAddress ?? existing?.supplierAddress ?? "",
    inventoryNumber: existing?.inventoryNumber ?? "", notes: existing?.notes ?? "",
    createdAt: existing?.createdAt ?? now, updatedAt: now };
}

/** Sum of AfA for a profile and year plus the list of rows (Anlagenverzeichnis). */
export function anlagenverzeichnis(assets: Asset[], year: number) {
  const rows = assets
    .filter((a) => !a.deletedAt && yearOf(a.acquisitionDate) <= year)
    .map((a) => ({ asset: a, ...afaForYear(a, year) }));
  return {
    rows,
    afaTotalCents: rows.reduce((s, r) => s + r.afaCents, 0),
    bookValueTotalCents: rows.reduce((s, r) => s + r.bookValueEndCents, 0),
  };
}
