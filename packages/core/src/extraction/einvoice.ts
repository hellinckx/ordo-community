/**
 * Electronic invoices embedded in PDFs (ZUGFeRD / Factur-X / XRechnung as UN/CEFACT CII, or UBL).
 * When present, these XML files are the single source of truth – no OCR or AI needed.
 */
import type { ExtractedFields } from "../model/types";
import { ExtractedFieldsSchema } from "../model/types";
import { isVatRate, type VatLine } from "../model/vat";

const EMBEDDED_NAMES = /(factur-x|zugferd|xrechnung|invoice|ebinterface|cii)[^/\\]*\.xml$/i;

/** XML text → plain text ("Muster &amp; Co" → "Muster & Co"). */
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const cp = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });
}

function tag(src: string, name: string): string {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[A-Za-z0-9]+:)?${name}>`, "i");
  const m = src.match(re);
  return m ? unescapeXml(m[1]!.trim()) : "";
}
function block(src: string, name: string): string {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${name}>`, "i");
  const m = src.match(re);
  return m ? m[1]! : "";
}
function blocks(src: string, name: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${name}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]!);
  return out;
}
function cents(s: string): number | null {
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function isoFrom102(s: string): string | null {
  const m = s.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m2 ? `${m2[1]}-${m2[2]}-${m2[3]}` : null;
}

export interface EInvoiceResult {
  format: "cii" | "ubl" | "ebinterface";
  fields: ExtractedFields;
  confidence: Record<string, number>;
}

/** Parses UN/CEFACT Cross Industry Invoice (ZUGFeRD 2.x / Factur-X / XRechnung CII). */
export function parseCii(xml: string): EInvoiceResult | null {
  if (!/CrossIndustryInvoice/i.test(xml)) return null;
  const doc = block(xml, "ExchangedDocument");
  const trade = block(xml, "SupplyChainTradeTransaction");
  const agreement = block(trade, "ApplicableHeaderTradeAgreement");
  const seller = block(agreement, "SellerTradeParty");
  const buyer = block(agreement, "BuyerTradeParty");
  const settlement = block(trade, "ApplicableHeaderTradeSettlement");
  const summation = block(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
  const sellerAddr = block(seller, "PostalTradeAddress");
  const vatLines: VatLine[] = [];
  for (const t of blocks(settlement, "ApplicableTradeTax")) {
    const rate = Math.round(Number(tag(t, "RateApplicablePercent") || "0"));
    const net = cents(tag(t, "BasisAmount")) ?? 0;
    const vat = cents(tag(t, "CalculatedAmount")) ?? 0;
    if (isVatRate(rate)) vatLines.push({ rate, netCents: net, vatCents: vat });
  }
  const gross = cents(tag(summation, "GrandTotalAmount")) ?? (vatLines.length ? vatLines.reduce((s, l) => s + l.netCents + l.vatCents, 0) : null);
  const due = cents(tag(summation, "DuePayableAmount"));
  const payment = block(settlement, "SpecifiedTradePaymentTerms");
  const dueDate = isoFrom102(tag(block(payment, "DueDateDateTime"), "DateTimeString"));
  const sellerIban = tag(block(settlement, "SpecifiedTradeSettlementPaymentMeans"), "IBANID");
  const items = blocks(trade, "IncludedSupplyChainTradeLineItem").slice(0, 100).map((li) => ({
    description: tag(block(li, "SpecifiedTradeProduct"), "Name") || null,
    quantity: Number(tag(block(li, "SpecifiedLineTradeDelivery"), "BilledQuantity")) || null,
    unitPriceCents: cents(tag(block(block(li, "SpecifiedLineTradeAgreement"), "NetPriceProductTradePrice"), "ChargeAmount")),
    totalCents: cents(tag(block(block(li, "SpecifiedLineTradeSettlement"), "SpecifiedTradeSettlementLineMonetarySummation"), "LineTotalAmount")),
    vatRate: Number(tag(block(block(li, "SpecifiedLineTradeSettlement"), "ApplicableTradeTax"), "RateApplicablePercent")) || null,
  }));
  const typeCode = tag(doc, "TypeCode");
  const fields = ExtractedFieldsSchema.parse({
    documentType: typeCode === "381" ? "credit_note" : "invoice",
    direction: "incoming",
    vendorName: tag(seller, "Name") || null,
    vendorUid: tag(block(seller, "SpecifiedTaxRegistration"), "ID") || null,
    vendorAddress: [tag(sellerAddr, "LineOne"), [tag(sellerAddr, "PostcodeCode"), tag(sellerAddr, "CityName")].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
    vendorIban: sellerIban.replace(/\s+/g, "").toUpperCase() || null,
    customerName: tag(buyer, "Name") || null,
    invoiceNumber: tag(doc, "ID") || null,
    invoiceDate: isoFrom102(tag(block(doc, "IssueDateTime"), "DateTimeString")),
    dueDate,
    currency: tag(settlement, "InvoiceCurrencyCode") || "EUR",
    grossCents: gross,
    netCents: cents(tag(summation, "TaxBasisTotalAmount")),
    vatCents: cents(tag(summation, "TaxTotalAmount")),
    vatLines,
    paymentMethod: "bank",
    isPaid: due === 0 ? true : null,
    description: null,
    lineItems: items,
    suggestedCategory: null,
    reverseCharge: /\bAE\b/.test(blocks(settlement, "ApplicableTradeTax").map((t) => tag(t, "CategoryCode")).join(" ")) ? true : null,
    notes: "E-Rechnung (ZUGFeRD/Factur-X) im PDF gelesen",
  });
  const confidence: Record<string, number> = { vendorName: 0.98, invoiceNumber: 0.98, invoiceDate: 0.98, grossCents: 0.99, vatLines: 0.98, dueDate: dueDate ? 0.95 : 0, vendorUid: fields.vendorUid ? 0.98 : 0, vendorIban: fields.vendorIban ? 0.98 : 0, documentType: 0.98, currency: 0.98 };
  return { format: "cii", fields, confidence };
}

/** Parses UBL 2.1 invoices (XRechnung UBL, Peppol BIS). */
export function parseUbl(xml: string): EInvoiceResult | null {
  if (!/<(?:[A-Za-z0-9]+:)?(Invoice|CreditNote)[\s>]/i.test(xml) || /CrossIndustryInvoice/i.test(xml)) return null;
  const isCredit = /<(?:[A-Za-z0-9]+:)?CreditNote[\s>]/i.test(xml);
  const supplier = block(block(xml, "AccountingSupplierParty"), "Party");
  const customer = block(block(xml, "AccountingCustomerParty"), "Party");
  const totals = block(xml, "LegalMonetaryTotal");
  const vatLines: VatLine[] = [];
  for (const st of blocks(block(xml, "TaxTotal"), "TaxSubtotal")) {
    const rate = Math.round(Number(tag(block(st, "TaxCategory"), "Percent") || "0"));
    const net = cents(tag(st, "TaxableAmount")) ?? 0;
    const vat = cents(tag(st, "TaxAmount")) ?? 0;
    if (isVatRate(rate)) vatLines.push({ rate, netCents: net, vatCents: vat });
  }
  const addr = block(supplier, "PostalAddress");
  const fields = ExtractedFieldsSchema.parse({
    documentType: isCredit ? "credit_note" : "invoice",
    direction: "incoming",
    vendorName: tag(block(supplier, "PartyLegalEntity"), "RegistrationName") || tag(block(supplier, "PartyName"), "Name") || null,
    vendorUid: tag(block(supplier, "PartyTaxScheme"), "CompanyID") || null,
    vendorAddress: [tag(addr, "StreetName"), [tag(addr, "PostalZone"), tag(addr, "CityName")].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
    vendorIban: (tag(block(block(xml, "PaymentMeans"), "PayeeFinancialAccount"), "ID") || "").replace(/\s+/g, "").toUpperCase() || null,
    customerName: tag(block(customer, "PartyLegalEntity"), "RegistrationName") || tag(block(customer, "PartyName"), "Name") || null,
    invoiceNumber: tag(xml, "ID") || null,
    invoiceDate: isoFrom102(tag(xml, "IssueDate")),
    dueDate: isoFrom102(tag(xml, "DueDate")),
    currency: tag(xml, "DocumentCurrencyCode") || "EUR",
    grossCents: cents(tag(totals, "TaxInclusiveAmount")),
    netCents: cents(tag(totals, "TaxExclusiveAmount")),
    vatCents: cents(tag(block(xml, "TaxTotal"), "TaxAmount")),
    vatLines,
    paymentMethod: "bank",
    isPaid: null,
    description: null,
    lineItems: blocks(xml, isCredit ? "CreditNoteLine" : "InvoiceLine").slice(0, 100).map((li) => ({
      description: tag(block(li, "Item"), "Name") || null,
      quantity: Number(tag(li, isCredit ? "CreditedQuantity" : "InvoicedQuantity")) || null,
      unitPriceCents: cents(tag(block(li, "Price"), "PriceAmount")),
      totalCents: cents(tag(li, "LineExtensionAmount")),
      vatRate: Number(tag(block(block(li, "Item"), "ClassifiedTaxCategory"), "Percent")) || null,
    })),
    suggestedCategory: null,
    reverseCharge: /<(?:[A-Za-z0-9]+:)?ID[^>]*>AE</i.test(block(xml, "TaxTotal")) ? true : null,
    notes: "E-Rechnung (UBL) im PDF gelesen",
  });
  const confidence: Record<string, number> = { vendorName: 0.98, invoiceNumber: 0.98, invoiceDate: 0.98, grossCents: 0.99, vatLines: 0.98, dueDate: fields.dueDate ? 0.95 : 0, vendorUid: fields.vendorUid ? 0.98 : 0, vendorIban: fields.vendorIban ? 0.98 : 0, documentType: 0.98, currency: 0.98 };
  return { format: "ubl", fields, confidence };
}

function attr(src: string, element: string, name: string): string {
  const m = src.match(new RegExp(`<(?:[A-Za-z0-9]+:)?${element}\\b[^>]*\\s${name}="([^"]*)"`, "i"));
  return m ? m[1]!.trim() : "";
}

/** "00000000" is ebInterface's placeholder for "no VAT number". */
const noUid = (s: string) => (!s || /^0+$/.test(s) ? null : s.replace(/\s+/g, "").toUpperCase());

/**
 * Parses ebInterface 4.x–6.x, the Austrian XML invoice standard (e-Rechnung an den Bund, USP). 6.x carries the VAT in
 * Tax/TaxItem (TaxableAmount, TaxPercent, TaxAmount), older versions in Tax/VAT/Item (TaxedAmount, VATRate, Amount).
 */
export function parseEbInterface(xml: string): EInvoiceResult | null {
  if (!/ebinterface\.at\/schema\//i.test(xml) || !/<(?:[A-Za-z0-9]+:)?Invoice[\s>]/i.test(xml)) return null;
  const docType = attr(xml, "Invoice", "DocumentType");
  const biller = block(xml, "Biller");
  const recipient = block(xml, "InvoiceRecipient");
  const addr = block(biller, "Address");
  const tax = block(xml, "Tax");
  const vatLines: VatLine[] = [];
  const taxItems = blocks(tax, "TaxItem");
  if (taxItems.length) {
    for (const t of taxItems) {
      const rate = Math.round(Number(tag(t, "TaxPercent") || "0"));
      const net = cents(tag(t, "TaxableAmount")) ?? 0;
      const vat = cents(tag(t, "TaxAmount")) ?? Math.round((net * rate) / 100);
      if (isVatRate(rate)) vatLines.push({ rate, netCents: net, vatCents: vat });
    }
  } else {
    for (const t of blocks(block(tax, "VAT"), "Item")) {
      const rate = Math.round(Number(tag(t, "VATRate") || "0"));
      const net = cents(tag(t, "TaxedAmount")) ?? 0;
      const vat = cents(tag(t, "Amount")) ?? Math.round((net * rate) / 100);
      if (isVatRate(rate)) vatLines.push({ rate, netCents: net, vatCents: vat });
    }
  }
  const gross = cents(tag(xml, "TotalGrossAmount")) ?? (vatLines.length ? vatLines.reduce((s, l) => s + l.netCents + l.vatCents, 0) : null);
  const payable = cents(tag(xml, "PayableAmount"));
  const net = vatLines.length ? vatLines.reduce((s, l) => s + l.netCents, 0) : null;
  const vat = vatLines.length ? vatLines.reduce((s, l) => s + l.vatCents, 0) : null;
  const dueDate = isoFrom102(tag(block(xml, "PaymentConditions"), "DueDate"));
  const delivery = block(xml, "Delivery");
  const serviceDate = tag(delivery, "Date") || [tag(delivery, "FromDate"), tag(delivery, "ToDate")].filter(Boolean).join(" – ") || null;
  const items = blocks(block(xml, "Details"), "ListLineItem").slice(0, 100).map((li) => ({
    description: tag(li, "Description") || null,
    quantity: Number(tag(li, "Quantity")) || null,
    unitPriceCents: cents(tag(li, "UnitPrice")),
    totalCents: cents(tag(li, "LineItemAmount")),
    vatRate: Number(tag(li, "TaxPercent") || tag(li, "VATRate")) || null,
  }));
  const categories = [...tax.matchAll(/TaxCategoryCode="([^"]+)"/gi)].map((m) => m[1]!.toUpperCase());
  const fields = ExtractedFieldsSchema.parse({
    documentType: docType === "CreditMemo" || docType === "SubsequentCredit" ? "credit_note" : "invoice",
    direction: "incoming",
    vendorName: tag(addr, "Name") || null,
    vendorUid: noUid(tag(biller, "VATIdentificationNumber")),
    vendorAddress: [tag(addr, "Street"), [tag(addr, "ZIP"), tag(addr, "Town")].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
    vendorIban: tag(block(xml, "PaymentMethod"), "IBAN").replace(/\s+/g, "").toUpperCase() || null,
    customerName: tag(block(recipient, "Address"), "Name") || null,
    invoiceNumber: tag(xml, "InvoiceNumber") || null,
    invoiceDate: isoFrom102(tag(xml, "InvoiceDate")),
    dueDate,
    serviceDate,
    currency: attr(xml, "Invoice", "InvoiceCurrency") || "EUR",
    grossCents: gross,
    netCents: net,
    vatCents: vat,
    vatLines,
    paymentMethod: "bank",
    isPaid: payable === 0 ? true : null,
    description: null,
    lineItems: items,
    suggestedCategory: null,
    reverseCharge: categories.includes("AE") ? true : null,
    notes: "E-Rechnung (ebInterface) gelesen",
  });
  const confidence: Record<string, number> = { vendorName: 0.98, invoiceNumber: 0.98, invoiceDate: 0.98, grossCents: 0.99, vatLines: 0.98, dueDate: dueDate ? 0.95 : 0, vendorUid: fields.vendorUid ? 0.98 : 0, vendorIban: fields.vendorIban ? 0.98 : 0, documentType: 0.98, currency: 0.98 };
  return { format: "ebinterface", fields, confidence };
}

export function parseEInvoiceXml(xml: string): EInvoiceResult | null {
  // ebInterface first: its root element is also called <Invoice>, which the UBL parser would otherwise claim
  return parseEbInterface(xml) ?? parseCii(xml) ?? parseUbl(xml);
}

/** Whether a standalone XML file is an e-invoice Ordo can read. */
export function isEInvoiceXml(xml: string): boolean {
  return /ebinterface\.at\/schema\/|CrossIndustryInvoice|urn:oasis:names:specification:ubl:schema:xsd:(Invoice|CreditNote)-2/i.test(xml);
}

/** Picks the e-invoice XML out of a PDF's embedded files (pdf.js attachments map). */
export function findEInvoiceAttachment(attachments: Record<string, { filename: string; content: Uint8Array }> | null | undefined): string | null {
  if (!attachments) return null;
  const td = new TextDecoder("utf-8");
  const entries = Object.values(attachments);
  const preferred = entries.find((a) => EMBEDDED_NAMES.test(a.filename)) ?? entries.find((a) => a.filename.toLowerCase().endsWith(".xml"));
  if (!preferred) return null;
  const text = td.decode(preferred.content);
  return /CrossIndustryInvoice|<(?:[A-Za-z0-9]+:)?Invoice[\s>]|<(?:[A-Za-z0-9]+:)?CreditNote[\s>]/i.test(text) ? text : null;
}
