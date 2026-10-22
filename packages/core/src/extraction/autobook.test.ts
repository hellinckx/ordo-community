import { describe, expect, it } from "vitest";
import { AiSettingsSchema, ExtractionSchema, ProfileSchema, TransactionSchema, type Extraction, type Transaction } from "../model/types";
import { DEFAULT_CATEGORIES, FALLBACK_CATEGORY, SPECIAL_CATEGORIES } from "../model/defaults";
import { decideAutoBook, type AutoBookInput } from "./autobook";
import { documentDirection } from "./direction";
import { fieldStates } from "./fieldStates";

const now = "2026-10-21T10:00:00.000Z";
const profile = ProfileSchema.parse({ id: "p1", name: "Muster Design e.U.", mode: "business", createdAt: now, updatedAt: now });
const ai = AiSettingsSchema.parse({});

function extraction(over: Partial<Extraction> = {}, fields: Partial<Extraction["fields"]> = {}): Extraction {
  return ExtractionSchema.parse({
    provider: "openai",
    extractedAt: now,
    fields: { documentType: "invoice", direction: "incoming", vendorName: "IONOS SE", invoiceNumber: "100194208763", invoiceDate: "2026-10-01", grossCents: 101, vatLines: [{ rate: 20, netCents: 84, vatCents: 17 }], ...fields },
    confidence: { grossCents: 0.95, invoiceDate: 0.95, vendorName: 0.9, vatLines: 0.9, invoiceNumber: 0.9, category: 0.8, contact: 0.9 },
    overall: 0.94,
    warnings: [],
    ...over,
  });
}

function tx(over: Partial<Transaction> = {}): Transaction {
  return TransactionSchema.parse({ id: "t1", profileId: "p1", kind: "expense", date: "2026-10-01", grossCents: 101, categoryId: "cat_b_ex_software", invoiceNumber: "100194208763", createdAt: now, updatedAt: now, origin: "extraction", reviewed: false, ...over });
}

function input(over: Partial<AutoBookInput> = {}): AutoBookInput {
  return { extraction: extraction(), sources: ["rules", "ai"], qrKinds: [], suggestion: { categoryId: "cat_b_ex_software", categoryScore: 0.8, contactId: undefined, contactScore: 0, reasons: [] }, tx: tx(), ai, profile, categories: DEFAULT_CATEGORIES, existingTxs: [], ...over };
}

describe("decideAutoBook", () => {
  it("books a confident AI result", () => {
    const d = decideAutoBook(input());
    expect(d).toEqual({ ok: true, reasons: [] });
  });

  it("never books on rules alone", () => {
    const d = decideAutoBook(input({ sources: ["rules"] }));
    expect(d.ok).toBe(false);
    expect(d.reasons[0]).toMatch(/nur lokale Regeln/);
  });

  it("accepts a known contact in place of a confidently read vendor name", () => {
    const ex = extraction({ confidence: { grossCents: 0.95, invoiceDate: 0.95, vendorName: 0.75, vatLines: 0.9, category: 0.9 } });
    expect(decideAutoBook(input({ extraction: ex })).ok).toBe(false);
    expect(decideAutoBook(input({ extraction: ex, suggestion: { categoryId: "cat_b_ex_software", categoryScore: 0.9, contactId: "c1", contactScore: 0.85, reasons: [] } })).ok).toBe(true);
  });

  it("accepts an RKSV QR but not a bare EPC payment code", () => {
    expect(decideAutoBook(input({ sources: ["qr", "rules"], qrKinds: ["rksv"], extraction: extraction({}, { documentType: "receipt" }) })).ok).toBe(true);
    expect(decideAutoBook(input({ sources: ["qr", "rules"], qrKinds: ["epc"] })).ok).toBe(false);
  });

  it("stays in review when switched off, below threshold or with a failed AI call", () => {
    expect(decideAutoBook(input({ ai: { ...ai, autoBook: "off" } })).ok).toBe(false);
    expect(decideAutoBook(input({ extraction: extraction({ overall: 0.86 }) })).reasons).toContain("Gesamtsicherheit 86 % unter 90 %");
    expect(decideAutoBook(input({ aiError: "timeout" })).ok).toBe(false);
  });

  it("requires a real category, not the fallback or a special one", () => {
    const fallback = FALLBACK_CATEGORY.business.expense;
    expect(decideAutoBook(input({ tx: tx({ categoryId: fallback }), suggestion: { categoryId: fallback, categoryScore: 0.2, contactId: undefined, contactScore: 0, reasons: [] } })).ok).toBe(false);
    const d = decideAutoBook(input({ tx: tx({ categoryId: SPECIAL_CATEGORIES.assetPurchase }), suggestion: { categoryId: SPECIAL_CATEGORIES.assetPurchase, categoryScore: 0.9, contactId: undefined, contactScore: 0, reasons: [] } }));
    expect(d.reasons[0]).toMatch(/Sonderkategorie/);
  });

  it("blocks on VAT mismatch warnings and duplicate invoice numbers", () => {
    expect(decideAutoBook(input({ extraction: extraction({ warnings: ["Steuerzeilen ergeben nicht den Gesamtbetrag – bitte prüfen."] }) })).ok).toBe(false);
    expect(decideAutoBook(input({ existingTxs: [tx({ id: "t0" })] })).reasons[0]).toMatch(/existiert bereits/);
  });

  it("does not require VAT certainty for Kleinunternehmer", () => {
    const ex = extraction({ confidence: { grossCents: 0.95, invoiceDate: 0.95, vendorName: 0.9, vatLines: 0.3, category: 0.8 } });
    expect(decideAutoBook(input({ extraction: ex })).ok).toBe(false);
    expect(decideAutoBook(input({ extraction: ex, profile: { ...profile, vatRegime: "kleinunternehmer" } })).ok).toBe(true);
  });
});

describe("documentDirection", () => {
  it("prefers the forced direction, then the booked kind, then the extraction", () => {
    expect(documentDirection({ direction: "outgoing" })).toBe("outgoing");
    expect(documentDirection({ extraction: extraction({}, { direction: "outgoing" }) }, { kind: "expense" })).toBe("incoming");
    expect(documentDirection({ extraction: extraction({}, { direction: "outgoing" }) })).toBe("outgoing");
    expect(documentDirection({})).toBe("incoming");
  });
});

describe("fieldStates", () => {
  it("flags missing and shaky fields", () => {
    const ex = extraction({ confidence: { grossCents: 0.95, invoiceDate: 0.5, vendorName: 0.9, vatLines: 0.9, category: 0.2 } }, { invoiceNumber: null });
    const states = Object.fromEntries(fieldStates(ex, { mode: "business" }).map((s) => [s.key, s.state]));
    expect(states).toEqual({ date: "unsure", gross: "ok", partner: "ok", category: "unsure", vat: "ok", invoiceNumber: "missing" });
  });

  it("skips VAT for employees and the invoice number for receipts", () => {
    const keys = fieldStates(extraction({}, { documentType: "receipt" }), { mode: "employee" }).map((s) => s.key);
    expect(keys).toEqual(["date", "gross", "partner", "category"]);
  });
});
