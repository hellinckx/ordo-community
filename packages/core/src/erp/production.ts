/* Production logic (Ordo Produktion): bill of materials, material requirements, costs, work order progress. Pure functions. */
import { newId } from "../model/ids";
import type { Product, WorkOrder, WorkOrderStep } from "./schemas";
import { isStockTracked, roundQty, type StockMoveDraft } from "./stock";

/** Has a bill of materials (Stückliste) or work steps. */
export function hasBomOrRouting(p: Pick<Product, "components" | "operations">): boolean {
  return p.components.length > 0 || p.operations.length > 0;
}

/**
 * Whether adding `childId` as a component of `parentId` would create a loop
 * (the child is the parent itself or already contains the parent somewhere below).
 */
export function bomWouldCycle(products: Pick<Product, "id" | "components">[], parentId: string, childId: string): boolean {
  if (parentId === childId) return true;
  const byId = new Map(products.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const stack = [childId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === parentId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of byId.get(id)?.components ?? []) stack.push(c.productId);
  }
  return false;
}

/** Products whose bill of materials uses this product directly ("Verwendung"). */
export function whereUsed(productId: string, products: Product[]): { product: Product; quantity: number }[] {
  const out: { product: Product; quantity: number }[] = [];
  for (const p of products) {
    if (p.deletedAt) continue;
    const qty = p.components.filter((c) => c.productId === productId).reduce((s, c) => s + c.quantity, 0);
    if (qty) out.push({ product: p, quantity: roundQty(qty) });
  }
  return out.sort((a, b) => a.product.name.localeCompare(b.product.name, "de"));
}

/* ------------------------------------------------------------------ */
/* Material requirements                                               */
/* ------------------------------------------------------------------ */

export interface MaterialLine {
  productId: string;
  product?: Product;
  /** Quantity needed for the whole order. */
  needed: number;
  /** Stock right now. */
  available: number;
  /** Part of `needed` that is not on stock and cannot be made from a sub-BOM. */
  shortage: number;
  /** Part of `needed` that is missing but can be produced from its own bill of materials (only in `lines`). */
  toProduce: number;
  /** 1 = direct component, 2 = component of a component, … (smallest depth when it appears more than once). */
  depth: number;
  /** Not stock-tracked (e.g. a service) – always counts as available. */
  untracked: boolean;
}

export interface MaterialRequirements {
  /** Direct components × quantity – what "Material entnehmen" takes from stock. */
  direct: MaterialLine[];
  /**
   * Full explosion: stock is used first; what is missing of a component with its own bill of materials is
   * exploded further, what is missing of anything else is a shortage. Summed per product.
   */
  lines: MaterialLine[];
  /** Lines (of `lines`) with a shortage. */
  shortages: MaterialLine[];
  /** True when nothing is missing. */
  ok: boolean;
  /** A loop in the bill of materials was found and cut. */
  cycle: boolean;
  /** Component ids that point to no (or a deleted) product. */
  missing: string[];
}

/**
 * Explodes the bill of materials of `product` for `quantity` units and compares with stock.
 * Guards against loops (a product containing itself somewhere below).
 */
