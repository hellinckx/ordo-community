import { useMemo } from "react";
import { Link } from "react-router";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { materialRequirements, type MaterialLine, type Product } from "@ordo/core";
import { cls } from "@/lib/format";
import { fmtQty, useProducts, useStockLevels } from "@/modules/produkte/shared";

/** Needed vs. available material for `quantity` units of `product`; shortages in amber (partly there) or red (nothing there). */
export function MaterialCheck({ product, quantity, compact }: { product: Product; quantity: number; compact?: boolean }) {
  const products = useProducts();
  const levels = useStockLevels();
  const req = useMemo(() => materialRequirements(product, quantity, products, levels), [product, quantity, products, levels]);
  const top = req.lines.filter((l) => l.depth === 1);
  const deeper = req.lines.filter((l) => l.depth > 1);
  const allThere = req.ok && !req.lines.some((l) => l.toProduce > 0);

  if (!product.components.length) {
    return <p className="text-sm text-(--text-muted)">Für dieses Produkt ist keine Stückliste hinterlegt – es wird kein Material gebraucht.</p>;
  }
  return (
    <div className="space-y-3">
      {allThere ? (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> Alles Material ist da.
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {req.shortages.length ? `Es fehlt Material: ${req.shortages.map((l) => `${fmtQty(l.shortage)} ${l.product?.unit ?? ""} ${l.product?.name ?? ""}`).join(", ")}.` : "Einige Teile müssen erst gefertigt werden."}
            {!compact ? " Du kannst trotzdem starten – bestell oder fertige nach, bevor du Material entnimmst." : null}
          </span>
        </div>
      )}
      <MaterialTable lines={top} />
      {deeper.length ? (
        <div>
          <p className="mb-1.5 text-xs text-(--text-muted)">Für Teile, die erst gefertigt werden müssen, brauchst du zusätzlich:</p>
          <MaterialTable lines={deeper} />
        </div>
      ) : null}
      {req.cycle ? <p className="text-xs text-red-600">Die Stückliste enthält eine Schleife – bitte prüfen.</p> : null}
      {req.missing.length ? <p className="text-xs text-red-600">{req.missing.length} Bestandteil(e) der Stückliste gibt es nicht mehr.</p> : null}
    </div>
  );
}

function MaterialTable({ lines }: { lines: MaterialLine[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-(--border)">
      <table className="w-full min-w-[420px] text-sm">
        <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
          <tr>
            <th className="px-3 py-1.5">Material</th>
            <th className="px-3 py-1.5 text-right">Bedarf</th>
            <th className="px-3 py-1.5 text-right">Im Lager</th>
            <th className="px-3 py-1.5 text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-(--border)">
          {lines.map((l) => {
            const unit = l.product?.unit ?? "";
            const missing = l.shortage > 0;
            const none = missing && l.available <= 0;
            return (
              <tr key={l.productId}>
                <td className="max-w-0 px-3 py-2">{l.product ? <Link to={`/produkte/${l.productId}?tab=bestand`} className="block truncate hover:underline">{l.product.name}</Link> : "–"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular">{fmtQty(l.needed)} <span className="text-(--text-muted)">{unit}</span></td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular text-(--text-muted)">{l.untracked ? "–" : fmtQty(l.available)}</td>
                <td className={cls("whitespace-nowrap px-3 py-2 text-right text-xs font-medium", none ? "text-red-600 dark:text-red-400" : missing ? "text-amber-700 dark:text-amber-400" : l.toProduce > 0 ? "text-brand-700 dark:text-brand-400" : "text-emerald-700 dark:text-emerald-400")}>
                  {missing ? `fehlt ${fmtQty(l.shortage)}` : l.toProduce > 0 ? `${fmtQty(l.toProduce)} fertigen` : "da"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
