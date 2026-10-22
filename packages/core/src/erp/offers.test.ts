import { describe, expect, it } from "vitest";
import type { Contact, Invoice, Profile } from "../model/types";
import { CompanySchema } from "../model/types";
import type { Offer, OfferLine, Project } from "./schemas";
import {
  allocateInvoiceNumber,
  allocateOfferNumber,
  defaultOfferPaymentTerms,
  duplicateOffer,
  fillOfferPlaceholders,
  invoiceBudgetNetCents,
  invoiceFromOffer,
  invoicesForOffer,
  isOfferExpiringSoon,
  offerCompletion,
  offerDisplayStatus,
  offerFileName,
  offerLinesFromPaste,
  offerMainVatRate,
  offerTotals,
  parseLocalizedDecimal,
  parseOfferPaste,
  projectBillingSuggestion,
  projectInvoiceDraft,
  suggestOfferCompletionText,
  suggestOfferPaymentTerms,
  suggestOfferScopeText,
} from "./offers";

const NOW = "2026-03-02T10:00:00.000Z";

function line(p: Partial<OfferLine>): OfferLine {
  return { id: p.id ?? "l", title: "", description: "", quantity: 1, unit: "Std", unitNetCents: 0, vatRate: 20, optional: false, ...p };
}

function offer(p: Partial<Offer> = {}): Offer {
  return {
    id: "ofr_1",
    profileId: "prf_1",
    number: "AN-2026-0007",
    date: "2026-03-02",
    validUntil: "2026-04-01",
    status: "accepted",
    subject: "Simulation Halle 3",
    contractTitle: "Werkvertrag",
    introText: "",
    scopeText: "",
    completionText: "",
    paymentTermsText: "",
    paymentDueDays: 14,
    downpaymentPct: 30,
    finalPaymentPct: 70,
    discountPct: 0,
    discountText: "",
    reverseCharge: false,
    internalNote: "",
    lines: [],
    invoiceIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...p,
  };
}

function profile(p: Partial<Profile> = {}): Profile {
  return {
    id: "prf_1",
    name: "Firma",
    mode: "business",
    accountingMethod: "eur",
    vatRegime: "regelbesteuerung",
    uvaPeriod: "quarterly",
    ustSystem: "netto",
    pauschalierung: "none",
    pauschalierungBranch: "regular",
    fiscalYearStartMonth: 1,
    company: { ...CompanySchema.parse({}), name: "Muster e.U.", nextInvoiceNumber: 5, invoiceFooter: "Danke" },
    color: "#000",
    createdAt: NOW,
    updatedAt: NOW,
    ...p,
  };
}

const contact: Contact = {
  id: "ctc_1",
  profileId: "prf_1",
  name: "Kunde GmbH",
  kind: "customer",
  uid: "ATU12345678",
  email: "a@b.at",
  phone: "",
  street: "Hauptstraße 1",
  zip: "1010",
  city: "Wien",
  country: "AT",
  iban: "",
  notes: "",
  aliases: [],
  createdAt: NOW,
  updatedAt: NOW,
};

function invoice(p: Partial<Invoice>): Invoice {
  return {
    id: "inv_x",
    profileId: "prf_1",
    number: "RE-2026-0001",
    kind: "invoice",
    customerSnapshot: { name: "", street: "", zip: "", city: "", country: "AT", uid: "", email: "" },
    issueDate: "2026-03-10",
    dueDate: "2026-03-24",
    servicePeriod: "",
    lines: [],
    introText: "",
    footerText: "",
    status: "sent",
    paidCents: 0,
    vatTreatment: "standard",
    reference: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...p,
  };
}

let seq = 0;
const newId = (k: "invoice" | "line") => `${k}_${++seq}`;

