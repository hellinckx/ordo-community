import type { Category, EmployeeInfo, Profile, Transaction } from "../../model/types";
import { roundCents, type Cents } from "../../model/money";
import { L1_KENNZAHLEN, kzLabel } from "./kennzahlen";
import { constantsFor } from "./constants";
import { estimateTaxableFromMonthlyGross, marginalRate } from "./tariff";

export interface L1Line {
  kz: string;
  label: string;
  section: string;
  amountCents: Cents;
  rawCents: Cents;
  transactionIds: string[];
  note?: string;
}

export interface L1Result {
  year: number;
  profileId: string;
  kz: Record<string, Cents>;
  lines: L1Line[];
  werbungskostenCents: Cents;
  sonderausgabenCents: Cents;
  agbMitSelbstbehaltCents: Cents;
  agbOhneSelbstbehaltCents: Cents;
  selbstbehaltCents: Cents;
  selbstbehaltPct: number;
  taxableIncomeEstimateCents: Cents;
  marginalRate: number;
  estimatedRefundCents: Cents;
  privateExpensesCents: Cents;
  incomeCents: Cents;
  warnings: string[];
  info: { transactionCount: number; unreviewed: number; uncategorized: number };
}

const WK_KZ = new Set(["717", "274", "719", "169", "158", "159", "720", "721", "722", "300", "723", "724", "718", "916"]);
const SA_KZ = new Set(["460", "280", "458", "281", "282", "455", "456"]);
const AGB_SB_KZ = new Set(["730", "731", "734", "735"]);
const AGB_OHNE_KZ = new Set(["475", "476"]);

