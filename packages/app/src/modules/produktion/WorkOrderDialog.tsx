import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Info } from "lucide-react";
import { hasBomOrRouting, ids, nowIso, stepsFromOperations, todayIso, WorkOrderSchema, type Priority, type WorkOrder, type WorkOrderStep } from "@ordo/core";
import { useList, useProfile } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { useIsInstalled } from "@/modules/registry";
import { Button, DateInput, Field, Modal, Select, Textarea } from "@/components/ui";
import { ContactPicker } from "@/components/pickers";
import { cls } from "@/lib/format";
import { toast } from "@/state/toasts";
import { Group, isoAddDays, ProductPicker, QtyInput, useProducts, useStockLevels } from "@/modules/produkte/shared";
import { MaterialCheck } from "./MaterialCheck";
import { fmtMinutes, MemberAvatar, PRIORITY_LABELS, takeWorkOrderNumber, useMembers } from "./shared";

/** Explains the term once, wherever a work order is created. */
export function WorkOrderExplainer() {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-(--surface-2) px-4 py-3 text-sm text-(--text-muted)">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />
      <p>
        Ein <span className="font-medium text-(--text)">Fertigungsauftrag</span> sagt: Stell so viele Stück von diesem Produkt bis dann her. Ordo nimmt dafür die Stückliste (Material) und die Arbeitsschritte (wer macht was, wie lange) des Produkts.
      </p>
    </div>
  );
}

