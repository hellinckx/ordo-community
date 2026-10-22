import { describe, expect, it } from "vitest";
import { ProductSchema, WorkOrderSchema, type Product, type WorkOrder } from "./schemas";
import { bomCost, bomWouldCycle, hasBomOrRouting, materialRequirements, stepsFromOperations, whereUsed, workOrderIncoming, workOrderMaterialMoves, workOrderOutputMove, workOrderProgress } from "./production";

const now = "2026-10-01T00:00:00.000Z";
const prod = (id: string, patch: Partial<Product> = {}): Product => ProductSchema.parse({ id, profileId: "p", name: id, createdAt: now, updatedAt: now, ...patch });
const wo = (patch: Partial<WorkOrder> = {}): WorkOrder => WorkOrderSchema.parse({ id: "w1", profileId: "p", number: "FA-1", productId: "poster", createdAt: now, updatedAt: now, ...patch });

// Poster = 1 paper + 25 ml ink; Kit = 2 posters + 1 tube; ink is a service-like untracked consumable in one test
const paper = prod("paper", { kind: "material", costCents: 120 });
const ink = prod("ink", { kind: "material", costCents: 8 });
const tube = prod("tube", { kind: "material", costCents: 300 });
const poster = prod("poster", { costCents: 999, components: [{ productId: "paper", quantity: 1 }, { productId: "ink", quantity: 25 }], operations: [{ id: "o1", name: "Druck", minutes: 6, workCenter: "Drucker" }, { id: "o2", name: "Schneiden", minutes: 4, workCenter: "" }] });
const kit = prod("kit", { components: [{ productId: "poster", quantity: 2 }, { productId: "tube", quantity: 1 }], operations: [{ id: "o3", name: "Montage", minutes: 3, workCenter: "" }] });
const all = [paper, ink, tube, poster, kit];

describe("materialRequirements", () => {
  it("multiplies direct components with the order quantity and finds shortages", () => {
    const r = materialRequirements(poster, 10, all, new Map([["paper", 4], ["ink", 1000]]));
    expect(r.direct.map((l) => [l.productId, l.needed, l.shortage])).toEqual([["ink", 250, 0], ["paper", 10, 6]]);
    expect(r.ok).toBe(false);
    expect(r.shortages.map((l) => l.productId)).toEqual(["paper"]);
  });
  it("uses stock of sub-assemblies first and explodes only what is missing", () => {
    const levels = new Map([["poster", 3], ["paper", 100], ["ink", 10_000], ["tube", 1]]);
    const r = materialRequirements(kit, 2, all, levels);
    // needs 4 posters (3 on stock → 1 to produce) and 2 tubes (1 on stock → 1 short)
    const posterLine = r.lines.find((l) => l.productId === "poster")!;
    expect(posterLine).toMatchObject({ needed: 4, toProduce: 1, shortage: 0, depth: 1 });
    expect(r.lines.find((l) => l.productId === "paper")).toMatchObject({ needed: 1, depth: 2, shortage: 0 });
    expect(r.lines.find((l) => l.productId === "tube")).toMatchObject({ needed: 2, shortage: 1 });
    expect(r.direct.map((l) => l.productId)).toEqual(["poster", "tube"]);
  });
  it("does not loop forever on circular bills of materials", () => {
    const a = prod("a", { components: [{ productId: "b", quantity: 1 }] });
    const b = prod("b", { components: [{ productId: "a", quantity: 1 }] });
    const r = materialRequirements(a, 1, [a, b], new Map());
    expect(r.cycle).toBe(true);
  });
  it("reports missing components and treats untracked ones as available", () => {
    const svc = prod("svc", { kind: "service" });
    const p = prod("x", { components: [{ productId: "gone", quantity: 1 }, { productId: "svc", quantity: 2 }] });
    const r = materialRequirements(p, 1, [p, svc], new Map());
    expect(r.missing).toEqual(["gone"]);
    expect(r.direct[0]).toMatchObject({ productId: "svc", untracked: true, shortage: 0 });
    expect(r.shortages).toHaveLength(0);
  });
});

