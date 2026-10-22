import { useMemo } from "react";
import { Link } from "react-router";
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2 } from "lucide-react";
import { isBelowMinimum, isStockTracked, stockValue } from "@ordo/core";
import { Card } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { fmtQty, useProductAccess, useProducts, useStockLevels } from "./shared";

/** Übersicht card: stock value and items below their minimum. */
export function StockWidget() {
  const products = useProducts();
  const levels = useStockLevels();
  const access = useProductAccess();
  const tracked = useMemo(() => products.filter((p) => p.active && isStockTracked(p)), [products]);
  const low = useMemo(
    () => tracked.filter((p) => isBelowMinimum(p, levels.get(p.id) ?? 0)).sort((a, b) => (levels.get(a.id) ?? 0) / a.minStock - (levels.get(b.id) ?? 0) / b.minStock),
    [tracked, levels],
  );
  const value = useMemo(() => stockValue(tracked, levels).totalCents, [tracked, levels]);
  if (!access.canRead) return null;

  return (
    <Card title="Lager" action={<Link to={low.length ? "/lager?tab=vorschlaege" : "/lager"} className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline dark:text-brand-400">{low.length ? "Bestellvorschläge" : "Zum Lager"} <ArrowRight className="h-3.5 w-3.5" /></Link>}>
      {!tracked.length ? (
        <div className="flex items-start gap-3 text-sm">
          <Boxes className="mt-0.5 h-5 w-5 shrink-0 text-brand-700 dark:text-brand-400" />
          <p className="text-(--text-muted)">Noch nichts im Lager. <Link to="/produkte/neu?art=material" className="text-brand-700 hover:underline dark:text-brand-400">Ersten Artikel anlegen</Link></p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <div className="text-xs text-(--text-muted)">Lagerwert</div>
              <div className="tabular text-xl font-semibold tracking-tight">{fmtMoney(value)}</div>
            </div>
            <div>
              <div className="text-xs text-(--text-muted)">Unter Mindestbestand</div>
              <div className={low.length ? "tabular text-xl font-semibold tracking-tight text-amber-700 dark:text-amber-400" : "tabular text-xl font-semibold tracking-tight"}>{low.length}</div>
            </div>
          </div>
          {low.length ? (
            <ul className="space-y-1.5">
              {low.slice(0, 4).map((p) => (
                <li key={p.id}>
                  <Link to={`/produkte/${p.id}?tab=bestand`} className="flex items-center gap-2 rounded-lg text-sm hover:underline">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 tabular text-(--text-muted)">{fmtQty(levels.get(p.id) ?? 0)} / {fmtQty(p.minStock)} {p.unit}</span>
                  </Link>
                </li>
              ))}
              {low.length > 4 ? <li className="text-xs text-(--text-muted)">und {low.length - 4} weitere</li> : null}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-(--text-muted)"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Alles ausreichend auf Lager.</p>
          )}
        </div>
      )}
    </Card>
  );
}
