/**
 * Kontoabgleich: matches bank statement lines against booked transactions.
 * Score: exact amount (required) + date proximity + text overlap (contact name, invoice number, IBAN).
 */
import type { BankLine, Category, Contact, Transaction } from "../model/types";
import { nowIso, todayIso } from "../model/types";
import { ids } from "../model/ids";
import { lineFromGross } from "../model/vat";
import { FALLBACK_CATEGORY } from "../model/defaults";

export interface MatchCandidate {
  transactionId: string;
  score: number;
  reasons: string[];
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86400_000));
}

export function candidatesForLine(line: BankLine, transactions: Transaction[], contacts: Map<string, Contact>, taken: Set<string>): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  const text = norm(`${line.counterparty} ${line.purpose} ${line.reference}`);
  const abs = Math.abs(line.amountCents);
  for (const t of transactions) {
    if (t.deletedAt || taken.has(t.id) || t.kind === "transfer") continue;
    const wantIncome = line.amountCents > 0;
    if (wantIncome && t.kind !== "income") continue;
    if (!wantIncome && t.kind !== "expense" && t.kind !== "private") continue;
    const net = t.vatLines.reduce((s, l) => s + l.netCents, 0);
    const amountOk = Math.abs(t.grossCents) === abs || ((t.vatTreatment === "reverse_charge" || t.vatTreatment === "ig_erwerb") && net === abs);
    if (!amountOk) continue;
    const reasons: string[] = ["Betrag identisch"];
    let score = 0.5;
    const d1 = daysBetween(line.date, t.paidDate ?? t.date);
    const d2 = daysBetween(line.date, t.date);
    const d = Math.min(d1, d2);
    if (d === 0) {
      score += 0.3;
      reasons.push("gleicher Tag");
    } else if (d <= 3) {
      score += 0.22;
      reasons.push(`${d} Tag(e) Abstand`);
    } else if (d <= 10) {
      score += 0.12;
      reasons.push(`${d} Tage Abstand`);
    } else if (d <= 45) {
      score += 0.03;
    } else continue;
    const contact = t.contactId ? contacts.get(t.contactId) : undefined;
    if (contact) {
      const cn = norm(contact.name);
      const tokens = cn.split(" ").filter((x) => x.length > 2);
      if (cn && (text.includes(cn) || tokens.filter((x) => text.includes(x)).length >= Math.max(1, Math.ceil(tokens.length / 2)))) {
        score += 0.2;
        reasons.push(`Kontakt „${contact.name}“ im Text`);
      }
      if (contact.iban && line.counterpartyIban && contact.iban.replace(/\s+/g, "").toUpperCase() === line.counterpartyIban) {
        score += 0.25;
        reasons.push("IBAN stimmt überein");
      }
    }
    if (t.invoiceNumber && text.includes(norm(t.invoiceNumber))) {
      score += 0.25;
      reasons.push(`Rechnungsnummer ${t.invoiceNumber} im Text`);
    }
    if (t.description) {
      const dn = norm(t.description).split(" ").filter((x) => x.length > 3);
      const hits = dn.filter((x) => text.includes(x)).length;
      if (dn.length && hits / dn.length >= 0.5) {
        score += 0.1;
        reasons.push("Beschreibung passt");
      }
    }
    if (t.paymentMethod === "cash") score -= 0.3;
    out.push({ transactionId: t.id, score: Math.min(1, Math.round(score * 100) / 100), reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface ReconcileResult {
  /** lines with updated suggestion/status */
  lines: BankLine[];
  autoMatched: number;
  suggested: number;
}

/**
 * Computes suggestions for all open lines. Auto-matches when exactly one candidate scores ≥ threshold
 * (or the best is clearly ahead of the second).
 */
export function reconcile(lines: BankLine[], transactions: Transaction[], contacts: Contact[], opts: { autoThreshold?: number } = {}): ReconcileResult {
  const threshold = opts.autoThreshold ?? 0.85;
  const contactMap = new Map(contacts.map((c) => [c.id, c]));
  const taken = new Set(lines.filter((l) => l.matchedTransactionId).map((l) => l.matchedTransactionId!));
  let autoMatched = 0;
  let suggested = 0;
  const out = lines.map((l) => ({ ...l }));
  // process best-first so strong matches claim transactions before weak ones
  const open = out.filter((l) => l.status === "unmatched" || l.status === "suggested");
  const scored = open.map((l) => ({ l, cands: candidatesForLine(l, transactions, contactMap, taken) })).sort((a, b) => (b.cands[0]?.score ?? 0) - (a.cands[0]?.score ?? 0));
  for (const { l, cands } of scored) {
    const fresh = cands.filter((c) => !taken.has(c.transactionId));
    const best = fresh[0];
    if (!best) {
      l.status = "unmatched";
      l.suggestedTransactionId = undefined;
      l.suggestionScore = undefined;
      continue;
    }
    const second = fresh[1];
    const clear = !second || best.score - second.score >= 0.15;
    if (best.score >= threshold && clear) {
      l.status = "matched";
      l.matchedTransactionId = best.transactionId;
      l.suggestedTransactionId = undefined;
      l.suggestionScore = best.score;
      taken.add(best.transactionId);
      autoMatched++;
    } else {
      l.status = "suggested";
      l.suggestedTransactionId = best.transactionId;
      l.suggestionScore = best.score;
      suggested++;
    }
  }
  return { lines: out, autoMatched, suggested };
}

/** Guesses category/contact for a bank line and builds a draft transaction (for "Buchung erstellen"). */
export function transactionFromBankLine(line: BankLine, profileId: string, mode: "employee" | "business", categories: Category[], contacts: Contact[], vatRegime: "kleinunternehmer" | "regelbesteuerung"): Transaction {
  const kind: Transaction["kind"] = line.amountCents > 0 ? "income" : "expense";
  const text = norm(`${line.counterparty} ${line.purpose}`);
  let contact: Contact | undefined;
  let best = 0;
  for (const c of contacts) {
    if (c.deletedAt) continue;
    if (c.iban && line.counterpartyIban && c.iban.replace(/\s+/g, "").toUpperCase() === line.counterpartyIban) {
      contact = c;
      break;
    }
    const cn = norm(c.name);
    if (cn && text.includes(cn) && cn.length > best) {
      contact = c;
      best = cn.length;
    }
    for (const a of c.aliases) {
      const an = norm(a);
      if (an && text.includes(an) && an.length > best) {
        contact = c;
        best = an.length;
      }
    }
  }
  let categoryId = contact?.defaultCategoryId;
  if (!categoryId) {
    let bestScore = 0;
    for (const c of categories) {
      if (c.deletedAt || c.kind !== kind || (c.mode !== "both" && c.mode !== mode)) continue;
      for (const kw of c.keywords) {
        const k = norm(kw);
        if (k && text.includes(k) && k.length > bestScore) {
          bestScore = k.length;
          categoryId = c.id;
        }
      }
    }
  }
  if (!categoryId) categoryId = FALLBACK_CATEGORY[mode][kind];
  const cat = categories.find((c) => c.id === categoryId);
  const gross = Math.abs(line.amountCents);
  const isKu = vatRegime === "kleinunternehmer";
  const rate = isKu && kind === "income" ? 0 : (cat?.defaultVatRate ?? 20);
  const now = nowIso();
  const isTransfer = /\b(uebertrag|umbuchung|eigenuebertrag|sparbuch|kreditkartenabrechnung|paypal transfer|eigene konten)\b/.test(text);
  return {
    id: ids.transaction(),
    profileId,
    kind: isTransfer ? "transfer" : kind,
    date: line.date,
    paidDate: line.valueDate ?? line.date,
    description: (line.counterparty || line.purpose || "Bankumsatz").slice(0, 120),
    contactId: contact?.id,
    categoryId: isTransfer ? undefined : categoryId,
    vatLines: isTransfer ? [] : [lineFromGross(gross, rate)],
    grossCents: gross,
    currency: line.currency || "EUR",
    vatTreatment: isKu && kind === "income" ? "kleinunternehmer" : "standard",
    vatDeductiblePct: cat?.defaultDeductiblePct ?? 100,
    paymentMethod: "bank",
    counterPaymentMethod: isTransfer ? "cash" : undefined,
    invoiceNumber: line.reference,
    reference: line.purpose.slice(0, 200),
    documentIds: [],
    tags: ["bank"],
    notes: "",
    origin: "import",
    reviewed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export interface ReconcileStats {
  total: number;
  matched: number;
  booked: number;
  suggested: number;
  unmatched: number;
  ignored: number;
  unmatchedDebitCents: number;
  unmatchedCreditCents: number;
  /** transactions paid by bank in the period without any bank line */
  unbankedTransactions: Transaction[];
}

export function reconcileStats(lines: BankLine[], transactions: Transaction[], from?: string, to?: string): ReconcileStats {
  const matchedTx = new Set(lines.map((l) => l.matchedTransactionId).filter(Boolean));
  const stats: ReconcileStats = { total: 0, matched: 0, booked: 0, suggested: 0, unmatched: 0, ignored: 0, unmatchedDebitCents: 0, unmatchedCreditCents: 0, unbankedTransactions: [] };
  for (const l of lines) {
    if (l.deletedAt) continue;
    stats.total++;
    if (l.status === "matched") stats.matched++;
    else if (l.status === "booked") stats.booked++;
    else if (l.status === "suggested") stats.suggested++;
    else if (l.status === "ignored") stats.ignored++;
    else {
      stats.unmatched++;
      if (l.amountCents < 0) stats.unmatchedDebitCents += -l.amountCents;
      else stats.unmatchedCreditCents += l.amountCents;
    }
  }
  const f = from ?? "0000-00-00";
  const t = to ?? todayIso();
  stats.unbankedTransactions = transactions.filter((x) => !x.deletedAt && x.kind !== "transfer" && (x.paymentMethod === "bank" || x.paymentMethod === "direct_debit") && !matchedTx.has(x.id) && (x.paidDate ?? x.date) >= f && (x.paidDate ?? x.date) <= t);
  return stats;
}
