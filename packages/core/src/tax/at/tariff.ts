import { constantsFor } from "./constants";

/** Einkommensteuer nach § 33 Abs. 1 EStG (ohne Absetzbeträge) in Cent für ein zu versteuerndes Einkommen in Cent. */
export function incomeTaxCents(taxableIncomeCents: number, year: number): number {
  const income = Math.max(0, taxableIncomeCents) / 100;
  const { tariff } = constantsFor(year);
  let tax = 0;
  let lower = 0;
  for (const b of tariff) {
    if (income <= lower) break;
    const upper = Math.min(income, b.upTo);
    tax += (upper - lower) * b.rate;
    lower = b.upTo;
    if (income <= b.upTo) break;
  }
  return Math.round(tax * 100);
}

/** Grenzsteuersatz (0..0.55) für ein Einkommen in Cent. */
export function marginalRate(taxableIncomeCents: number, year: number): number {
  const income = Math.max(0, taxableIncomeCents) / 100;
  const { tariff } = constantsFor(year);
  for (const b of tariff) {
    if (income <= b.upTo) return b.rate;
  }
  return tariff[tariff.length - 1]!.rate;
}

/** Durchschnittssteuersatz. */
export function averageRate(taxableIncomeCents: number, year: number): number {
  if (taxableIncomeCents <= 0) return 0;
  return incomeTaxCents(taxableIncomeCents, year) / taxableIncomeCents;
}

/** Grobe Schätzung des Jahresbrutto → steuerpflichtiges Einkommen für Angestellte (abzüglich ~18 % SV, Sonderzahlungen begünstigt). */
export function estimateTaxableFromMonthlyGross(monthlyGrossCents: number): number {
  const yearly12 = monthlyGrossCents * 12;
  return Math.round(yearly12 * 0.82);
}

export function tariffTable(year: number): { from: number; to: number | null; rate: number }[] {
  const { tariff } = constantsFor(year);
  let lower = 0;
  return tariff.map((b) => {
    const row = { from: lower, to: Number.isFinite(b.upTo) ? b.upTo : null, rate: b.rate };
    lower = b.upTo;
    return row;
  });
}
