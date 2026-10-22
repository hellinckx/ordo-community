/**
 * ebInterface 6.1 – the Austrian XML invoice standard. Needed for e-invoices to the federal government (USP /
 * e-Rechnung an den Bund) and accepted by many larger firms and ERPs. Structure and element order follow
 * Invoice.xsd 6.1 (austriapro/ebinterface-standards); reading ebInterface lives in extraction/einvoice.ts.
 */
import type { Invoice, Profile } from "../model/types";
import { invoiceTotals } from "../analytics/stats";

export const EBINTERFACE_NS = "http://www.ebinterface.at/schema/6p1/";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const amount = (c: number) => (c / 100).toFixed(2);
const el = (name: string, value: string | number | undefined | null, attrs = "") => (value === undefined || value === null || value === "" ? "" : `<${name}${attrs}>${esc(String(value))}</${name}>`);

/** UN/ECE Recommendation 20 codes for the units Ordo users type. Unknown units are passed through as written. */
export function unitCode(unit: string): string {
  const u = unit.trim().toLowerCase().replace(/\.$/, "");
  const map: Record<string, string> = {
    stk: "C62", "stück": "C62", stueck: "C62", st: "C62", pauschale: "C62", pausch: "C62", psch: "C62", "": "C62",
    h: "HUR", std: "HUR", stunde: "HUR", stunden: "HUR",
    min: "MIN", minute: "MIN", minuten: "MIN",
    tag: "DAY", tage: "DAY", tg: "DAY",
    monat: "MON", monate: "MON", mon: "MON",
    woche: "WEE", wochen: "WEE",
    jahr: "ANN", jahre: "ANN",
    kg: "KGM", g: "GRM", t: "TNE", l: "LTR", m: "MTR", km: "KMT", "m²": "MTK", m2: "MTK", "m³": "MTQ", m3: "MTQ",
  };
  return map[u] ?? unit.trim();
}

/** UNCL 5305 tax category for one rate under the invoice's VAT treatment. */
function taxCategory(rate: number, inv: Invoice, isKu: boolean): string {
  if (isKu || inv.vatTreatment === "kleinunternehmer" || inv.vatTreatment === "exempt") return "E";
  if (inv.vatTreatment === "reverse_charge") return "AE";
  if (inv.vatTreatment === "ig_lieferung") return "K";
  if (inv.vatTreatment === "export") return "G";
  if (rate === 0) return "Z";
  return rate === 20 ? "S" : "AA";
}

function legalNote(inv: Invoice, isKu: boolean): string {
  if (isKu || inv.vatTreatment === "kleinunternehmer") return "Umsatzsteuerbefreit gemäß § 6 Abs. 1 Z 27 UStG (Kleinunternehmerregelung).";
  if (inv.vatTreatment === "reverse_charge") return "Übergang der Steuerschuld auf den Leistungsempfänger (Reverse Charge, § 19 Abs. 1 UStG).";
  if (inv.vatTreatment === "ig_lieferung") return "Steuerfreie innergemeinschaftliche Lieferung (Art. 6 Abs. 1 UStG).";
  if (inv.vatTreatment === "export") return "Steuerfreie Ausfuhrlieferung (§ 6 Abs. 1 Z 1 UStG).";
  return "";
}

export interface EbInterfaceOptions {
  /** Auftragsreferenz of the recipient – for the federal government the "Einkäufergruppe/Auftragsreferenz". */
  orderReference?: string;
  /** Your supplier number at the recipient (Lieferantennummer). */
  billerIdAtRecipient?: string;
}

export interface EbInterfaceResult {
  xml: string;
  /** Things the recipient's portal is likely to reject – shown before the file is saved. */
  warnings: string[];
}

/**
 * Builds the ebInterface 6.1 XML for an outgoing invoice. The amounts are those of the PDF (invoiceTotals); an invoice-
 * level discount is folded into the line amounts so that every tax rate's lines add up exactly to its taxable amount.
 */
