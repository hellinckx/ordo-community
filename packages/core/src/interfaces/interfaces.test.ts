import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../model/defaults";
import { InvoiceSchema, ProfileSchema, type Profile, type Transaction } from "../model/types";
import { lineFromGross } from "../model/vat";
import { deriveJournal } from "../accounting/posting";
import { parseEbInterface, parseEInvoiceXml } from "../extraction/einvoice";
import { buildEbInterface, unitCode } from "./ebinterface";
import { bmdBuchungen } from "./bmd";
import { encodeWindows1252 } from "./encoding";
import { apiTransaction, describeFields, pickPath, apiCents } from "./api";
import { redactIntegration, IntegrationSchema } from "./integrations";

const now = "2026-01-01T00:00:00.000Z";
const profile: Profile = ProfileSchema.parse({
  id: "p1",
  name: "Muster Design e.U.",
  mode: "business",
  accountingMethod: "doppik",
  createdAt: now,
  updatedAt: now,
  company: { name: "Muster Design e.U.", street: "Hauptplatz 1", zip: "1060", city: "Wien", uid: "ATU12345678", iban: "AT61 1904 3002 3457 3201", bic: "BKAUATWW", email: "office@muster.at" },
});

function tx(over: Partial<Transaction> & { grossCents: number; kind: Transaction["kind"]; date: string }): Transaction {
  return {
    id: over.id ?? "t1",
    profileId: "p1",
    description: "Test",
    currency: "EUR",
    vatTreatment: "standard",
    vatDeductiblePct: 100,
    paymentMethod: "bank",
    invoiceNumber: "",
    reference: "",
    documentIds: [],
    tags: [],
    notes: "",
    origin: "manual",
    reviewed: true,
    createdAt: now,
    updatedAt: now,
    vatLines: [lineFromGross(over.grossCents, 20)],
    ...over,
  };
}

const invoice = InvoiceSchema.parse({
  id: "inv1",
  profileId: "p1",
  number: "RE-2026-0007",
  issueDate: "2026-03-10",
  dueDate: "2026-03-24",
  createdAt: now,
  updatedAt: now,
  reference: "4500012345",
  customerSnapshot: { name: "Beispiel GmbH & Co KG", street: "Ring 2", zip: "1010", city: "Wien", uid: "ATU87654321" },
  lines: [
    { id: "l1", description: "Beratung", quantity: 3, unit: "h", unitNetCents: 9000, vatRate: 20 },
    { id: "l2", description: "Fachbuch <Steuern>", quantity: 1, unit: "Stk", unitNetCents: 3000, vatRate: 10 },
  ],
  discountPct: 10,
});

describe("ebInterface", () => {
  it("writes an invoice that reads back with the same numbers", () => {
    const { xml, warnings } = buildEbInterface(invoice, profile);
    expect(warnings).toEqual([]);
    expect(xml).toContain('xmlns="http://www.ebinterface.at/schema/6p1/"');
    expect(xml).toContain("Fachbuch &lt;Steuern&gt;");
    expect(xml).toContain('<Quantity Unit="HUR">3</Quantity>');
    expect(xml).toContain("<OrderID>4500012345</OrderID>");
    const r = parseEInvoiceXml(xml);
    expect(r?.format).toBe("ebinterface");
    expect(r?.fields.invoiceNumber).toBe("RE-2026-0007");
    expect(r?.fields.vendorUid).toBe("ATU12345678");
    expect(r?.fields.vendorIban).toBe("AT611904300234573201");
    expect(r?.fields.customerName).toBe("Beispiel GmbH & Co KG");
    // 270 + 30 net, minus 10 % → 243 (20 %) and 27 (10 %)
    expect(r?.fields.vatLines).toEqual([
      { rate: 20, netCents: 24300, vatCents: 4860 },
      { rate: 10, netCents: 2700, vatCents: 270 },
    ]);
    expect(r?.fields.grossCents).toBe(24300 + 4860 + 2700 + 270);
    // the discounted line amounts add up to each rate's taxable amount
    const lineSum = (r?.fields.lineItems ?? []).reduce((s, l) => s + (l.totalCents ?? 0), 0);
    expect(lineSum).toBe(24300 + 2700);
  });

  it("marks reverse charge and uses the placeholder UID", () => {
    const rc = { ...invoice, vatTreatment: "reverse_charge" as const, customerSnapshot: { ...invoice.customerSnapshot, uid: "", country: "DE" } };
    const { xml } = buildEbInterface(rc, profile);
    expect(xml).toContain('TaxCategoryCode="AE"');
    expect(xml).toContain("<InvoiceRecipient><VATIdentificationNumber>00000000</VATIdentificationNumber>");
    expect(parseEbInterface(xml)?.fields.reverseCharge).toBe(true);
  });

  it("is not mistaken for UBL", () => {
    const ubl = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>X</ID></Invoice>';
    expect(parseEbInterface(ubl)).toBeNull();
    expect(parseEInvoiceXml(ubl)?.format).toBe("ubl");
  });

  it("maps units to UN/ECE codes", () => {
    expect(unitCode("Stk")).toBe("C62");
    expect(unitCode("Std.")).toBe("HUR");
    expect(unitCode("Palette")).toBe("Palette");
  });
});

