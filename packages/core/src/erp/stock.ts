/* Stock logic (Ordo Lager): stock levels, value, reorder suggestions, inventory count. Pure functions. */
import { newId } from "../model/ids";
import type { Product, StockMove } from "./schemas";

/** Quantities are decimals (1,7 m², 0,5 kg) – sums are rounded so 0.1 + 0.2 stays 0.3. */
export function roundQty(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Whether Ordo keeps a stock count for this item. Services never have stock. */
export function isStockTracked(p: Pick<Product, "kind" | "trackStock">): boolean {
  return p.trackStock && p.kind !== "service";
}

/** True when the item is tracked, has a minimum and the stock is below it. */
export function isBelowMinimum(p: Pick<Product, "kind" | "trackStock" | "minStock">, level: number): boolean {
  return isStockTracked(p) && p.minStock > 0 && level < p.minStock;
}

/**
 * Stock per product = sum of its signed moves (+ in, − out). Every product appears in the map (0 without moves);
 * moves of unknown products are counted too. Deleted moves are ignored. `until` (inclusive) gives the stock at a date.
 */
export function stockLevels(products: Pick<Product, "id">[], moves: StockMove[], opts: { until?: string } = {}): Map<string, number> {
  const levels = new Map<string, number>();
  for (const p of products) levels.set(p.id, 0);
  for (const m of moves) {
    if (m.deletedAt) continue;
    if (opts.until && m.date > opts.until) continue;
    levels.set(m.productId, (levels.get(m.productId) ?? 0) + m.quantity);
  }
  for (const [k, v] of levels) levels.set(k, roundQty(v));
  return levels;
}

export interface StockValue {
  /** Total value of everything on stock, at cost (net cents). */
  totalCents: number;
  /** Value per product (only tracked products with positive stock). */
  byProduct: Map<string, number>;
}

/** Stock value at cost (costCents × quantity). Negative stock counts as 0; services and untracked items are skipped. */
export function stockValue(products: Product[], levels: Map<string, number>): StockValue {
  const byProduct = new Map<string, number>();
  let totalCents = 0;
  for (const p of products) {
    if (p.deletedAt || !isStockTracked(p)) continue;
    const qty = levels.get(p.id) ?? 0;
    if (qty <= 0) continue;
    const v = Math.round(qty * p.costCents);
    byProduct.set(p.id, v);
    totalCents += v;
  }
  return { totalCents, byProduct };
}

export interface ReorderSuggestion {
  product: Product;
  productId: string;
  /** Current stock. */
  quantity: number;
  minStock: number;
  /** Quantity still on the way (e.g. open work orders). */
  incoming: number;
  /** Stock the suggestion fills up to (2 × minimum by default). */
  target: number;
  /** Suggested quantity to order or produce (rounded up to whole units). */
  suggested: number;
  /** Suggested quantity × cost. */
  costCents: number;
  supplierId?: string;
  /** Made in-house (has a bill of materials) – produce instead of buying. */
  make: boolean;
}

/**
 * Items below their minimum stock with a quantity that fills them up to `factor` × minimum (default 2×).
 * Quantities already on the way (`incoming`) are counted as stock. Skips services, untracked and inactive items.
 * Most urgent first (lowest stock relative to its minimum).
 */
export function reorderSuggestions(products: Product[], levels: Map<string, number>, opts: { factor?: number; incoming?: Map<string, number> } = {}): ReorderSuggestion[] {
  const factor = opts.factor ?? 2;
  const out: ReorderSuggestion[] = [];
  for (const p of products) {
    if (p.deletedAt || !p.active || !isStockTracked(p) || p.minStock <= 0) continue;
    const quantity = levels.get(p.id) ?? 0;
    const incoming = Math.max(0, opts.incoming?.get(p.id) ?? 0);
    const available = roundQty(quantity + incoming);
    if (available >= p.minStock) continue;
    const target = roundQty(p.minStock * factor);
    const suggested = Math.max(1, Math.ceil(roundQty(target - available)));
    out.push({ product: p, productId: p.id, quantity, minStock: p.minStock, incoming, target, suggested, costCents: Math.round(suggested * p.costCents), supplierId: p.supplierId, make: p.components.length > 0 });
  }
  return out.sort((a, b) => a.quantity / a.minStock - b.quantity / b.minStock || a.product.name.localeCompare(b.product.name, "de"));
}

/** A stock movement before it gets an id and timestamps. */
export type StockMoveDraft = Omit<StockMove, "id" | "createdAt" | "updatedAt" | "deletedAt" | "profileId">;

/** Turns a draft into a storable movement. */
export function newStockMove(profileId: string, draft: StockMoveDraft, now: string = new Date().toISOString()): StockMove {
  return { ...draft, id: newId("stk"), profileId, createdAt: now, updatedAt: now };
}

export interface InventoryLine {
  productId: string;
  expected: number;
  counted: number;
  difference: number;
  /** Difference × cost. */
  valueCents: number;
}

/** Compares counted with expected stock. Only counted, tracked products appear; equal counts have difference 0. */
export function inventoryDifferences(products: Product[], levels: Map<string, number>, counts: Map<string, number>): InventoryLine[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: InventoryLine[] = [];
  for (const [productId, counted] of counts) {
    const p = byId.get(productId);
    if (!p || !isStockTracked(p) || !Number.isFinite(counted)) continue;
    const expected = levels.get(productId) ?? 0;
    const difference = roundQty(counted - expected);
    out.push({ productId, expected, counted, difference, valueCents: Math.round(difference * p.costCents) });
  }
  return out;
}

/** Inventory count → one `count` movement per product whose counted stock differs from the books. */
export function inventoryAdjustments(products: Product[], levels: Map<string, number>, counts: Map<string, number>, opts: { date: string; note?: string }): StockMoveDraft[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return inventoryDifferences(products, levels, counts)
    .filter((l) => Math.abs(l.difference) > 1e-9)
    .map((l) => ({
      productId: l.productId,
      date: opts.date,
      quantity: l.difference,
      kind: "count" as const,
      unitCostCents: byId.get(l.productId)?.costCents,
      note: opts.note ?? `Inventur: gezählt ${fmtQty(l.counted)}, erwartet ${fmtQty(l.expected)}`,
    }));
}

function fmtQty(n: number): string {
  return n.toLocaleString("de-AT", { maximumFractionDigits: 3 });
}
