/**
 * BMD NTCS Buchungsimport (CSV) – what most Austrian tax advisors import. One row per booking line against the money
 * or personal account, semicolon separated, comma decimals, dates as JJJJMMTT, field names in the first row.
 * Rules (BMD standard format): satzart 0; bucod 1 = Soll, 2 = Haben; betrag positive for Soll, negative for Haben;
 * steuer with the opposite sign (customers negative, suppliers positive); steucod 00 = Vorsteuer/keine Steuer,
 * 01 = Ist-Umsatzsteuer, 03 = Soll-Umsatzsteuer, 09 = ig. Erwerb mit Vorsteuerabzug. Codes and Buchungssymbole are set
 * up per client in BMD, so every value is overridable – the export dialog says to check them with the firm.
 */
import type { DerivedEntry } from "../accounting/posting";
import type { JournalLine } from "../model/types";
import { STD } from "../accounting/chart";
import { encodeWindows1252 } from "./encoding";

export type BmdSymbolKind = "AR" | "ER" | "BK" | "KA" | "SO";
export type BmdTaxKind = "output" | "input" | "none" | "igErwerb" | "reverseCharge";

export interface BmdOptions {
  symbols?: Partial<Record<BmdSymbolKind, string>>;
  taxCodes?: Partial<Record<BmdTaxKind, string>>;
  /** Ist-Besteuerung (Umsatzsteuer nach Zahlungseingang): output VAT gets steucod 01 instead of 03. */
  istBesteuerung?: boolean;
  encoding?: "windows-1252" | "utf-8";
  /** External document number per transaction id (invoice number, number on the receipt) → extbelegnr. */
  references?: Map<string, string>;
}

export interface BmdResult {
  bytes: Uint8Array;
  rows: number;
  /** Entries that could not be expressed as one BMD row per line, and things the firm should look at. */
  warnings: string[];
}

export const BMD_FIELDS = ["satzart", "konto", "buchdat", "gkto", "belegnr", "belegdat", "mwst", "steucod", "bucod", "betrag", "steuer", "periode", "text", "symbol", "extbelegnr"] as const;

const DEFAULT_SYMBOLS: Record<BmdSymbolKind, string> = { AR: "AR", ER: "ER", BK: "BK", KA: "KA", SO: "SO" };
const DEFAULT_CODES: Record<BmdTaxKind, string> = { output: "03", input: "00", none: "00", igErwerb: "09", reverseCharge: "19" };

const OUTPUT_TAX = new Set<string>([STD.outputVat, STD.outputVatIg, STD.outputVatRc]);
const INPUT_TAX = new Set<string>([STD.inputVat, STD.inputVatIg, STD.inputVatRc]);
const MONEY = new Set<string>([STD.cash, STD.bank, STD.paypal, STD.card]);
const PERSONAL = new Set<string>([STD.receivables, STD.payables]);

