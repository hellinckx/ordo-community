import { expect, it } from "vitest";
import { parseReceiptText } from "./parse";
it("keeps only the company name of one-line sender rows", () => {
  const a = parseReceiptText("Aon Austria GmbH  Kaspar-Brunner-Straße 4  3300 Amstetten\nRechnung Nr. 123\nDatum 01.10.2026\nGesamt EUR 120,00", {});
  expect(a.fields.vendorName).toBe("Aon Austria GmbH");
  const b = parseReceiptText("SimPlan AG - Sophie-Scholl-Platz 6 - 63452 Hanau - Deutschland\nRechnung 77\nSumme 50,00 EUR", {});
  expect(b.fields.vendorName).toBe("SimPlan AG");
  const c = parseReceiptText("Müller - Bau GmbH\nRechnung 1\nSumme 10,00 EUR", {});
  expect(c.fields.vendorName).toBe("Müller - Bau GmbH");
});