export function buildEbInterface(inv: Invoice, profile: Profile, opts: EbInterfaceOptions = {}): EbInterfaceResult {
  const warnings: string[] = [];
  const c = profile.company;
  const cust = inv.customerSnapshot;
  const isKu = profile.vatRegime === "kleinunternehmer";
  const totals = invoiceTotals(isKu && inv.vatTreatment === "standard" ? { ...inv, vatTreatment: "kleinunternehmer" } : inv);
  const taxable = inv.vatTreatment === "standard" && !isKu;

  // line nets as on the PDF, then the per-rate totals (after the invoice discount) spread back onto the lines
  const lines = inv.lines.map((l) => ({ l, rate: taxable ? l.vatRate : 0, net: Math.round(l.quantity * l.unitNetCents * (1 - (l.discountPct || 0) / 100)) }));
  for (const row of totals.byRate) {
    const members = lines.filter((x) => x.rate === row.rate);
    const before = members.reduce((s, x) => s + x.net, 0);
    if (!members.length || before === row.netCents) continue;
    let left = row.netCents;
    members.forEach((x, i) => {
      const share = i === members.length - 1 ? left : Math.round((x.net / (before || 1)) * row.netCents);
      left -= share;
      x.net = share;
    });
  }

  if (!c.name && !profile.name) warnings.push("Firmenname fehlt (Einstellungen → Profil & Firma).");
  if (!c.zip || !c.city) warnings.push("Postleitzahl und Ort deiner Firma fehlen.");
  if (!c.uid && !isKu) warnings.push("Deine UID-Nummer fehlt – ohne sie lehnen viele Empfänger die E-Rechnung ab.");
  if (!cust.name) warnings.push("Der Kunde hat keinen Namen.");
  if (!cust.zip || !cust.city) warnings.push("Postleitzahl und Ort des Kunden fehlen.");
  if (!lines.length) warnings.push("Die Rechnung hat keine Positionen.");
  if (!c.iban) warnings.push("Keine IBAN hinterlegt – der Empfänger sieht keine Bankverbindung.");

  const address = (a: { name: string; street?: string; zip?: string; city?: string; country?: string; email?: string; phone?: string }) =>
    `<Address>${el("Name", a.name || "-")}${el("Street", a.street)}<Town>${esc(a.city || "-")}</Town><ZIP>${esc(a.zip || "-")}</ZIP><Country CountryCode="${esc((a.country || "AT").slice(0, 2).toUpperCase())}">${esc(countryName(a.country || "AT"))}</Country>${el("Phone", a.phone)}${el("Email", a.email)}</Address>`;

  const delivery = inv.servicePeriodStart && inv.servicePeriodEnd
    ? `<Delivery><Period><FromDate>${inv.servicePeriodStart}</FromDate><ToDate>${inv.servicePeriodEnd}</ToDate></Period></Delivery>`
    : `<Delivery><Date>${inv.servicePeriodStart ?? inv.issueDate}</Date></Delivery>`;

  const items = lines
    .map(({ l, rate, net }, i) => {
      const unitPrice = l.quantity ? net / 100 / l.quantity : 0;
      return (
        `<ListLineItem><PositionNumber>${i + 1}</PositionNumber>${el("Description", l.description || "Position")}` +
        `<Quantity Unit="${esc(unitCode(l.unit))}">${Number(l.quantity.toFixed(4))}</Quantity><UnitPrice>${unitPrice.toFixed(4)}</UnitPrice>` +
        `<TaxItem><TaxableAmount>${amount(net)}</TaxableAmount><TaxPercent TaxCategoryCode="${taxCategory(rate, inv, isKu)}">${rate.toFixed(2)}</TaxPercent></TaxItem>` +
        `<LineItemAmount>${amount(net)}</LineItemAmount></ListLineItem>`
      );
    })
    .join("");

  const note = legalNote(inv, isKu);
  const taxItems = totals.byRate
    .map((r) => `<TaxItem><TaxableAmount>${amount(r.netCents)}</TaxableAmount><TaxPercent TaxCategoryCode="${taxCategory(r.rate, inv, isKu)}">${r.rate.toFixed(2)}</TaxPercent><TaxAmount>${amount(r.vatCents)}</TaxAmount>${el("Comment", note)}</TaxItem>`)
    .join("");

  const payment = c.iban
    ? `<PaymentMethod><UniversalBankTransaction><BeneficiaryAccount>${el("BIC", c.bic.replace(/\s+/g, ""))}<IBAN>${esc(c.iban.replace(/\s+/g, "").toUpperCase())}</IBAN>${el("BankAccountOwner", c.name || profile.name)}</BeneficiaryAccount><PaymentReference>${esc(inv.number)}</PaymentReference></UniversalBankTransaction></PaymentMethod>`
    : "";
  const comment = [inv.introText, note, inv.footerText].map((s) => s?.trim()).filter(Boolean).join("\n");
  const orderRef = opts.orderReference ?? inv.reference;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Invoice xmlns="${EBINTERFACE_NS}" GeneratingSystem="Ordo" DocumentType="${inv.kind === "credit_note" ? "CreditMemo" : "Invoice"}" InvoiceCurrency="EUR" Language="ger">` +
    `<InvoiceNumber>${esc(inv.number)}</InvoiceNumber><InvoiceDate>${inv.issueDate}</InvoiceDate>${delivery}` +
    `<Biller><VATIdentificationNumber>${esc(c.uid.replace(/\s+/g, "").toUpperCase() || "00000000")}</VATIdentificationNumber>` +
    address({ name: c.name || profile.name, street: c.street, zip: c.zip, city: c.city, country: c.country, email: c.email, phone: c.phone }) +
    `${el("InvoiceRecipientsBillerID", opts.billerIdAtRecipient)}</Biller>` +
    `<InvoiceRecipient><VATIdentificationNumber>${esc(cust.uid.replace(/\s+/g, "").toUpperCase() || "00000000")}</VATIdentificationNumber>` +
    (orderRef ? `<OrderReference><OrderID>${esc(orderRef)}</OrderID></OrderReference>` : "") +
    address({ name: cust.name, street: cust.street, zip: cust.zip, city: cust.city, country: cust.country, email: cust.email }) +
    `</InvoiceRecipient>` +
    `<Details><ItemList>${items}</ItemList></Details>` +
    `<Tax>${taxItems}</Tax>` +
    `<TotalGrossAmount>${amount(totals.grossCents)}</TotalGrossAmount><PayableAmount>${amount(totals.grossCents)}</PayableAmount>` +
    payment +
    `<PaymentConditions><DueDate>${inv.dueDate}</DueDate></PaymentConditions>` +
    el("Comment", comment) +
    `</Invoice>\n`;
  return { xml, warnings };
}

function countryName(code: string): string {
  const map: Record<string, string> = { AT: "Österreich", DE: "Deutschland", CH: "Schweiz", IT: "Italien", SI: "Slowenien", HU: "Ungarn", SK: "Slowakei", CZ: "Tschechien", LI: "Liechtenstein" };
  return map[code.toUpperCase()] ?? code.toUpperCase();
}