describe("offerTotals", () => {
  it("sums lines per rate, leaves optional lines out", () => {
    const t = offerTotals(offer({ lines: [line({ quantity: 2.5, unitNetCents: 10_001 }), line({ quantity: 1, unitNetCents: 5_000, vatRate: 10 }), line({ quantity: 3, unitNetCents: 1_000, optional: true })] }));
    expect(t.linesNetCents).toBe(25_003 + 5_000); // round(2.5 × 100,01 €)
    expect(t.optionalNetCents).toBe(3_000);
    expect(t.byRate).toEqual([
      { rate: 20, netCents: 25_003, vatCents: 5_001 },
      { rate: 10, netCents: 5_000, vatCents: 500 },
    ]);
    expect(t.vatCents).toBe(5_501);
    expect(t.grossCents).toBe(30_003 + 5_501);
  });

  it("takes the discount off net and VAT", () => {
    const t = offerTotals(offer({ discountPct: 10, lines: [line({ quantity: 1, unitNetCents: 100_000 })] }));
    expect(t.discountNetCents).toBe(10_000);
    expect(t.discountVatCents).toBe(2_000);
    expect(t.netCents).toBe(90_000);
    expect(t.vatCents).toBe(18_000);
    expect(t.grossCents).toBe(108_000);
  });

  it("has no VAT with reverse charge or Kleinunternehmer", () => {
    const o = offer({ reverseCharge: true, lines: [line({ unitNetCents: 10_000 })] });
    expect(offerTotals(o).vatCents).toBe(0);
    expect(offerTotals(o).noVat).toBe(true);
    expect(offerTotals(offer({ lines: [line({ unitNetCents: 10_000 })] }), { kleinunternehmer: true }).grossCents).toBe(10_000);
  });

  it("finds the main VAT rate", () => {
    expect(offerMainVatRate(offer({ lines: [line({ unitNetCents: 100, vatRate: 20 }), line({ unitNetCents: 500, vatRate: 10 })] }))).toBe(10);
    expect(offerMainVatRate(offer())).toBe(20);
  });
});

describe("numbering", () => {
  it("formats offer numbers from the settings and skips used ones", () => {
    expect(allocateOfferNumber({ offerNumberPattern: "AN-{YYYY}-{NNNN}", nextOfferNumber: 7 }, "2026-03-02")).toEqual({ number: "AN-2026-0007", next: 8 });
    expect(allocateOfferNumber({ offerNumberPattern: "AN-{YYYY}-{NNNN}", nextOfferNumber: 7 }, "2026-03-02", ["AN-2026-0007", "AN-2026-0008"])).toEqual({ number: "AN-2026-0009", next: 10 });
  });
  it("formats invoice numbers from the company", () => {
    expect(allocateInvoiceNumber({ invoiceNumberPattern: "RE{YY}{MM}-{NNN}", nextInvoiceNumber: 12 }, "2026-11-05")).toEqual({ number: "RE2611-012", next: 13 });
  });
});

describe("status", () => {
  it("shows sent offers past validity as expired", () => {
    expect(offerDisplayStatus({ status: "sent", validUntil: "2026-03-01" }, "2026-03-02")).toBe("expired");
    expect(offerDisplayStatus({ status: "accepted", validUntil: "2026-03-01" }, "2026-03-02")).toBe("accepted");
  });
  it("finds offers that run out within 14 days", () => {
    expect(isOfferExpiringSoon({ status: "sent", validUntil: "2026-03-16" }, "2026-03-02")).toBe(true);
    expect(isOfferExpiringSoon({ status: "sent", validUntil: "2026-03-17" }, "2026-03-02")).toBe(false);
    expect(isOfferExpiringSoon({ status: "draft", validUntil: "2026-03-05" }, "2026-03-02")).toBe(false);
  });
});

