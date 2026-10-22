import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { CalendarClock, Columns3, Factory, List, Plus, Search } from "lucide-react";
import { hasBomOrRouting, workOrderProgress, type Product, type WorkOrder, type WorkOrderStatus } from "@ordo/core";
import { useContactMap, useList } from "@/state/hooks";
import { isMobile } from "@/platform";
import { Badge, Button, EmptyState, Input, PageHeader, Progress } from "@/components/ui";
import { cls } from "@/lib/format";
import { toast } from "@/state/toasts";
import { fmtQty, useProducts } from "@/modules/produkte/shared";
import { setWorkOrderStatus } from "./actions";
import { CompleteDialog } from "./CompleteDialog";
import { BOARD_STATUSES, dueInfo, MemberAvatar, PriorityBadge, STATUS_LABELS, useMembers, useProductionAccess } from "./shared";
import { WorkOrderDialog, WorkOrderExplainer } from "./WorkOrderDialog";

type View = "board" | "list";
const VIEW_KEY = "ordo.produktion.view";

const COLUMN_HINT: Record<WorkOrderStatus, string> = {
  planned: "Angelegt, noch nicht losgelegt",
  released: "Termin und Material passen – kann starten",
  in_progress: "Wird gerade gefertigt",
  done: "Fertig gemeldet und im Lager",
  cancelled: "Abgebrochen",
};

