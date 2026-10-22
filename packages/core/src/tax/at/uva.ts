import type { Category, Profile, Transaction } from "../../model/types";
import type { VatRate } from "../../model/vat";
import { roundCents, type Cents } from "../../model/money";
import { UVA_KENNZAHLEN, kzLabel } from "./kennzahlen";
import { uvaPeriodRange, type PeriodRange, type UvaPeriodRef } from "./deadlines";

export interface UvaLine {
  kz: string;
  label: string;
  baseCents?: Cents;
  taxCents?: Cents;
  section: string;
}

export interface UvaResult {
  period: PeriodRange;
  profileId: string;
  lines: UvaLine[];
  /** kz -> { base, tax } */
  kz: Record<string, { baseCents: Cents; taxCents: Cents }>;
  totals: {
    bemessungsgrundlage: Cents; // Summe 4.4
    steuerpflichtig: Cents; // 4.13
    umsatzsteuer: Cents; // Summe USt
    vorsteuer: Cents; // 5.13
    zahllast: Cents; // 095 (positive = Zahllast, negative = Gutschrift)
  };
  info: {
    transactionCount: number;
    zmAuslandsleistungenCents: Cents; // nicht steuerbar, ZM-pflichtig
    uncategorized: number;
    unreviewed: number;
    kleinunternehmer: boolean;
    basis: "ist" | "soll";
  };
  warnings: string[];
}

const RATE_TO_KZ: Record<number, string> = { 20: "022", 10: "029", 13: "006", 19: "037" };
const RATE_TO_KZ_IG: Record<number, string> = { 20: "072", 10: "073", 13: "008", 19: "088" };

function add(map: Record<string, { baseCents: Cents; taxCents: Cents }>, kz: string, base: Cents, tax: Cents) {
  const cur = map[kz] ?? { baseCents: 0, taxCents: 0 };
  cur.baseCents += base;
  cur.taxCents += tax;
  map[kz] = cur;
}

/** Relevant date for the UVA: Istbesteuerung (EÜR) uses the payment date, Sollbesteuerung the invoice date. */
export function uvaRelevantDate(tx: Transaction, profile: Profile): string {
  if (profile.accountingMethod === "eur") return tx.paidDate ?? tx.date;
  return tx.date;
}

