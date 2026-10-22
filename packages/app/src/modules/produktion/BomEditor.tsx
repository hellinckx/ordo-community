import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowUp, Clock, Info, ListTree, Plus, Trash2 } from "lucide-react";
import { bomCost, bomWouldCycle, newId, type Product } from "@ordo/core";
import { requireStore } from "@/state/session";
import { Button, Card, Input } from "@/components/ui";
import { cls, fmtMoney, fmtPct } from "@/lib/format";
import { toast } from "@/state/toasts";
import { fmtQty, ProductPicker, QtyInput, useProducts, useStockLevels } from "@/modules/produkte/shared";
import { fmtMinutes, useLabourRate } from "./shared";

type Operation = Product["operations"][number];

/** Short explanation shown once at the top of every bill-of-materials screen. */
export function BomExplainer() {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-(--surface-2) px-4 py-3 text-sm text-(--text-muted)">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />
      <p>
        Eine <span className="font-medium text-(--text)">Stückliste</span> sagt, woraus ein Stück besteht – Material und Teile mit Menge. Die <span className="font-medium text-(--text)">Arbeitsschritte</span> sagen, was dafür zu tun ist und wie lange es dauert. Daraus rechnet Ordo Materialbedarf, Zeit und Herstellkosten.
      </p>
    </div>
  );
}

/**
 * Edits components and work steps of a product. Every change is saved right away.
 */
