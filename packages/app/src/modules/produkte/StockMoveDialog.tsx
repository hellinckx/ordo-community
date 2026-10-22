import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { isStockTracked, newStockMove, roundQty, todayIso, type StockMoveDraft } from "@ordo/core";
import { useProfile } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { Button, Checkbox, DateInput, Field, Input, Modal, MoneyInput } from "@/components/ui";
import { ContactPicker } from "@/components/pickers";
import { fmtMoney } from "@/lib/format";
import { toast } from "@/state/toasts";
import { fmtQty, Group, ProductPicker, QtyInput, Segmented, useProducts, useStockLevels } from "./shared";

export type MoveMode = "receipt" | "issue" | "adjustment";

/**
 * Book a stock movement by hand: Zugang (goods in), Abgang (sale or consumption) or Korrektur (set the real stock).
 */
export function StockMoveDialog({ open, onClose, productId, mode = "receipt", quantity, lockProduct }: { open: boolean; onClose: () => void; productId?: string; mode?: MoveMode; quantity?: number; /** Product cannot be changed (opened from the product page). */ lockProduct?: boolean }) {
  const profile = useProfile();
  const products = useProducts();
  const levels = useStockLevels();
  const [kind, setKind] = useState<MoveMode>(mode);
  const [pid, setPid] = useState<string | undefined>(productId);
  const [qty, setQty] = useState<number | null>(quantity ?? null);
  const [counted, setCounted] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [updateCost, setUpdateCost] = useState(false);
  const [reason, setReason] = useState<"sale" | "issue">("issue");
  const [contactId, setContactId] = useState<string | undefined>();
  const [note, setNote] = useState("");

  const product = products.find((p) => p.id === pid);
  const level = pid ? (levels.get(pid) ?? 0) : 0;

  useEffect(() => {
    if (!open) return;
    const p = products.find((x) => x.id === productId);
    setKind(mode);
    setPid(productId);
    setQty(quantity ?? null);
    setCounted(productId ? (levels.get(productId) ?? 0) : null);
    setDate(todayIso());
    setUnitCost(p?.costCents ?? null);
    setUpdateCost(false);
    setReason("issue");
    setContactId(mode === "receipt" ? p?.supplierId : undefined);
    setNote("");
    // only when the dialog opens
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickProduct = (id: string | undefined) => {
    setPid(id);
    const p = products.find((x) => x.id === id);
    setUnitCost(p?.costCents ?? null);
    if (kind === "receipt") setContactId(p?.supplierId);
    setCounted(id ? (levels.get(id) ?? 0) : null);
  };

  const delta = useMemo(() => {
    if (kind === "adjustment") return counted === null ? 0 : roundQty(counted - level);
    if (!qty) return 0;
    return kind === "receipt" ? qty : -qty;
  }, [kind, qty, counted, level]);
  const after = roundQty(level + delta);

  const save = () => {
    if (!product) return toast.warning("Wähle zuerst einen Artikel.");
    if (!delta) return toast.warning(kind === "adjustment" ? "Der Bestand stimmt schon – nichts zu buchen." : "Gib eine Menge ein.");
    const draft: StockMoveDraft = {
      productId: product.id,
      date,
      quantity: delta,
      kind: kind === "receipt" ? "receipt" : kind === "adjustment" ? "adjustment" : reason,
      unitCostCents: (kind === "receipt" ? unitCost : null) ?? product.costCents,
      note: note.trim() || (kind === "adjustment" ? `Korrektur von ${fmtQty(level)} auf ${fmtQty(counted ?? 0)}` : ""),
      contactId: kind === "adjustment" ? undefined : contactId,
    };
    const store = requireStore();
    store.insert("stockMoves", newStockMove(profile.id, draft), "stock.move");
    if (kind === "receipt" && updateCost && unitCost !== null && unitCost !== product.costCents) store.update("products", product.id, { costCents: unitCost });
    toast.success(kind === "receipt" ? "Zugang gebucht" : kind === "issue" ? "Abgang gebucht" : "Bestand korrigiert", `${product.name}: jetzt ${fmtQty(after)} ${product.unit}`);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Lagerbewegung buchen" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={save} disabled={!product}>Buchen</Button></>}>
      <div className="space-y-4">
        <Segmented value={kind} onChange={setKind} options={[{ id: "receipt", label: "Zugang" }, { id: "issue", label: "Abgang" }, { id: "adjustment", label: "Korrektur" }]} />
        <p className="text-xs text-(--text-muted)">
          {kind === "receipt" ? "Ware ist angekommen – etwa eine Lieferung oder ein Einkauf." : kind === "issue" ? "Ware hat das Lager verlassen – verkauft, verbraucht oder ausgeschieden." : "Trag ein, wie viel wirklich da ist. Ordo bucht die Differenz."}
        </p>
        <Field label="Artikel" required>
          {lockProduct && product ? (
            <div className="flex h-10 items-center rounded-[11px] border border-(--border) bg-(--surface-2) px-3 text-sm">{product.name}</div>
          ) : (
            <ProductPicker value={pid} onChange={pickProduct} filter={isStockTracked} levels={levels} />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === "adjustment" ? (
            <Field label="Tatsächlicher Bestand" hint={product ? `Laut Ordo: ${fmtQty(level)} ${product.unit}` : undefined}>
              <QtyInput value={counted} onChange={setCounted} suffix={product?.unit} />
            </Field>
          ) : (
            <Field label="Menge" hint={product ? `Bestand jetzt: ${fmtQty(level)} ${product.unit}` : undefined}>
              <QtyInput value={qty} onChange={setQty} suffix={product?.unit} autoFocus={!!productId} />
            </Field>
          )}
          <Field label="Datum">
            <DateInput value={date} onChange={(d) => setDate(d ?? todayIso())} />
          </Field>
          {kind === "receipt" ? (
            <>
              <Field label="Einkaufspreis je Einheit (netto)" hint={unitCost && delta ? `Gesamt ${fmtMoney(Math.round(unitCost * delta))}` : undefined}>
                <MoneyInput value={unitCost} onChange={setUnitCost} />
              </Field>
              <Field label="Lieferant">
                <ContactPicker value={contactId} onChange={setContactId} kind="vendor" placeholder="Lieferant (optional)" />
              </Field>
            </>
          ) : null}
          {kind === "issue" ? (
            <>
              <Group label="Grund">
                <Segmented value={reason} onChange={setReason} options={[{ id: "issue", label: "Verbrauch" }, { id: "sale", label: "Verkauf" }]} />
              </Group>
              {reason === "sale" ? (
                <Field label="Kunde">
                  <ContactPicker value={contactId} onChange={setContactId} kind="customer" placeholder="Kunde (optional)" />
                </Field>
              ) : null}
            </>
          ) : null}
        </div>
        {kind === "receipt" && product && unitCost !== null && unitCost !== product.costCents ? (
          <Checkbox checked={updateCost} onChange={setUpdateCost} label="Als neuen Einkaufspreis übernehmen" hint={`Bisher ${fmtMoney(product.costCents)} je ${product.unit}`} />
        ) : null}
        <Field label="Notiz">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "receipt" ? "z. B. Lieferschein 2026-118" : kind === "issue" ? "z. B. Muster für Kundin" : "z. B. beschädigt aussortiert"} />
        </Field>
        {product && delta ? (
          <div className="flex items-center justify-between rounded-xl bg-(--surface-2) px-3 py-2.5 text-sm">
            <span className="text-(--text-muted)">Bestand danach</span>
            <span className="tabular font-semibold">
              {fmtQty(after)} {product.unit} <span className="ml-1 font-normal text-(--text-muted)">({delta > 0 ? "+" : "−"}{fmtQty(Math.abs(delta))})</span>
            </span>
          </div>
        ) : null}
        {product && after < 0 ? (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Danach wäre der Bestand negativ. Buchen geht trotzdem – prüf aber, ob ein Zugang fehlt.
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
