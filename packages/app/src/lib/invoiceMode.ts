import type { Profile } from "@ordo/core";

export type InvoiceMode = "summa" | "external";

/** Effective invoice mode. Undecided profiles fall back to "summa" only if they already wrote invoices in Ordo. */
export function invoiceModeOf(profile: Profile, invoiceCount: number): InvoiceMode | undefined {
  if (profile.company.invoiceMode) return profile.company.invoiceMode;
  return invoiceCount > 0 ? "summa" : undefined;
}

export const INVOICE_MODE_INFO: Record<InvoiceMode, { title: string; short: string; hint: string; body: string }> = {
  summa: {
    title: "In Ordo schreiben",
    short: "Ordo erstellt meine Rechnungen",
    hint: "Nummernkreis, Pflichtangaben, PDF mit Logo – direkt hier.",
    body: "Du schreibst Ausgangsrechnungen direkt in Ordo: fortlaufende Nummer, Pflichtangaben nach § 11 UStG, PDF mit Logo. Beim Fertigstellen entsteht automatisch die Einnahme (offen bis zur Zahlung).",
  },
  external: {
    title: "Kommen aus anderem Programm",
    short: "Meine Rechnungen entstehen woanders",
    hint: "PDF in den Ordner legen oder hochladen – wird automatisch als Einnahme gebucht.",
    body: "Du schreibst Rechnungen mit einem anderen Programm (ERP, Online-Tool, Word …). Lege die PDFs einfach in den Ordner für Ausgangsrechnungen oder lade sie hoch – Ordo liest Kunde, Nummer, Betrag und USt aus und bucht sie als Einnahme. Kein Nummernkreis nötig.",
  },
};