export function BomEditor({ product, readOnly }: { product: Product; readOnly?: boolean }) {
  const products = useProducts();
  const levels = useStockLevels();
  const rate = useLabourRate();
  const cost = useMemo(() => bomCost(product, products, { hourlyCostCents: rate.cents }), [product, products, rate.cents]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const workCenters = useMemo(() => [...new Set(products.flatMap((p) => p.operations.map((o) => o.workCenter)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")), [products]);
  const [adding, setAdding] = useState(false);
  const [focusOp, setFocusOp] = useState<string | null>(null);

  const patch = (fn: (p: Product) => Partial<Product>) => requireStore().update("products", product.id, (p) => ({ ...p, ...fn(p) }), "product.bom");

  const addComponent = (id: string | undefined) => {
    setAdding(false);
    if (!id) return;
    if (bomWouldCycle(products, product.id, id)) return toast.warning("Das geht nicht", "Dieser Artikel enthält schon das Produkt selbst – das wäre eine Schleife.");
    if (product.components.some((c) => c.productId === id)) return toast.info("Ist schon in der Stückliste");
    patch((p) => ({ components: [...p.components, { productId: id, quantity: 1 }] }));
  };
  const setQty = (i: number, quantity: number) => patch((p) => ({ components: p.components.map((c, j) => (j === i ? { ...c, quantity } : c)) }));
  const removeComponent = (i: number) => patch((p) => ({ components: p.components.filter((_, j) => j !== i) }));

  const addOp = () => {
    const op: Operation = { id: newId("op"), name: "", minutes: 0, workCenter: "" };
    setFocusOp(op.id);
    patch((p) => ({ operations: [...p.operations, op] }));
  };
  const setOp = (id: string, change: Partial<Operation>) => patch((p) => ({ operations: p.operations.map((o) => (o.id === id ? { ...o, ...change } : o)) }));
  const moveOp = (i: number, dir: -1 | 1) =>
    patch((p) => {
      const ops = [...p.operations];
      const j = i + dir;
      if (j < 0 || j >= ops.length) return {};
      [ops[i], ops[j]] = [ops[j]!, ops[i]!];
      return { operations: ops };
    });
  const removeOp = (id: string) => patch((p) => ({ operations: p.operations.filter((o) => o.id !== id) }));

  const margin = product.priceCents ? (product.priceCents - cost.totalCents) / product.priceCents : null;
  const costDiffers = (cost.materialCents > 0 || cost.labourCents > 0) && cost.totalCents !== product.costCents;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card title={`Stückliste – für 1 ${product.unit}`} padded={false} action={!readOnly ? <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Material</Button> : undefined}>
          {product.components.length ? (
            <ul className="divide-y divide-(--border)">
              {product.components.map((c, i) => {
                const comp = byId.get(c.productId);
                const line = cost.lines.find((l) => l.productId === c.productId);
                return (
                  <li key={`${c.productId}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5">
                    <div className="min-w-0 flex-1 basis-40">
                      {comp ? <Link to={`/produkte/${comp.id}`} className="block truncate text-sm font-medium hover:underline">{comp.name}</Link> : <span className="text-sm text-red-600">Gelöschter Artikel</span>}
                      <div className="truncate text-xs text-(--text-muted)">
                        {comp ? `${fmtMoney(line?.unitCents ?? comp.costCents)} je ${comp.unit}${line?.source === "bom" ? " (aus Stückliste)" : ""} · Lager ${fmtQty(levels.get(comp.id) ?? 0)} ${comp.unit}` : c.productId}
                      </div>
                    </div>
                    <div className="w-32">
                      {readOnly ? <span className="block text-right text-sm tabular">{fmtQty(c.quantity)} {comp?.unit}</span> : <QtyInput value={c.quantity} commit="blur" onChange={(n) => n !== c.quantity && setQty(i, n)} suffix={comp?.unit} aria-label="Menge" />}
                    </div>
                    <div className="w-24 text-right text-sm tabular">{line ? fmtMoney(line.totalCents) : "–"}</div>
                    {!readOnly ? <button onClick={() => removeComponent(i)} className="rounded-lg p-1.5 text-(--text-muted) hover:bg-(--surface-2) hover:text-red-600" aria-label="Entfernen"><Trash2 className="h-4 w-4" /></button> : null}
                  </li>
                );
              })}
            </ul>
          ) : !adding ? (
            <div className="px-5 py-8 text-center text-sm text-(--text-muted)">
              <ListTree className="mx-auto mb-2 h-6 w-6 text-brand-700 dark:text-brand-400" />
              Noch kein Material. Füg hinzu, was in einem {product.unit} steckt – etwa Papier, Farbe oder Teile.
            </div>
          ) : null}
          {adding ? (
            <div className="border-t border-(--border) px-5 py-3">
              <ProductPicker value={undefined} autoFocus onChange={addComponent} levels={levels} placeholder="Material oder Teil wählen …" filter={(p) => p.kind !== "service" && p.id !== product.id && !product.components.some((c) => c.productId === p.id) && !bomWouldCycle(products, product.id, p.id)} />
              <button onClick={() => setAdding(false)} className="mt-2 text-xs text-(--text-muted) hover:text-(--text)">Abbrechen</button>
            </div>
          ) : null}
        </Card>

        <Card title="Arbeitsschritte – für 1 Stück" padded={false} action={!readOnly ? <Button size="sm" variant="outline" onClick={addOp}><Plus className="h-4 w-4" /> Schritt</Button> : undefined}>
          {product.operations.length ? (
            <ol className="divide-y divide-(--border)">
              {product.operations.map((o, i) => (
                <OperationRow key={o.id} op={o} index={i} count={product.operations.length} readOnly={readOnly} autoFocus={focusOp === o.id} onChange={(c) => setOp(o.id, c)} onMove={(d) => moveOp(i, d)} onRemove={() => removeOp(o.id)} />
              ))}
            </ol>
          ) : (
            <div className="px-5 py-8 text-center text-sm text-(--text-muted)">
              <Clock className="mx-auto mb-2 h-6 w-6 text-brand-700 dark:text-brand-400" />
              Noch keine Arbeitsschritte. Zum Beispiel: Druckvorstufe, Druck, Schneiden, Montage.
            </div>
          )}
          <datalist id="ordo-workcenters">{workCenters.map((w) => <option key={w} value={w} />)}</datalist>
        </Card>
      </div>

      <div className="space-y-5">
        <Card title={`Kosten je ${product.unit}`}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-(--text-muted)">Material</dt><dd className="tabular">{fmtMoney(cost.materialCents)}</dd></div>
            <div className="flex justify-between gap-3">
              <dt className="text-(--text-muted)">Arbeit <span className="text-xs">({fmtMinutes(cost.minutes)}{rate.cents ? ` × ${fmtMoney(rate.cents)}/h` : ""})</span></dt>
              <dd className="tabular">{fmtMoney(cost.labourCents)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-(--border) pt-2 font-semibold"><dt>Herstellkosten</dt><dd className="tabular">{fmtMoney(cost.totalCents)}</dd></div>
            {product.priceCents ? (
              <>
                <div className="flex justify-between gap-3 pt-1"><dt className="text-(--text-muted)">Verkaufspreis netto</dt><dd className="tabular">{fmtMoney(product.priceCents)}</dd></div>
                <div className="flex justify-between gap-3">
                  <dt className="text-(--text-muted)">Rohertrag</dt>
                  <dd className={cls("tabular font-medium", product.priceCents - cost.totalCents < 0 && "text-red-600")}>{fmtMoney(product.priceCents - cost.totalCents)}{margin !== null ? <span className="ml-1 font-normal text-(--text-muted)">({fmtPct(margin)})</span> : null}</dd>
                </div>
              </>
            ) : null}
          </dl>
          {!rate.fromTeam && product.operations.length ? (
            <p className="mt-3 text-xs text-(--text-muted)">
              Für die Arbeitszeit fehlt ein Stundensatz. Trag unter <Link to="/team" className="text-brand-700 hover:underline dark:text-brand-400">Team</Link> die internen Stundenkosten ein, dann rechnet Ordo sie mit.
            </p>
          ) : rate.fromTeam ? (
            <p className="mt-3 text-xs text-(--text-muted)">Arbeit mit den durchschnittlichen Stundenkosten deines Teams gerechnet.</p>
          ) : null}
          {cost.cycle ? <p className="mt-2 text-xs text-red-600">Die Stückliste enthält eine Schleife – ein Teil enthält das Produkt selbst.</p> : null}
          {costDiffers && !readOnly ? (
            <div className="mt-4 rounded-xl bg-(--surface-2) p-3 text-xs text-(--text-muted)">
              Gespeicherter Kostenpreis: <span className="tabular font-medium text-(--text)">{fmtMoney(product.costCents)}</span>
              <Button size="sm" variant="outline" className="mt-2 w-full justify-center" onClick={() => { requireStore().update("products", product.id, { costCents: cost.totalCents }, "product.cost"); toast.success("Kostenpreis übernommen", fmtMoney(cost.totalCents)); }}>
                Herstellkosten als Kostenpreis übernehmen
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function OperationRow({ op, index, count, readOnly, autoFocus, onChange, onMove, onRemove }: { op: Operation; index: number; count: number; readOnly?: boolean; autoFocus?: boolean; onChange: (c: Partial<Operation>) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void }) {
  const [name, setName] = useState(op.name);
  const [center, setCenter] = useState(op.workCenter);
  useEffect(() => setName(op.name), [op.name]);
  useEffect(() => setCenter(op.workCenter), [op.workCenter]);
  if (readOnly) {
    return (
      <li className="flex items-center gap-3 px-5 py-2.5 text-sm">
        <span className="w-5 text-right text-xs tabular text-(--text-muted)">{index + 1}.</span>
        <span className="min-w-0 flex-1 truncate font-medium">{op.name || "Ohne Namen"}</span>
        {op.workCenter ? <span className="hidden truncate text-(--text-muted) sm:inline">{op.workCenter}</span> : null}
        <span className="tabular">{fmtMinutes(op.minutes)}</span>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-2 px-5 py-2.5">
      <span className="w-5 text-right text-xs tabular text-(--text-muted)">{index + 1}.</span>
      <div className="min-w-0 flex-1 basis-40">
        <Input value={name} autoFocus={autoFocus} placeholder="Name des Schritts" onChange={(e) => setName(e.target.value)} onBlur={() => name !== op.name && onChange({ name: name.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      </div>
      <div className="w-36 basis-36 max-sm:flex-1">
        <Input value={center} list="ordo-workcenters" placeholder="Arbeitsplatz" onChange={(e) => setCenter(e.target.value)} onBlur={() => center !== op.workCenter && onChange({ workCenter: center.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      </div>
      <div className="w-28">
        <QtyInput value={op.minutes} commit="blur" suffix="min" onChange={(n) => n !== op.minutes && onChange({ minutes: n })} aria-label="Minuten" />
      </div>
      <div className="flex items-center">
        <button disabled={index === 0} onClick={() => onMove(-1)} className="rounded-lg p-1.5 text-(--text-muted) hover:bg-(--surface-2) disabled:opacity-30" aria-label="Nach oben"><ArrowUp className="h-4 w-4" /></button>
        <button disabled={index === count - 1} onClick={() => onMove(1)} className="rounded-lg p-1.5 text-(--text-muted) hover:bg-(--surface-2) disabled:opacity-30" aria-label="Nach unten"><ArrowDown className="h-4 w-4" /></button>
        <button onClick={onRemove} className="rounded-lg p-1.5 text-(--text-muted) hover:bg-(--surface-2) hover:text-red-600" aria-label="Entfernen"><Trash2 className="h-4 w-4" /></button>
      </div>
    </li>
  );
}
