import { describe, expect, it } from "vitest";
import { allocateCents, formatForFinanzOnline, parseAmount, toCents } from "./money";
import { lineFromGross, lineFromNet, netFromGross, normalizeVatLines, vatFromNet } from "./vat";

describe("parseAmount", () => {
  it("parses German formats", () => {
    expect(parseAmount("1.234,56")).toBe(123456);
    expect(parseAmount("1234,56")).toBe(123456);
    expect(parseAmount("12,5")).toBe(1250);
    expect(parseAmount("€ 12,50")).toBe(1250);
    expect(parseAmount("12,50 EUR")).toBe(1250);
    expect(parseAmount("-12,50")).toBe(-1250);
    expect(parseAmount("12,50-")).toBe(-1250);
    expect(parseAmount("12.-")).toBe(1200);
  });
  it("parses English formats", () => {
    expect(parseAmount("1,234.56")).toBe(123456);
    expect(parseAmount("1234.56")).toBe(123456);
    expect(parseAmount("1.234")).toBe(123400); // thousands separator
    expect(parseAmount("0.99")).toBe(99);
  });
  it("rejects garbage", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(toCents("x")).toBe(0);
  });
  it("formats for FinanzOnline", () => {
    expect(formatForFinanzOnline(123456)).toBe("1234,56");
    expect(formatForFinanzOnline(-5)).toBe("-0,05");
  });
  it("allocates without losing cents", () => {
    const parts = allocateCents(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });
});

describe("vat", () => {
  it("splits gross into net and vat", () => {
    expect(netFromGross(12000, 20)).toBe(10000);
    expect(lineFromGross(12000, 20)).toEqual({ rate: 20, netCents: 10000, vatCents: 2000 });
    expect(lineFromGross(1100, 10)).toEqual({ rate: 10, netCents: 1000, vatCents: 100 });
    expect(lineFromGross(113, 13)).toEqual({ rate: 13, netCents: 100, vatCents: 13 });
  });
  it("computes vat from net with rounding", () => {
    expect(vatFromNet(333, 20)).toBe(67);
    expect(lineFromNet(10000, 20).vatCents).toBe(2000);
  });
  it("normalizes lines", () => {
    const lines = normalizeVatLines([
      { rate: 20, netCents: 100, vatCents: 20 },
      { rate: 10, netCents: 50, vatCents: 5 },
      { rate: 20, netCents: 100, vatCents: 20 },
    ]);
    expect(lines).toEqual([
      { rate: 20, netCents: 200, vatCents: 40 },
      { rate: 10, netCents: 50, vatCents: 5 },
    ]);
  });
});