export default function WorkOrdersPage() {
  const workOrders = useList("workOrders");
  const products = useProducts();
  const access = useProductionAccess();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [preset, setPreset] = useState<{ productId?: string; quantity?: number }>({});
  const [completing, setCompleting] = useState<WorkOrder | null>(null);
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [view, setViewState] = useState<View>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as View) || (isMobile ? "list" : "board");
    } catch {
      return isMobile ? "list" : "board";
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  // "+ Neu → Fertigungsauftrag" lands here with ?neu=1 (optionally &produkt=…&menge=… from the Bestellvorschläge)
  useEffect(() => {
    if (params.get("neu") !== "1") return;
    if (access.canWrite) {
      const m = Number(params.get("menge"));
      setPreset({ productId: params.get("produkt") ?? undefined, quantity: Number.isFinite(m) && m > 0 ? m : undefined });
      setCreating(true);
    }
    setParams({}, { replace: true });
  }, [params, setParams, access.canWrite]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const producible = useMemo(() => products.some((p) => p.kind !== "service" && hasBomOrRouting(p)), [products]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return workOrders
      .filter((w) => {
        if (mine && access.me && !w.assigneeIds.includes(access.me.id) && !w.steps.some((x) => x.memberId === access.me!.id)) return false;
        if (s && !`${w.number} ${byId.get(w.productId)?.name ?? ""} ${w.notes}`.toLowerCase().includes(s)) return false;
        return true;
      })
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.number.localeCompare(b.number));
  }, [workOrders, q, mine, access.me, byId]);
  const cancelled = filtered.filter((w) => w.status === "cancelled");

  const move = (id: string, status: WorkOrderStatus) => {
    const wo = workOrders.find((w) => w.id === id);
    if (!wo || wo.status === status) return;
    if (wo.status === "done") return toast.info("Ist schon fertig gemeldet", "Öffne den Auftrag, wenn du ihn wieder aufmachen willst.");
    if (status === "done") return setCompleting(wo);
    setWorkOrderStatus(wo, status);
  };
  const create = () => {
    setPreset({});
    setCreating(true);
  };

  if (!access.canRead) return <><PageHeader title="Fertigungsaufträge" /><EmptyState title="Kein Zugriff" body="Deine Rolle sieht die Produktion nicht." /></>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fertigungsaufträge"
        subtitle="Was gerade gefertigt wird – von geplant bis fertig im Lager."
        actions={access.canWrite && producible ? <Button onClick={create}><Plus className="h-4 w-4" /> Neuer Fertigungsauftrag</Button> : undefined}
      />
      {!workOrders.length ? (
        <div className="space-y-4">
          <WorkOrderExplainer />
          {producible ? (
            <EmptyState icon={<Factory className="h-8 w-8" />} title="Noch keine Fertigungsaufträge" body="Leg den ersten Auftrag an – Ordo erzeugt die Arbeitsschritte, prüft das Material und bucht am Ende die fertige Ware ins Lager." action={access.canWrite ? <Button onClick={create}><Plus className="h-4 w-4" /> Fertigungsauftrag anlegen</Button> : undefined} />
          ) : (
            <EmptyState icon={<Factory className="h-8 w-8" />} title="Zuerst eine Stückliste" body="Damit Ordo weiß, was zu tun ist, braucht ein Produkt eine Stückliste oder Arbeitsschritte." action={<Link to="/stuecklisten"><Button>Zu den Stücklisten</Button></Link>} />
          )}
        </div>
      ) : (
        <>
          <div className="surface flex flex-wrap items-center gap-2 p-3">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nummer, Produkt oder Notiz …" className="pl-9" />
            </div>
            {access.me ? (
              <button onClick={() => setMine((v) => !v)} className={cls("inline-flex h-10 items-center gap-1.5 rounded-[11px] border px-3 text-sm", mine ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200" : "border-(--border)")}>
                Nur meine
              </button>
            ) : null}
            <div className="flex gap-0.5 rounded-[11px] bg-(--surface-2) p-0.5">
              <button onClick={() => setView("board")} className={cls("inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium", view === "board" ? "bg-(--surface) shadow-[0_1px_3px_rgb(0_0_0/0.1)] dark:bg-slate-600" : "text-(--text-muted)")} aria-label="Board"><Columns3 className="h-4 w-4" /><span className="hidden sm:inline">Board</span></button>
              <button onClick={() => setView("list")} className={cls("inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium", view === "list" ? "bg-(--surface) shadow-[0_1px_3px_rgb(0_0_0/0.1)] dark:bg-slate-600" : "text-(--text-muted)")} aria-label="Liste"><List className="h-4 w-4" /><span className="hidden sm:inline">Liste</span></button>
            </div>
          </div>

          {view === "board" ? (
            <Board orders={filtered.filter((w) => w.status !== "cancelled")} products={byId} canMove={access.canWrite} onMove={move} />
          ) : (
            <GroupedList orders={filtered.filter((w) => w.status !== "cancelled")} products={byId} />
          )}

          {cancelled.length ? (
            <div>
              <button onClick={() => setShowCancelled((v) => !v)} className="text-sm text-(--text-muted) hover:text-(--text)">
                {showCancelled ? "Stornierte ausblenden" : `${cancelled.length} storniert${cancelled.length === 1 ? "er Auftrag" : "e Aufträge"} anzeigen`}
              </button>
              {showCancelled ? <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cancelled.map((w) => <OrderCard key={w.id} wo={w} product={byId.get(w.productId)} />)}</div> : null}
            </div>
          ) : null}
        </>
      )}
      <WorkOrderDialog open={creating} onClose={() => setCreating(false)} preset={preset} />
      <CompleteDialog open={!!completing} onClose={() => setCompleting(null)} workOrder={completing} />
    </div>
  );
}

