/**
 * Steuerliche Eckwerte Österreich. Werte pro Veranlagungsjahr; bei unbekanntem Jahr wird das
 * nächstliegende bekannte Jahr verwendet. Quellen: BMF, WKO (Stand Oktober 2026).
 */

export interface TariffBracket {
  /** Obergrenze des Einkommens in Euro (inklusive); Infinity für die letzte Stufe. */
  upTo: number;
  rate: number; // 0.2 = 20 %
}

export interface YearConstants {
  year: number;
  /** Einkommensteuertarif § 33 Abs. 1 EStG */
  tariff: TariffBracket[];
  /** Kleinunternehmergrenze USt § 6 Abs. 1 Z 27 (brutto, Jahr) */
  kleinunternehmerGrenze: number;
  kleinunternehmerToleranzPct: number;
  /** UVA monatlich, wenn Vorjahresumsatz über dieser Grenze */
  uvaMonthlyAbove: number;
  /** Keine UVA-Pflicht (nur USt-Jahreserklärung), wenn Vorjahresumsatz bis zu dieser Grenze */
  uvaExemptUpTo: number;
  /** Geringwertige Wirtschaftsgüter § 13 EStG (netto) */
  gwgGrenze: number;
  /** Basispauschalierung § 17 Abs. 1 EStG */
  basisPauschale: { umsatzGrenze: number; regularPct: number; regularMax: number; servicePct: number; serviceMax: number };
  /** Kleinunternehmerpauschalierung § 17 Abs. 3a EStG */
  kuPauschale: { umsatzGrenze: number; regularPct: number; regularMax: number; servicePct: number; serviceMax: number };
  /** Gewinnfreibetrag § 10 EStG */
  gewinnfreibetrag: { grundPct: number; grundBasisMax: number; stufen: { upTo: number; pct: number }[]; max: number };
  /** Kilometergeld, Taggeld, Nächtigungsgeld */
  kilometergeldPkw: number;
  taggeldInland: number;
  naechtigungsgeldInland: number;
  /** Werbungskostenpauschale § 16 Abs. 3 EStG */
  werbungskostenPauschale: number;
  /** Kleines/großes Arbeitsplatzpauschale § 4 Abs. 4 Z 8 EStG */
  arbeitsplatzpauschaleKlein: number;
  arbeitsplatzpauschaleGross: number;
  /** Homeoffice-/Telearbeitspauschale pro Tag und max. Tage */
  telearbeitPauschaleProTag: number;
  telearbeitMaxTage: number;
  /** Ergonomisches Mobiliar max. */
  ergonomischesMobiliarMax: number;
  /** Selbstbehalt außergewöhnliche Belastungen § 34 Abs. 4 */
  agbSelbstbehalt: { upTo: number; pct: number }[];
}

const AT_2025: YearConstants = {
  year: 2025,
  tariff: [
    { upTo: 13308, rate: 0 },
    { upTo: 21617, rate: 0.2 },
    { upTo: 35836, rate: 0.3 },
    { upTo: 69166, rate: 0.4 },
    { upTo: 103072, rate: 0.48 },
    { upTo: 1000000, rate: 0.5 },
    { upTo: Infinity, rate: 0.55 },
  ],
  kleinunternehmerGrenze: 55000,
  kleinunternehmerToleranzPct: 10,
  uvaMonthlyAbove: 100000,
  uvaExemptUpTo: 55000,
  gwgGrenze: 1000,
  basisPauschale: { umsatzGrenze: 320000, regularPct: 13.5, regularMax: 43200, servicePct: 6, serviceMax: 19200 },
  kuPauschale: { umsatzGrenze: 55000, regularPct: 45, regularMax: 24750, servicePct: 20, serviceMax: 11000 },
  gewinnfreibetrag: {
    grundPct: 15,
    grundBasisMax: 33000,
    stufen: [
      { upTo: 178000, pct: 13 },
      { upTo: 353000, pct: 7 },
      { upTo: 583000, pct: 4.5 },
    ],
    max: 46400,
  },
  kilometergeldPkw: 0.5,
  taggeldInland: 30,
  naechtigungsgeldInland: 17,
  werbungskostenPauschale: 132,
  arbeitsplatzpauschaleKlein: 300,
  arbeitsplatzpauschaleGross: 1200,
  telearbeitPauschaleProTag: 3,
  telearbeitMaxTage: 100,
  ergonomischesMobiliarMax: 300,
  agbSelbstbehalt: [
    { upTo: 7300, pct: 6 },
    { upTo: 14600, pct: 8 },
    { upTo: 36400, pct: 10 },
    { upTo: Infinity, pct: 12 },
  ],
};

const AT_2026: YearConstants = {
  ...AT_2025,
  year: 2026,
  tariff: [
    { upTo: 13539, rate: 0 },
    { upTo: 21992, rate: 0.2 },
    { upTo: 36458, rate: 0.3 },
    { upTo: 70365, rate: 0.4 },
    { upTo: 104859, rate: 0.48 },
    { upTo: 1000000, rate: 0.5 },
    { upTo: Infinity, rate: 0.55 },
  ],
  basisPauschale: { umsatzGrenze: 420000, regularPct: 15, regularMax: 63000, servicePct: 6, serviceMax: 25200 },
};

const YEARS: Record<number, YearConstants> = { 2025: AT_2025, 2026: AT_2026 };

export function constantsFor(year: number): YearConstants {
  if (YEARS[year]) return YEARS[year]!;
  const known = Object.keys(YEARS).map(Number).sort((a, b) => a - b);
  if (year < known[0]!) return YEARS[known[0]!]!;
  return YEARS[known[known.length - 1]!]!;
}

export const VAT_RATE_LABELS: Record<number, string> = {
  0: "0 % (steuerfrei)",
  10: "10 % ermäßigt",
  13: "13 % ermäßigt",
  19: "19 % Jungholz/Mittelberg",
  20: "20 % Normalsteuersatz",
};

/** Belege sind 7 Jahre aufzubewahren (§ 132 BAO). */
export const AUFBEWAHRUNG_JAHRE = 7;