describe("BMD export", () => {
  const cats = DEFAULT_CATEGORIES;
  const text = (bytes: Uint8Array) => new TextDecoder("windows-1252").decode(bytes);

  it("books income and expenses against the bank with tax and sign rules", () => {
    const entries = deriveJournal(profile, [
      tx({ id: "a", kind: "income", date: "2026-02-03", grossCents: 12000, description: "Logo für Bäckerei" }),
      tx({ id: "b", kind: "expense", date: "2026-02-05", grossCents: 6000, description: "Druckerpapier" }),
    ], [], cats, []);
    const r = bmdBuchungen(entries, { references: new Map([["a", "RE-2026-0001"]]) });
    const lines = text(r.bytes).trim().split("\r\n");
    expect(lines[0]).toBe("satzart;konto;buchdat;gkto;belegnr;belegdat;mwst;steucod;bucod;betrag;steuer;periode;text;symbol;extbelegnr");
    expect(r.rows).toBe(2);
    const income = lines[1]!.split(";");
    expect(income.slice(0, 2)).toEqual(["0", "2800"]);
    expect(income[6]).toBe("20");
    expect(income[7]).toBe("03");
    expect(income[8]).toBe("1");
    expect(income[9]).toBe("120,00");
    expect(income[10]).toBe("-20,00");
    expect(income[12]).toBe("Logo für Bäckerei");
    expect(income[13]).toBe("BK");
    expect(income[14]).toBe("RE-2026-0001");
    const expense = lines[2]!.split(";");
    expect(expense[7]).toBe("00");
    expect(expense[8]).toBe("2");
    expect(expense[9]).toBe("-60,00");
    expect(expense[10]).toBe("10,00");
    expect(r.warnings).toEqual([]);
  });

  it("uses Ist-USt codes when asked and nets reverse charge out of the payable amount", () => {
    const entries = deriveJournal(profile, [
      tx({ id: "a", kind: "income", date: "2026-02-03", grossCents: 12000 }),
      tx({ id: "c", kind: "expense", date: "2026-02-07", grossCents: 10000, vatTreatment: "reverse_charge", vatLines: [{ rate: 20, netCents: 10000, vatCents: 0 }] }),
    ], [], cats, []);
    const r = bmdBuchungen(entries, { istBesteuerung: true, encoding: "utf-8" });
    const lines = new TextDecoder().decode(r.bytes).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[1]!.split(";")[7]).toBe("01");
    const rc = lines[2]!.split(";");
    expect(rc[7]).toBe("19");
    expect(rc[9]).toBe("-100,00");
    expect(rc[10]).toBe("20,00");
    expect(r.warnings.some((w) => w.includes("Reverse-Charge"))).toBe(true);
  });
});

describe("helpers", () => {
  it("encodes Windows-1252", () => {
    expect([...encodeWindows1252("€äß–☃")]).toEqual([0x80, 0xe4, 0xdf, 0x96, 0x3f]);
  });

  it("reads euro amounts written either way", () => {
    expect(apiCents(12.5)).toBe(1250);
    expect(apiCents("1.234,56")).toBe(123456);
    expect(apiCents("1234.56")).toBe(123456);
    expect(apiCents("1,234.56")).toBe(123456);
    expect(() => apiCents("zwölf")).toThrow();
  });

  it("maps transactions to euros", () => {
    const t = apiTransaction(tx({ kind: "income", date: "2026-02-03", grossCents: 12000, dueDate: "2026-02-17" }));
    expect(t.amount).toBe(120);
    expect(t.vat).toEqual([{ rate: 20, net: 100, vat: 20 }]);
    expect(t.open).toBe(true);
  });

  it("picks paths and describes sample records", () => {
    const sample = { value: [{ CardCode: "C1", Address: { City: "Wien" } }] };
    expect(pickPath(sample, "value.0.Address.City")).toBe("Wien");
    expect(describeFields(sample).map((f) => f.path)).toEqual(["value", "value.0.CardCode", "value.0.Address.City"]);
  });

  it("never hands out secrets", () => {
    const i = IntegrationSchema.parse({ id: "x", kind: "sap_b1", name: "SAP", profileId: "p1", secret: "geheim", createdAt: now, updatedAt: now, log: [{ at: now, ok: true, message: "ok" }] });
    const r = redactIntegration(i);
    expect(JSON.stringify(r)).not.toContain("geheim");
    expect(r.hasSecret).toBe(true);
  });
});