function Board({ orders, products, canMove, onMove }: { orders: WorkOrder[]; products: Map<string, Product>; canMove: boolean; onMove: (id: string, status: WorkOrderStatus) => void }) {
  const [over, setOver] = useState<WorkOrderStatus | null>(null);
  const onDrop = (e: DragEvent, status: WorkOrderStatus) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/plain");
    if (id) onMove(id, status);
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {BOARD_STATUSES.map((s) => {
        const col = orders.filter((w) => w.status === s);
        return (
          <section
            key={s}
            onDragOver={canMove ? (e) => { e.preventDefault(); setOver(s); } : undefined}
            onDragLeave={canMove ? () => setOver((o) => (o === s ? null : o)) : undefined}
            onDrop={canMove ? (e) => onDrop(e, s) : undefined}
            className={cls("flex min-h-40 flex-col rounded-[20px] bg-(--surface-2) p-2 transition-colors", over === s && "bg-brand-50 ring-2 ring-brand-300 dark:bg-brand-900/20")}
          >
            <header className="px-2 pb-2 pt-1">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold">{STATUS_LABELS[s]}</h3>
                <span className="text-xs tabular text-(--text-muted)">{col.length}</span>
              </div>
              <p className="text-[11px] text-(--text-muted)">{COLUMN_HINT[s]}</p>
            </header>
            <div className="flex flex-1 flex-col gap-2">
              {col.map((w) => <OrderCard key={w.id} wo={w} product={products.get(w.productId)} draggable={canMove && w.status !== "done"} />)}
              {!col.length ? <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-(--border) px-3 py-6 text-center text-xs text-(--text-muted)">{canMove ? "Hierher ziehen" : "Leer"}</div> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function GroupedList({ orders, products }: { orders: WorkOrder[]; products: Map<string, Product> }) {
  return (
    <div className="space-y-5">
      {BOARD_STATUSES.map((s) => {
        const col = orders.filter((w) => w.status === s);
        if (!col.length) return null;
        return (
          <section key={s}>
            <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">{STATUS_LABELS[s]} <span className="font-normal text-(--text-muted)">{col.length}</span></h3>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{col.map((w) => <OrderCard key={w.id} wo={w} product={products.get(w.productId)} />)}</div>
          </section>
        );
      })}
      {!orders.length ? <EmptyState title="Nichts gefunden" body="Passe Suche oder Filter an." /> : null}
    </div>
  );
}

function OrderCard({ wo, product, draggable }: { wo: WorkOrder; product?: Product; draggable?: boolean }) {
  const members = useMembers();
  const contacts = useContactMap();
  const p = workOrderProgress(wo);
  const due = dueInfo(wo);
  const people = useMemo(() => {
    const ids = new Set([...wo.assigneeIds, ...wo.steps.map((s) => s.memberId).filter((x): x is string => !!x)]);
    return members.filter((m) => ids.has(m.id));
  }, [wo.assigneeIds, wo.steps, members]);
  return (
    <Link
      to={`/produktion/${wo.id}`}
      draggable={draggable}
      onDragStart={draggable ? (e) => { e.dataTransfer.setData("text/plain", wo.id); e.dataTransfer.effectAllowed = "move"; } : undefined}
      className={cls("surface block p-3 transition-shadow hover:shadow-card", draggable && "cursor-grab active:cursor-grabbing", wo.status === "cancelled" && "opacity-60")}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-(--text-muted)">
        <span className="tabular">{wo.number}</span>
        <PriorityBadge priority={wo.priority} />
      </div>
      <div className="mt-1 text-sm font-medium leading-snug">{product?.name ?? "Gelöschtes Produkt"}</div>
      <div className="text-xs text-(--text-muted)">
        {fmtQty(wo.quantity)} {product?.unit ?? "Stk"}
        {wo.customerId ? ` · ${contacts.get(wo.customerId)?.name ?? ""}` : ""}
      </div>
      {p.total ? (
        <div className="mt-2.5 flex items-center gap-2">
          <Progress value={p.ratio} className="h-1.5" />
          <span className="shrink-0 text-[11px] tabular text-(--text-muted)">{p.done}/{p.total}</span>
        </div>
      ) : null}
      {due || people.length ? (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {due ? (
            <span className={cls("inline-flex items-center gap-1 text-xs", due.tone === "danger" ? "text-red-600 dark:text-red-400" : due.tone === "warning" ? "text-amber-700 dark:text-amber-400" : "text-(--text-muted)")}>
              <CalendarClock className="h-3.5 w-3.5" /> {due.label}
            </span>
          ) : <span />}
          <span className="flex -space-x-1.5">{people.slice(0, 4).map((m) => <MemberAvatar key={m.id} member={m} />)}</span>
        </div>
      ) : null}
      {wo.status === "done" && wo.outputBooked ? <Badge tone="success" className="mt-2">im Lager</Badge> : null}
    </Link>
  );
}
