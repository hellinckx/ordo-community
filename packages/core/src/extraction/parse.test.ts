import { describe, expect, it } from "vitest";
import { parseReceiptText, findIban, findUids, findAmounts, findDates } from "./parse";
import { suggestCategory } from "./categorize";
import { DEFAULT_CATEGORIES } from "../model/defaults";
import { fromAiOutput, mergeExtractions } from "./normalize";
import { AI_OUTPUT_SCHEMA, buildExtractionPrompt, type AiOutput } from "./schema";

const BILLA = `BILLA AG
Billa Filiale 1234
Mariahilfer Straße 10, 1070 Wien
UID: ATU 12345678
Kassenbon Nr. 4711
Datum: 12.03.2026 17:42
Milch 1L               1,29 A
Brot                    3,49 A
Kaffee                 7,99 B
Summe EUR             12,77
Bankomat              12,77
MwSt   Netto   Steuer   Brutto
A 10%  4,35    0,43     4,78
B 20%  6,66    1,33     7,99
Vielen Dank für Ihren Einkauf
`;

const INVOICE = `Mustermann IT Services GmbH
Technikerstraße 5
4020 Linz
UID-Nr.: ATU98765432

Max Kunde
Kundengasse 1
1010 Wien

Rechnung Nr. 2026-0042
Rechnungsdatum: 03.02.2026
Leistungszeitraum: Jänner 2026

Pos  Beschreibung                 Menge  Einzelpreis  Betrag
1    Softwareentwicklung           10 h   100,00       1.000,00
                                            Nettobetrag  1.000,00
                                            20 % USt       200,00
                                            Rechnungsbetrag 1.200,00
Zahlbar innerhalb von 14 Tagen ohne Abzug.
IBAN: AT61 1904 3002 3457 3201  BIC: BKAUATWW
`;

