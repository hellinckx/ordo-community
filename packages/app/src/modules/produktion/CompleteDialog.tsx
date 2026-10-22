import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { bomCost, workOrderProgress, type WorkOrder } from "@ordo/core";
import { useProfile } from "@/state/hooks";
import { Button, Checkbox, Field, Modal } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/state/toasts";
import { fmtQty, QtyInput, useProducts } from "@/modules/produkte/shared";
import { completeWorkOrder } from "./actions";
import { useLabourRate } from "./shared";

/** "Fertigmeldung": finished goods into stock, optionally take the material too. */
export function CompleteDialog({ open, onClose, workOrder }: { open: boolean; onClose: () => void; workOrder: WorkOrder | null }) {
  const profile = useProfile();
  const products = useProducts();
  const rate = useLabourRate();
  const [quantity, setQuantity] = useState(0);
  const [takeMaterials, setTakeMaterials] = useState(true);
  useEffect(() => {
    if (!open || !workOrder) return;
    setQuantity(workOrder.quantity);
    setTakeMaterials(!workOrder.materialsBooked);
  }, [open, workOrder]);
  const product = workOrder ? products.find((p) => p.id === workOrder.productId) : undefined;
  const unitCost = useMemo(() => (product ? bomCost(product, products, { hourlyCostCents: rate.cents }).totalCents : 0), [product, products, rate.cents]);
  if (!workOrder) return null;
  const progress = workOrderProgress(workOrder);
  const openSteps = progress.total - progress.done;

  const confirm = () => {
    if (!product) return toast.error("Das Produkt gibt es nicht mehr.");
    completeWorkOrder(workOrder, product, products, profile.id, { quantity: workOrder.outputBooked ? 0 : quantity, unitCostCents: unitCost || product.costCents, bookMaterials: takeMaterials });
    toast.success("Fertig gemeldet", workOrder.outputBooked ? workOrder.number : `${fmtQty(quantity)} ${product.unit} ${product.name} sind jetzt im Lager.`);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" title="Fertigmelden" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={confirm}>Fertigmelden</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="text-(--text-muted)">
          {workOrder.outputBooked ? "Die Fertigware ist schon im Lager gebucht. Der Auftrag wird nur abgeschlossen." : `Die fertigen ${product?.name ?? "Produkte"} kommen ins Lager${unitCost ? ` – zu ${fmtMoney(unitCost)} Herstellkosten je ${product?.unit ?? "Stück"}` : ""}.`}
        </p>
        {!workOrder.outputBooked ? (
          <Field label="Gefertigte Menge" hint={quantity !== workOrder.quantity ? `Geplant waren ${fmtQty(workOrder.quantity)} ${product?.unit ?? ""}.` : undefined}>
            <QtyInput value={quantity} onChange={setQuantity} suffix={product?.unit} />
          </Field>
        ) : null}
        {!workOrder.materialsBooked && product?.components.length ? (
          <Checkbox checked={takeMaterials} onChange={setTakeMaterials} label="Material jetzt aus dem Lager nehmen" hint="Bucht die Stückliste × geplante Menge als Materialentnahme." />
        ) : null}
        {openSteps > 0 ? (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {openSteps === 1 ? "Ein Arbeitsschritt ist" : `${openSteps} Arbeitsschritte sind`} noch nicht abgehakt.
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