describe("bomCost", () => {
  it("adds material at cost and labour minutes × hourly cost", () => {
    const c = bomCost(poster, all, { hourlyCostCents: 6000 });
    expect(c.materialCents).toBe(120 + 25 * 8);
    expect(c.minutes).toBe(10);
    expect(c.labourCents).toBe(1000);
    expect(c.totalCents).toBe(1320);
  });
  it("rolls up sub-assemblies instead of their cost price", () => {
    const c = bomCost(kit, all, { hourlyCostCents: 6000 });
    expect(c.lines.find((l) => l.productId === "poster")).toMatchObject({ unitCents: 1320, totalCents: 2640, source: "bom" });
    expect(c.totalCents).toBe(2640 + 300 + 300);
  });
  it("survives cycles", () => {
    const a = prod("a", { components: [{ productId: "b", quantity: 1 }] });
    const b = prod("b", { costCents: 5, components: [{ productId: "a", quantity: 1 }] });
    expect(bomCost(a, [a, b], { hourlyCostCents: 0 }).cycle).toBe(true);
  });
});

describe("bill of materials helpers", () => {
  it("detects loops before they are created", () => {
    expect(bomWouldCycle(all, "poster", "poster")).toBe(true);
    expect(bomWouldCycle(all, "poster", "kit")).toBe(true);
    expect(bomWouldCycle(all, "kit", "paper")).toBe(false);
  });
  it("finds where a product is used", () => {
    expect(whereUsed("poster", all).map((u) => [u.product.id, u.quantity])).toEqual([["kit", 2]]);
    expect(hasBomOrRouting(paper)).toBe(false);
    expect(hasBomOrRouting(poster)).toBe(true);
  });
});

describe("work orders", () => {
  it("creates steps from operations × quantity", () => {
    const steps = stepsFromOperations(poster, 5, { memberId: "m1" });
    expect(steps.map((s) => [s.name, s.plannedMinutes, s.memberId, s.done])).toEqual([["Druck", 30, "m1", false], ["Schneiden", 20, "m1", false]]);
    expect(new Set(steps.map((s) => s.id)).size).toBe(2);
  });
  it("measures progress by planned minutes", () => {
    const steps = stepsFromOperations(poster, 5);
    steps[0]!.done = true;
    const p = workOrderProgress(wo({ steps, status: "in_progress" }));
    expect(p).toMatchObject({ done: 1, total: 2, plannedMinutes: 50, allDone: false });
    expect(p.ratio).toBeCloseTo(0.6);
    expect(workOrderProgress(wo({ steps: [], status: "done" })).ratio).toBe(1);
    expect(workOrderProgress(wo({ steps: [], status: "planned" })).ratio).toBe(0);
  });
  it("books material and finished goods", () => {
    const order = wo({ quantity: 4 });
    const moves = workOrderMaterialMoves(order, poster, all, "2026-10-21");
    expect(moves.map((m) => [m.productId, m.quantity, m.kind])).toEqual([["paper", -4, "production_out"], ["ink", -100, "production_out"]]);
    expect(moves[0]!.workOrderId).toBe("w1");
    const out = workOrderOutputMove(order, "2026-10-21", { unitCostCents: 1320 });
    expect(out).toMatchObject({ productId: "poster", quantity: 4, kind: "production_in", unitCostCents: 1320 });
  });
  it("sums what open orders will still produce", () => {
    const m = workOrderIncoming([wo({ quantity: 3 }), wo({ id: "w2", quantity: 2, status: "in_progress" }), wo({ id: "w3", quantity: 9, status: "done" }), wo({ id: "w4", quantity: 9, outputBooked: true })]);
    expect(m.get("poster")).toBe(5);
  });
});
