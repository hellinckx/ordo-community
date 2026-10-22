import { describe, expect, it } from "vitest";
import { ProductSchema, StockMoveSchema, type Product, type StockMove } from "./schemas";
import { inventoryAdjustments, inventoryDifferences, isBelowMinimum, newStockMove, reorderSuggestions, stockLevels, stockValue } from "./stock";

const now = "2026-10-01T00:00:00.000Z";
const prod = (id: string, patch: Partial<Product> = {}): Product => ProductSchema.parse({ id, profileId: "p", name: id, createdAt: now, updatedAt: now, ...patch });
const move = (productId: string, quantity: number, patch: Partial<StockMove> = {}): StockMove =>
  StockMoveSchema.parse({ id: `m${Math.random()}`, profileId: "p", productId, quantity, kind: quantity >= 0 ? "receipt" : "issue", date: "2026-10-01", createdAt: now, updatedAt: now, ...patch });

describe("stockLevels", () => {
  it("sums signed moves per product and lists products without moves as 0", () => {
    const products = [prod("a"), prod("b")];
    const levels = stockLevels(products, [move("a", 10), move("a", -3), move("a", 0.1), move("a", 0.2)]);
    expect(levels.get("a")).toBe(7.3);
    expect(levels.get("b")).toBe(0);
  });
  it("ignores deleted moves and respects an end date", () => {
    const levels = stockLevels([prod("a")], [move("a", 5), move("a", 5, { deletedAt: now }), move("a", 2, { date: "2026-12-01" })], { until: "2026-11-01" });
    expect(levels.get("a")).toBe(5);
  });
});

describe("stockValue", () => {
  it("values positive stock at cost and skips services and untracked items", () => {
    const products = [prod("a", { costCents: 150 }), prod("b", { costCents: 1000, kind: "service" }), prod("c", { costCents: 200, trackStock: false }), prod("d", { costCents: 100 })];
    const levels = new Map([["a", 3], ["b", 5], ["c", 5], ["d", -2]]);
    const v = stockValue(products, levels);
    expect(v.totalCents).toBe(450);
    expect(v.byProduct.get("a")).toBe(450);
    expect(v.byProduct.has("d")).toBe(false);
  });
});

describe("reorderSuggestions", () => {
  it("fills items below minimum up to twice the minimum", () => {
    const products = [prod("a", { minStock: 10, costCents: 200 }), prod("b", { minStock: 10 }), prod("c", { minStock: 4, kind: "service" }), prod("d", { minStock: 5, active: false })];
    const levels = new Map([["a", 3], ["b", 10], ["c", 0], ["d", 0]]);
    const s = reorderSuggestions(products, levels);
    expect(s.map((x) => x.productId)).toEqual(["a"]);
    expect(s[0]!.suggested).toBe(17);
    expect(s[0]!.costCents).toBe(3400);
  });
  it("counts incoming quantities and rounds up", () => {
    const products = [prod("a", { minStock: 2.5 }), prod("b", { minStock: 10 })];
    const levels = new Map([["a", 1], ["b", 2]]);
    const s = reorderSuggestions(products, levels, { incoming: new Map([["b", 20]]) });
    expect(s.map((x) => x.productId)).toEqual(["a"]);
    expect(s[0]!.suggested).toBe(4);
  });
  it("sorts the most urgent first", () => {
    const products = [prod("a", { name: "A", minStock: 10 }), prod("b", { name: "B", minStock: 10 })];
    const s = reorderSuggestions(products, new Map([["a", 8], ["b", 1]]));
    expect(s.map((x) => x.productId)).toEqual(["b", "a"]);
  });
  it("isBelowMinimum", () => {
    expect(isBelowMinimum(prod("a", { minStock: 5 }), 4)).toBe(true);
    expect(isBelowMinimum(prod("a", { minStock: 5 }), 5)).toBe(false);
    expect(isBelowMinimum(prod("a", { minStock: 0 }), -1)).toBe(false);
  });
});

describe("inventory count", () => {
  it("creates count moves for differences only", () => {
    const products = [prod("a", { costCents: 100 }), prod("b"), prod("c", { kind: "service" })];
    const levels = new Map([["a", 10], ["b", 4], ["c", 0]]);
    const counts = new Map([["a", 8], ["b", 4], ["c", 3]]);
    const diffs = inventoryDifferences(products, levels, counts);
    expect(diffs.find((d) => d.productId === "a")).toMatchObject({ expected: 10, counted: 8, difference: -2, valueCents: -200 });
    const moves = inventoryAdjustments(products, levels, counts, { date: "2026-10-21" });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ productId: "a", quantity: -2, kind: "count", date: "2026-10-21", unitCostCents: 100 });
    const full = newStockMove("p", moves[0]!, now);
    expect(full.id).toMatch(/^stk_/);
    expect(full.profileId).toBe("p");
    const after = stockLevels(products, [move("a", 10), full]);
    expect(after.get("a")).toBe(8);
  });
});