describe("texts", () => {
  it("computes the completion range with buffer", () => {
    const short = offerCompletion("2026-03-02", "2026-04-13"); // 6 weeks, Monday
    expect(short.range).toBe("ca. 6–9 Wochen");
    expect(short.deadline).toBe("2026-04-13");
    expect(short.deadlineLabel).toBe("13. April 2026");
    expect(short.deadlineWeekday).toBe("Montag");
    const long = offerCompletion("2026-01-05", "2026-05-11"); // 18 weeks
    expect(long.range).toBe("ca. 18–22 Wochen");
  });
  it("moves a weekend deadline back to Friday", () => {
    expect(offerCompletion("2026-03-02", "2026-03-29").deadline).toBe("2026-03-27"); // Sunday → Friday
  });
  it("falls back without project dates", () => {
    const c = offerCompletion();
    expect(c.range).toBe("ca. 4–6 Wochen");
    expect(c.deadline).toBeNull();
    expect(suggestOfferCompletionText("", { offer: offer() })).toBe("Die Fertigstellung des Werkes erfolgt innerhalb von ca. 4–6 Wochen ab Auftragserteilung.");
  });
  it("fills the completion template", () => {
    expect(suggestOfferCompletionText(undefined, { offer: offer(), projectStart: "2026-03-02", projectEnd: "2026-04-13" })).toBe(
      "Die Fertigstellung des Werkes erfolgt innerhalb von ca. 6–9 Wochen. Spätester Fertigstellungstermin: 13. April 2026 (Montag).",
    );
  });
  it("replaces placeholders and keeps unknown ones", () => {
    expect(fillOfferPlaceholders("Hallo {customerName}, {{projectName}} {unknown}", { customerName: "Anna", projectName: "Halle" })).toBe("Hallo Anna, Halle {unknown}");
    expect(fillOfferPlaceholders("Termin: {d} ({w}).", { d: "offen", w: "" })).toBe("Termin: offen.");
  });
  it("builds the payment text", () => {
    expect(defaultOfferPaymentTerms({ downpaymentPct: 30, finalPaymentPct: 70, paymentDueDays: 14 })).toBe("30 % bei Annahme des Angebotes, 70 % nach Übergabe der vereinbarten Leistungen. Zahlungsziel 14 Tage netto ohne Abzüge.");
    expect(defaultOfferPaymentTerms({ downpaymentPct: 0, finalPaymentPct: 100, paymentDueDays: 30 })).toBe("Zahlungsziel 30 Tage netto ohne Abzüge.");
    const ctx = { offer: offer({ downpaymentPct: 40, finalPaymentPct: 60 }), customerName: "Kunde GmbH", companyName: "Muster e.U." };
    expect(suggestOfferPaymentTerms("{downPaymentPercent} % bei Auftrag, {finalPaymentPercent} % danach, {paymentDueDays} Tage – {customerName}", ctx)).toBe("40 % bei Auftrag, 60 % danach, 14 Tage – Kunde GmbH");
    expect(suggestOfferPaymentTerms("", ctx)).toContain("40 % bei Annahme");
  });
  it("suggests the note with contract title", () => {
    expect(suggestOfferScopeText("", { offer: offer() })).toBe(
      "Bei Annahme dieses Angebotes wird dieses als Anlage B zum Werkvertrag beigefügt.\nDer Leistungsumfang ergibt sich aus den Positionen und Beschreibungen dieses Angebotes.",
    );
    expect(suggestOfferScopeText("", { offer: offer({ contractTitle: "" }) })).toBe("Der Leistungsumfang ergibt sich aus den Positionen und Beschreibungen dieses Angebotes.");
  });
  it("builds a safe file name", () => {
    expect(offerFileName({ date: "2026-03-15", number: "AN-2026-0007" }, "Müller & Söhne GmbH")).toBe("20260315_AN-2026-0007_Mueller_Soehne_GmbH.pdf");
  });
});

describe("duplicateOffer", () => {
  it("makes a fresh draft", () => {
    let n = 0;
    const copy = duplicateOffer(offer({ status: "accepted", invoiceIds: ["inv_1"], sentAt: NOW, decidedAt: NOW, lines: [line({ id: "a" })] }), { id: "ofr_2", number: "AN-2026-0008", today: "2026-05-01", validDays: 30, now: NOW, newLineId: () => `n${++n}` });
    expect(copy.status).toBe("draft");
    expect(copy.invoiceIds).toEqual([]);
    expect(copy.sentAt).toBeUndefined();
    expect(copy.validUntil).toBe("2026-05-31");
    expect(copy.lines[0]!.id).toBe("n1");
  });
});