export function computeUva(
  profile: Profile,
  ref: UvaPeriodRef,
  transactions: Transaction[],
  categories: Category[],
  opts: { manual?: Partial<Record<"056" | "048" | "044" | "032" | "061" | "083" | "082" | "087" | "089" | "064" | "062" | "063" | "067" | "090" | "001" | "071" | "076" | "077" | "012" | "015" | "018" | "019", Cents>> } = {},
): UvaResult {
  const period = uvaPeriodRange(ref);
  const kz: Record<string, { baseCents: Cents; taxCents: Cents }> = {};
  const warnings: string[] = [];
  const catById = new Map(categories.map((c) => [c.id, c]));
  const isKu = profile.vatRegime === "kleinunternehmer";
  let count = 0;
  let zm = 0;
  let uncategorized = 0;
  let unreviewed = 0;

  for (const tx of transactions) {
    if (tx.deletedAt || tx.profileId !== profile.id) continue;
    if (tx.kind === "transfer" || tx.kind === "private") continue;
    const d = uvaRelevantDate(tx, profile);
    if (d < period.from || d > period.to) continue;
    const cat = tx.categoryId ? catById.get(tx.categoryId) : undefined;
    if (!cat) uncategorized++;
    if (!tx.reviewed) unreviewed++;
    const treatment = isKu && tx.vatTreatment === "standard" ? "kleinunternehmer" : tx.vatTreatment;
    if (treatment === "private") continue;
    count++;
    const net = tx.vatLines.reduce((s, l) => s + l.netCents, 0);
    const vat = tx.vatLines.reduce((s, l) => s + l.vatCents, 0);
    const gross = tx.grossCents;
    const deductible = Math.max(0, Math.min(100, tx.vatDeductiblePct)) / 100;

    if (tx.kind === "income") {
      switch (treatment) {
        case "standard":
          add(kz, "000", net, 0);
          for (const l of tx.vatLines) {
            const code = RATE_TO_KZ[l.rate];
            if (l.rate === 0) {
              // 0 % line on a standard income: treat as exempt without input VAT deduction
              add(kz, "020", l.netCents, 0);
            } else if (code) {
              add(kz, code, l.netCents, l.vatCents);
            }
          }
          break;
        case "kleinunternehmer":
          add(kz, "000", gross, 0);
          add(kz, "016", gross, 0);
          break;
        case "reverse_charge":
          // Leistungsort im Ausland (§ 3a Abs. 6) → nicht steuerbar, nur ZM
          zm += net || gross;
          break;
        case "ig_lieferung":
          add(kz, "000", net || gross, 0);
          add(kz, "017", net || gross, 0);
          break;
        case "export":
          add(kz, "000", net || gross, 0);
          add(kz, "011", net || gross, 0);
          break;
        case "exempt":
          add(kz, "000", net || gross, 0);
          add(kz, "020", net || gross, 0);
          break;
        case "ig_erwerb":
          warnings.push(`Einnahme ${tx.description || tx.id} ist als „innergemeinschaftlicher Erwerb“ markiert – das gilt nur für Ausgaben.`);
          break;
      }
    } else if (tx.kind === "expense") {
      if (isKu) continue; // Kleinunternehmer: kein Vorsteuerabzug
      switch (treatment) {
        case "standard":
          if (vat > 0) add(kz, "060", 0, roundCents(vat * deductible));
          break;
        case "reverse_charge": {
          // Steuerschuld geht auf uns über: USt in 057, Vorsteuer in 066
          const base = net || gross;
          const rate = (tx.vatLines[0]?.rate as VatRate | undefined) || 20;
          const rc = roundCents((base * (rate || 20)) / 100);
          add(kz, "057", 0, rc);
          add(kz, "066", 0, roundCents(rc * deductible));
          break;
        }
        case "ig_erwerb": {
          const base = net || gross;
          const rate = (tx.vatLines[0]?.rate as VatRate | undefined) || 20;
          const tax = roundCents((base * (rate || 20)) / 100);
          add(kz, "070", base, 0);
          const code = RATE_TO_KZ_IG[rate || 20] ?? "072";
          add(kz, code, base, tax);
          add(kz, "065", 0, roundCents(tax * deductible));
          break;
        }
        default:
          break; // exempt, export etc.: nothing to report for expenses
      }
    }
  }

  for (const [code, value] of Object.entries(opts.manual ?? {})) {
    if (value) {
      const def = UVA_KENNZAHLEN.find((k) => k.kz === code);
      if (def?.kind === "base") add(kz, code, value, 0);
      else add(kz, code, 0, value);
    }
  }

  const g = (code: string) => kz[code] ?? { baseCents: 0, taxCents: 0 };
  const bemessungsgrundlage = g("000").baseCents + g("001").baseCents - g("021").baseCents;
  const steuerfrei = ["011", "012", "015", "017", "018", "019", "016", "020"].reduce((s, c) => s + g(c).baseCents, 0);
  const steuerpflichtig = bemessungsgrundlage - steuerfrei;
  const ustLieferungen = ["022", "029", "006", "037", "052", "007"].reduce((s, c) => s + g(c).taxCents, 0);
  const ustWeiters = ["056", "057", "048", "044", "032"].reduce((s, c) => s + g(c).taxCents, 0);
  const ustIg = ["072", "073", "008", "088"].reduce((s, c) => s + g(c).taxCents, 0);
  const umsatzsteuer = ustLieferungen + ustWeiters + ustIg;
  const vorsteuerPlus = ["060", "061", "083", "065", "066", "082", "087", "089", "064"].reduce((s, c) => s + g(c).taxCents, 0);
  const vorsteuer = vorsteuerPlus - g("062").taxCents + g("063").taxCents + g("067").taxCents;
  const zahllast = umsatzsteuer - vorsteuer + g("090").taxCents;
  add(kz, "095", 0, 0);
  kz["095"] = { baseCents: 0, taxCents: zahllast };

  const lines: UvaLine[] = UVA_KENNZAHLEN.filter((k) => kz[k.kz] && (kz[k.kz]!.baseCents !== 0 || kz[k.kz]!.taxCents !== 0 || k.kz === "095")).map((k) => ({
    kz: k.kz,
    label: kzLabel(k.kz),
    section: k.section,
    baseCents: k.kind === "base" || k.kind === "base+tax" ? kz[k.kz]!.baseCents : undefined,
    taxCents: k.kind === "tax" || k.kind === "base+tax" ? kz[k.kz]!.taxCents : undefined,
  }));

  if (uncategorized > 0) warnings.push(`${uncategorized} Buchung(en) ohne Kategorie im Zeitraum.`);
  if (unreviewed > 0) warnings.push(`${unreviewed} Buchung(en) noch nicht geprüft.`);
  if (isKu && g("000").baseCents > 0) warnings.push("Kleinunternehmer: In der Regel keine UVA-Pflicht; nur bei Option zur Regelbesteuerung einreichen.");

  return {
    period,
    profileId: profile.id,
    lines,
    kz,
    totals: { bemessungsgrundlage, steuerpflichtig, umsatzsteuer, vorsteuer, zahllast },
    info: { transactionCount: count, zmAuslandsleistungenCents: zm, uncategorized, unreviewed, kleinunternehmer: isKu, basis: profile.accountingMethod === "eur" ? "ist" : "soll" },
    warnings,
  };
}

/** Year-to-date turnover (net) – used for Kleinunternehmer threshold monitoring. */
export function turnoverForYear(profile: Profile, year: number, transactions: Transaction[]): { netCents: Cents; grossCents: Cents } {
  let netCents = 0;
  let grossCents = 0;
  for (const tx of transactions) {
    if (tx.deletedAt || tx.profileId !== profile.id || tx.kind !== "income" || tx.vatTreatment === "private") continue;
    const d = uvaRelevantDate(tx, profile);
    if (!d.startsWith(String(year))) continue;
    netCents += tx.vatLines.reduce((s, l) => s + l.netCents, 0) || tx.grossCents;
    grossCents += tx.grossCents;
  }
  return { netCents, grossCents };
}
