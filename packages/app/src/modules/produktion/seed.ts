import { bomCost, formatNumber, ids, MemberSchema, newStockMove, nowIso, stepsFromOperations, todayIso, workOrderMaterialMoves, workOrderOutputMove, WorkOrderSchema, type Member, type Product, type StockMove, type WorkOrder, type WorkOrderStatus, type VaultStore } from "@ordo/core";
import { isoAddDays } from "@/modules/produkte/shared";
import { DEMO_REF } from "@/modules/produkte/seed";

const at = (iso: string, hour: number) => `${iso}T${String(hour).padStart(2, "0")}:00:00.000Z`;

/**
 * Demo work orders for "Muster Design e.U.": one per board column (done, in progress, released, planned),
 * steps assigned to the existing team. Needs the Produkte demo articles; creates one person only if the team is empty.
 */
export function seedProduktionDemo(store: VaultStore, profileId: string): void {
  if (store.list("workOrders", { profileId }).length) return;
  const products = store.list("products", { profileId });
  const byRef = (ref: string) => products.find((p) => p.legacyRef === ref);
  const poster = byRef(DEMO_REF.poster);
  const cards = byRef(DEMO_REF.cards);
  const rollup = byRef(DEMO_REF.rollup);
  if (!poster || !cards || !rollup) return;

  const now = nowIso();
  const today = todayIso();
  const day = (n: number) => isoAddDays(today, n);
  const contacts = store.list("contacts", { profileId });
  const customer = (part: string) => contacts.find((c) => c.name.toLowerCase().includes(part.toLowerCase()))?.id;

  let members: Member[] = store.list("members").filter((m) => m.active);
  const newMembers: Member[] = [];
  if (!members.length) {
    const mia = MemberSchema.parse({ id: ids.member(), name: "Mia Muster", role: "owner", title: "Inhaberin", hourlyCostCents: 4200, hourlyRateCents: 8500, color: "#0a5fe0", createdAt: now, updatedAt: now });
    newMembers.push(mia);
    members = [mia];
  }
  const who = (i: number) => members[i % members.length]!.id;
  const rates = members.map((m) => m.hourlyCostCents).filter((c) => c > 0);
  const hourly = rates.length ? Math.round(rates.reduce((s, c) => s + c, 0) / rates.length) : 3800;

  const order = (product: Product, quantity: number, status: WorkOrderStatus, data: Partial<WorkOrder>, stepState: (s: WorkOrder["steps"][number], i: number) => Partial<WorkOrder["steps"][number]>): WorkOrder => {
    const steps = stepsFromOperations(product, quantity).map((s, i) => ({ ...s, memberId: who(i), ...stepState(s, i) }));
    const assigneeIds = [...new Set(steps.map((s) => s.memberId).filter((x): x is string => !!x))];
    return WorkOrderSchema.parse({ id: ids.workOrder(), profileId, number: "", productId: product.id, quantity, status, assigneeIds, steps, createdAt: now, updatedAt: now, ...data });
  };

  const done = order(poster, 50, "done", { priority: "high", plannedStart: day(-16), dueDate: day(-12), startedAt: at(day(-15), 7), completedAt: at(day(-13), 14), customerId: customer("Stadtwerke"), materialsBooked: true, outputBooked: true, notes: "Kampagne „Energie sparen“ – Freigabe-PDF vom Kunden liegt in Dateien." }, (s, i) => ({ done: true, doneAt: at(day(-15 + i), 9 + i), actualMinutes: Math.round(s.plannedMinutes * [1.1, 0.95, 1][i % 3]!) }));
  const running = order(rollup, 3, "in_progress", { priority: "high", plannedStart: day(-2), dueDate: day(2), startedAt: at(day(-2), 8), customerId: customer("Alpenblick"), materialsBooked: true, notes: "Logo in Pantone 2945 C, Druck matt." }, (s, i) => (i < 2 ? { done: true, doneAt: at(day(-2 + i), 10), actualMinutes: i === 0 ? s.plannedMinutes + 5 : s.plannedMinutes - 5 } : {}));
  const released = order(cards, 4, "released", { plannedStart: day(1), dueDate: day(5), customerId: customer("Morgenrot") }, (_s, i) => (i === 2 ? { memberId: undefined } : {}));
  const planned = order(poster, 30, "planned", { priority: "low", plannedStart: day(7), dueDate: day(14), notes: "Lager auffüllen für die Weihnachtsaktion." }, () => ({}));
  const orders = [done, running, released, planned];
  const numbering = store.vault.settings.projects;
  orders.forEach((o, i) => (o.number = formatNumber(numbering.workOrderNumberPattern || "FA-{YYYY}-{NNNN}", numbering.nextWorkOrderNumber + i, today)));

  const mv = (d: Parameters<typeof newStockMove>[1]) => newStockMove(profileId, d, now);
  const moves: StockMove[] = [
    ...workOrderMaterialMoves(done, poster, products, day(-15)).map(mv),
    mv(workOrderOutputMove(done, day(-13), { unitCostCents: bomCost(poster, products, { hourlyCostCents: hourly }).totalCents })),
    mv({ productId: poster.id, date: day(-11), quantity: -20, kind: "sale", unitCostCents: poster.costCents, contactId: customer("Stadtwerke"), note: "Lieferung Kampagne" }),
    ...workOrderMaterialMoves(running, rollup, products, day(-2)).map(mv),
  ];

  store.mutate(
    (v) => {
      if (newMembers.length) v.members = [...v.members, ...newMembers];
      v.settings = { ...v.settings, projects: { ...v.settings.projects, nextWorkOrderNumber: v.settings.projects.nextWorkOrderNumber + orders.length } };
      v.workOrders = [...v.workOrders, ...orders];
      v.stockMoves = [...v.stockMoves, ...moves];
    },
    { audit: { action: "demo.seed", entity: "workOrders", details: "Produktion" } },
  );
}
