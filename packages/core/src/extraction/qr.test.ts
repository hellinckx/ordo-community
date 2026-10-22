import { describe, expect, it } from "vitest";
import { parseRksv, parseEpc, parseQrPayload, fieldsFromQr } from "./qr";
import { parseCii, parseUbl, findEInvoiceAttachment } from "./einvoice";

describe("RKSV QR", () => {
  it("parses a Kassenbon signature QR", () => {
    const raw = "_R1-AT1_DEMO-CASH-BOX524_366585_2026-03-12T17:42:11_7,99_9,52_0,00_0,00_0,00_ZmVpZ2VuZA==_a1b2c3d4_bWFnaWM=_c2lnbmF0dXJl";
    const r = parseRksv(raw)!;
    expect(r).toMatchObject({ kassenId: "DEMO-CASH-BOX524", belegNummer: "366585", date: "2026-03-12", time: "17:42:11", normal20: 799, ermaessigt10: 952, grossCents: 1751 });
    expect(r.vatLines).toEqual([
      { rate: 20, netCents: 666, vatCents: 133 },
      { rate: 10, netCents: 865, vatCents: 87 },
    ]);
    const f = fieldsFromQr([r]);
    expect(f.fields.grossCents).toBe(1751);
    expect(f.confidence.grossCents).toBeGreaterThan(0.95);
    expect(f.fields.isPaid).toBe(true);
  });
  it("parses EPC payment QR", () => {
    const raw = "BCD\n002\n1\nSCT\nBKAUATWW\nMustermann IT Services GmbH\nAT611904300234573201\nEUR1200.00\n\n2026-0042\nRechnung 2026-0042";
    const e = parseEpc(raw)!;
    expect(e).toMatchObject({ name: "Mustermann IT Services GmbH", iban: "AT611904300234573201", amountCents: 120000, reference: "2026-0042" });
    expect(parseQrPayload("https://example.com").kind).toBe("unknown");
  });
});

const CII = `<?xml version="1.0"?><rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocument><ram:ID>RE-2026-0042</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20260203</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
<ram:IncludedSupplyChainTradeLineItem><ram:SpecifiedTradeProduct><ram:Name>Softwareentwicklung</ram:Name></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>100.00</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="HUR">10</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:RateApplicablePercent>20</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>1000.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>
<ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty><ram:Name>Mustermann IT Services GmbH</ram:Name><ram:PostalTradeAddress><ram:PostcodeCode>4020</ram:PostcodeCode><ram:LineOne>Technikerstraße 5</ram:LineOne><ram:CityName>Linz</ram:CityName></ram:PostalTradeAddress><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">ATU98765432</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty><ram:BuyerTradeParty><ram:Name>Max Kunde</ram:Name></ram:BuyerTradeParty></ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode><ram:SpecifiedTradeSettlementPaymentMeans><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>AT611904300234573201</ram:IBANID></ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans><ram:ApplicableTradeTax><ram:CalculatedAmount>200.00</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>1000.00</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>20</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">20260217</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms><ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>1000.00</ram:LineTotalAmount><ram:TaxBasisTotalAmount>1000.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">200.00</ram:TaxTotalAmount><ram:GrandTotalAmount>1200.00</ram:GrandTotalAmount><ram:DuePayableAmount>1200.00</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation></ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>`;

const UBL = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:ID>INV-77</cbc:ID><cbc:IssueDate>2026-05-04</cbc:IssueDate><cbc:DueDate>2026-05-18</cbc:DueDate><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
<cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Alpen Hosting GmbH</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:StreetName>Bergweg 3</cbc:StreetName><cbc:CityName>Innsbruck</cbc:CityName><cbc:PostalZone>6020</cbc:PostalZone></cac:PostalAddress><cac:PartyTaxScheme><cbc:CompanyID>ATU11122233</cbc:CompanyID></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Alpen Hosting GmbH</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Muster Design e.U.</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
<cac:PaymentMeans><cac:PayeeFinancialAccount><cbc:ID>AT02 1100 0000 1234 5678</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">19.80</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount>99.00</cbc:TaxableAmount><cbc:TaxAmount>19.80</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount>99.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount>118.80</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity>12</cbc:InvoicedQuantity><cbc:LineExtensionAmount>99.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Webhosting Business</cbc:Name><cac:ClassifiedTaxCategory><cbc:Percent>20</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount>8.25</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
</Invoice>`;

describe("e-invoice XML", () => {
  it("parses ZUGFeRD/Factur-X CII", () => {
    const r = parseCii(CII)!;
    expect(r.format).toBe("cii");
    expect(r.fields).toMatchObject({ vendorName: "Mustermann IT Services GmbH", vendorUid: "ATU98765432", invoiceNumber: "RE-2026-0042", invoiceDate: "2026-02-03", dueDate: "2026-02-17", grossCents: 120000, netCents: 100000, vatCents: 20000, vendorIban: "AT611904300234573201" });
    expect(r.fields.vatLines).toEqual([{ rate: 20, netCents: 100000, vatCents: 20000 }]);
    expect(r.fields.lineItems[0]).toMatchObject({ description: "Softwareentwicklung", quantity: 10, totalCents: 100000 });
  });
  it("parses UBL", () => {
    const r = parseUbl(UBL)!;
    expect(r.format).toBe("ubl");
    expect(r.fields).toMatchObject({ vendorName: "Alpen Hosting GmbH", vendorUid: "ATU11122233", invoiceNumber: "INV-77", invoiceDate: "2026-05-04", dueDate: "2026-05-18", grossCents: 11880, vendorIban: "AT021100000012345678" });
  });
  it("finds the embedded XML among PDF attachments", () => {
    const enc = new TextEncoder();
    expect(findEInvoiceAttachment({ a: { filename: "logo.png", content: enc.encode("x") }, b: { filename: "factur-x.xml", content: enc.encode(CII) } })).toContain("CrossIndustryInvoice");
    expect(findEInvoiceAttachment({ a: { filename: "notes.xml", content: enc.encode("<notes/>") } })).toBeNull();
  });
});