export function computeL1(profile: Profile, year: number, transactions: Transaction[], categories: Category[], employee: EmployeeInfo | undefined): L1Result {
  const c = constantsFor(year);
  const catById = new Map(categories.map((x) => [x.id, x]));
  const raw: Record<string, Cents> = {};
  const txByKz: Record<string, string[]> = {};
  const warnings: string[] = [];
  let count = 0;
  let unreviewed = 0;
  let uncategorized = 0;
  let privateExpenses = 0;
  let income = 0;

  for (const tx of transactions) {
    if (tx.deletedAt || tx.profileId !== profile.id) continue;
    if (tx.kind === "transfer") continue;
    const d = tx.paidDate ?? tx.date;
    if (!d.startsWith(String(year))) continue;
    count++;
    if (!tx.reviewed) unreviewed++;
    const cat = tx.categoryId ? catById.get(tx.categoryId) : undefined;
    if (!cat) uncategorized++;
    if (tx.kind === "income") {
      income += tx.grossCents;
      continue;
    }
    const code = tx.l1KzOverride ?? cat?.l1Kz;
    if (!code) {
      privateExpenses += tx.grossCents;
      continue;
    }
    raw[code] = (raw[code] ?? 0) + tx.grossCents;
    (txByKz[code] ??= []).push(tx.id);
  }

  if (employee?.pendlerpauschaleCents) raw["718"] = (raw["718"] ?? 0) + employee.pendlerpauschaleCents;
  if (employee?.pendlereuroCents) raw["916"] = (raw["916"] ?? 0) + employee.pendlereuroCents;

  // Caps and rules
  const kz: Record<string, Cents> = {};
  const notes: Record<string, string> = {};
  for (const [code, amount] of Object.entries(raw)) {
    let v = amount;
    if (code === "158") {
      const cap = c.ergonomischesMobiliarMax * 100;
      if (v > cap) {
        notes[code] = `Auf ${c.ergonomischesMobiliarMax} € pro Jahr gedeckelt; der Rest kann im Folgejahr geltend gemacht werden.`;
        v = cap;
      }
    }
    if (code === "458") {
      const cap = 60000;
      if (v > cap) {
        notes[code] = "Kirchenbeitrag max. 600 € pro Jahr.";
        v = cap;
      }
      notes[code] = (notes[code] ? notes[code] + " " : "") + "Wird vom Empfänger automatisch gemeldet – nur bei Abweichung eintragen.";
    }
    if (code === "169" && employee?.homeofficeDays) {
      const pauschale = Math.min(employee.homeofficeDays, c.telearbeitMaxTage) * c.telearbeitPauschaleProTag * 100;
      notes[code] = `Abzüglich erhaltener Telearbeitspauschale (${employee.homeofficeDays} Tage ≈ ${(pauschale / 100).toFixed(2)} €), falls vom Arbeitgeber ausbezahlt.`;
    }
    if (code === "455" || code === "456") notes[code] = "Nur für Altverträge (Topf-Sonderausgaben, Verträge vor 2016) – ab 2021 nicht mehr absetzbar.";
    kz[code] = v;
  }

  const sum = (set: Set<string>) => Object.entries(kz).filter(([k]) => set.has(k)).reduce((s, [, v]) => s + v, 0);
  const werbungskosten = sum(WK_KZ) - (kz["916"] ?? 0);
  const sonderausgaben = sum(SA_KZ);
  const agbMit = sum(AGB_SB_KZ);
  const agbOhne = sum(AGB_OHNE_KZ);

  const taxable = employee?.monthlyGrossCents ? estimateTaxableFromMonthlyGross(employee.monthlyGrossCents) : Math.round(income * 0.82);
  const sbPct = c.agbSelbstbehalt.find((s) => taxable / 100 <= s.upTo)?.pct ?? 12;
  const selbstbehalt = roundCents((taxable * sbPct) / 100);
  const mRate = marginalRate(taxable, year);

  const wkPauschale = c.werbungskostenPauschale * 100;
  const wkEffective = Math.max(0, werbungskosten - wkPauschale);
  const agbEffective = Math.max(0, agbMit - selbstbehalt) + agbOhne;
  const estimatedRefund = roundCents((wkEffective + sonderausgaben + agbEffective) * mRate) + (kz["916"] ?? 0);

  if (werbungskosten > 0 && werbungskosten <= wkPauschale) warnings.push(`Werbungskosten liegen unter dem Pauschbetrag von ${c.werbungskostenPauschale} € – bringen keine zusätzliche Ersparnis.`);
  if (agbMit > 0 && agbMit <= selbstbehalt) warnings.push(`Außergewöhnliche Belastungen (${(agbMit / 100).toFixed(2)} €) liegen unter dem geschätzten Selbstbehalt (${(selbstbehalt / 100).toFixed(2)} €, ${sbPct} %).`);
  if (!employee?.monthlyGrossCents) warnings.push("Bruttogehalt in den Einstellungen eintragen, damit Selbstbehalt und Ersparnis genauer geschätzt werden.");
  if (unreviewed) warnings.push(`${unreviewed} Buchung(en) noch nicht geprüft.`);

  const lines: L1Line[] = L1_KENNZAHLEN.filter((k) => k.kz in kz).map((k) => ({
    kz: k.kz,
    label: kzLabel(k.kz),
    section: k.section,
    amountCents: kz[k.kz]!,
    rawCents: raw[k.kz] ?? kz[k.kz]!,
    transactionIds: txByKz[k.kz] ?? [],
    note: notes[k.kz],
  }));

  return {
    year,
    profileId: profile.id,
    kz,
    lines,
    werbungskostenCents: werbungskosten,
    sonderausgabenCents: sonderausgaben,
    agbMitSelbstbehaltCents: agbMit,
    agbOhneSelbstbehaltCents: agbOhne,
    selbstbehaltCents: selbstbehalt,
    selbstbehaltPct: sbPct,
    taxableIncomeEstimateCents: taxable,
    marginalRate: mRate,
    estimatedRefundCents: estimatedRefund,
    privateExpensesCents: privateExpenses,
    incomeCents: income,
    warnings,
    info: { transactionCount: count, unreviewed, uncategorized },
  };
}
