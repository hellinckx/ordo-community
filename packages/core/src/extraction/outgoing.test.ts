import { describe, expect, it } from "vitest";
import { extractDocument, transactionFromExtraction } from "./pipeline";
import { TextExtractor } from "./text";
import { DEFAULT_CATEGORIES } from "../model/defaults";
import { ProfileSchema, SettingsSchema } from "../model/types";

const OWN_INVOICE = `Muster Design e.U.
Musterweg 7
1060 Wien
UID: ATU12345678

Alpenblick Hotel GmbH
Seestraße 1
5700 Zell am See

Rechnung Nr. RE-2026-017
Rechnungsdatum: 14.10.2026
Leistung: Webdesign Relaunch
Nettobetrag 2.500,00
20 % USt 500,00
Rechnungsbetrag 3.000,00
Zahlbar innerhalb von 14 Tagen.
IBAN: AT61 1904 3002 3457 3201`;

describe("outgoing invoices from an external program", () => {
  it("books them as open income with the customer as contact", async () => {
    const now = "2026-10-21T00:00:00.000Z";
    const profile = ProfileSchema.parse({ id: "p1", name: "Muster Design e.U.", mode: "business", createdAt: now, updatedAt: now, company: { name: "Muster Design e.U.", uid: "ATU12345678", invoiceMode: "external" } });
    const settings = SettingsSchema.parse({});
    const contacts = [{ id: "c1", profileId: "p1", name: "Alpenblick Hotel GmbH", kind: "customer" as const, uid: "", email: "", phone: "", street: "", zip: "", city: "", country: "AT", iban: "", notes: "", aliases: [], createdAt: now, updatedAt: now }];
    const out = await extractDocument(new TextEncoder().encode(OWN_INVOICE), "RE-2026-017.txt", "text/plain", { profile, settings, categories: DEFAULT_CATEGORIES, contacts, textExtractor: new TextExtractor(), forceDirection: "outgoing" });
    expect(out.extraction.fields.direction).toBe("outgoing");
    expect(out.extraction.fields.customerName).toBe("Alpenblick Hotel GmbH");
    expect(out.extraction.fields.grossCents).toBe(300000);
    expect(out.suggestion.contactId).toBe("c1");
    const tx = transactionFromExtraction(profile, out.extraction, out.suggestion, DEFAULT_CATEGORIES, "d1");
    expect(tx.kind).toBe("income");
    expect(tx.categoryId).toBe("cat_b_in_20");
    expect(tx.paidDate).toBeUndefined();
    expect(tx.dueDate).toBe("2026-10-28");
    expect(tx.description).toBe("Rechnung RE-2026-017 – Alpenblick Hotel GmbH");
    expect(tx.vatLines).toEqual([{ rate: 20, netCents: 250000, vatCents: 50000 }]);
  });
});

describe("recipient detection on two-column PDFs", () => {
  it("cuts the invoice meta column off the address line", async () => {
    const { parseReceiptText } = await import("./parse");
    const text = `Mustermann IT Services GmbH
Technikerstraße 5, 4020 Linz
UID-Nr.: ATU98765432
Max Kunde Rechnung Nr. 2026-0042
Kundengasse 1 Rechnungsdatum: 03.02.2026
1010 Wien Leistungszeitraum: Jaenner 2026
Rechnungsbetrag 1.200,00`;
    const r = parseReceiptText(text, { outgoing: true });
    expect(r.fields.vendorName).toBe("Mustermann IT Services GmbH");
    expect(r.fields.customerName).toBe("Max Kunde");
  });
});