describe("parseReceiptText", () => {
  it("parses an Austrian supermarket receipt", () => {
    const r = parseReceiptText(BILLA);
    expect(r.fields.documentType).toBe("receipt");
    expect(r.fields.vendorName).toBe("BILLA AG");
    expect(r.fields.invoiceDate).toBe("2026-03-12");
    expect(r.fields.grossCents).toBe(1277);
    expect(r.fields.vendorUid).toBe("ATU12345678");
    expect(r.fields.vatLines).toEqual([
      { rate: 20, netCents: 666, vatCents: 133 },
      { rate: 10, netCents: 435, vatCents: 43 },
    ]);
    expect(r.fields.paymentMethod).toBe("card");
    expect(r.fields.isPaid).toBe(true);
    expect(r.overall).toBeGreaterThan(0.7);
  });

  it("parses a B2B invoice", () => {
    const r = parseReceiptText(INVOICE, { ownNames: ["Max Kunde"] });
    expect(r.fields.documentType).toBe("invoice");
    expect(r.fields.vendorName).toBe("Mustermann IT Services GmbH");
    expect(r.fields.invoiceNumber).toBe("2026-0042");
    expect(r.fields.invoiceDate).toBe("2026-02-03");
    expect(r.fields.dueDate).toBe("2026-02-17");
    expect(r.fields.grossCents).toBe(120000);
    expect(r.fields.vatLines).toEqual([{ rate: 20, netCents: 100000, vatCents: 20000 }]);
    expect(r.fields.vendorIban).toBe("AT611904300234573201");
    expect(r.fields.vendorUid).toBe("ATU98765432");
    expect(r.fields.isPaid).toBe(false);
  });

  it("finds identifiers", () => {
    expect(findIban("IBAN AT61 1904 3002 3457 3201")).toBe("AT611904300234573201");
    expect(findIban("IBAN AT61 1904 3002 3457 3202")).toBeNull();
    expect(findUids("UID ATU12345678 und DE123456789")).toEqual(["ATU12345678", "DE123456789"]);
  });

  it("reads English amounts and US dates", () => {
    expect(findAmounts("Total 1,234.56 USD")).toEqual([123456]);
    expect(findAmounts("Summe 12,77")).toEqual([1277]);
    expect(findDates(["Date paid October 15, 2026"]).map((d) => d.iso)).toEqual(["2026-10-15"]);
    expect(findDates(["Due 3 Oct 2026", "Dec 24, 2025"]).map((d) => d.iso)).toEqual(["2026-10-03", "2025-12-24"]);
  });

  it("parses a US-style platform receipt (multi-column, 'Amount paid')", () => {
    const r = parseReceiptText(OPENAI, { ownNames: ["Muster Design e.U."], ownUid: "ATU12345678" });
    expect(r.fields.vendorName).toBe("OpenAI OpCo, LLC");
    expect(r.fields.invoiceNumber).toBe("INV-MUSTER01-000001");
    expect(r.fields.invoiceDate).toBe("2026-10-15");
    expect(r.fields.grossCents).toBe(1500);
    expect(r.fields.currency).toBe("EUR");
    expect(r.fields.isPaid).toBe(true);
    expect(r.fields.vendorUid).not.toBe("ATU12345678");
    expect(r.confidence.grossCents).toBeGreaterThanOrEqual(0.85);
    expect(r.confidence.invoiceDate).toBeGreaterThanOrEqual(0.9);
  });

  it("takes the explicit seller on marketplace invoices", () => {
    const r = parseReceiptText(AMAZON, { ownNames: ["Muster Design e.U."] });
    expect(r.fields.vendorName).toBe("Amazon EU S.à r.l.");
    expect(r.confidence.vendorName).toBe(0.85);
    expect(r.fields.invoiceNumber).toBe("AT100M2USTER");
    expect(r.fields.invoiceDate).toBe("2026-01-23");
    expect(r.fields.grossCents).toBe(4372);
    expect(r.fields.vatLines[0]).toMatchObject({ rate: 20, vatCents: 729 });
    expect(r.fields.vendorUid).toBe("LU26888617");
  });

  it("parses a German hosting invoice with 'SE' legal form", () => {
    const r = parseReceiptText(IONOS);
    expect(r.fields.documentType).toBe("invoice");
    expect(r.fields.vendorName).toBe("IONOS SE");
    expect(r.fields.invoiceNumber).toBe("100100200300");
    expect(r.fields.invoiceDate).toBe("2026-10-01");
    expect(r.fields.grossCents).toBe(101);
    expect(r.fields.vatLines[0]).toMatchObject({ rate: 20, vatCents: 17 });
    expect(r.fields.vendorUid).toBe("DE812871812");
    expect(r.overall).toBeGreaterThan(0.8);
  });
});

const OPENAI = `Receipt
Invoice number INV-MUSTER01-000001
Receipt number 1000-0000-0001
Date paid October 15, 2026
Payment method Mastercard - 0000
Billing Account BA-MUSTER01
Purchase Profile PP-MUSTER01-0001
OpenAI OpCo, LLC Bill to Ship to
1415 3rd Street Muster Design e.U. Muster Design e.U.
San Francisco, California 94158 Musterweg 7 Musterweg 7
United States 1060 Wien 1060 Wien
ar@openai.com Austria Austria
EU OSS VAT EU372041333 AT VAT ATU12345678
€15.00 paid on October 15, 2026
Description Qty Unit price Amount
Ads | ChatGPT campaign spend 1 €15.00 €15.00
Subtotal €15.00
Total €15.00
Amount paid €15.00
`;

const AMAZON = `Amazon.de
Rechnung
Verkauft von Amazon EU S.à r.l.
38 avenue John F. Kennedy, L-1855 Luxemburg
USt-IdNr. LU26888617
Rechnungsnummer AT100M2USTER
Rechnungsdatum 23.01.2026
Lieferadresse
Muster Design e.U.
Musterweg 7
1060 Wien
Artikel Menge Preis
Logitech MX Keys 1 36,43 €
Zwischensumme (netto) 36,43 €
USt 20 % 7,29 €
Gesamtbetrag 43,72 €
`;

