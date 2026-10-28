import { useMemo } from "react";
import { PackagePlus, Plus, X } from "lucide-react";
import { isStockTracked, suggestReceiptLines, type ExtractedLineItem, type ReceiptLine, type Transaction } from "@ordo/core";
import { useList } from "@/state/hooks";
import { Button, Checkbox, MoneyInput } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { fmtQty, ProductPicker, QtyInput, useProducts, useStockLevels } from "./shared";

/** Goods from an incoming invoice that should go into stock – booked together with the invoice. */
export interface PurchaseStock {
  open: boolean;
  lines: ReceiptLine[];
  updateCost: boolean;
}

export const NO_PURCHASE_STOCK: PurchaseStock = { open: false, lines: [], updateCost: true };

/**
 * "Ins Lager buchen" on the review screen of an incoming invoice: pick article + quantity per line,
 * Ordo books a Zugang when the invoice is booked. Shows what this invoice already put into stock.
 */
export function PurchaseStockCard({ tx, lineItems, value, onChange }: { tx: Transaction; lineItems: ExtractedLineItem[]; value: PurchaseStock; onChange: (v: PurchaseStock) => void }) {
  const products = useProducts();
  const levels = useStockLevels();
  const moves = useList("stockMoves");
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const booked = useMemo(() => moves.filter((m) => m.transactionId === tx.id), [moves, tx.id]);
  const set = (p: Partial<PurchaseStock>) => onChange({ ...value, ...p });
  const setLine = (i: number, p: Partial<ReceiptLine>) => set({ lines: value.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const start = () => {
    const suggested = suggestReceiptLines(lineItems, products);
    onChange({ ...value, open: true, lines: suggested.length ? suggested : [{ quantity: 1 }] });
  };
  const ready = value.lines.filter((l) => l.productId && l.quantity > 0);
  const costChanges = ready.filter((l) => l.unitCostCents && l.unitCostCents !== byId.get(l.productId!)?.costCents);

  return (
    <div className="mt-4 rounded-xl border border-(--border) p-3">
      <div className="flex items-center gap-2">
        <PackagePlus className="h-4 w-4 shrink-0 text-brand-600" />
        <span className="flex-1 text-sm font-medium">Ins Lager buchen</span>
        {value.open ? <button type="button" onClick={() => onChange({ ...value, open: false })} className="rounded-md p-1 text-(--text-muted) hover:bg-(--surface-2)" aria-label="Nicht ins Lager buchen"><X className="h-4 w-4" /></button> : <Button size="sm" variant="outline" onClick={start}>Artikel wählen</Button>}
      </div>
      {booked.length ? (
        <p className="mt-1.5 text-xs text-(--text-muted)">Schon im Lager: {booked.map((m) => `+${fmtQty(m.quantity)} ${byId.get(m.productId)?.unit ?? ""} ${byId.get(m.productId)?.name ?? "Artikel"}`).join(" · ")}</p>
      ) : !value.open ? (
        <p className="mt-1.5 text-xs text-(--text-muted)">Ware für dein Lager dabei? Wähl die Artikel – Ordo bucht sie beim Buchen der Rechnung als Zugang.</p>
      ) : null}
      {value.open ? (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-[1fr_90px_110px_28px] gap-2 px-0.5 text-[11px] font-medium text-(--text-muted)"><span>Artikel</span><span>Menge</span><span>Einkauf je Einh.</span><span /></div>
          {value.lines.map((l, i) => {
            const p = l.productId ? byId.get(l.productId) : undefined;
            return (
              <div key={i}>
                <div className="grid grid-cols-[1fr_90px_110px_28px] items-center gap-2">
                  <ProductPicker value={l.productId} filter={isStockTracked} levels={levels} placeholder={l.description ? "Artikel zuordnen …" : "Artikel wählen …"} onChange={(id, prod) => setLine(i, { productId: id, unitCostCents: l.unitCostCents ?? prod?.costCents })} />
                  <QtyInput value={l.quantity} onChange={(n) => setLine(i, { quantity: n })} suffix={p?.unit} />
                  <MoneyInput value={l.unitCostCents ?? null} onChange={(c) => setLine(i, { unitCostCents: c ?? undefined })} />
                  <button type="button" onClick={() => set({ lines: value.lines.filter((_, j) => j !== i) })} className="rounded-md p-1 text-(--text-muted) hover:bg-(--surface-2)" aria-label="Zeile entfernen"><X className="h-4 w-4" /></button>
                </div>
                {l.description ? <span className="mt-0.5 block truncate px-0.5 text-[11px] text-(--text-muted)">Auf der Rechnung: {l.description}</span> : null}
              </div>
            );
          })}
          <Button size="sm" variant="ghost" onClick={() => set({ lines: [...value.lines, { quantity: 1 }] })}><Plus className="h-4 w-4" /> Artikel</Button>
          {costChanges.length ? <Checkbox checked={value.updateCost} onChange={(updateCost) => set({ updateCost })} label="Preise als neuen Einkaufspreis übernehmen" hint={costChanges.map((l) => `${byId.get(l.productId!)?.name}: bisher ${fmtMoney(byId.get(l.productId!)?.costCents ?? 0)}`).join(" · ")} /> : null}
          <p className="text-xs text-(--text-muted)">{ready.length ? `${ready.length === 1 ? "Ein Artikel kommt" : `${ready.length} Artikel kommen`} beim Buchen ins Lager.` : "Zeilen ohne Artikel werden nicht ins Lager gebucht."}</p>
        </div>
      ) : null}
    </div>
  );
}