describe("parseOfferPaste", () => {
  it("parses German decimals", () => {
    expect(parseLocalizedDecimal("1.234,56")).toBe(1234.56);
    expect(parseLocalizedDecimal("1.234")).toBe(1234);
    expect(parseLocalizedDecimal("1,234.5")).toBe(1234.5);
    expect(parseLocalizedDecimal("€ 12,50")).toBe(12.5);
    expect(parseLocalizedDecimal("20 %")).toBe(20);
    expect(parseLocalizedDecimal("abc")).toBeNull();
  });

  it("reads Excel rows without header (text, quantity, price, VAT)", () => {
    const r = parseOfferPaste("Beratung vor Ort\t2,5\t1.200,00\t20\r\nReisekosten\t1\t85\t10\r\n\r\n");
    expect(r.errors).toEqual([]);
    expect(r.hasHeader).toBe(false);
    expect(r.rows).toEqual([
      { line: 1, title: "Beratung vor Ort", description: "", quantity: 2.5, unitNetCents: 120_000, vatRate: 20 },
      { line: 2, title: "Reisekosten", description: "", quantity: 1, unitNetCents: 8_500, vatRate: 10 },
    ]);
    expect(parseOfferPaste("Nur Text\t1\t5").rows[0]).toMatchObject({ vatRate: 20, unitNetCents: 500 });
  });

  it("reads quoted multi-line cells and a header with aliases", () => {
    const text = 'Titel\tBeschreibung\tMenge (Stunden)\tEinheit\tEinzelpreis\tUSt %\tInterne Notiz\n"Analyse"\t"Zeile 1\nZeile 2"\t10\tStd\t95,50\t20\tgeheim\nModell\t\t1\tpauschal\t2.000\t20\t';
    const r = parseOfferPaste(text);
    expect(r.errors).toEqual([]);
    expect(r.hasHeader).toBe(true);
    expect(r.notes[0]).toContain("Interne Notiz");
    expect(r.rows).toEqual([
      { line: 2, title: "Analyse", description: "Zeile 1\nZeile 2", quantity: 10, unit: "Std", unitNetCents: 9_550, vatRate: 20 },
      { line: 4, title: "Modell", description: "", quantity: 1, unit: "pauschal", unitNetCents: 200_000, vatRate: 20 },
    ]);
  });

  it("splits the first line of the text into title and description", () => {
    const r = parseOfferPaste('"Montage\nInklusive Anfahrt";3;45,00;20');
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ title: "Montage", description: "Inklusive Anfahrt", quantity: 3, unitNetCents: 4_500 });
  });

  it("reports errors per row and keeps the good ones", () => {
    const r = parseOfferPaste("A\t1\t10\t20\nB\tx\t10\t20\nC\t1\t-5\t20\nD\t1\t10\t7");
    expect(r.rows.map((x) => x.title)).toEqual(["A"]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(r.errors[0]!.message).toContain("Menge");
    expect(r.errors[2]!.message).toContain("Steuersatz");
  });

  it("knows the 5-column layouts", () => {
    const a = parseOfferPaste("Text\t2\t10\t20\tGilt nur werktags");
    expect(a.rows[0]).toMatchObject({ title: "Text", description: "Gilt nur werktags", quantity: 2 });
    const b = parseOfferPaste("Titel A\tBeschreibung A\t2\t10\t10");
    expect(b.rows[0]).toMatchObject({ title: "Titel A", description: "Beschreibung A", quantity: 2, vatRate: 10 });
  });

  it("limits size and complains about unclosed quotes", () => {
    expect(parseOfferPaste("x".repeat(20_001)).errors[0]!.message).toContain("zu lang");
    expect(parseOfferPaste('"A\t1\t10\t20').errors.some((e) => e.message.includes("Anführungszeichen"))).toBe(true);
    expect(parseOfferPaste("   ").errors[0]!.message).toContain("mindestens eine Position");
    const many = Array.from({ length: 101 }, (_, i) => `P${i}\t1\t1\t20`).join("\n");
    const r = parseOfferPaste(many);
    expect(r.rows).toHaveLength(100);
    expect(r.errors.some((e) => e.message.includes("Höchstens 100"))).toBe(true);
  });

  it("turns rows into offer lines", () => {
    let n = 0;
    const lines = offerLinesFromPaste([{ line: 1, title: "A", description: "", quantity: 2, unitNetCents: 100, vatRate: 20 }], { unit: "Stk" }, () => `x${++n}`);
    expect(lines[0]).toMatchObject({ id: "x1", title: "A", unit: "Stk", quantity: 2, optional: false });
  });
});