export function WorkOrderDialog({ open, onClose, workOrder, preset }: { open: boolean; onClose: () => void; workOrder?: WorkOrder; preset?: { productId?: string; quantity?: number } }) {
  const profile = useProfile();
  const navigate = useNavigate();
  const products = useProducts();
  const levels = useStockLevels();
  const members = useMembers();
  const projects = useList("projects");
  const projekte = useIsInstalled("projekte");
  const [productId, setProductId] = useState<string | undefined>();
  const [quantity, setQuantity] = useState(1);
  const [dueDate, setDueDate] = useState<string | undefined>();
  const [plannedStart, setPlannedStart] = useState<string | undefined>();
  const [priority, setPriority] = useState<Priority>("medium");
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [projectId, setProjectId] = useState<string | undefined>();
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [stepMembers, setStepMembers] = useState<Record<string, string | undefined>>({});
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setProductId(workOrder?.productId ?? preset?.productId);
    setQuantity(workOrder?.quantity ?? preset?.quantity ?? 1);
    setDueDate(workOrder ? workOrder.dueDate : isoAddDays(todayIso(), 7));
    setPlannedStart(workOrder ? workOrder.plannedStart : todayIso());
    setPriority(workOrder?.priority ?? "medium");
    setCustomerId(workOrder?.customerId);
    setProjectId(workOrder?.projectId);
    setAssigneeIds(workOrder?.assigneeIds ?? []);
    setStepMembers({});
    setNotes(workOrder?.notes ?? "");
    // only when the dialog opens
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const product = products.find((p) => p.id === productId);
  const editing = !!workOrder;
  const qtyLocked = !!workOrder && (workOrder.materialsBooked || workOrder.outputBooked);
  const openProjects = useMemo(() => projects.filter((p) => p.status !== "cancelled" && p.status !== "completed").sort((a, b) => a.name.localeCompare(b.name, "de")), [projects]);

  const toggleAssignee = (id: string) => setAssigneeIds((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const defaultMember = assigneeIds[0];

  const save = () => {
    if (!product) return toast.warning("Wähle das Produkt, das gefertigt werden soll.");
    if (!(quantity > 0)) return toast.warning("Gib eine Menge größer 0 ein.");
    const store = requireStore();
    if (workOrder) {
      const factor = workOrder.quantity ? quantity / workOrder.quantity : 1;
      store.update(
        "workOrders",
        workOrder.id,
        (w) => ({
          ...w,
          quantity,
          dueDate,
          plannedStart,
          priority,
          customerId,
          projectId,
          assigneeIds,
          notes,
          steps: factor !== 1 ? w.steps.map((s) => ({ ...s, plannedMinutes: Math.round(s.plannedMinutes * factor) })) : w.steps,
        }),
        "workOrder.update",
      );
      toast.success("Gespeichert");
      onClose();
      return;
    }
    const steps: WorkOrderStep[] = stepsFromOperations(product, quantity).map((s, i) => {
      const op = product.operations[i];
      const chosen = op ? stepMembers[op.id] : undefined;
      return { ...s, memberId: chosen === "" ? undefined : (chosen ?? defaultMember) };
    });
    const now = nowIso();
    const created: WorkOrder = WorkOrderSchema.parse({ id: ids.workOrder(), profileId: profile.id, number: "", productId: product.id, quantity, status: "planned", priority, plannedStart, dueDate, customerId, projectId, assigneeIds, steps, notes, createdAt: now, updatedAt: now });
    store.mutate(
      (v) => {
        created.number = takeWorkOrderNumber(v);
        v.workOrders = [...v.workOrders, created];
      },
      { audit: { action: "workOrder.create", entity: "workOrders", entityId: created.id } },
    );
    toast.success("Fertigungsauftrag angelegt", created.number);
    onClose();
    navigate(`/produktion/${created.id}`);
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? `${workOrder.number} bearbeiten` : "Neuer Fertigungsauftrag"} footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={save} disabled={!product}>{editing ? "Speichern" : "Anlegen"}</Button></>}>
      <div className="space-y-5">
        {!editing ? <WorkOrderExplainer /> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Produkt" required className="sm:col-span-2">
            {editing ? (
              <div className="flex h-10 items-center rounded-[11px] border border-(--border) bg-(--surface-2) px-3 text-sm">{product?.name ?? "–"}</div>
            ) : (
              <ProductPicker value={productId} onChange={(id) => setProductId(id)} levels={levels} filter={(p) => p.active && p.kind !== "service" && hasBomOrRouting(p)} placeholder="Produkt mit Stückliste wählen …" />
            )}
          </Field>
          <Field label="Menge" required hint={qtyLocked ? "Material oder Fertigware ist schon gebucht." : undefined}>
            <QtyInput value={quantity} onChange={setQuantity} suffix={product?.unit} disabled={qtyLocked} />
          </Field>
          <Field label="Start geplant">
            <DateInput value={plannedStart} onChange={setPlannedStart} />
          </Field>
          <Field label="Fällig am">
            <DateInput value={dueDate} onChange={setDueDate} />
          </Field>
          <Field label="Priorität">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
            </Select>
          </Field>
          <Field label="Für Kunde" className={projekte && openProjects.length ? "" : "sm:col-span-3"}>
            <ContactPicker value={customerId} onChange={setCustomerId} kind="customer" placeholder="Kunde (optional)" />
          </Field>
          {projekte && openProjects.length ? (
            <Field label="Projekt" className="sm:col-span-2">
              <Select value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || undefined)}>
                <option value="">Kein Projekt</option>
                {openProjects.map((p) => <option key={p.id} value={p.id}>{p.number ? `${p.number} · ` : ""}{p.name}</option>)}
              </Select>
            </Field>
          ) : null}
        </div>

        {members.length ? (
          <Group label="Zuständig">
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = assigneeIds.includes(m.id);
                return (
                  <button key={m.id} type="button" onClick={() => toggleAssignee(m.id)} className={cls("inline-flex h-9 items-center gap-2 rounded-full border pl-1 pr-3 text-sm transition-colors", on ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200" : "border-(--border) hover:bg-(--surface-2)")}>
                    <MemberAvatar member={m} className="ring-0" />
                    {m.name}
                  </button>
                );
              })}
            </div>
          </Group>
        ) : null}

        {product && !editing && product.operations.length ? (
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-(--text-muted)">Arbeitsschritte</div>
            <ul className="divide-y divide-(--border) rounded-xl border border-(--border)">
              {product.operations.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 basis-32">
                    <span className="block truncate font-medium">{o.name || "Schritt"}</span>
                    <span className="block text-xs text-(--text-muted)">{[o.workCenter, `${fmtMinutes(Math.round(o.minutes * quantity))} geplant`].filter(Boolean).join(" · ")}</span>
                  </span>
                  {members.length ? (
                    <Select value={stepMembers[o.id] ?? defaultMember ?? ""} onChange={(e) => setStepMembers((s) => ({ ...s, [o.id]: e.target.value }))} className="h-9 w-44 text-[13px]" aria-label="Wer">
                      <option value="">Noch offen</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </Select>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {product ? (
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-(--text-muted)">Material</div>
            <MaterialCheck product={product} quantity={quantity || 0} compact />
          </div>
        ) : null}

        <Field label="Notiz">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="z. B. Farbe laut Freigabe-PDF, matt laminiert" />
        </Field>
      </div>
    </Modal>
  );
}
