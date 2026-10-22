import { describe, expect, it } from "vitest";
import { aiOutput } from "./aiOutput.fixture";
import { assessAiOutput, estimateReadCostCents, extractionModelLabel, preferStrong, usageCostCents } from "./escalation";

describe("assessAiOutput – is the cheap answer sure enough?", () => {
  it("accepts a clean, consistent answer", () => {
    const a = assessAiOutput(aiOutput(), { threshold: 0.9, checkVat: true });
    expect(a.issues).toEqual([]);
    expect(a.confident).toBe(true);
  });

  it("flags missing essentials", () => {
    const a = assessAiOutput(aiOutput({ gross_total: null, invoice_date: null, vendor_name: null, net_total: null, vat_total: null, vat_lines: [] }), { threshold: 0.9 });
    expect(a.issues).toEqual(expect.arrayContaining(["Betrag fehlt", "Datum fehlt", "Lieferant fehlt"]));
    expect(a.confident).toBe(false);
  });

  it("flags an invalid date", () => {
    expect(assessAiOutput(aiOutput({ invoice_date: "2026-02-30" }), { threshold: 0.9 }).issues).toContain("Datum fehlt");
  });

  it("flags confidences below the auto-book threshold", () => {
    const a = assessAiOutput(aiOutput({ confidence: { overall: 0.8, vendor_name: 0.97, invoice_date: 0.98, gross_total: 0.7, vat_lines: 0.95, invoice_number: 0.9 } }), { threshold: 0.9 });
    expect(a.issues).toEqual(["Betrag unsicher (70 %)", "Gesamtsicherheit 80 %"]);
  });

  it("flags totals that don't add up", () => {
    const a = assessAiOutput(aiOutput({ gross_total: 125 }), { threshold: 0.9 });
    expect(a.issues).toContain("Summen passen nicht zusammen");
  });

  it("flags VAT that doesn't match its rate, tolerating rounding", () => {
    expect(assessAiOutput(aiOutput({ vat_lines: [{ rate: 10, net: 100, vat: 20 }] }), { threshold: 0.9 }).issues).toContain("Steuerbetrag passt nicht zum Steuersatz");
    expect(assessAiOutput(aiOutput({ gross_total: 120.03, vat_total: 20.03, vat_lines: [{ rate: 20, net: 100, vat: 20.03 }] }), { threshold: 0.9 }).issues).toEqual([]);
  });

  it("checks VAT certainty only when VAT matters and not for reverse charge", () => {
    const shaky = aiOutput({ confidence: { overall: 0.95, vendor_name: 0.97, invoice_date: 0.98, gross_total: 0.99, vat_lines: 0.5, invoice_number: 0.9 } });
    expect(assessAiOutput(shaky, { threshold: 0.9, checkVat: true }).issues).toEqual(["Umsatzsteuer unsicher (50 %)"]);
    expect(assessAiOutput(shaky, { threshold: 0.9, checkVat: false }).issues).toEqual([]);
    expect(assessAiOutput({ ...shaky, reverse_charge: true }, { threshold: 0.9, checkVat: true }).issues).toEqual([]);
  });

  it("uses the customer for outgoing invoices", () => {
    expect(assessAiOutput(aiOutput({ direction: "outgoing", vendor_name: null, customer_name: "Hotel Alpenblick" }), { threshold: 0.9 }).issues).toEqual([]);
    expect(assessAiOutput(aiOutput({ direction: "outgoing", vendor_name: null, customer_name: null }), { threshold: 0.9 }).issues).toContain("Kunde fehlt");
  });

  it("never uses wording that blocks auto-booking", () => {
    const a = assessAiOutput(aiOutput({ gross_total: 999, vat_lines: [{ rate: 10, net: 100, vat: 20 }] }), { threshold: 0.9 });
    for (const i of a.issues) expect(i).not.toMatch(/stimmen nicht überein|ergeben nicht den Gesamtbetrag|weichen ab/);
  });
});

describe("preferStrong", () => {
  const ok = { issues: [], confident: true, meanConfidence: 0.95 };
  const bad = { issues: ["Betrag fehlt"], confident: false, meanConfidence: 0.6 };
  it("keeps the answer with fewer problems", () => {
    expect(preferStrong(bad, ok)).toBe(true);
    expect(preferStrong(ok, bad)).toBe(false);
  });
  it("prefers the stronger model on a tie", () => {
    expect(preferStrong(bad, { ...bad, meanConfidence: 0.6 })).toBe(true);
    expect(preferStrong({ ...bad, meanConfidence: 0.9 }, { ...bad, meanConfidence: 0.5 })).toBe(false);
  });
});

describe("model labels and prices", () => {
  it("names the models", () => {
    expect(extractionModelLabel("claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(extractionModelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(extractionModelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(extractionModelLabel("gpt-5.4-mini")).toBe("gpt-5.4-mini");
  });

  it("prices a call", () => {
    expect(usageCostCents("claude-haiku-5-5", { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(10);
    expect(usageCostCents("claude-opus-5-5", { inputTokens: 5000, outputTokens: 2000 })).toBeCloseTo(6);
    expect(usageCostCents("unknown", { inputTokens: 5000 })).toBeUndefined();
  });

  it("estimates re-reading: Haiku alone is a fraction of a cent, auto adds the Opus share", () => {
    const haiku = estimateReadCostCents(1, "claude-haiku-5-5");
    expect(haiku.low).toBeGreaterThan(0.05);
    expect(haiku.high).toBeLessThan(0.3);
    const auto = estimateReadCostCents(54, "auto");
    expect(auto.low).toBeGreaterThan(haiku.low * 54);
    expect(auto.perInvoice.high).toBeLessThan(5);
    expect(auto.high).toBeCloseTo(auto.perInvoice.high * 54);
  });
});