describe("invoiceFromOffer", () => {
  const base = offer({
    discountPct: 10,
    discountText: "Treuerabatt",
    lines: [line({ title: "Analyse", description: "Datenaufnahme", quantity: 10, unit: "Std", unitNetCents: 10_000 }), line({ title: "Extra", optional: true, unitNetCents: 99_999 })],
  });

  it("copies the positions with the discount and the customer", () => {
    const { invoice, nextInvoiceNumber } = invoiceFromOffer(base, { profile: profile(), contact: { ...contact, paymentDueDays: 30 }, issueDate: "2026-03-10", now: NOW, newId, usedNumbers: ["RE-2026-0005"] });
    expect(invoice.number).toBe("RE-2026-0006");
    expect(nextInvoiceNumber).toBe(7);
    expect(invoice.dueDate).toBe("2026-04-09");
    expect(invoice.customerSnapshot).toMatchObject({ name: "Kunde GmbH", uid: "ATU12345678", city: "Wien" });
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]).toMatchObject({ description: "Analyse\nDatenaufnahme", quantity: 10, unit: "Std", unitNetCents: 10_000, vatRate: 20, discountPct: 10 });
    expect(invoice.projectId).toBeUndefined();
    expect(invoice.offerId).toBe("ofr_1");
    expect(invoice.discountText).toBe("Treuerabatt");
    expect(invoice.discountPct).toBeUndefined();
    expect(invoice.vatTreatment).toBe("standard");
    expect(invoice.footerText).toBe("Danke");
    expect(invoice.status).toBe("draft");
  });

  it("can put the discount on the invoice instead", () => {
    const { invoice } = invoiceFromOffer(base, { profile: profile(), issueDate: "2026-03-10", now: NOW, newId, discountMode: "invoice" });
    expect(invoice.discountPct).toBe(10);
    expect(invoice.lines[0]!.discountPct).toBe(0);
  });

  it("uses offer payment days, reverse charge and Kleinunternehmer", () => {
    const rc = invoiceFromOffer({ ...base, reverseCharge: true, paymentDueDays: 21 }, { profile: profile(), issueDate: "2026-03-10", now: NOW, newId }).invoice;
    expect(rc.vatTreatment).toBe("reverse_charge");
    expect(rc.lines[0]!.vatRate).toBe(0);
    expect(rc.dueDate).toBe("2026-03-31");
    const ku = invoiceFromOffer(base, { profile: profile({ vatRegime: "kleinunternehmer" }), issueDate: "2026-03-10", now: NOW, newId }).invoice;
    expect(ku.vatTreatment).toBe("kleinunternehmer");
  });

  it("makes a down-payment invoice over the offer net", () => {
    const { invoice } = invoiceFromOffer(base, { profile: profile(), issueDate: "2026-03-10", now: NOW, newId, kind: "downpayment" });
    // net after discount 90.000 × 30 %
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]).toMatchObject({ unitNetCents: 27_000, vatRate: 20, quantity: 1 });
    expect(invoice.lines[0]!.description).toContain("Anzahlung 30 % laut Angebot AN-2026-0007");
  });

  it("splits amounts over mixed VAT rates", () => {
    const mixed = offer({ lines: [line({ unitNetCents: 30_000, vatRate: 20 }), line({ unitNetCents: 10_000, vatRate: 10 })] });
    const { invoice } = invoiceFromOffer(mixed, { profile: profile(), issueDate: "2026-03-10", now: NOW, newId, kind: "amount", amountNetCents: 10_001 });
    expect(invoice.lines.map((l) => [l.vatRate, l.unitNetCents])).toEqual([
      [20, 7_501],
      [10, 2_500],
    ]);
  });

  it("deducts earlier invoices on the final invoice", () => {
    const down = invoice({ id: "inv_d", number: "RE-2026-0002", offerId: "ofr_1", lines: [{ id: "x", description: "Anzahlung", quantity: 1, unit: "pauschal", unitNetCents: 27_000, vatRate: 20, discountPct: 0 }] });
    const other = invoice({ id: "inv_o", offerId: "ofr_other", lines: [{ id: "y", description: "x", quantity: 1, unit: "pauschal", unitNetCents: 5_000, vatRate: 20, discountPct: 0 }] });
    const earlier = invoicesForOffer(base, [down, other, invoice({ id: "inv_c", offerId: "ofr_1", status: "cancelled" })]);
    expect(earlier.map((i) => i.id)).toEqual(["inv_d"]);
    const { invoice: fin } = invoiceFromOffer(base, { profile: profile(), issueDate: "2026-04-10", now: NOW, newId, kind: "final", earlierInvoices: earlier });
    expect(fin.lines).toHaveLength(2);
    expect(fin.lines[1]).toMatchObject({ description: "abzüglich Rechnung RE-2026-0002 vom 10.03.2026", unitNetCents: -27_000, vatRate: 20, discountPct: 0 });
    const net = fin.lines.reduce((s, l) => s + Math.round(l.quantity * l.unitNetCents * (1 - l.discountPct / 100)), 0);
    expect(net).toBe(90_000 - 27_000);
  });
});

