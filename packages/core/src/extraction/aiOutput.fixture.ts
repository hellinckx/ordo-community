import type { AiOutput } from "./schema";

/** A clean AI answer for tests (120 € gross, 20 % VAT). */
export function aiOutput(patch: Partial<AiOutput> = {}): AiOutput {
  return {
    document_type: "invoice",
    direction: "incoming",
    vendor_name: "Billa AG",
    vendor_uid: "ATU12345678",
    vendor_address: null,
    vendor_iban: null,
    customer_name: null,
    invoice_number: "R-1",
    invoice_date: "2026-10-01",
    due_date: null,
    service_date: null,
    currency: "EUR",
    gross_total: 120,
    net_total: 100,
    vat_total: 20,
    vat_lines: [{ rate: 20, net: 100, vat: 20 }],
    payment_method: "card",
    is_paid: true,
    description: "Büromaterial",
    line_items: [],
    suggested_category: null,
    reverse_charge: false,
    confidence: { overall: 0.96, vendor_name: 0.97, invoice_date: 0.98, gross_total: 0.99, vat_lines: 0.95, invoice_number: 0.9 },
    notes: null,
    ...patch,
  };
}