export function materialRequirements(product: Product, quantity: number, products: Product[], levels: Map<string, number>, opts: { explode?: boolean } = {}): MaterialRequirements {
  const explode = opts.explode ?? true;
  const byId = new Map(products.filter((p) => !p.deletedAt).map((p) => [p.id, p]));
  const missing = new Set<string>();
  let cycle = false;

  // direct components
  const directMap = new Map<string, MaterialLine>();
  for (const c of product.components) {
    if (!(c.quantity > 0)) continue;
    const comp = byId.get(c.productId);
    if (!comp) {
      missing.add(c.productId);
      continue;
    }
    if (comp.id === product.id) {
      cycle = true;
      continue;
    }
    const line = directMap.get(comp.id) ?? blankLine(comp, levels, 1);
    line.needed = roundQty(line.needed + c.quantity * quantity);
    directMap.set(comp.id, line);
  }
  for (const l of directMap.values()) l.shortage = l.untracked ? 0 : roundQty(Math.max(0, l.needed - Math.max(0, l.available)));

  // full explosion with running availability
  const remaining = new Map<string, number>();
  const agg = new Map<string, MaterialLine>();
  const visit = (p: Product, qty: number, depth: number, path: Set<string>) => {
    for (const c of p.components) {
      if (!(c.quantity > 0)) continue;
      const comp = byId.get(c.productId);
      if (!comp) {
        missing.add(c.productId);
        continue;
      }
      if (path.has(comp.id)) {
        cycle = true;
        continue;
      }
      const need = roundQty(c.quantity * qty);
      const line = agg.get(comp.id) ?? blankLine(comp, levels, depth);
      line.depth = Math.min(line.depth, depth);
      line.needed = roundQty(line.needed + need);
      agg.set(comp.id, line);
      if (line.untracked) continue;
      const avail = remaining.has(comp.id) ? remaining.get(comp.id)! : Math.max(0, line.available);
      const take = Math.min(avail, need);
      remaining.set(comp.id, roundQty(avail - take));
      const lacking = roundQty(need - take);
      if (lacking <= 0) continue;
      if (explode && comp.components.length) {
        line.toProduce = roundQty(line.toProduce + lacking);
        visit(comp, lacking, depth + 1, new Set([...path, comp.id]));
      } else {
        line.shortage = roundQty(line.shortage + lacking);
      }
    }
  };
  visit(product, quantity, 1, new Set([product.id]));

  const sort = (a: MaterialLine, b: MaterialLine) => a.depth - b.depth || (a.product?.name ?? "").localeCompare(b.product?.name ?? "", "de");
  const lines = [...agg.values()].sort(sort);
  const shortages = lines.filter((l) => l.shortage > 0);
  return { direct: [...directMap.values()].sort(sort), lines, shortages, ok: shortages.length === 0 && missing.size === 0, cycle, missing: [...missing] };
}

function blankLine(p: Product, levels: Map<string, number>, depth: number): MaterialLine {
  return { productId: p.id, product: p, needed: 0, available: levels.get(p.id) ?? 0, shortage: 0, toProduce: 0, depth, untracked: !isStockTracked(p) };
}

/* ------------------------------------------------------------------ */
/* Cost roll-up                                                        */
/* ------------------------------------------------------------------ */

export interface BomCostLine {
  productId: string;
  product?: Product;
  /** Per unit of the parent. */
  quantity: number;
  /** Cost of one unit of the component (rolled up when it has its own bill of materials). */
  unitCents: number;
  totalCents: number;
  /** "bom" = from its own bill of materials, "cost" = its cost price. */
  source: "bom" | "cost";
}

export interface BomCost {
  /** Material per unit (net cents). */
  materialCents: number;
  /** Own work steps per unit: minutes × hourly cost. */
  labourCents: number;
  totalCents: number;
  /** Minutes of the product's own work steps per unit. */
  minutes: number;
  lines: BomCostLine[];
  cycle: boolean;
  missing: string[];
}

/**
 * Production cost of ONE unit: components at cost (components with their own bill of materials or work steps
 * are rolled up recursively) plus labour = minutes of the work steps × `hourlyCostCents`.
 */
export function bomCost(product: Product, products: Product[], opts: { hourlyCostCents: number }): BomCost {
  const byId = new Map(products.filter((p) => !p.deletedAt).map((p) => [p.id, p]));
  const memo = new Map<string, number>();
  let cycle = false;
  const missing = new Set<string>();

  const unitCost = (p: Product, path: Set<string>): number => {
    if (!hasBomOrRouting(p)) return p.costCents;
    const cached = memo.get(p.id);
    if (cached !== undefined) return cached;
    let total = labour(p);
    for (const c of p.components) {
      const comp = byId.get(c.productId);
      if (!comp) {
        missing.add(c.productId);
        continue;
      }
      if (path.has(comp.id)) {
        cycle = true;
        continue;
      }
      total += c.quantity * unitCost(comp, new Set([...path, comp.id]));
    }
    const v = Math.round(total);
    memo.set(p.id, v);
    return v;
  };
  const labour = (p: Product) => (p.operations.reduce((s, o) => s + Math.max(0, o.minutes), 0) * opts.hourlyCostCents) / 60;

  const lines: BomCostLine[] = [];
  for (const c of product.components) {
    const comp = byId.get(c.productId);
    if (!comp) {
      missing.add(c.productId);
      continue;
    }
    if (comp.id === product.id) {
      cycle = true;
      continue;
    }
    const unitCents = unitCost(comp, new Set([product.id, comp.id]));
    lines.push({ productId: comp.id, product: comp, quantity: c.quantity, unitCents, totalCents: Math.round(c.quantity * unitCents), source: hasBomOrRouting(comp) ? "bom" : "cost" });
  }
  const materialCents = lines.reduce((s, l) => s + l.totalCents, 0);
  const minutes = product.operations.reduce((s, o) => s + Math.max(0, o.minutes), 0);
  const labourCents = Math.round(labour(product));
  return { materialCents, labourCents, totalCents: materialCents + labourCents, minutes, lines, cycle, missing: [...missing] };
}

