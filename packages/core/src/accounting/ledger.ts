import type { Cents } from "../model/money";
import { accountName, accountType, CHART_OF_ACCOUNTS, type AccountType } from "./chart";
import type { DerivedEntry } from "./posting";

export interface AccountBalance {
  account: string;
  name: string;
  type: AccountType;
  debitCents: Cents;
  creditCents: Cents;
  /** debit - credit (positive = Sollsaldo) */
  balanceCents: Cents;
}

function inRange(date: string, from?: string, to?: string) {
  return (!from || date >= from) && (!to || date <= to);
}

/** Saldenliste: all accounts with movements in the range. */
export function saldenliste(entries: DerivedEntry[], from?: string, to?: string): AccountBalance[] {
  const map = new Map<string, AccountBalance>();
  for (const e of entries) {
    if (!inRange(e.date, from, to)) continue;
    for (const l of e.lines) {
      let b = map.get(l.account);
      if (!b) {
        b = { account: l.account, name: accountName(l.account), type: accountType(l.account), debitCents: 0, creditCents: 0, balanceCents: 0 };
        map.set(l.account, b);
      }
      b.debitCents += l.debitCents;
      b.creditCents += l.creditCents;
      b.balanceCents = b.debitCents - b.creditCents;
    }
  }
  return [...map.values()].sort((a, b) => a.account.localeCompare(b.account));
}

export interface GuvResult {
  from: string;
  to: string;
  revenues: AccountBalance[];
  expenses: AccountBalance[];
  revenueTotalCents: Cents;
  expenseTotalCents: Cents;
  resultCents: Cents; // Gewinn (+) / Verlust (−)
}

/** Gewinn- und Verlustrechnung (Klassen 4–8). */
export function guv(entries: DerivedEntry[], from: string, to: string): GuvResult {
  const balances = saldenliste(entries, from, to);
  const revenues = balances.filter((b) => b.type === "revenue");
  const expenses = balances.filter((b) => b.type === "expense");
  const revenueTotalCents = revenues.reduce((s, b) => s - b.balanceCents, 0); // credit balance positive
  const expenseTotalCents = expenses.reduce((s, b) => s + b.balanceCents, 0);
  return { from, to, revenues, expenses, revenueTotalCents, expenseTotalCents, resultCents: revenueTotalCents - expenseTotalCents };
}

export interface BilanzResult {
  asOf: string;
  aktiva: AccountBalance[];
  passiva: AccountBalance[];
  aktivaTotalCents: Cents;
  passivaTotalCents: Cents;
  jahresergebnisCents: Cents;
  eigenkapitalCents: Cents;
}

/** Bilanz zum Stichtag (alle Buchungen bis asOf, Ergebnis des laufenden Jahres im Eigenkapital). */
export function bilanz(entries: DerivedEntry[], asOf: string): BilanzResult {
  const all = saldenliste(entries, undefined, asOf);
  const year = asOf.slice(0, 4);
  const current = guv(entries, `${year}-01-01`, asOf);
  const priorResults = guv(entries, "0000-01-01", `${Number(year) - 1}-12-31`).resultCents;
  const aktiva = all.filter((b) => b.type === "asset" && b.balanceCents !== 0);
  const liabilities = all.filter((b) => b.type === "liability" && b.balanceCents !== 0);
  const equity = all.filter((b) => b.type === "equity" && b.balanceCents !== 0);
  const aktivaTotalCents = aktiva.reduce((s, b) => s + b.balanceCents, 0);
  const equityFromAccounts = equity.reduce((s, b) => s - b.balanceCents, 0);
  const eigenkapitalCents = equityFromAccounts + priorResults + current.resultCents;
  const passiva: AccountBalance[] = [
    ...liabilities.map((b) => ({ ...b, balanceCents: -b.balanceCents })),
    { account: "9000", name: "Eigenkapital (inkl. Vorjahresergebnisse)", type: "equity", debitCents: 0, creditCents: 0, balanceCents: equityFromAccounts + priorResults },
    { account: "9890", name: `Jahresergebnis ${year}`, type: "closing", debitCents: 0, creditCents: 0, balanceCents: current.resultCents },
  ];
  const passivaTotalCents = passiva.reduce((s, b) => s + b.balanceCents, 0);
  return { asOf, aktiva, passiva, aktivaTotalCents, passivaTotalCents, jahresergebnisCents: current.resultCents, eigenkapitalCents };
}

export interface KontoblattRow {
  entryNumber: number;
  date: string;
  description: string;
  counterAccounts: string[];
  debitCents: Cents;
  creditCents: Cents;
  balanceCents: Cents;
}

/** Kontoblatt with running balance. */
export function kontoblatt(entries: DerivedEntry[], account: string, from?: string, to?: string): KontoblattRow[] {
  const rows: KontoblattRow[] = [];
  let balance = 0;
  for (const e of entries) {
    if (!inRange(e.date, from, to)) continue;
    for (const l of e.lines) {
      if (l.account !== account) continue;
      balance += l.debitCents - l.creditCents;
      rows.push({
        entryNumber: e.number,
        date: e.date,
        description: l.text || e.description,
        counterAccounts: e.lines.filter((x) => x.account !== account).map((x) => x.account),
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        balanceCents: balance,
      });
    }
  }
  return rows;
}

export function accountsWithMovements(entries: DerivedEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) for (const l of e.lines) set.add(l.account);
  return [...set].sort();
}

export const ALL_ACCOUNT_NUMBERS = CHART_OF_ACCOUNTS.map((a) => a.number);
