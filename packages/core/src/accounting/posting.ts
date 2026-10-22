import type { Asset, Category, JournalEntry, JournalLine, PaymentMethod, Profile, Transaction } from "../model/types";
import type { Cents } from "../model/money";
import { roundCents } from "../model/money";
import { SPECIAL_CATEGORIES } from "../model/defaults";
import { ACCOUNT_INDEX, STD } from "./chart";
import { afaForYear } from "./assets";

export type DerivedEntry = Omit<JournalEntry, "id" | "createdAt" | "updatedAt"> & { id: string };

export function paymentAccount(method: PaymentMethod): string {
  switch (method) {
    case "cash":
      return STD.cash;
    case "card":
      return STD.card;
    case "paypal":
      return STD.paypal;
    default:
      return STD.bank;
  }
}

export function revenueAccountForRate(rate: number): string {
  if (rate === 10) return STD.revenue10;
  if (rate === 13) return STD.revenue13;
  if (rate === 0) return STD.revenue0;
  return STD.revenue20;
}

function line(account: string, debitCents: Cents, creditCents: Cents, text = "", vatRate?: JournalLine["vatRate"]): JournalLine {
  return { account, debitCents, creditCents, text, vatRate };
}

/**
 * Generates the journal entries (Buchungssätze) for a transaction according to the Austrian EKR.
 * Pure function: no ids/numbers; those are assigned by deriveJournal.
 */
export function postingsForTransaction(tx: Transaction, profile: Profile, categories: Map<string, Category>): Omit<DerivedEntry, "id" | "number">[] {
  const cat = tx.categoryId ? categories.get(tx.categoryId) : undefined;
  const isKu = profile.vatRegime === "kleinunternehmer";
  const gross = tx.grossCents;
  const net = tx.vatLines.reduce((s, l) => s + l.netCents, 0) || gross;
  const vat = tx.vatLines.reduce((s, l) => s + l.vatCents, 0);
  const deductible = isKu ? 0 : Math.max(0, Math.min(100, tx.vatDeductiblePct)) / 100;
  const pay = paymentAccount(tx.paymentMethod);
  const text = tx.description || cat?.name || "";
  const base = { profileId: tx.profileId, date: tx.date, description: text, transactionId: tx.id, documentIds: tx.documentIds, source: "auto" as const, locked: false };
  const entries: Omit<DerivedEntry, "id" | "number">[] = [];

  if (tx.kind === "transfer") {
    const to = paymentAccount(tx.counterPaymentMethod ?? "bank");
    entries.push({ ...base, description: text || "Umbuchung", lines: [line(to, gross, 0, text), line(pay, 0, gross, text)] });
    return entries;
  }
  if (tx.kind === "private") {
    entries.push({ ...base, description: text || "Privatentnahme", lines: [line(STD.privateWithdrawal, gross, 0, text), line(pay, 0, gross, text)] });
    return entries;
  }

  const isPaid = !!tx.paidDate || !tx.dueDate;
  const openAccount = tx.kind === "income" ? STD.receivables : STD.payables;
  const settleAccount = isPaid && (!tx.paidDate || tx.paidDate === tx.date) ? pay : openAccount;

  if (tx.kind === "income") {
    if (cat?.id === SPECIAL_CATEGORIES.privateDeposit) {
      entries.push({ ...base, lines: [line(pay, gross, 0, text), line(STD.privateDeposit, 0, gross, text)] });
      return entries;
    }
    const lines: JournalLine[] = [line(settleAccount, gross, 0, text)];
    const revenueAccount = tx.ekrAccountOverride ?? cat?.ekrAccount;
    switch (isKu && tx.vatTreatment === "standard" ? "kleinunternehmer" : tx.vatTreatment) {
      case "standard":
        if (tx.vatLines.length === 0) {
          lines.push(line(revenueAccount ?? STD.revenue20, 0, gross, text));
        } else {
          for (const l of tx.vatLines) {
            lines.push(line(revenueAccount ?? revenueAccountForRate(l.rate), 0, l.netCents, text, l.rate));
            if (l.vatCents) lines.push(line(STD.outputVat, 0, l.vatCents, `USt ${l.rate} %`, l.rate));
          }
        }
        break;
      case "kleinunternehmer":
        lines.push(line(revenueAccount ?? STD.revenue0, 0, gross, text, 0));
        break;
      case "reverse_charge":
        lines.push(line(revenueAccount ?? "4120", 0, gross, text, 0));
        break;
      case "ig_lieferung":
        lines.push(line(revenueAccount ?? "4100", 0, gross, text, 0));
        break;
      case "export":
        lines.push(line(revenueAccount ?? "4110", 0, gross, text, 0));
        break;
      default:
        lines.push(line(revenueAccount ?? STD.revenue0, 0, gross, text, 0));
    }
    entries.push({ ...base, lines });
  } else {
    // expense
    if (cat?.id === SPECIAL_CATEGORIES.privateWithdrawal) {
      entries.push({ ...base, lines: [line(STD.privateWithdrawal, gross, 0, text), line(pay, 0, gross, text)] });
      return entries;
    }
    const isAsset = cat?.id === SPECIAL_CATEGORIES.assetPurchase;
    const expenseAccount = tx.ekrAccountOverride ?? (isAsset ? STD.assetBga : cat?.ekrAccount ?? STD.otherExpense);
    const lines: JournalLine[] = [];
    const treatment = isKu && tx.vatTreatment === "standard" ? "kleinunternehmer" : tx.vatTreatment;
    if (treatment === "standard") {
      const vatDeductible = roundCents(vat * deductible);
      const expenseAmount = gross - vatDeductible;
      lines.push(line(expenseAccount, expenseAmount, 0, text, tx.vatLines[0]?.rate));
      if (vatDeductible) lines.push(line(STD.inputVat, vatDeductible, 0, "Vorsteuer"));
      lines.push(line(settleAccount, 0, gross, text));
    } else if (treatment === "reverse_charge" || treatment === "ig_erwerb") {
      const rate = tx.vatLines[0]?.rate || 20;
      const rc = roundCents((net * rate) / 100);
      const rcDeductible = roundCents(rc * deductible);
      lines.push(line(expenseAccount, net + (rc - rcDeductible), 0, text, rate as JournalLine["vatRate"]));
      if (rcDeductible) lines.push(line(treatment === "ig_erwerb" ? STD.inputVatIg : STD.inputVatRc, rcDeductible, 0, treatment === "ig_erwerb" ? "Vorsteuer ig. Erwerb" : "Vorsteuer Reverse Charge"));
      lines.push(line(treatment === "ig_erwerb" ? STD.outputVatIg : STD.outputVatRc, 0, rc, treatment === "ig_erwerb" ? "USt ig. Erwerb" : "USt Reverse Charge"));
      lines.push(line(settleAccount, 0, net, text));
    } else {
      lines.push(line(expenseAccount, gross, 0, text, 0));
      lines.push(line(settleAccount, 0, gross, text));
    }
    entries.push({ ...base, lines });
  }

  // Zahlung zu einem späteren Zeitpunkt: offener Posten wird ausgeglichen
  if (tx.paidDate && tx.paidDate !== tx.date && tx.dueDate) {
    const amount = tx.vatTreatment === "reverse_charge" || tx.vatTreatment === "ig_erwerb" ? net : gross;
    if (tx.kind === "income") {
      entries.push({ ...base, date: tx.paidDate, description: `Zahlungseingang: ${text}`, lines: [line(pay, amount, 0), line(STD.receivables, 0, amount)] });
    } else {
      entries.push({ ...base, date: tx.paidDate, description: `Zahlung: ${text}`, lines: [line(STD.payables, amount, 0), line(pay, 0, amount)] });
    }
  }
  return entries;
}