/* ------------------------------------------------------------------ */
/* Work orders                                                         */
/* ------------------------------------------------------------------ */

/** Planned, released or in progress. */
export function isWorkOrderOpen(wo: Pick<WorkOrder, "status" | "deletedAt">): boolean {
  return !wo.deletedAt && (wo.status === "planned" || wo.status === "released" || wo.status === "in_progress");
}

/** Work steps for an order: the product's operations, minutes × quantity. */
export function stepsFromOperations(product: Pick<Product, "operations">, quantity: number, opts: { memberId?: string } = {}): WorkOrderStep[] {
  return product.operations.map((o) => ({
    id: newId("wos"),
    name: o.name,
    plannedMinutes: Math.round(Math.max(0, o.minutes) * quantity),
    actualMinutes: 0,
    workCenter: o.workCenter,
    memberId: opts.memberId,
    done: false,
  }));
}

export interface WorkOrderProgress {
  done: number;
  total: number;
  plannedMinutes: number;
  actualMinutes: number;
  /** 0…1 – weighted by planned minutes when there are any, otherwise by number of steps. */
  ratio: number;
  allDone: boolean;
}

export function workOrderProgress(wo: Pick<WorkOrder, "steps" | "status">): WorkOrderProgress {
  const total = wo.steps.length;
  const done = wo.steps.filter((s) => s.done).length;
  const plannedMinutes = wo.steps.reduce((s, x) => s + x.plannedMinutes, 0);
  const actualMinutes = wo.steps.reduce((s, x) => s + x.actualMinutes, 0);
  let ratio: number;
  if (!total) ratio = wo.status === "done" ? 1 : 0;
  else if (plannedMinutes > 0) ratio = wo.steps.filter((s) => s.done).reduce((s, x) => s + x.plannedMinutes, 0) / plannedMinutes;
  else ratio = done / total;
  if (wo.status === "done") ratio = 1;
  return { done, total, plannedMinutes, actualMinutes, ratio, allDone: total > 0 && done === total };
}

/** Quantities that open work orders will still put into stock, per product. */
export function workOrderIncoming(workOrders: WorkOrder[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const wo of workOrders) {
    if (!isWorkOrderOpen(wo) || wo.outputBooked) continue;
    out.set(wo.productId, roundQty((out.get(wo.productId) ?? 0) + wo.quantity));
  }
  return out;
}

/** "Material entnehmen": one `production_out` per direct, stock-tracked component (quantity × order quantity). */
export function workOrderMaterialMoves(wo: Pick<WorkOrder, "id" | "number" | "quantity">, product: Product, products: Product[], date: string): StockMoveDraft[] {
  const byId = new Map(products.filter((p) => !p.deletedAt).map((p) => [p.id, p]));
  const sums = new Map<string, number>();
  for (const c of product.components) {
    const comp = byId.get(c.productId);
    if (!comp || comp.id === product.id || !isStockTracked(comp) || !(c.quantity > 0)) continue;
    sums.set(comp.id, roundQty((sums.get(comp.id) ?? 0) + c.quantity * wo.quantity));
  }
  return [...sums].map(([productId, qty]) => ({
    productId,
    date,
    quantity: -qty,
    kind: "production_out" as const,
    unitCostCents: byId.get(productId)?.costCents,
    note: `Material für ${wo.number}`,
    workOrderId: wo.id,
  }));
}

/** "Fertigmeldung": the finished goods go into stock (`production_in`). */
export function workOrderOutputMove(wo: Pick<WorkOrder, "id" | "number" | "quantity" | "productId">, date: string, opts: { quantity?: number; unitCostCents?: number } = {}): StockMoveDraft {
  return {
    productId: wo.productId,
    date,
    quantity: roundQty(opts.quantity ?? wo.quantity),
    kind: "production_in",
    unitCostCents: opts.unitCostCents,
    note: `Fertigmeldung ${wo.number}`,
    workOrderId: wo.id,
  };
}
