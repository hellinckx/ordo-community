import { newStockMove, nowIso, todayIso, workOrderMaterialMoves, workOrderOutputMove, type Product, type StockMove, type WorkOrder, type WorkOrderStatus } from "@ordo/core";
import { requireStore } from "@/state/session";

/** Changes the status; the first start sets startedAt, leaving "done" clears completedAt. */
export function setWorkOrderStatus(wo: WorkOrder, status: WorkOrderStatus): void {
  requireStore().update(
    "workOrders",
    wo.id,
    (w) => ({
      ...w,
      status,
      startedAt: status === "in_progress" && !w.startedAt ? nowIso() : w.startedAt,
      completedAt: status === "done" ? (w.completedAt ?? nowIso()) : undefined,
    }),
    `workOrder.${status}`,
  );
}

/** "Material entnehmen": books the components once as production_out. Returns the number of movements. */
export function bookWorkOrderMaterials(wo: WorkOrder, product: Product, products: Product[], profileId: string, date: string = todayIso()): number {
  if (wo.materialsBooked) return 0;
  const moves = workOrderMaterialMoves(wo, product, products, date).map((d) => newStockMove(profileId, d));
  requireStore().mutate(
    (v) => {
      v.stockMoves = [...v.stockMoves, ...moves];
      v.workOrders = v.workOrders.map((w) => (w.id === wo.id ? { ...w, materialsBooked: true, updatedAt: nowIso() } : w));
    },
    { audit: { action: "workOrder.materials", entity: "workOrders", entityId: wo.id, details: `${moves.length}` } },
  );
  return moves.length;
}

/**
 * "Fertigmeldung": finished goods into stock (production_in), optionally the material too, status → done.
 */
export function completeWorkOrder(wo: WorkOrder, product: Product, products: Product[], profileId: string, opts: { quantity: number; unitCostCents?: number; bookMaterials: boolean; date?: string }): void {
  const date = opts.date ?? todayIso();
  const moves: StockMove[] = [];
  const takeMaterials = opts.bookMaterials && !wo.materialsBooked;
  if (takeMaterials) moves.push(...workOrderMaterialMoves(wo, product, products, date).map((d) => newStockMove(profileId, d)));
  if (!wo.outputBooked && opts.quantity > 0) moves.push(newStockMove(profileId, workOrderOutputMove(wo, date, { quantity: opts.quantity, unitCostCents: opts.unitCostCents })));
  const now = nowIso();
  requireStore().mutate(
    (v) => {
      v.stockMoves = [...v.stockMoves, ...moves];
      v.workOrders = v.workOrders.map((w) =>
        w.id === wo.id
          ? { ...w, status: "done" as const, materialsBooked: w.materialsBooked || takeMaterials, outputBooked: w.outputBooked || opts.quantity > 0, completedAt: now, startedAt: w.startedAt ?? now, updatedAt: now }
          : w,
      );
    },
    { audit: { action: "workOrder.complete", entity: "workOrders", entityId: wo.id } },
  );
}

/** Puts booked material back into stock (e.g. when an order is cancelled). */
export function returnWorkOrderMaterials(wo: WorkOrder, profileId: string, moves: StockMove[]): number {
  const taken = moves.filter((m) => m.workOrderId === wo.id && m.kind === "production_out" && !m.deletedAt);
  const back = taken.map((m) => newStockMove(profileId, { productId: m.productId, date: todayIso(), quantity: -m.quantity, kind: "adjustment", unitCostCents: m.unitCostCents, note: `Rückbuchung ${wo.number}`, workOrderId: wo.id }));
  requireStore().mutate(
    (v) => {
      v.stockMoves = [...v.stockMoves, ...back];
      v.workOrders = v.workOrders.map((w) => (w.id === wo.id ? { ...w, materialsBooked: false, updatedAt: nowIso() } : w));
    },
    { audit: { action: "workOrder.returnMaterials", entity: "workOrders", entityId: wo.id } },
  );
  return back.length;
}
