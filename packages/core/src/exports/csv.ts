import type { Category, Contact, Transaction } from "../model/types";
import { fromCents } from "../model/money";
import type { DerivedEntry } from "../accounting/posting";
import { accountName } from "../accounting/chart";

const te = new TextEncoder();

/** German Excel friendly CSV: UTF-8 BOM, semicolon separator, comma decimal, CRLF. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): Uint8Array {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? v.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }) : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(";"), ...rows.map((r) => r.map(esc).join(";"))];
  return te.encode("﻿" + lines.join("\r\n") + "\r\n");
}

export const KIND_LABELS: Record<Transaction["kind"], string> = { expense: "Ausgabe", income: "Einnahme", transfer: "Umbuchung", private: "Privat" };
export const PAYMENT_LABELS: Record<Transaction["paymentMethod"], string> = { bank: "Bank", cash: "Bar", card: "Karte", paypal: "PayPal", direct_debit: "Lastschrift", other: "Sonstige" };
export const TREATMENT_LABELS: Record<Transaction["vatTreatment"], string> = {
  standard: "Standard",
  kleinunternehmer: "Kleinunternehmer (steuerfrei)",
  reverse_charge: "Reverse Charge",
  ig_erwerb: "Innergemeinschaftlicher Erwerb",
  ig_lieferung: "Innergemeinschaftliche Lieferung",
  export: "Ausfuhr (Drittland)",
  exempt: "Steuerfrei ohne Vorsteuerabzug",
  private: "Privat (nicht steuerrelevant)",
};

export function transactionsCsv(transactions: Transaction[], categories: Category[], contacts: Contact[]): Uint8Array {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const cons = new Map(contacts.map((c) => [c.id, c.name]));
  const headers = ["Datum", "Bezahlt am", "Art", "Beschreibung", "Kontakt", "Kategorie", "Netto", "USt", "Brutto", "USt-Satz", "USt-Behandlung", "Vorsteuer %", "Zahlungsart", "Rechnungsnr.", "Fällig", "EKR-Konto", "E1a-KZ", "L1-KZ", "Tags", "Belege", "Geprüft", "ID"];
  const rows = transactions
    .filter((t) => !t.deletedAt)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => {
      const c = t.categoryId ? cats.get(t.categoryId) : undefined;
      const net = t.vatLines.reduce((s, l) => s + l.netCents, 0) || t.grossCents;
      const vat = t.vatLines.reduce((s, l) => s + l.vatCents, 0);
      const rates = [...new Set(t.vatLines.map((l) => l.rate))].join("/");
      return [
        t.date,
        t.paidDate ?? "",
        KIND_LABELS[t.kind],
        t.description,
        t.contactId ? (cons.get(t.contactId) ?? "") : "",
        c?.name ?? "",
        fromCents(t.kind === "income" ? net : -net),
        fromCents(t.kind === "income" ? vat : -vat),
        fromCents(t.kind === "income" ? t.grossCents : -t.grossCents),
        rates ? rates + " %" : "",
        TREATMENT_LABELS[t.vatTreatment],
        t.vatDeductiblePct,
        PAYMENT_LABELS[t.paymentMethod],
        t.invoiceNumber,
        t.dueDate ?? "",
        t.ekrAccountOverride ?? c?.ekrAccount ?? "",
        t.e1aKzOverride ?? c?.e1aKz ?? "",
        t.l1KzOverride ?? c?.l1Kz ?? "",
        t.tags.join(", "),
        t.documentIds.length,
        t.reviewed ? "ja" : "nein",
        t.id,
      ];
    });
  return toCsv(headers, rows);
}

export function journalCsv(entries: DerivedEntry[]): Uint8Array {
  const headers = ["Nr.", "Datum", "Buchungstext", "Konto", "Kontobezeichnung", "Soll", "Haben", "USt-Satz", "Quelle"];
  const rows: (string | number)[][] = [];
  for (const e of entries) {
    for (const l of e.lines) {
      rows.push([e.number, e.date, l.text || e.description, l.account, accountName(l.account), l.debitCents ? fromCents(l.debitCents) : "", l.creditCents ? fromCents(l.creditCents) : "", l.vatRate !== undefined ? `${l.vatRate} %` : "", e.source]);
    }
  }
  return toCsv(headers, rows);
}

export function kennzahlenCsv(lines: { kz: string; label: string; section: string; amountCents?: number; baseCents?: number; taxCents?: number }[]): Uint8Array {
  const headers = ["Kennzahl", "Bezeichnung", "Abschnitt", "Bemessungsgrundlage", "Steuer/Betrag"];
  return toCsv(
    headers,
    lines.map((l) => [l.kz, l.label, l.section, l.baseCents !== undefined ? fromCents(l.baseCents) : "", l.taxCents !== undefined ? fromCents(l.taxCents) : l.amountCents !== undefined ? fromCents(l.amountCents) : ""]),
  );
}

/**
 * BMD/ DATEV-ähnlicher Buchungsexport für den Steuerberater (eine Zeile pro Buchung mit Gegenkonto).
 * Format: Datum;Belegnr;Text;Konto;Gegenkonto;Betrag;Steuersatz;Steuercode
 */
export function steuerberaterCsv(entries: DerivedEntry[]): Uint8Array {
  const headers = ["Datum", "Belegnr", "Buchungstext", "Konto", "Gegenkonto", "Betrag", "Steuersatz", "Soll/Haben"];
  const rows: (string | number)[][] = [];
  for (const e of entries) {
    const credits = e.lines.filter((l) => l.creditCents);
    const debits = e.lines.filter((l) => l.debitCents);
    const counter = credits.length === 1 ? credits[0]!.account : debits.length === 1 ? debits[0]!.account : "";
    for (const l of e.lines) {
      if (counter && l.account === counter && (credits.length === 1 ? credits.length : debits.length) === 1 && e.lines.length > 2) continue;
      rows.push([e.date, String(e.number), l.text || e.description, l.account, counter && counter !== l.account ? counter : "", fromCents(l.debitCents || l.creditCents), l.vatRate ?? "", l.debitCents ? "S" : "H"]);
    }
  }
  return toCsv(headers, rows);
}
