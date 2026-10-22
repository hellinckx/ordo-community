import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Copy, Factory, MoreHorizontal, PackageX, Power, SlidersHorizontal, Trash2 } from "lucide-react";
import { bomCost, ids, isBelowMinimum, isStockTracked, isWorkOrderOpen, nowIso, ProductSchema, roundQty, stockValue, whereUsed, type Product, type ProductKind, type StockMove, type VatRate } from "@ordo/core";
import { useContactMap, useList, useProfile } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { useIsInstalled } from "@/modules/registry";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Menu, MoneyInput, PageHeader, Select, Stat, Switch, Tabs, Textarea } from "@/components/ui";
import { ContactPicker } from "@/components/pickers";
import { cls, fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import { toast } from "@/state/toasts";
import { BomEditor, BomExplainer } from "@/modules/produktion/BomEditor";
import { useLabourRate } from "@/modules/produktion/shared";
import { fmtQty, Group, KIND_LABELS, KindBadge, MOVE_LABELS, QtyInput, Segmented, UNIT_SUGGESTIONS, useProductAccess, useProducts, useStockLevels, VAT_OPTIONS } from "./shared";
import { StockMoveDialog, type MoveMode } from "./StockMoveDialog";

type Tab = "stamm" | "bestand" | "stueckliste" | "verwendung";

const MASTER_KEYS = ["sku", "name", "description", "kind", "unit", "priceCents", "vatRate", "costCents", "category", "supplierId", "trackStock", "minStock", "location", "barcode", "active"] as const;
type Master = Pick<Product, (typeof MASTER_KEYS)[number]>;
const pickMaster = (p: Product): Master => Object.fromEntries(MASTER_KEYS.map((k) => [k, p[k]])) as Master;
const sameMaster = (a: Master, b: Master) => MASTER_KEYS.every((k) => (a[k] ?? "") === (b[k] ?? ""));

export default function ProductDetail() {
  const { id = "" } = useParams();
  const products = useProducts();
  const isNew = id === "neu";
  const product = isNew ? undefined : products.find((p) => p.id === id);
  if (!isNew && !product) {
    return (
      <div>
        <BackLink />
        <EmptyState title="Artikel nicht gefunden" body="Vielleicht wurde er gelöscht." action={<Link to="/produkte"><Button variant="outline">Zu den Produkten</Button></Link>} />
      </div>
    );
  }
  return <ProductEditor key={id} product={product} />;
}

function BackLink() {
  return (
    <Link to="/produkte" className="mb-3 inline-flex items-center gap-1 text-sm text-(--text-muted) hover:text-(--text)">
      <ArrowLeft className="h-4 w-4" /> Produkte
    </Link>
  );
}

function blankProduct(profileId: string, kind: ProductKind): Product {
  const now = nowIso();
  return ProductSchema.parse({ id: ids.product(), profileId, name: "", kind, unit: kind === "service" ? "Std" : "Stk", trackStock: kind !== "service", createdAt: now, updatedAt: now });
}

function ProductEditor({ product }: { product?: Product }) {
  const profile = useProfile();
  const navigate = useNavigate();
  const access = useProductAccess();
  const produktion = useIsInstalled("produktion");
  const [params, setParams] = useSearchParams();
  const initialKind = (params.get("art") as ProductKind) || "product";
  const [draft, setDraft] = useState<Master>(() => pickMaster(product ?? blankProduct(profile.id, KIND_LABELS[initialKind] ? initialKind : "product")));
  const base = useRef<Master | null>(product ? pickMaster(product) : null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readOnly = !access.canWrite;
  const allProducts = useProducts();
  const usedIn = useMemo(() => (product && confirmDelete ? whereUsed(product.id, allProducts) : []), [product, confirmDelete, allProducts]);

  // keep the form in sync with changes from elsewhere (e.g. cost taken over from the Stückliste) while nothing is edited
  useEffect(() => {
    if (!product) return;
    const next = pickMaster(product);
    setDraft((d) => (base.current && sameMaster(d, base.current) ? next : d));
    base.current = next;
  }, [product]);

  const dirty = product ? !sameMaster(draft, pickMaster(product)) : true;
  const set = (patch: Partial<Master>) => setDraft((d) => ({ ...d, ...patch }));
  const wantedTab: Tab = product ? ((params.get("tab") as Tab) || "stamm") : "stamm";
  const setTab = (t: Tab) => setParams(t === "stamm" ? {} : { tab: t }, { replace: true });

  const save = () => {
    if (!draft.name.trim()) return toast.warning("Gib dem Artikel einen Namen.");
    const store = requireStore();
    const clean: Master = { ...draft, name: draft.name.trim(), sku: draft.sku.trim(), category: draft.category.trim(), trackStock: draft.kind === "service" ? false : draft.trackStock };
    if (product) {
      store.update("products", product.id, (p) => ({ ...p, ...clean }), "product.update");
      toast.success("Gespeichert");
    } else {
      const now = nowIso();
      const p = ProductSchema.parse({ ...clean, id: ids.product(), profileId: profile.id, createdAt: now, updatedAt: now });
      store.insert("products", p, "product.create");
      toast.success("Artikel angelegt", p.name);
      navigate(`/produkte/${p.id}`, { replace: true });
    }
  };

  const duplicate = () => {
    if (!product) return;
    const now = nowIso();
    const copy: Product = { ...product, id: ids.product(), name: `${product.name} (Kopie)`, sku: "", barcode: "", createdAt: now, updatedAt: now, legacyRef: undefined, operations: product.operations.map((o) => ({ ...o, id: ids.line() })) };
    requireStore().insert("products", copy, "product.duplicate");
    toast.success("Kopie angelegt");
    navigate(`/produkte/${copy.id}`);
  };

  const toggleActive = () => {
    if (!product) return;
    requireStore().update("products", product.id, { active: !product.active }, "product.update");
    toast.success(product.active ? "Deaktiviert" : "Wieder aktiv", product.active ? "Der Artikel bleibt erhalten, taucht aber nicht mehr in Auswahllisten auf." : undefined);
  };

  const title = product ? product.name : draft.name || "Neues Produkt";
  const hasBom = product ? product.components.length > 0 || product.operations.length > 0 : false;
  const showBomTab = !!product && produktion && product.kind !== "service";
  const tabs: { id: Tab; label: string }[] = product
    ? [
        { id: "stamm", label: "Stammdaten" },
        ...(isStockTracked(product) ? [{ id: "bestand" as Tab, label: "Bestand & Bewegungen" }] : []),
        ...(showBomTab ? [{ id: "stueckliste" as Tab, label: "Stückliste & Arbeitsschritte" }] : []),
        ...(product.kind !== "service" ? [{ id: "verwendung" as Tab, label: "Verwendung" }] : []),
      ]
    : [];
  const tab: Tab = tabs.some((t) => t.id === wantedTab) ? wantedTab : "stamm";

  return (
    <div className="space-y-4">
      <BackLink />
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{title}{product && !product.active ? <Badge>inaktiv</Badge> : null}</span>}
        subtitle={product ? <span className="flex flex-wrap items-center gap-2"><KindBadge kind={product.kind} />{product.sku ? <span>{product.sku}</span> : null}{product.category ? <span>· {product.category}</span> : null}</span> : "Produkt, Material oder Leistung – Preise und Lager kannst du jederzeit ergänzen."}
        actions={
          <>
            {!readOnly && (dirty || !product) && tab === "stamm" ? (
              <>
                <Button variant="ghost" onClick={() => (product ? setDraft(pickMaster(product)) : navigate("/produkte"))}>{product ? "Verwerfen" : "Abbrechen"}</Button>
                <Button onClick={save}>{product ? "Speichern" : "Anlegen"}</Button>
              </>
            ) : null}
            {product && !readOnly ? (
              <Menu
                trigger={<Button variant="outline" size="icon" aria-label="Mehr"><MoreHorizontal className="h-4 w-4" /></Button>}
                items={[
                  { label: "Duplizieren", icon: <Copy className="h-4 w-4" />, onClick: duplicate },
                  { label: product.active ? "Deaktivieren" : "Wieder aktivieren", icon: <Power className="h-4 w-4" />, onClick: toggleActive },
                  ...(access.canAdmin ? [{ label: "Löschen", icon: <Trash2 className="h-4 w-4" />, danger: true, onClick: () => setConfirmDelete(true) }] : []),
                ]}
              />
            ) : null}
          </>
        }
      />
      {tabs.length > 1 ? (
        <div className="-mx-1 overflow-x-auto px-1">
          <Tabs value={tab} onChange={setTab} tabs={tabs} className="w-fit flex-nowrap!" />
        </div>
      ) : null}

      {tab === "stamm" ? <MasterForm draft={draft} set={set} product={product} readOnly={readOnly} hasBom={hasBom && produktion} /> : null}
      {tab === "bestand" && product ? <StockTab product={product} /> : null}
      {tab === "stueckliste" && product && showBomTab ? (
        <div className="space-y-4">
          <BomExplainer />
          <BomEditor product={product} readOnly={readOnly} />
        </div>
      ) : null}
      {tab === "verwendung" && product ? <UsageTab product={product} /> : null}

      {!readOnly && dirty && product && tab === "stamm" ? (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <div className="glass-strong flex items-center gap-2 rounded-2xl p-2 shadow-pop">
            <span className="px-2 text-sm text-(--text-muted)">Ungespeicherte Änderungen</span>
            <Button variant="ghost" size="sm" onClick={() => setDraft(pickMaster(product))}>Verwerfen</Button>
            <Button size="sm" onClick={save}>Speichern</Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title="Artikel löschen?"
        confirmLabel="Löschen"
        body={`${usedIn.length ? `Er steckt noch in der Stückliste von ${usedIn.map((u) => u.product.name).join(", ")}. ` : ""}Bisherige Lagerbewegungen bleiben im Journal. Wenn du ihn nur nicht mehr brauchst, kannst du ihn stattdessen deaktivieren.`}
        onConfirm={() => {
          if (!product) return;
          requireStore().softDelete("products", product.id, "product.delete");
          toast.success("Artikel gelöscht");
          navigate("/produkte");
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stammdaten                                                          */
/* ------------------------------------------------------------------ */

function MasterForm({ draft, set, product, readOnly, hasBom }: { draft: Master; set: (p: Partial<Master>) => void; product?: Product; readOnly: boolean; hasBom: boolean }) {
  const products = useProducts();
  const levels = useStockLevels();
  const rate = useLabourRate();
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")), [products]);
  const rolled = useMemo(() => (product && hasBom ? bomCost(product, products, { hourlyCostCents: rate.cents }) : null), [product, hasBom, products, rate.cents]);
  const gross = Math.round(draft.priceCents * (1 + draft.vatRate / 100));
  const profit = draft.priceCents - draft.costCents;
  const service = draft.kind === "service";
  const level = product ? (levels.get(product.id) ?? 0) : 0;

  return (
    <fieldset disabled={readOnly} className="grid min-w-0 gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card title="Allgemein">
          <div className="space-y-4">
            <Group label="Art" hint={draft.kind === "product" ? "Etwas, das du verkaufst – gekauft oder selbst hergestellt." : draft.kind === "material" ? "Was du einkaufst und verbrauchst, etwa für die Produktion." : "Arbeit, die du verrechnest – ohne Lagerbestand."}>
              <Segmented value={draft.kind} onChange={(k) => set({ kind: k, trackStock: k === "service" ? false : draft.kind === "service" ? true : draft.trackStock, unit: k === "service" && draft.unit === "Stk" ? "Std" : k !== "service" && draft.unit === "Std" ? "Stk" : draft.unit })} options={[{ id: "product", label: "Produkt" }, { id: "material", label: "Material" }, { id: "service", label: "Leistung" }]} />
            </Group>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" required className="sm:col-span-2">
                <Input value={draft.name} autoFocus={!product} onChange={(e) => set({ name: e.target.value })} placeholder={draft.kind === "service" ? "z. B. Designstunde" : draft.kind === "material" ? "z. B. Papier 300 g A1" : "z. B. Plakat A1"} />
              </Field>
              <Field label="Artikelnummer">
                <Input value={draft.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="z. B. P-1001" />
              </Field>
              <Field label="Einheit">
                <Input value={draft.unit} list="ordo-units" onChange={(e) => set({ unit: e.target.value })} />
                <datalist id="ordo-units">{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
              </Field>
              <Field label="Kategorie" className="sm:col-span-2">
                <Input value={draft.category} list="ordo-product-categories" onChange={(e) => set({ category: e.target.value })} placeholder="z. B. Drucksorten" />
                <datalist id="ordo-product-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field label="Beschreibung" hint="Erscheint als Text in Angeboten und Rechnungen." className="sm:col-span-2">
                <Textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} rows={3} />
              </Field>
            </div>
            <Switch checked={draft.active} onChange={(v) => set({ active: v })} label="Aktiv" hint="Inaktive Artikel bleiben erhalten, erscheinen aber nicht mehr in Auswahllisten." disabled={readOnly} />
          </div>
        </Card>

        <Card title="Preis & Kosten">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Verkaufspreis netto" hint={draft.priceCents ? `Brutto ${fmtMoney(gross)}` : undefined}>
              <MoneyInput value={draft.priceCents} onChange={(c) => set({ priceCents: c ?? 0 })} />
            </Field>
            <Field label="Umsatzsteuer">
              <Select value={draft.vatRate} onChange={(e) => set({ vatRate: Number(e.target.value) as VatRate })}>
                {VAT_OPTIONS.map((r) => <option key={r} value={r}>{r} %</option>)}
              </Select>
            </Field>
            <Field label={service ? "Kosten netto" : draft.kind === "material" ? "Einkaufspreis netto" : "Kosten netto"} hint={`je ${draft.unit || "Einheit"}`}>
              <MoneyInput value={draft.costCents} onChange={(c) => set({ costCents: c ?? 0 })} />
            </Field>
          </div>
          {rolled && rolled.totalCents !== draft.costCents ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-(--surface-2) px-3 py-2 text-sm">
              <span className="text-(--text-muted)">Herstellkosten laut Stückliste: <span className="tabular font-medium text-(--text)">{fmtMoney(rolled.totalCents)}</span></span>
              {!readOnly ? <Button size="sm" variant="outline" onClick={() => set({ costCents: rolled.totalCents })}>Übernehmen</Button> : null}
            </div>
          ) : null}
          {draft.priceCents || draft.costCents ? (
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-(--border) pt-4 text-sm">
              <div>
                <div className="text-xs text-(--text-muted)">Rohertrag je {draft.unit || "Einheit"}</div>
                <div className={cls("mt-0.5 tabular font-semibold", profit < 0 && "text-red-600")}>{fmtMoney(profit)}</div>
              </div>
              <div>
                <div className="text-xs text-(--text-muted)">Marge</div>
                <div className={cls("mt-0.5 tabular font-semibold", profit < 0 && "text-red-600")}>{draft.priceCents ? fmtPct(profit / draft.priceCents) : "–"}</div>
              </div>
              <div>
                <div className="text-xs text-(--text-muted)">Aufschlag</div>
                <div className="mt-0.5 tabular font-semibold">{draft.costCents ? fmtPct(profit / draft.costCents) : "–"}</div>
              </div>
            </div>
          ) : null}
          <div className="mt-4">
            <Field label="Lieferant">
              <ContactPicker value={draft.supplierId} onChange={(id) => set({ supplierId: id })} kind="vendor" placeholder="Lieferant (optional)" />
            </Field>
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card title="Lager">
          {service ? (
            <p className="text-sm text-(--text-muted)">Leistungen haben keinen Lagerbestand.</p>
          ) : (
            <div className="space-y-4">
              <Switch checked={draft.trackStock} onChange={(v) => set({ trackStock: v })} label="Bestand führen" hint="Ordo zählt Zu- und Abgänge mit." disabled={readOnly} />
              {draft.trackStock ? (
                <>
                  {product ? (
                    <div className="flex items-baseline justify-between rounded-xl bg-(--surface-2) px-3 py-2.5">
                      <span className="text-sm text-(--text-muted)">Bestand jetzt</span>
                      <span className={cls("tabular text-lg font-semibold", isBelowMinimum({ ...product, ...draft }, level) && "text-amber-700 dark:text-amber-400")}>{fmtQty(level)} <span className="text-sm font-normal text-(--text-muted)">{draft.unit}</span></span>
                    </div>
                  ) : null}
                  <Field label="Mindestbestand" hint="Darunter meldet sich Ordo mit einem Bestellvorschlag. 0 = keine Meldung.">
                    <QtyInput value={draft.minStock} onChange={(n) => set({ minStock: n })} suffix={draft.unit} />
                  </Field>
                  <Field label="Lagerort">
                    <Input value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder="z. B. Regal A2" />
                  </Field>
                  <Field label="Barcode / EAN">
                    <Input value={draft.barcode} onChange={(e) => set({ barcode: e.target.value })} inputMode="numeric" />
                  </Field>
                </>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */
/* Bestand & Bewegungen                                                */
/* ------------------------------------------------------------------ */

function StockTab({ product }: { product: Product }) {
  const moves = useList("stockMoves");
  const workOrders = useList("workOrders");
  const contacts = useContactMap();
  const levels = useStockLevels();
  const access = useProductAccess();
  const produktion = useIsInstalled("produktion");
  const [dialog, setDialog] = useState<MoveMode | null>(null);
  const [deleting, setDeleting] = useState<StockMove | null>(null);
  const level = levels.get(product.id) ?? 0;
  const value = stockValue([product], levels).totalCents;
  const low = isBelowMinimum(product, level);
  const woById = useMemo(() => new Map(workOrders.map((w) => [w.id, w])), [workOrders]);

  // newest first with the stock after each movement
  const rows = useMemo(() => {
    const mine = moves.filter((m) => m.productId === product.id).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    let run = 0;
    return mine.map((m) => ({ m, after: (run = roundQty(run + m.quantity)) })).reverse();
  }, [moves, product.id]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Bestand" value={<span>{fmtQty(level)} <span className="text-base font-normal text-(--text-muted)">{product.unit}</span></span>} sub={low ? <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> Unter Mindestbestand</span> : product.location ? `Lagerort ${product.location}` : undefined} />
        <Stat label="Lagerwert" value={fmtMoney(value)} sub={`zu ${fmtMoney(product.costCents)} je ${product.unit}`} />
        <Stat label="Mindestbestand" value={product.minStock ? <span>{fmtQty(product.minStock)} <span className="text-base font-normal text-(--text-muted)">{product.unit}</span></span> : "–"} sub={product.minStock ? (low ? `Es fehlen ${fmtQty(roundQty(product.minStock - level))} ${product.unit}` : "Alles im grünen Bereich") : "Keine Meldung eingestellt"} />
      </div>
      {access.canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog("receipt")}><ArrowDownToLine className="h-4 w-4" /> Zugang buchen</Button>
          <Button variant="outline" onClick={() => setDialog("issue")}><ArrowUpFromLine className="h-4 w-4" /> Abgang buchen</Button>
          <Button variant="outline" onClick={() => setDialog("adjustment")}><SlidersHorizontal className="h-4 w-4" /> Korrektur</Button>
        </div>
      ) : null}
      <Card title="Bewegungen" padded={false}>
        {!rows.length ? (
          <EmptyState bare icon={<PackageX className="h-7 w-7" />} title="Noch keine Bewegungen" body="Buch den Anfangsbestand als Zugang – danach zählt Ordo jede Bewegung mit." />
        ) : (
          <ul className="divide-y divide-(--border)">
            {rows.map(({ m, after }) => {
              const wo = m.workOrderId ? woById.get(m.workOrderId) : undefined;
              return (
                <li key={m.id} className="group flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="w-20 shrink-0 tabular text-(--text-muted)">{fmtDate(m.date)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={m.quantity >= 0 ? "success" : "neutral"}>{MOVE_LABELS[m.kind]}</Badge>
                      {wo && produktion ? <Link to={`/produktion/${wo.id}`} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline dark:text-brand-400"><Factory className="h-3 w-3" />{wo.number}</Link> : null}
                    </span>
                    {m.note || m.contactId ? <span className="mt-0.5 block truncate text-xs text-(--text-muted)">{[m.contactId ? contacts.get(m.contactId)?.name : "", m.note].filter(Boolean).join(" · ")}</span> : null}
                  </span>
                  <span className={cls("w-20 shrink-0 text-right tabular font-medium", m.quantity >= 0 ? "text-emerald-700 dark:text-emerald-400" : "")}>{m.quantity >= 0 ? "+" : "−"}{fmtQty(Math.abs(m.quantity))}</span>
                  <span className="hidden w-20 shrink-0 text-right tabular text-(--text-muted) sm:block">{fmtQty(after)}</span>
                  {access.canAdmin ? (
                    <button onClick={() => setDeleting(m)} className="rounded-lg p-1.5 text-(--text-muted) opacity-60 hover:bg-(--surface-2) hover:text-red-600 group-hover:opacity-100" aria-label="Bewegung löschen"><Trash2 className="h-4 w-4" /></button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <StockMoveDialog open={!!dialog} onClose={() => setDialog(null)} productId={product.id} mode={dialog ?? "receipt"} lockProduct />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        danger
        title="Bewegung löschen?"
        confirmLabel="Löschen"
        body={deleting ? `${MOVE_LABELS[deleting.kind]} vom ${fmtDate(deleting.date)} über ${fmtQty(deleting.quantity)} ${product.unit}. Der Bestand ändert sich entsprechend.${deleting.workOrderId ? " Die Bewegung gehört zu einem Fertigungsauftrag – dort bleibt sie als gebucht markiert." : ""}` : undefined}
        onConfirm={() => {
          if (!deleting) return;
          requireStore().softDelete("stockMoves", deleting.id, "stock.delete");
          toast.success("Bewegung gelöscht");
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Verwendung                                                          */
/* ------------------------------------------------------------------ */

function UsageTab({ product }: { product: Product }) {
  const products = useProducts();
  const workOrders = useList("workOrders");
  const produktion = useIsInstalled("produktion");
  const used = useMemo(() => whereUsed(product.id, products), [product.id, products]);
  const usedIds = useMemo(() => new Map(used.map((u) => [u.product.id, u.quantity])), [used]);
  const openOrders = useMemo(
    () => workOrders.filter((w) => isWorkOrderOpen(w) && !w.materialsBooked && usedIds.has(w.productId)).map((w) => ({ w, need: roundQty((usedIds.get(w.productId) ?? 0) * w.quantity) })),
    [workOrders, usedIds],
  );
  if (!used.length) {
    return <EmptyState icon={<PackageX className="h-8 w-8" />} title="Wird nirgends verwendet" body={produktion ? "Sobald dieser Artikel in der Stückliste eines Produkts steht, siehst du es hier." : "Mit dem Modul Produktion kannst du festlegen, in welchen Produkten dieser Artikel steckt."} />;
  }
  return (
    <div className="space-y-5">
      <Card title="Steckt in" padded={false}>
        <ul className="divide-y divide-(--border)">
          {used.map((u) => (
            <li key={u.product.id}>
              <Link to={`/produkte/${u.product.id}?tab=stueckliste`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-(--surface-2)">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{u.product.name}</span>
                  <span className="block truncate text-xs text-(--text-muted)">{[KIND_LABELS[u.product.kind], u.product.sku].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 tabular text-(--text-muted)">{fmtQty(u.quantity)} {product.unit} je {u.product.unit}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      {produktion && openOrders.length ? (
        <Card title="Gebraucht in offenen Fertigungsaufträgen" padded={false}>
          <ul className="divide-y divide-(--border)">
            {openOrders.map(({ w, need }) => (
              <li key={w.id}>
                <Link to={`/produktion/${w.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-(--surface-2)">
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{w.number}</span> <span className="text-(--text-muted)">· {products.find((p) => p.id === w.productId)?.name} × {fmtQty(w.quantity)}</span></span>
                  <span className="shrink-0 tabular">{fmtQty(need)} {product.unit}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
