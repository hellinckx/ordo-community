import type { AiSettings, Category, Extraction, Profile, Transaction } from "../model/types";
import { FALLBACK_CATEGORY, SPECIAL_CATEGORIES } from "../model/defaults";
import type { Suggestion } from "./categorize";
import type { ExtractOutcome } from "./pipeline";

export interface AutoBookInput {
  extraction: Extraction;
  sources: ExtractOutcome["sources"];
  qrKinds: ExtractOutcome["qrKinds"];
  aiError?: string;
  suggestion: Suggestion;
  /** The draft built by transactionFromExtraction. */
  tx: Transaction;
  ai: AiSettings;
  profile: Profile;
  categories: Category[];
  /** Live transactions of the same profile (for the invoice-number duplicate check). */
  existingTxs: Transaction[];
}

export interface AutoBookDecision {
  ok: boolean;
  /** Why the document stays in review (German, shown in the job detail / warnings). */
  reasons: string[];
}

/** Warnings that mean "a human must look at this", regardless of the confidence numbers. */
const BLOCKING_WARNINGS: RegExp[] = [
  /weichen ab/, // AI and rules disagree on amount/date
  /hat KI-Wert/, // rules overrode the AI on an essential field
  /nur anhand des größten Betrags/,
  /ergeben nicht den Gesamtbetrag/,
  /stimmen nicht überein/,
  /Kein plausibles (Beleg|Rechnungs)datum/,
  /KI-Erkennung fehlgeschlagen/,
];

const SPECIAL_IDS = new Set<string>(Object.values(SPECIAL_CATEGORIES));

/**
 * Decides whether an extraction is trustworthy enough to be booked without review.
 * Rules alone never qualify (they top out below 0.9); a trusted source (AI, e-invoice XML or an
 * RKSV cash-register QR) plus confident essential fields is required.
 */
export function decideAutoBook(i: AutoBookInput): AutoBookDecision {
  const reasons: string[] = [];
  const { extraction: ex, tx } = i;
  const conf = ex.confidence;
  const pct = (n: number | undefined) => `${Math.round((n ?? 0) * 100)} %`;

  if (i.ai.autoBook !== "confident") return { ok: false, reasons: ["Automatisches Buchen ist ausgeschaltet"] };

  const trusted = (i.sources.includes("ai") && !i.aiError) || i.sources.includes("einvoice") || (i.sources.includes("qr") && i.qrKinds.includes("rksv"));
  if (!trusted) reasons.push("Keine verlässliche Quelle (nur lokale Regeln)");

  const min = i.ai.minAutoApproveConfidence;
  if (ex.overall < min) reasons.push(`Gesamtsicherheit ${pct(ex.overall)} unter ${pct(min)}`);
  if (ex.fields.grossCents === null || (conf.grossCents ?? 0) < 0.85) reasons.push(`Betrag unsicher (${pct(conf.grossCents)})`);
  if (ex.fields.invoiceDate === null || (conf.invoiceDate ?? 0) < 0.85) reasons.push(`Datum unsicher (${pct(conf.invoiceDate)})`);

  const income = tx.kind === "income";
  const partner = income ? ex.fields.customerName : ex.fields.vendorName;
  const partnerConf = income ? (conf.customerName ?? conf.vendorName) : conf.vendorName;
  // A known contact (matched by UID, IBAN or name) is as good as a confidently read name.
  const knownContact = i.suggestion.contactScore >= 0.8 && !!i.suggestion.contactId;
  if (!partner || ((partnerConf ?? 0) < 0.8 && !knownContact)) reasons.push(`${income ? "Kunde" : "Lieferant"} unsicher (${pct(partnerConf)})`);

  if (!tx.categoryId || i.suggestion.categoryScore < 0.6 || tx.categoryId === FALLBACK_CATEGORY[i.profile.mode][income ? "income" : "expense"]) {
    reasons.push(`Kategorie unsicher (${pct(i.suggestion.categoryScore)})`);
  } else if (SPECIAL_IDS.has(tx.categoryId)) {
    reasons.push("Sonderkategorie (Anlage, Privat, Gehalt) braucht eine Prüfung");
  } else if (!i.categories.some((c) => c.id === tx.categoryId && !c.deletedAt && !c.isArchived)) {
    reasons.push("Kategorie nicht mehr verfügbar");
  }

  if (i.profile.mode === "business" && i.profile.vatRegime !== "kleinunternehmer" && tx.vatTreatment !== "reverse_charge" && (conf.vatLines ?? 0) < 0.8) {
    reasons.push(`Umsatzsteuer unsicher (${pct(conf.vatLines)})`);
  }

  if (ex.fields.documentType !== "invoice" && ex.fields.documentType !== "receipt") reasons.push(`Dokumentart „${ex.fields.documentType}“ wird nicht automatisch gebucht`);

  const blocking = ex.warnings.find((w) => BLOCKING_WARNINGS.some((re) => re.test(w)));
  if (blocking) reasons.push(`Hinweis: ${blocking}`);

  if (tx.invoiceNumber && i.existingTxs.some((t) => t.id !== tx.id && !t.deletedAt && t.invoiceNumber === tx.invoiceNumber && t.grossCents === tx.grossCents)) {
    reasons.push(`Buchung mit Rechnungsnummer ${tx.invoiceNumber} existiert bereits`);
  }

  return { ok: reasons.length === 0, reasons };
}
