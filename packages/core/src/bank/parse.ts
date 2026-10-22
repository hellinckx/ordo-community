/**
 * Bank statement (Kontoauszug) parsing: CSV exports of Austrian/German banks, CAMT.053/052 XML,
 * text layer of PDF statements, plus an AI schema for scanned/complex PDFs.
 */
import { parseAmount, type Cents } from "../model/money";
import { findAmounts, findDates, findIban } from "../extraction/parse";

export interface ParsedBankLine {
  date: string;
  valueDate?: string;
  amountCents: Cents;
  currency: string;
  counterparty: string;
  counterpartyIban: string;
  purpose: string;
  reference: string;
  balanceAfterCents?: Cents;
}

export interface ParsedStatement {
  format: "csv" | "camt" | "pdf" | "ai";
  iban: string;
  accountName: string;
  bankName: string;
  from?: string;
  to?: string;
  openingBalanceCents?: Cents;
  closingBalanceCents?: Cents;
  lines: ParsedBankLine[];
  warnings: string[];
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function toIsoDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/);
  if (m) return `20${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export function parseCsvRows(text: string): string[][] {
  const t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = t.split("\n").find((l) => l.trim()) ?? "";
  const counts = { ";": (firstLine.match(/;/g) ?? []).length, ",": (firstLine.match(/,/g) ?? []).length, "\t": (firstLine.match(/\t/g) ?? []).length, "|": (firstLine.match(/\|/g) ?? []).length };
  const sep = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ";") as string;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (inQ) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const H = {
  date: [/^buchungsdatum/i, /^buchungstag/i, /^buchung$/i, /^datum/i, /^date$/i, /^booking date/i, /^transaction date/i, /^started date/i, /^wertstellung$/i],
  valueDate: [/^valuta/i, /^wertstellung/i, /^value date/i, /^valutadatum/i, /^completed date/i],
  amount: [/^betrag$/i, /^betrag \(/i, /^amount$/i, /^amount \(/i, /^umsatz$/i, /^transaction amount/i, /^betrag eur/i],
  debit: [/^soll$/i, /^lastschrift/i, /^debit/i, /^ausgang/i, /^abgang/i],
  credit: [/^haben$/i, /^gutschrift/i, /^credit/i, /^eingang/i, /^zugang/i],
  currency: [/^währung/i, /^waehrung/i, /^currency/i],
  counterparty: [/^partner ?name/i, /^empfänger/i, /^auftraggeber/i, /^name zahlungsbeteiligter/i, /^beguenstigter/i, /^begünstigter/i, /^zahlungspartner/i, /^payee/i, /^description$/i, /^partner$/i, /^empfaenger/i, /^name$/i, /^kontoinhaber/i],
  iban: [/^partner ?iban/i, /^iban zahlungsbeteiligter/i, /^iban$/i, /^kontonummer\/iban/i, /^empfänger iban/i, /^gegenkonto/i],
  purpose: [/^verwendungszweck/i, /^buchungstext/i, /^zahlungsreferenz/i, /^text$/i, /^umsatztext/i, /^beschreibung/i, /^zahlungsgrund/i, /^reference$/i, /^details/i, /^purpose/i, /^buchungs-details/i, /^umsatz text/i],
  reference: [/^zahlungsreferenz/i, /^referenz/i, /^kundenreferenz/i, /^mandatsreferenz/i, /^end-to-end/i],
  balance: [/^saldo/i, /^kontostand/i, /^balance/i],
};

function findCol(headers: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h.trim()));
    if (i >= 0) return i;
  }
  return -1;
}

export function parseBankCsv(text: string): ParsedStatement {
  const rows = parseCsvRows(text);
  const warnings: string[] = [];
  const out: ParsedStatement = { format: "csv", iban: "", accountName: "", bankName: "", lines: [], warnings };
  if (!rows.length) {
    warnings.push("CSV ist leer.");
    return out;
  }
  // Header row = first row that contains a date-like and an amount-like column name
  let headerIdx = rows.findIndex((r) => r.some((c) => H.date.some((p) => p.test(c.trim()))) && r.some((c) => [...H.amount, ...H.debit, ...H.credit].some((p) => p.test(c.trim()))));
  if (headerIdx < 0) headerIdx = 0;
  const headers = rows[headerIdx]!.map((h) => h.trim());
  const col = {
    date: findCol(headers, H.date),
    valueDate: findCol(headers, H.valueDate),
    amount: findCol(headers, H.amount),
    debit: findCol(headers, H.debit),
    credit: findCol(headers, H.credit),
    currency: findCol(headers, H.currency),
    counterparty: findCol(headers, H.counterparty),
    iban: findCol(headers, H.iban),
    purpose: findCol(headers, H.purpose),
    reference: findCol(headers, H.reference),
    balance: findCol(headers, H.balance),
  };
  const headerless = col.date < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0);
  const ibanInHead = findIban(rows.slice(0, headerIdx + 1).flat().join(" "));
  if (ibanInHead) out.iban = ibanInHead;
  const dataRows = headerless ? rows : rows.slice(headerIdx + 1);
  for (const r of dataRows) {
    let date: string | null = null;
    let amount: Cents | null = null;
    let purpose = "";
    let counterparty = "";
    let iban = "";
    let currency = "EUR";
    let valueDate: string | undefined;
    let reference = "";
    let balance: Cents | undefined;
    if (!headerless) {
      date = toIsoDate(r[col.date]);
      if (col.amount >= 0) amount = parseAmount(r[col.amount] ?? "");
      if (amount === null && col.debit >= 0) {
        const d = parseAmount(r[col.debit] ?? "");
        const c = col.credit >= 0 ? parseAmount(r[col.credit] ?? "") : null;
        if (d) amount = -Math.abs(d);
        else if (c) amount = Math.abs(c);
      }
      if (col.valueDate >= 0) valueDate = toIsoDate(r[col.valueDate]) ?? undefined;
      if (col.currency >= 0 && r[col.currency]?.trim()) currency = r[col.currency]!.trim().toUpperCase();
      if (col.counterparty >= 0) counterparty = (r[col.counterparty] ?? "").trim();
      if (col.iban >= 0) iban = (r[col.iban] ?? "").replace(/\s+/g, "").toUpperCase();
      if (col.purpose >= 0) purpose = (r[col.purpose] ?? "").trim();
      if (col.reference >= 0 && col.reference !== col.purpose) reference = (r[col.reference] ?? "").trim();
      if (col.balance >= 0) balance = parseAmount(r[col.balance] ?? "") ?? undefined;
    } else {
      // Heuristic: first date cell, last amount cell, longest text cell
      for (const c of r) {
        if (!date) date = toIsoDate(c);
      }
      const amounts = r.map((c) => parseAmount(c)).filter((a): a is number => a !== null);
      amount = amounts.length ? amounts[amounts.length - 1]! : null;
      const texts = r.filter((c) => !toIsoDate(c) && parseAmount(c) === null && c.trim().length > 2).sort((a, b) => b.length - a.length);
      purpose = texts[0] ?? "";
      counterparty = texts[1] ?? "";
      iban = findIban(r.join(" ")) ?? "";
    }
    if (!date || amount === null) continue;
    if (!counterparty && purpose) {
      // Many banks put "Name / Zweck" into one field
      const m = purpose.match(/^([^/|]{3,60})[/|]/);
      if (m) counterparty = m[1]!.trim();
    }
    if (!iban) iban = findIban(`${purpose} ${counterparty}`) ?? "";
    out.lines.push({ date, valueDate, amountCents: amount, currency, counterparty, counterpartyIban: iban, purpose, reference, balanceAfterCents: balance });
  }
  if (!out.lines.length) warnings.push("Keine Buchungszeilen im CSV erkannt – Spaltenüberschriften prüfen (Datum, Betrag, Verwendungszweck).");
  finalize(out);
  return out;
}

/* ------------------------------------------------------------------ */
/* CAMT.053 / CAMT.052 (ISO 20022 XML)                                 */
/* ------------------------------------------------------------------ */

export function parseCamt(xml: string): ParsedStatement {
  const out: ParsedStatement = { format: "camt", iban: "", accountName: "", bankName: "", lines: [], warnings: [] };
  const get = (src: string, tag: string): string => {
    const m = src.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "i"));
    return m ? m[1]!.trim() : "";
  };
  const all = (src: string, tag: string): string[] => {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
    const list: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) list.push(m[1]!);
    return list;
  };
  const stmt = all(xml, "Stmt")[0] ?? all(xml, "Rpt")[0] ?? xml;
  const acct = all(stmt, "Acct")[0] ?? "";
  out.iban = get(acct, "IBAN");
  out.accountName = get(acct, "Nm");
  out.bankName = get(all(acct, "Svcr")[0] ?? "", "Nm");
  const period = all(stmt, "FrToDt")[0] ?? "";
  out.from = toIsoDate(get(period, "FrDtTm").slice(0, 10)) ?? undefined;
  out.to = toIsoDate(get(period, "ToDtTm").slice(0, 10)) ?? undefined;
  for (const bal of all(stmt, "Bal")) {
    const code = get(all(bal, "Tp")[0] ?? "", "Cd");
    const amt = parseAmount(get(bal, "Amt").replace(".", ","));
    const sign = get(bal, "CdtDbtInd") === "DBIT" ? -1 : 1;
    if (amt === null) continue;
    if (code === "OPBD") out.openingBalanceCents = sign * amt;
    if (code === "CLBD") out.closingBalanceCents = sign * amt;
  }
  for (const ntry of all(stmt, "Ntry")) {
    const amtRaw = get(ntry, "Amt");
    const amt = parseAmount(amtRaw.includes(".") && !amtRaw.includes(",") ? amtRaw.replace(".", ",") : amtRaw);
    if (amt === null) continue;
    const sign = get(ntry, "CdtDbtInd") === "DBIT" ? -1 : 1;
    const date = toIsoDate(get(all(ntry, "BookgDt")[0] ?? "", "Dt") || get(all(ntry, "BookgDt")[0] ?? "", "DtTm").slice(0, 10));
    const valueDate = toIsoDate(get(all(ntry, "ValDt")[0] ?? "", "Dt")) ?? undefined;
    if (!date) continue;
    const dtls = all(ntry, "TxDtls")[0] ?? ntry;
    const rltd = all(dtls, "RltdPties")[0] ?? "";
    const cdtr = get(all(rltd, "Cdtr")[0] ?? "", "Nm");
    const dbtr = get(all(rltd, "Dbtr")[0] ?? "", "Nm");
    const counterparty = sign < 0 ? cdtr || dbtr : dbtr || cdtr;
    const ibanC = get(all(rltd, sign < 0 ? "CdtrAcct" : "DbtrAcct")[0] ?? "", "IBAN");
    const rmt = all(dtls, "RmtInf")[0] ?? "";
    const ustrd = all(rmt, "Ustrd").join(" ");
    const strd = get(all(rmt, "Strd")[0] ?? "", "Ref");
    const refs = all(dtls, "Refs")[0] ?? "";
    const e2e = get(refs, "EndToEndId");
    const addtl = get(ntry, "AddtlNtryInf");
    out.lines.push({ date, valueDate, amountCents: sign * amt, currency: (ntry.match(/Ccy="([A-Z]{3})"/)?.[1] ?? "EUR"), counterparty: counterparty || addtl.slice(0, 60), counterpartyIban: ibanC, purpose: [ustrd, strd, addtl].filter(Boolean).join(" ").trim(), reference: e2e && e2e !== "NOTPROVIDED" ? e2e : strd, balanceAfterCents: undefined });
  }
  if (!out.lines.length) out.warnings.push("Keine <Ntry>-Einträge in der CAMT-Datei gefunden.");
  finalize(out);
  return out;
}

/* ------------------------------------------------------------------ */
/* PDF text layer (heuristic)                                          */
/* ------------------------------------------------------------------ */

const NOISE = /^(seite|page|kontoauszug|auszug|blatt|iban|bic|datum|buchung|valuta|betrag|saldo|umsatz|alter saldo|neuer saldo|zwischensumme)/i;

export function parseBankPdfText(text: string): ParsedStatement {
  const out: ParsedStatement = { format: "pdf", iban: "", accountName: "", bankName: "", lines: [], warnings: [] };
  const lines = text.split("\n").map((l) => l.replace(/\s{2,}/g, " ").trim()).filter(Boolean);
  out.iban = findIban(lines.slice(0, 40).join(" ")) ?? "";
  const bank = lines.find((l) => /\b(bank|sparkasse|raiffeisen|bawag|erste|volksbank|n26|revolut|easybank|bank99|ing|dadat|hypo|oberbank|bks|bank austria|unicredit)\b/i.test(l));
  if (bank) out.bankName = bank.slice(0, 60);
  const dateHits = findDates(lines);
  const periodDates = dateHits.filter((d) => /(kontoauszug|zeitraum|vom|bis|auszug)/.test(d.context));
  if (periodDates.length >= 2) {
    out.from = periodDates[0]!.iso;
    out.to = periodDates[1]!.iso;
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (NOISE.test(l) && !/\d{2}\.\d{2}\./.test(l)) {
      const sa = /alter saldo|anfangssaldo|saldo alt|vortrag/i.test(l) ? "open" : /neuer saldo|endsaldo|schlusssaldo|saldo neu/i.test(l) ? "close" : null;
      if (sa) {
        const am = findAmounts(l);
        const signed = /-\s?[\d.]+,\d{2}|[\d.]+,\d{2}\s?-|S$/.test(l) ? -1 : 1;
        if (am.length) {
          if (sa === "open") out.openingBalanceCents = signed * am[am.length - 1]!;
          else out.closingBalanceCents = signed * am[am.length - 1]!;
        }
      }
      continue;
    }
    const dm = l.match(/^(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?)\s+(?:(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})?)\s+)?(.*)$/);
    if (!dm) continue;
    const yearFallback = out.to?.slice(0, 4) ?? out.from?.slice(0, 4) ?? String(new Date().getFullYear());
    const fix = (d: string) => (/\d{4}$/.test(d) ? d : /\d{2}$/.test(d.replace(/\.$/, "")) && d.split(".").filter(Boolean).length === 3 ? d : `${d.replace(/\.$/, "")}.${yearFallback}`);
    const date = toIsoDate(fix(dm[1]!));
    const valueDate = dm[2] ? toIsoDate(fix(dm[2])) ?? undefined : undefined;
    const rest = dm[3] ?? "";
    // amount = last money token on the line (or the next line), sign from "-" or trailing "S"/"H"
    let amountStr = rest.match(/(-?\s?\d{1,3}(?:[.\s]\d{3})*,\d{2}\s?-?)\s*([SH])?\s*$/);
    let desc = rest;
    let j = i;
    if (!amountStr && lines[i + 1] && /^(-?\s?\d{1,3}(?:[.\s]\d{3})*,\d{2}\s?-?)\s*([SH])?$/.test(lines[i + 1]!)) {
      amountStr = lines[i + 1]!.match(/(-?\s?\d{1,3}(?:[.\s]\d{3})*,\d{2}\s?-?)\s*([SH])?$/);
      j = i + 1;
    }
    if (!date || !amountStr) continue;
    const raw = amountStr[1]!;
    let amount = parseAmount(raw);
    if (amount === null) continue;
    if (amountStr[2] === "S" || /-/.test(raw)) amount = -Math.abs(amount);
    else if (amountStr[2] === "H") amount = Math.abs(amount);
    desc = desc.replace(amountStr[0], "").trim();
    // collect continuation lines (no leading date, no amount-only) as purpose
    const extra: string[] = [];
    let k = j + 1;
    while (k < lines.length && extra.length < 4 && !/^\d{1,2}\.\d{1,2}\./.test(lines[k]!) && !NOISE.test(lines[k]!) && !/^-?\s?\d{1,3}(?:[.\s]\d{3})*,\d{2}\s?-?\s*[SH]?$/.test(lines[k]!)) {
      extra.push(lines[k]!);
      k++;
    }
    const full = [desc, ...extra].join(" ").trim();
    const iban = findIban(full) ?? "";
    const counterparty = desc.split(/\s{2,}|\s\|\s|\s\/\s/)[0]?.slice(0, 60) ?? "";
    out.lines.push({ date, valueDate, amountCents: amount, currency: "EUR", counterparty, counterpartyIban: iban, purpose: full, reference: "" });
    i = Math.max(i, j);
  }
  if (!out.lines.length) out.warnings.push("Keine Umsätze im PDF-Text erkannt – bei gescannten Auszügen KI-Erkennung oder CSV-Export der Bank verwenden.");
  finalize(out);
  return out;
}

function finalize(s: ParsedStatement) {
  s.lines.sort((a, b) => a.date.localeCompare(b.date));
  if (!s.from && s.lines.length) s.from = s.lines[0]!.date;
  if (!s.to && s.lines.length) s.to = s.lines[s.lines.length - 1]!.date;
  if (s.openingBalanceCents !== undefined && s.closingBalanceCents !== undefined) {
    const sum = s.lines.reduce((x, l) => x + l.amountCents, 0);
    if (Math.abs(s.openingBalanceCents + sum - s.closingBalanceCents) > 1) s.warnings.push(`Saldenprüfung: Anfangssaldo + Umsätze ≠ Endsaldo (Differenz ${((s.openingBalanceCents + sum - s.closingBalanceCents) / 100).toFixed(2)} €) – möglicherweise fehlen Zeilen.`);
  }
}

/* ------------------------------------------------------------------ */
/* AI schema for statements                                            */
/* ------------------------------------------------------------------ */

export const AI_BANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["iban", "bank_name", "account_name", "period_from", "period_to", "opening_balance", "closing_balance", "lines", "notes"],
  properties: {
    iban: { type: ["string", "null"] },
    bank_name: { type: ["string", "null"] },
    account_name: { type: ["string", "null"] },
    period_from: { type: ["string", "null"], description: "ISO date" },
    period_to: { type: ["string", "null"], description: "ISO date" },
    opening_balance: { type: ["number", "null"] },
    closing_balance: { type: ["number", "null"] },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "value_date", "amount", "counterparty", "counterparty_iban", "purpose", "reference"],
        properties: {
          date: { type: "string", description: "Buchungsdatum ISO" },
          value_date: { type: ["string", "null"] },
          amount: { type: "number", description: "signed, negative for debits, 2 decimals" },
          counterparty: { type: ["string", "null"] },
          counterparty_iban: { type: ["string", "null"] },
          purpose: { type: ["string", "null"] },
          reference: { type: ["string", "null"] },
        },
      },
    },
    notes: { type: ["string", "null"] },
  },
} as const;

export interface AiBankOutput {
  iban: string | null;
  bank_name: string | null;
  account_name: string | null;
  period_from: string | null;
  period_to: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  lines: { date: string; value_date: string | null; amount: number; counterparty: string | null; counterparty_iban: string | null; purpose: string | null; reference: string | null }[];
  notes: string | null;
}

export const BANK_PROMPT = `Du bist ein präziser Buchhaltungs-Assistent. Das beigefügte Dokument ist ein Kontoauszug (Bank, Kreditkarte oder PayPal). Extrahiere ALLE Umsatzzeilen vollständig als JSON gemäß Schema.
Regeln: Beträge als Zahl mit Vorzeichen (Abbuchung negativ, Gutschrift positiv, deutsches Format 1.234,56 korrekt lesen). Datumsangaben ISO (YYYY-MM-DD). counterparty = Name des Zahlungspartners, purpose = Verwendungszweck/Buchungstext. Zwischensummen, Salden und Überschriften sind KEINE Umsatzzeilen. Antworte nur mit dem JSON.`;

export function fromAiBankOutput(ai: AiBankOutput): ParsedStatement {
  const out: ParsedStatement = { format: "ai", iban: (ai.iban ?? "").replace(/\s+/g, "").toUpperCase(), accountName: ai.account_name ?? "", bankName: ai.bank_name ?? "", from: toIsoDate(ai.period_from) ?? undefined, to: toIsoDate(ai.period_to) ?? undefined, openingBalanceCents: ai.opening_balance != null ? Math.round(ai.opening_balance * 100) : undefined, closingBalanceCents: ai.closing_balance != null ? Math.round(ai.closing_balance * 100) : undefined, lines: [], warnings: [] };
  for (const l of ai.lines ?? []) {
    const date = toIsoDate(l.date);
    if (!date || !Number.isFinite(l.amount)) continue;
    out.lines.push({ date, valueDate: toIsoDate(l.value_date) ?? undefined, amountCents: Math.round(l.amount * 100), currency: "EUR", counterparty: l.counterparty ?? "", counterpartyIban: (l.counterparty_iban ?? "").replace(/\s+/g, "").toUpperCase(), purpose: l.purpose ?? "", reference: l.reference ?? "" });
  }
  if (ai.notes) out.warnings.push(`KI-Hinweis: ${ai.notes}`);
  finalize(out);
  return out;
}

/** Fingerprint for dedupe across overlapping statement exports. */
export async function bankLineHash(l: ParsedBankLine, iban: string, sha: (s: string) => Promise<string>): Promise<string> {
  return sha([iban, l.date, l.amountCents, (l.counterparty || "").toLowerCase().slice(0, 40), (l.purpose || "").toLowerCase().replace(/\s+/g, " ").slice(0, 80)].join("|"));
}