const IONOS = `IONOS SE
Elgendorfer Str. 57
56410 Montabaur
USt-IdNr. DE812871812
Rechnung
Rechnungsnummer: 100100200300
Rechnungsdatum: 01.10.2026
Kundennummer: 12345678
Position Beschreibung Betrag
1 Domain muster-simulation.at 0,84 €
Nettobetrag 0,84 €
zzgl. 20 % USt. 0,17 €
Rechnungsbetrag 1,01 €
`;

describe("categorize", () => {
  it("suggests categories by vendor keywords", () => {
    const r = parseReceiptText(BILLA);
    const s = suggestCategory(r.fields, BILLA, DEFAULT_CATEGORIES, [], "employee", "expense");
    expect(s.categoryId).toBe("cat_e_p_lebensmittel");
    const b = suggestCategory(parseReceiptText("OMV Tankstelle\nDiesel 45,2 L\nSumme 72,30\n20% MwSt 12,05").fields, "", DEFAULT_CATEGORIES, [], "business", "expense");
    expect(b.categoryId).toBe("cat_b_ex_treibstoff");
  });
  it("uses user keywords and skips archived categories", () => {
    const cats = DEFAULT_CATEGORIES.map((c) => (c.id === "cat_e_p_lebensmittel" ? { ...c, isArchived: true } : c.id === "cat_e_p_haushalt" ? { ...c, userKeywords: ["billa"] } : c));
    const r = parseReceiptText(BILLA);
    expect(suggestCategory(r.fields, BILLA, cats, [], "employee", "expense").categoryId).toBe("cat_e_p_haushalt");
  });
  it("prefers contact default category", () => {
    const r = parseReceiptText(INVOICE);
    const contacts = [{ id: "c1", profileId: "p1", name: "Mustermann IT Services GmbH", kind: "vendor" as const, uid: "ATU98765432", email: "", phone: "", street: "", zip: "", city: "", country: "AT", iban: "", defaultCategoryId: "cat_b_ex_fremd", notes: "", aliases: [], createdAt: "", updatedAt: "" }];
    const s = suggestCategory(r.fields, INVOICE, DEFAULT_CATEGORIES, contacts, "business", "expense");
    expect(s.contactId).toBe("c1");
    expect(s.categoryId).toBe("cat_b_ex_fremd");
  });
});

describe("normalize + merge", () => {
  it("converts AI output and merges with rules", () => {
    const ai: AiOutput = {
      document_type: "receipt", direction: "incoming", vendor_name: "Billa AG", vendor_uid: "ATU12345678", vendor_address: null, vendor_iban: null, customer_name: null,
      invoice_number: "4711", invoice_date: "2026-03-12", due_date: null, service_date: null, currency: "EUR", gross_total: 12.77, net_total: 11.01, vat_total: 1.76,
      vat_lines: [{ rate: 10, net: 4.35, vat: 0.43 }, { rate: 20, net: 6.66, vat: 1.33 }], payment_method: "card", is_paid: true, description: "Lebensmittel Billa", line_items: [],
      suggested_category: "Lebensmittel / Supermarkt", reverse_charge: false, confidence: { overall: 0.95, vendor_name: 0.95, invoice_date: 0.95, gross_total: 0.98, vat_lines: 0.9, invoice_number: 0.8 }, notes: null,
    };
    const n = fromAiOutput(ai);
    expect(n.fields.grossCents).toBe(1277);
    expect(n.fields.vatLines).toHaveLength(2);
    const merged = mergeExtractions(parseReceiptText(BILLA), n);
    expect(merged.fields.vendorName).toBe("Billa AG");
    expect(merged.confidence.grossCents).toBeGreaterThan(0.95);
    expect(merged.overall).toBeGreaterThan(0.85);
    expect(AI_OUTPUT_SCHEMA.required).toContain("gross_total");
  });
  it("lists categories with example keywords in the prompt", () => {
    const p = buildExtractionPrompt({ mode: "employee", categories: [{ name: "Lebensmittel", kind: "expense", keywords: ["billa", "spar"] }, { name: "Gehalt", kind: "income" }] });
    expect(p).toContain("Ausgaben: Lebensmittel (z. B. billa, spar)");
    expect(p).toContain("Einnahmen: Gehalt");
  });
});
