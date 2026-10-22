/**
 * All monetary values are stored as integer cents (EUR). Never use floats for storage.
 */
export type Cents = number;

export function toCents(value: number | string | null | undefined): Cents {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Math.round(value * 100);
  const parsed = parseAmount(value);
  return parsed === null ? 0 : parsed;
}

export function fromCents(cents: Cents): number {
  return Math.round(cents) / 100;
}

/** Banker's-safe rounding helper for cents (half away from zero, like Austrian tax practice). */
export function roundCents(value: number): Cents {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

/**
 * Parses "1.234,56", "1234,56", "1,234.56", "1234.56", "€ 12,50", "12,50 EUR", "-12,5", "12.-"
 * into cents. Returns null when no number is present.
 */
export function parseAmount(raw: string): Cents | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/[€$£]|EUR|CHF|USD/gi, "").replace(/\s+/g, "");
  s = s.replace(/,-$|\.-$|,--$|\.--$/, ",00");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (!/^[0-9.,']+$/.test(s)) return null;
  s = s.replace(/'/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart: string;
  let fracPart = "";
  if (lastComma === -1 && lastDot === -1) {
    intPart = s;
  } else if (lastComma > lastDot) {
    // comma is decimal separator (German)
    intPart = s.slice(0, lastComma).replace(/[.,]/g, "");
    fracPart = s.slice(lastComma + 1);
  } else {
    // dot is decimal separator (English) unless it is a thousands separator pattern like 1.234
    const after = s.slice(lastDot + 1);
    if (lastComma === -1 && after.length === 3 && s.replace(/\./g, "").length > 3 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
      intPart = s.replace(/\./g, "");
    } else {
      intPart = s.slice(0, lastDot).replace(/[.,]/g, "");
      fracPart = after;
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (fracPart.length > 2) fracPart = fracPart.slice(0, 2);
  while (fracPart.length < 2) fracPart += "0";
  const cents = Number(intPart || "0") * 100 + Number(fracPart);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

const deAT = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });
const deATPlain = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatCents(cents: Cents, opts: { currency?: boolean } = {}): string {
  const v = fromCents(cents);
  return opts.currency === false ? deATPlain.format(v) : deAT.format(v);
}

/** Formats for FinanzOnline number fields: "1234,56" (no thousands separators, comma decimal). */
export function formatForFinanzOnline(cents: Cents): string {
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${cents < 0 ? "-" : ""}${euros},${rest.toString().padStart(2, "0")}`;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Splits an amount proportionally without losing cents (largest remainder method). */
export function allocateCents(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || weights.length === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floored = raw.map((r) => Math.trunc(r));
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.trunc(r) }))
    .sort((a, b) => b.frac - a.frac);
  const step = remainder > 0 ? 1 : -1;
  for (const { i } of order) {
    if (remainder === 0) break;
    floored[i]! += step;
    remainder -= step;
  }
  return floored;
}
