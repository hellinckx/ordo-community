import type { Asset } from "../model/types";
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
  const startYear = yearOf(asset.acquisitionDate);
  const disposalYear = asset.disposedAt ? yearOf(asset.disposedAt) : undefined;
  const privatePct = Math.max(0, Math.min(100, asset.privateUsePct)) / 100;
  let book = asset.costCents;

  if (asset.method === "gwg") {
    const afa = book;
    out.push({ year: startYear, afaCents: afa, bookValueStartCents: book, bookValueEndCents: 0, privateShareCents: roundCents(afa * privatePct), mode: "gwg" });
    return out;
  }

  const years = Math.max(1, asset.usefulLifeYears);
  const annualLinear = roundCents(asset.costCents / years);
  const lastYear = disposalYear ?? startYear + Math.ceil(years) + 1;

  for (let y = startYear; y <= lastYear && book > 0; y++) {
    let afa: Cents;
    let mode: AfaYearResult["mode"] = "voll";
    if (asset.method === "degressive") {
      afa = roundCents(book * (Math.min(30, asset.degressiveRatePct) / 100));
      // switch to linear when it yields more (allowed once)
      const remainingYears = Math.max(1, years - (y - startYear));
      const linearRest = roundCents(book / remainingYears);
      if (linearRest > afa) afa = linearRest;
    } else {
      afa = annualLinear;
    }
    if (y === startYear && monthOf(asset.acquisitionDate) > 6) {
      afa = roundCents(afa / 2);
      mode = "halb";
    }
    if (disposalYear === y && asset.disposedAt && monthOf(asset.disposedAt) <= 6) {
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

export function afaForYear(asset: Asset, year: number): AfaYearResult {
  const row = afaSchedule(asset).find((r) => r.year === year);
  return row ?? { year, afaCents: 0, bookValueStartCents: bookValueAt(asset, year - 1), bookValueEndCents: bookValueAt(asset, year), privateShareCents: 0, mode: "none" };
}

/** Restbuchwert am Ende des Jahres. */
export function bookValueAt(asset: Asset, year: number): Cents {
  if (year < yearOf(asset.acquisitionDate)) return 0;
  const rows = afaSchedule(asset);
  let book = asset.costCents;
  for (const r of rows) {
    if (r.year > year) break;
    book = r.bookValueEndCents;
  }
  return book;
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