const isTax = (a: string) => OUTPUT_TAX.has(a) || INPUT_TAX.has(a);
const amountOf = (l: JournalLine) => l.debitCents || l.creditCents;
const isDebit = (l: JournalLine) => l.debitCents > 0;
const ymd = (iso: string) => iso.replace(/-/g, "");
const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const clean = (s: string, max: number) => s.replace(/[;\r\n"]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function symbolFor(account: string): BmdSymbolKind {
  if (account === STD.receivables) return "AR";
  if (account === STD.payables) return "ER";
  if (account === STD.cash) return "KA";
  if (MONEY.has(account)) return "BK";
  return "SO";
}

/** The line the booking runs against: money first, then customer/supplier accounts, else the one alone on its side. */
function anchorOf(rest: JournalLine[]): JournalLine | undefined {
  const alone = (l: JournalLine) => rest.filter((x) => isDebit(x) === isDebit(l)).length === 1;
  return rest.find((l) => MONEY.has(l.account) && alone(l)) ?? rest.find((l) => PERSONAL.has(l.account) && alone(l)) ?? rest.find((l) => MONEY.has(l.account) || PERSONAL.has(l.account)) ?? rest.find(alone);
}

export function bmdBuchungen(entries: DerivedEntry[], opts: BmdOptions = {}): BmdResult {
  const symbols = { ...DEFAULT_SYMBOLS, ...opts.symbols };
  const codes = { ...DEFAULT_CODES, ...opts.taxCodes };
  const warnings: string[] = [];
  const rows: string[][] = [];
  let reverseCharge = 0;

  for (const e of entries) {
    const tax = e.lines.filter((l) => isTax(l.account) && amountOf(l));
    const rest = e.lines.filter((l) => !isTax(l.account) && amountOf(l));
    const anchor = anchorOf(rest);
    if (!anchor || rest.length < 2) {
      warnings.push(`Buchung ${e.number} (${e.date}) hat keine eindeutige Gegenbuchung und fehlt im Export – bitte von Hand übernehmen.`);
      continue;
    }
    const counters = rest.filter((l) => l !== anchor);
    if (counters.some((l) => isDebit(l) === isDebit(anchor))) {
      warnings.push(`Buchung ${e.number} (${e.date}) ist eine Sammelbuchung mit mehreren Konten auf beiden Seiten – bitte prüfen.`);
    }
    const used = new Set<JournalLine>();
    // tax on the counter line's side belongs to it (by rate when there are several lines); tax on the anchor's side
    // (ig. Erwerb / Reverse Charge: the second half of the self-assessed VAT) only nets out of the gross amount
    const taxFor = (l: JournalLine, side: boolean) => {
      const same = tax.filter((t) => isDebit(t) === side && !used.has(t));
      const picked = counters.length === 1 ? same : same.filter((t) => t.vatRate === undefined || t.vatRate === l.vatRate);
      picked.forEach((t) => used.add(t));
      return picked;
    };
    for (const l of counters) {
      const own = taxFor(l, isDebit(l));
      const opposite = taxFor(l, isDebit(anchor));
      const ownTax = own.reduce((s, t) => s + amountOf(t), 0);
      const oppositeTax = opposite.reduce((s, t) => s + amountOf(t), 0);
      const gross = amountOf(l) + ownTax - oppositeTax;
      const accounts = [...own, ...opposite].map((t) => t.account);
      let steucod = codes.none;
      if (accounts.includes(STD.inputVatRc) || accounts.includes(STD.outputVatRc)) {
        steucod = codes.reverseCharge;
        reverseCharge++;
      } else if (accounts.includes(STD.inputVatIg) || accounts.includes(STD.outputVatIg)) steucod = codes.igErwerb;
      else if (accounts.includes(STD.outputVat)) steucod = opts.istBesteuerung ? "01" : codes.output;
      else if (accounts.includes(STD.inputVat)) steucod = codes.input;
      const rate = l.vatRate ?? own.find((t) => t.vatRate !== undefined)?.vatRate ?? (ownTax && amountOf(l) ? Math.round((ownTax / amountOf(l)) * 100) : 0);
      const soll = isDebit(anchor);
      rows.push([
        "0",
        anchor.account,
        ymd(e.date),
        l.account,
        String(e.number),
        ymd(e.date),
        String(rate),
        steucod,
        soll ? "1" : "2",
        money(soll ? gross : -gross),
        money(soll ? -ownTax : ownTax),
        String(Number(e.date.slice(5, 7))),
        clean(l.text || e.description, 60),
        symbols[symbolFor(anchor.account)],
        clean((e.transactionId && opts.references?.get(e.transactionId)) || "", 30),
      ]);
    }
    const left = tax.filter((t) => !used.has(t));
    if (left.length) warnings.push(`Buchung ${e.number} (${e.date}): Steuerzeile ohne passende Gegenbuchung – bitte prüfen.`);
  }
  if (reverseCharge) warnings.push(`${reverseCharge} Reverse-Charge-Zeilen tragen den Steuercode ${codes.reverseCharge} – bitte mit der Kanzlei abstimmen, welcher Code in BMD dafür angelegt ist.`);

  const text = [BMD_FIELDS.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n") + "\r\n";
  const bytes = opts.encoding === "utf-8" ? new TextEncoder().encode("﻿" + text) : encodeWindows1252(text);
  return { bytes, rows: rows.length, warnings };
}