/** Yearly AfA entries from the asset register (31.12.). */
export function afaEntries(assets: Asset[], profile: Profile, year: number): Omit<DerivedEntry, "id" | "number">[] {
  const out: Omit<DerivedEntry, "id" | "number">[] = [];
  for (const a of assets) {
    if (a.deletedAt || a.profileId !== profile.id) continue;
    const r = afaForYear(a, year);
    if (r.afaCents > 0) {
      const afaAccount = a.method === "gwg" ? STD.gwg : a.ekrAccount.startsWith("01") ? "7020" : STD.afa;
      out.push({
        profileId: profile.id,
        date: `${year}-12-31`,
        description: `AfA ${year}: ${a.name}`,
        lines: [line(afaAccount, r.afaCents, 0, a.name), line(a.method === "gwg" ? a.ekrAccount : "0690", 0, r.afaCents, a.name)],
        documentIds: [],
        source: "auto",
        locked: false,
      });
    }
    if (r.bookValueAtDisposalCents && a.disposedAt) {
      out.push({
        profileId: profile.id,
        date: a.disposedAt,
        description: `Anlagenabgang: ${a.name}`,
        lines: [line(STD.bookValueDisposed, r.bookValueAtDisposalCents, 0, a.name), line(a.ekrAccount, 0, r.bookValueAtDisposalCents, a.name)],
        documentIds: [],
        source: "auto",
        locked: false,
      });
    }
  }
  return out;
}

/**
 * Derives the complete journal (Buchungsjournal) for a profile: automatic entries from transactions
 * and assets plus persisted manual entries, sorted by date and numbered sequentially.
 */
export function deriveJournal(profile: Profile, transactions: Transaction[], assets: Asset[], categories: Category[], manualEntries: JournalEntry[], years?: number[]): DerivedEntry[] {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const raw: Omit<DerivedEntry, "number">[] = [];
  for (const tx of transactions) {
    if (tx.deletedAt || tx.profileId !== profile.id) continue;
    postingsForTransaction(tx, profile, catMap).forEach((e, i) => raw.push({ ...e, id: `${tx.id}:${i}` }));
  }
  const yearSet = new Set<number>(years ?? raw.map((e) => Number(e.date.slice(0, 4))));
  for (const a of assets) if (!a.deletedAt && a.profileId === profile.id) yearSet.add(Number(a.acquisitionDate.slice(0, 4)));
  const thisYear = new Date().getFullYear();
  for (const y of [...yearSet]) {
    if (y > thisYear) continue;
    afaEntries(assets, profile, y).forEach((e, i) => raw.push({ ...e, id: `afa:${y}:${i}` }));
  }
  for (const m of manualEntries) {
    if (m.deletedAt || m.profileId !== profile.id) continue;
    raw.push({ ...m });
  }
  raw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  return raw.map((e, i) => ({ ...e, number: i + 1 }));
}

/** Validates that an entry balances (Soll = Haben) and uses known accounts. */
export function validateEntry(lines: JournalLine[]): string[] {
  const errors: string[] = [];
  const debit = lines.reduce((s, l) => s + l.debitCents, 0);
  const credit = lines.reduce((s, l) => s + l.creditCents, 0);
  if (debit !== credit) errors.push(`Soll (${debit / 100}) und Haben (${credit / 100}) stimmen nicht überein.`);
  if (lines.length < 2) errors.push("Mindestens zwei Buchungszeilen nötig.");
  for (const l of lines) {
    if (!ACCOUNT_INDEX[l.account] && !/^\d{4}$/.test(l.account)) errors.push(`Unbekanntes Konto ${l.account}.`);
    if (l.debitCents && l.creditCents) errors.push(`Zeile ${l.account}: entweder Soll oder Haben.`);
  }
  return errors;
}
