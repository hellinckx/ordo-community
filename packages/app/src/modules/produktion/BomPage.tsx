import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowLeft, ChevronRight, ExternalLink, Factory, ListTree, Plus, Search } from "lucide-react";
import { bomCost, hasBomOrRouting, type Product } from "@ordo/core";
import { Button, EmptyState, Field, Input, Modal, PageHeader } from "@/components/ui";
import { cls, fmtMoney } from "@/lib/format";
import { ProductPicker, useProductAccess, useProducts, useStockLevels } from "@/modules/produkte/shared";
import { BomEditor, BomExplainer } from "./BomEditor";
import { fmtMinutes, useLabourRate, useProductionAccess } from "./shared";
import { WorkOrderDialog } from "./WorkOrderDialog";

export default function BomPage() {
  const products = useProducts();
  const rate = useLabourRate();
  const productAccess = useProductAccess();
  const production = useProductionAccess();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const selectedId = params.get("p") ?? undefined;
  const select = (id: string | undefined) => setParams(id ? { p: id } : {}, { replace: false });
  const canEdit = productAccess.canWrite && production.canWrite;

  const withBom = useMemo(() => products.filter((p) => p.kind !== "service" && hasBomOrRouting(p)), [products]);
  const selected = products.find((p) => p.id === selectedId);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = selected && !withBom.some((p) => p.id === selected.id) ? [selected, ...withBom] : withBom;
    return rows.filter((p) => !s || `${p.name} ${p.sku}`.toLowerCase().includes(s));
  }, [withBom, selected, q]);
  const costs = useMemo(() => new Map(list.map((p) => [p.id, bomCost(p, products, { hourlyCostCents: rate.cents })])), [list, products, rate.cents]);

  if (!production.canRead) return <><PageHeader title="Stücklisten" /><EmptyState title="Kein Zugriff" body="Deine Rolle sieht die Produktion nicht." /></>;

  const header = (
    <PageHeader
      title="Stücklisten"
      subtitle="Woraus deine Produkte bestehen und welche Arbeitsschritte nötig sind."
      actions={canEdit ? <Button onClick={() => setPicking(true)}><Plus className="h-4 w-4" /> Neue Stückliste</Button> : undefined}
    />
  );

  return (
    <div className="space-y-4">
      {header}
      <BomExplainer />
      {!withBom.length && !selected ? (
        <EmptyState
          icon={<ListTree className="h-8 w-8" />}
          title="Noch keine Stückliste"
          body="Wähl ein Produkt und leg fest, welches Material hineingehört und welche Schritte nötig sind. Danach kannst du Fertigungsaufträge dafür anlegen."
          action={canEdit ? <Button onClick={() => setPicking(true)}><Plus className="h-4 w-4" /> Stückliste anlegen</Button> : undefined}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <aside className={cls("space-y-3", selected && "max-lg:hidden")}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Produkt suchen …" className="pl-9" />
            </div>
            <ul className="surface divide-y divide-(--border) overflow-hidden">
              {list.map((p) => {
                const c = costs.get(p.id);
                return (
                  <li key={p.id}>
                    <button onClick={() => select(p.id)} className={cls("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-(--surface-2)", p.id === selectedId && "bg-brand-50 dark:bg-brand-900/30")}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-(--text-muted)">
                          {p.components.length} Material · {p.operations.length} {p.operations.length === 1 ? "Schritt" : "Schritte"}
                          {c && c.minutes ? ` · ${fmtMinutes(c.minutes)}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs tabular text-(--text-muted)">{c ? fmtMoney(c.totalCents) : ""}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-(--text-muted) lg:hidden" />
                    </button>
                  </li>
                );
              })}
              {!list.length ? <li className="px-4 py-6 text-center text-sm text-(--text-muted)">Nichts gefunden</li> : null}
            </ul>
          </aside>
          <section className={cls("min-w-0", !selected && "max-lg:hidden")}>
            {selected ? (
              <SelectedBom product={selected} canEdit={canEdit} canOrder={production.canWrite} onBack={() => select(undefined)} onOrder={() => setOrdering(true)} />
            ) : (
              <div className="surface flex h-full min-h-60 items-center justify-center p-8 text-center text-sm text-(--text-muted)">Wähl links ein Produkt, um seine Stückliste zu sehen.</div>
            )}
          </section>
        </div>
      )}
      <PickProductDialog open={picking} onClose={() => setPicking(false)} onPick={(id) => { setPicking(false); select(id); }} />
      {selected ? <WorkOrderDialog open={ordering} onClose={() => setOrdering(false)} preset={{ productId: selected.id }} /> : null}
    </div>
  );
}

function SelectedBom({ product, canEdit, canOrder, onBack, onOrder }: { product: Product; canEdit: boolean; canOrder: boolean; onBack: () => void; onOrder: () => void }) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-(--text-muted) hover:text-(--text) lg:hidden">
        <ArrowLeft className="h-4 w-4" /> Alle Stücklisten
      </button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">{product.name}</h2>
          <p className="text-sm text-(--text-muted)">{[product.sku, product.priceCents ? `${fmtMoney(product.priceCents)} netto je ${product.unit}` : ""].filter(Boolean).join(" · ") || product.unit}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/produkte/${product.id}`}><Button variant="outline" size="sm"><ExternalLink className="h-4 w-4" /> Produkt</Button></Link>
          {canOrder && hasBomOrRouting(product) ? <Button size="sm" onClick={onOrder}><Factory className="h-4 w-4" /> Fertigungsauftrag</Button> : null}
        </div>
      </div>
      <BomEditor product={product} readOnly={!canEdit} />
    </div>
  );
}

function PickProductDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const levels = useStockLevels();
  const [id, setId] = useState<string | undefined>();
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Neue Stückliste" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button disabled={!id} onClick={() => id && onPick(id)}>Weiter</Button></>}>
      <div className="space-y-3">
        <Field label="Für welches Produkt?" hint="Fehlt es noch? Leg es zuerst unter Produkte an.">
          <ProductPicker value={id} onChange={(x) => setId(x)} levels={levels} filter={(p) => p.kind !== "service" && p.active && !hasBomOrRouting(p)} placeholder="Produkt wählen …" />
        </Field>
        <Link to="/produkte/neu" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline dark:text-brand-400"><Plus className="h-4 w-4" /> Neues Produkt anlegen</Link>
      </div>
    </Modal>
  );
}
