import { formatCents, fromCents } from "@ordo/core";

export const fmtMoney = (cents: number) => formatCents(cents);
export const fmtMoneyPlain = (cents: number) => formatCents(cents, { currency: false });
export const fmtNumber = (n: number, digits = 0) => n.toLocaleString("de-AT", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtPct = (ratio: number, digits = 0) => `${(ratio * 100).toLocaleString("de-AT", { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;

export function fmtDate(iso: string | undefined | null, opts: { long?: boolean } = {}): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  if (opts.long) return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" });
  return `${d}.${m}.${y}`;
}

export function fmtDateTime(iso: string | undefined | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  if (d < 30) return `vor ${d} Tag${d === 1 ? "" : "en"}`;
  return fmtDate(iso);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Parses user input "1.234,56" / "1234.56" into cents; returns null if invalid. */
export function parseMoneyInput(s: string): number | null {
  const t = s.trim().replace(/\s|€/g, "");
  if (!t) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const v = Number(normalized);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

export function moneyInputValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return fromCents(cents).toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("de-AT", { month: "long", year: "numeric" });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