describe("project invoices", () => {
  const project: Project = {
    id: "prj_1",
    profileId: "prf_1",
    number: "P-0012",
    name: "Halle 3",
    customerId: "ctc_1",
    description: "",
    status: "active",
    startDate: "2026-03-01",
    endDate: "2026-04-30",
    budgetCents: 100_000,
    budgetHours: 0,
    billing: "fixed",
    hourlyRateCents: 0,
    memberIds: [],
    hoursPerDay: 6,
    color: "#000",
    tags: [],
    notes: "",
    createdAt: NOW,
    updatedAt: NOW,
  };

  it("suggests the down payment first, then the rest", () => {
    const first = projectBillingSuggestion(project, [], { downpaymentPct: 30, today: "2026-03-10" });
    expect(first).toMatchObject({ kind: "downpayment", suggestedCents: 30_000, remainingCents: 100_000, reminder: "start" });
    const inv = invoice({ projectId: "prj_1", lines: [{ id: "a", description: "x", quantity: 1, unit: "pauschal", unitNetCents: 30_000, vatRate: 20, discountPct: 0 }] });
    const cancelled = invoice({ projectId: "prj_1", status: "cancelled", lines: inv.lines });
    const later = projectBillingSuggestion(project, [inv, cancelled], { downpaymentPct: 30, today: "2026-05-02" });
    expect(later).toMatchObject({ kind: "final", suggestedCents: 70_000, billedNetCents: 30_000, invoiceCount: 1, reminder: "end" });
    expect(later.progress).toBeCloseTo(0.3);
  });

  it("counts credit notes negative and applies invoice discounts", () => {
    const credit = invoice({ kind: "credit_note", lines: [{ id: "a", description: "x", quantity: 1, unit: "pauschal", unitNetCents: 1_000, vatRate: 20, discountPct: 0 }] });
    expect(invoiceBudgetNetCents(credit)).toBe(-1_000);
    expect(invoiceBudgetNetCents(invoice({ discountPct: 10, lines: credit.lines }))).toBe(900);
  });

  it("drafts a single-line project invoice with service period", () => {
    const { invoice: inv } = projectInvoiceDraft(project, { profile: profile(), contact, issueDate: "2026-03-10", now: NOW, newId, amountNetCents: 30_000, kind: "downpayment", downpaymentPct: 30 });
    expect(inv.projectId).toBe("prj_1");
    expect(inv.servicePeriodStart).toBe("2026-03-01");
    expect(inv.servicePeriodEnd).toBe("2026-04-30");
    expect(inv.servicePeriod).toBe("01.03.2026 – 30.04.2026");
    expect(inv.reference).toBe("Projekt P-0012");
    expect(inv.lines[0]).toMatchObject({ description: "Anzahlung 30 % – Halle 3", unitNetCents: 30_000, vatRate: 20 });
    expect(inv.dueDate).toBe("2026-03-24");
  });
});
