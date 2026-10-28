import type { BankLine } from "../model/types";

export function needsBankTransferReview(line: BankLine): boolean {
  return /\b(eigenübertrag|eigenuebertrag|eigene konten|umbuchung|bargeldbehebung|bankomatbehebung|barabhebung|atm|automat\s*\d|kreditkartenabrechnung)\b/i.test(`${line.counterparty} ${line.purpose}`);
}

export function bankSettlementInstructions(mode: "employee" | "business"): string {
  return `Erledige meine offenen Kontoauszugszeilen: Prüfe passende Vorschläge, ordne Umsätze bestehenden Buchungen zu und buche fehlende Einnahmen und Ausgaben mit passender Kategorie. ${mode === "employee"
    ? "Dies ist mein Privatprofil: Auch Taschengeld, Geschenke und Unterstützung sind Einnahmen im Haushaltsbudget. Private Umsätze nicht aussortieren. Das ist keine Aussage über ihre Steuerpflicht."
    : "Dies ist mein Firmenprofil: Eindeutig private Umsätze nicht als betrieblichen Umsatz buchen; einen Ausschluss einzeln begründen."} Ein Zahlungspartner oder das Wort Übertrag allein beweist keine Umbuchung zwischen eigenen Konten. Unklare Umsätze offen lassen und nachfragen. Zeig mir vorher die einzelnen Änderungen und sag danach, wo noch eine Rechnung fehlt oder etwas unklar ist.`;
}

/** Model suggestions must not silently discard private household income or unexplained movements. */
export function bankIgnoreError(line: BankLine, mode: "employee" | "business", reason?: string): string | undefined {
  if (!reason?.trim()) return "Zum Ignorieren ist eine nachvollziehbare Begründung erforderlich.";
  if (mode === "employee") return `Im Privatprofil sind private Zahlungen relevant, auch Taschengeld und Geschenke. Als ${line.amountCents > 0 ? "Einnahme" : "Ausgabe"} prüfen; eine echte Umbuchung muss die Person selbst bestätigen.`;
  return undefined;
}
