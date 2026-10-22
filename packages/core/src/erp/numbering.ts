/**
 * Fills a number pattern: {YYYY} {YY} {MM} and {N…} (zero-padded counter, width = number of N).
 * "AN-{YYYY}-{NNNN}" + 7 on 2026-03-02 → "AN-2026-0007".
 */
export function formatNumber(pattern: string, n: number, date: string = new Date().toISOString().slice(0, 10)): string {
  return pattern
    .replace("{YYYY}", date.slice(0, 4))
    .replace("{YY}", date.slice(2, 4))
    .replace("{MM}", date.slice(5, 7))
    .replace(/\{N+\}/, (m) => String(n).padStart(m.length - 2, "0"));
}
