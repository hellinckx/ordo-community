import { roundCents, type Cents } from "./money";

/** Austrian VAT rates. 19 % applies only to Jungholz/Mittelberg and is modelled for completeness. */
export const VAT_RATES = [0, 10, 13, 19, 20] as const;
export type VatRate = (typeof VAT_RATES)[number];

export interface VatLine {
  rate: VatRate;
  netCents: Cents;
  vatCents: Cents;
}

export function isVatRate(n: number): n is VatRate {
  return (VAT_RATES as readonly number[]).includes(n);
}

export function vatFromNet(netCents: Cents, rate: VatRate): Cents {
  return roundCents((netCents * rate) / 100);
}

export function netFromGross(grossCents: Cents, rate: VatRate): Cents {
  return roundCents((grossCents * 100) / (100 + rate));
}

export function vatFromGross(grossCents: Cents, rate: VatRate): Cents {
  return grossCents - netFromGross(grossCents, rate);
}

export function lineFromGross(grossCents: Cents, rate: VatRate): VatLine {
  const netCents = netFromGross(grossCents, rate);
  return { rate, netCents, vatCents: grossCents - netCents };
}

export function lineFromNet(netCents: Cents, rate: VatRate): VatLine {
  return { rate, netCents, vatCents: vatFromNet(netCents, rate) };
}

export function grossOfLines(lines: VatLine[]): Cents {
  return lines.reduce((s, l) => s + l.netCents + l.vatCents, 0);
}

export function netOfLines(lines: VatLine[]): Cents {
  return lines.reduce((s, l) => s + l.netCents, 0);
}

export function vatOfLines(lines: VatLine[]): Cents {
  return lines.reduce((s, l) => s + l.vatCents, 0);
}

/** Merges lines with the same rate. */
export function normalizeVatLines(lines: VatLine[]): VatLine[] {
  const byRate = new Map<VatRate, VatLine>();
  for (const l of lines) {
    const cur = byRate.get(l.rate);
    if (cur) {
      cur.netCents += l.netCents;
      cur.vatCents += l.vatCents;
    } else {
      byRate.set(l.rate, { ...l });
    }
  }
  return [...byRate.values()].sort((a, b) => b.rate - a.rate);
}
