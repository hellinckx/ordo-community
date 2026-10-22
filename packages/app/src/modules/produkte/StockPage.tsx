import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AlertTriangle, ArrowDownToLine, Boxes, ClipboardCheck, Download, Factory, History, Plus, RotateCcw, Search, ShoppingCart } from "lucide-react";
import { fromCents, inventoryAdjustments, inventoryDifferences, isBelowMinimum, isStockTracked, newStockMove, reorderSuggestions, stockLevels, stockValue, todayIso, workOrderIncoming, type ProductKind, type ReorderSuggestion, type StockMoveKind } from "@ordo/core";
import { useContactMap, useList, useProfile } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { useIsInstalled } from "@/modules/registry";
import { Badge, Button, Card, ConfirmDialog, DateInput, EmptyState, Field, Input, PageHeader, Select, Stat, Tabs } from "@/components/ui";
import { cls, fmtDate, fmtMoney } from "@/lib/format";
import { toast } from "@/state/toasts";
import { csvQty, fmtQty, isoAddDays, KIND_LABELS, MOVE_LABELS, ProductPicker, QtyInput, saveCsv, StockAmount, useProductAccess, useProducts, useStockLevels } from "./shared";
import { StockMoveDialog } from "./StockMoveDialog";

type Tab = "bestand" | "vorschlaege" | "bewegungen" | "inventur";

export default function StockPage() {
  const [params, setParams] = useSearchParams();
  const access = useProductAccess();
  const products = useProducts();
  const levels = useStockLevels();
  const workOrders = useList("workOrders");
  const produktion = useIsInstalled("produktion");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveFor, setMoveFor] = useState<{ productId?: string; quantity?: number }>({});
  const tab = ((params.get("tab") as Tab) || "bestand") satisfies Tab;
  const setTab = (t: Tab) => setParams(t === "bestand" ? {} : { tab: t }, { replace: true });

  // "+ Neu → Lagerbewegung" lands here with ?neu=1
  useEffect(() => {
    if (params.get("neu") !== "1") return;
    if (access.canWrite) {
      setMoveFor({});
      setMoveOpen(true);
    }
    const next = new URLSearchParams(params);
    next.delete("neu");
    setParams(next, { replace: true });
  }, [params, setParams, access.canWrite]);

  const tracked = useMemo(() => products.filter(isStockTracked), [products]);
  const incoming = useMemo(() => (produktion ? workOrderIncoming(workOrders) : new Map<string, number>()), [produktion, workOrders]);
  const suggestions = useMemo(() => reorderSuggestions(products, levels, { incoming }), [products, levels, incoming]);
  const book = (productId?: string, quantity?: number) => {
    setMoveFor({ productId, quantity });
    setMoveOpen(true);
  };

  if (!access.canRead) return <><PageHeader title="Lager" /><EmptyState title="Kein Zugriff" body="Deine Rolle sieht Produkte & Lager nicht." /></>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Lager"
        subtitle="Was da ist, was es wert ist und was bald nachbestellt werden sollte."
        actions={access.canWrite && tracked.length ? <Button onClick={() => book()}><Plus className="h-4 w-4" /> Lagerbewegung</Button> : undefined}
      />
      {!tracked.length ? (
        <EmptyState
          icon={<Boxes className="h-8 w-8" />}
          title="Noch nichts im Lager"
          body="Leg Produkte oder Material mit „Bestand führen“ an und buch den Anfangsbestand als Zugang. Danach zählt Ordo jede Bewegung mit."
          action={access.canWrite ? <Link to="/produkte/neu?art=material"><Button><Plus className="h-4 w-4" /> Material anlegen</Button></Link> : undefined}
        />
      ) : (
        <>
          <div className="-mx-1 overflow-x-auto px-1">
            <Tabs
              value={tab}
              onChange={setTab}
              className="w-fit flex-nowrap!"
              tabs={[
                { id: "bestand", label: "Bestand" },
                { id: "vorschlaege", label: "Bestellvorschläge", badge: suggestions.length ? <Badge tone="warning">{suggestions.length}</Badge> : undefined },
                { id: "bewegungen", label: "Bewegungen" },
                ...(access.canWrite ? [{ id: "inventur" as Tab, label: "Inventur" }] : []),
              ]}
            />
          </div>
          {tab === "bestand" ? <StockOverview onBook={book} /> : null}
          {tab === "vorschlaege" ? <ReorderList suggestions={suggestions} onBook={book} /> : null}
          {tab === "bewegungen" ? <MovesJournal /> : null}
          {tab === "inventur" && access.canWrite ? <Inventory /> : null}
        </>
      )}
      <StockMoveDialog open={moveOpen} onClose={() => setMoveOpen(false)} productId={moveFor.productId} quantity={moveFor.quantity} mode="receipt" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bestand                                                             */
/* ------------------------------------------------------------------ */

function StockOverview({ onBook }: { onBook: (productId?: string) => void }) {
  const products = useProducts();
  const levels = useStockLevels();
  const moves = useList("stockMoves");
  const access = useProductAccess();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | ProductKind>("all");
  const [onlyLow, setOnlyLow] = useState(false);
  const tracked = useMemo(() => products.filter((p) => isStockTracked(p) && p.active), [products]);
  const value = useMemo(() => stockValue(tracked, levels), [tracked, levels]);
  const low = useMemo(() => tracked.filter((p) => isBelowMinimum(p, levels.get(p.id) ?? 0)), [tracked, levels]);
  const since = isoAddDays(todayIso(), -30);
  const recentMoves = useMemo(() => moves.filter((m) => m.date >= since).length, [moves, since]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tracked.filter((p) => (kind === "all" || p.kind === kind) && (!onlyLow || isBelowMinimum(p, levels.get(p.id) ?? 0)) && (!s || `${p.name} ${p.sku} ${p.location} ${p.barcode}`.toLowerCase().includes(s)));
  }, [tracked, q, kind, onlyLow, levels]);

  const exportCsv = () =>
    saveCsv(
      `Ordo_Lagerbestand_${todayIso()}.csv`,
      ["Artikelnummer", "Artikel", "Art", "Lagerort", "Bestand", "Einheit", "Mindestbestand", "Kosten je Einheit", "Lagerwert", "Unter Minimum"],
      rows.map((p) => {
        const lv = levels.get(p.id) ?? 0;
        return [p.sku, p.name, KIND_LABELS[p.kind], p.location, csvQty(lv), p.unit, csvQty(p.minStock), fromCents(p.costCents), fromCents(value.byProduct.get(p.id) ?? 0), isBelowMinimum(p, lv) ? "ja" : ""];
      }),
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Lagerwert" value={fmtMoney(value.totalCents)} sub="zu Einkaufs- bzw. Herstellkosten" />
        <Stat label="Artikel im Lager" value={tracked.filter((p) => (levels.get(p.id) ?? 0) > 0).length} sub={`von ${tracked.length} mit Bestandsführung`} />
        <Stat label="Unter Mindestbestand" value={<span className={low.length ? "text-amber-700 dark:text-amber-400" : ""}>{low.length}</span>} sub={low.length ? "siehe Bestellvorschläge" : "alles ausreichend da"} />
        <Stat label="Bewegungen" value={recentMoves} sub="in den letzten 30 Tagen" />
      </div>
      <div className="surface flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artikel, Nummer oder Lagerort …" className="pl-9" />
        </div>
        <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-36">
          <option value="all">Alle Arten</option>
          <option value="product">Produkte</option>
          <option value="material">Material</option>
        </Select>
        {low.length ? (
          <button onClick={() => setOnlyLow((v) => !v)} className={cls("inline-flex h-10 items-center gap-1.5 rounded-[11px] border px-3 text-sm", onlyLow ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" : "border-(--border)")}>
            <AlertTriangle className="h-4 w-4" /> Unter Minimum
          </button>
        ) : null}
        <Button variant="outline" onClick={() => void exportCsv()} disabled={!rows.length}><Download className="h-4 w-4" /> CSV</Button>
      </div>
      {!rows.length ? (
        <EmptyState title="Nichts gefunden" body="Passe Suche oder Filter an." />
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
              <tr>
                <th className="px-4 py-2">Artikel</th>
                <th className="hidden px-3 py-2 md:table-cell">Lagerort</th>
                <th className="px-3 py-2 text-right">Bestand</th>
                <th className="px-3 py-2 text-right">Minimum</th>
                <th className="px-3 py-2 text-right">Wert</th>
                {access.canWrite ? <th className="w-10 px-2 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-(--border)">
              {rows.map((p) => {
                const lv = levels.get(p.id) ?? 0;
                const isLow = isBelowMinimum(p, lv);
                return (
                  <tr key={p.id} onClick={() => navigate(`/produkte/${p.id}?tab=bestand`)} className={cls("cursor-pointer hover:bg-(--surface-2)", isLow && "bg-amber-50/60 dark:bg-amber-900/10")}>
                    <td className="max-w-0 px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        {isLow ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" /> : null}
                        <span className="truncate font-medium">{p.name}</span>
                      </div>
                      <div className="truncate text-xs text-(--text-muted)">{[KIND_LABELS[p.kind], p.sku].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="hidden px-3 py-2.5 text-(--text-muted) md:table-cell">{p.location || "–"}</td>
                    <td className="px-3 py-2.5 text-right"><StockAmount product={p} level={lv} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular text-(--text-muted)">{p.minStock ? fmtQty(p.minStock) : "–"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">{fmtMoney(value.byProduct.get(p.id) ?? 0)}</td>
                    {access.canWrite ? (
                      <td className="px-2 py-2.5">
                        <button onClick={(e) => { e.stopPropagation(); onBook(p.id); }} className="rounded-lg p-1.5 text-(--text-muted) hover:bg-(--surface) hover:text-(--text)" aria-label="Bewegung buchen" title="Bewegung buchen"><Plus className="h-4 w-4" /></button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-(--border) font-semibold">
                <td className="px-4 py-2.5" colSpan={2}>Summe</td>
                <td className="hidden md:table-cell" />
                <td />
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">{fmtMoney(rows.reduce((s, p) => s + (value.byProduct.get(p.id) ?? 0), 0))}</td>
                {access.canWrite ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bestellvorschläge                                                   */
/* ------------------------------------------------------------------ */

function ReorderList({ suggestions, onBook }: { suggestions: ReorderSuggestion[]; onBook: (productId?: string, quantity?: number) => void }) {
  const contacts = useContactMap();
  const access = useProductAccess();
  const produktion = useIsInstalled("produktion");
  const navigate = useNavigate();
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; rows: ReorderSuggestion[] }>();
    for (const s of suggestions) {
      const key = s.make && produktion ? "__make" : (s.supplierId ?? "__none");
      const title = key === "__make" ? "Selbst fertigen" : key === "__none" ? "Ohne Lieferant" : (contacts.get(key)?.name ?? "Unbekannter Lieferant");
      const g = m.get(key) ?? { title, rows: [] };
      g.rows.push(s);
      m.set(key, g);
    }
    return [...m.entries()].sort(([a], [b]) => (a.startsWith("__") ? 1 : 0) - (b.startsWith("__") ? 1 : 0)).map(([, g]) => g);
  }, [suggestions, contacts, produktion]);
  const total = suggestions.filter((s) => !(s.make && produktion)).reduce((s, x) => s + x.costCents, 0);

  const exportCsv = () =>
    saveCsv(
      `Ordo_Bestellvorschlaege_${todayIso()}.csv`,
      ["Lieferant", "Artikelnummer", "Artikel", "Bestand", "Mindestbestand", "In Fertigung", "Vorschlag", "Einheit", "Kosten je Einheit", "Kosten gesamt"],
      suggestions.map((s) => [s.make && produktion ? "Selbst fertigen" : s.supplierId ? (contacts.get(s.supplierId)?.name ?? "") : "", s.product.sku, s.product.name, csvQty(s.quantity), csvQty(s.minStock), csvQty(s.incoming), csvQty(s.suggested), s.product.unit, fromCents(s.product.costCents), fromCents(s.costCents)]),
    );

  if (!suggestions.length) {
    return <EmptyState icon={<ShoppingCart className="h-8 w-8" />} title="Nichts nachzubestellen" body="Alle Artikel mit Mindestbestand sind ausreichend da. Sobald einer darunter fällt, steht er hier – mit einer Menge, die bis zum doppelten Mindestbestand auffüllt." />;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-(--text-muted)">Diese Artikel liegen unter ihrem Mindestbestand. Der Vorschlag füllt bis zum doppelten Mindestbestand auf{produktion ? "; was gerade gefertigt wird, ist schon eingerechnet" : ""}.</p>
        <div className="flex items-center gap-3">
          {total ? <span className="text-sm text-(--text-muted)">Einkauf gesamt <span className="tabular font-semibold text-(--text)">{fmtMoney(total)}</span></span> : null}
          <Button variant="outline" onClick={() => void exportCsv()}><Download className="h-4 w-4" /> CSV</Button>
        </div>
      </div>
      {groups.map((g) => (
        <Card key={g.title} title={g.title} padded={false}>
          <ul className="divide-y divide-(--border)">
            {g.rows.map((s) => (
              <li key={s.productId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
                <Link to={`/produkte/${s.productId}?tab=bestand`} className="min-w-0 flex-1 basis-48">
                  <span className="block truncate font-medium hover:underline">{s.product.name}</span>
                  <span className="block truncate text-xs text-(--text-muted)">
                    Bestand <span className="text-amber-700 dark:text-amber-400">{fmtQty(s.quantity)}</span> · Minimum {fmtQty(s.minStock)} {s.product.unit}
                    {s.incoming ? ` · ${fmtQty(s.incoming)} in Fertigung` : ""}
                  </span>
                </Link>
                <span className="text-right">
                  <span className="block tabular font-semibold">{fmtQty(s.suggested)} {s.product.unit}</span>
                  <span className="block text-xs tabular text-(--text-muted)">{s.costCents ? fmtMoney(s.costCents) : "–"}</span>
                </span>
                {access.canWrite ? (
                  s.make && produktion ? (
                    <Button size="sm" variant="outline" onClick={() => navigate(`/produktion?neu=1&produkt=${s.productId}&menge=${s.suggested}`)}><Factory className="h-4 w-4" /> Fertigen</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => onBook(s.productId, s.suggested)}><ArrowDownToLine className="h-4 w-4" /> Zugang</Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bewegungen                                                          */
/* ------------------------------------------------------------------ */

type Period = "month" | "lastMonth" | "30" | "year" | "all" | "custom";

function periodRange(p: Period, from?: string, to?: string): { from?: string; to?: string } {
  const today = todayIso();
  const y = today.slice(0, 4);
  const m = today.slice(0, 7);
  if (p === "month") return { from: `${m}-01`, to: today };
  if (p === "lastMonth") {
    const first = isoAddDays(`${m}-01`, -1).slice(0, 7);
    return { from: `${first}-01`, to: isoAddDays(`${m}-01`, -1) };
  }
  if (p === "30") return { from: isoAddDays(today, -30), to: today };
  if (p === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (p === "custom") return { from, to };
  return {};
}

function MovesJournal() {
  const moves = useList("stockMoves");
  const products = useProducts();
  const levels = useStockLevels();
  const contacts = useContactMap();
  const workOrders = useList("workOrders");
  const produktion = useIsInstalled("produktion");
  const [period, setPeriod] = useState<Period>("30");
  const [from, setFrom] = useState<string | undefined>(isoAddDays(todayIso(), -30));
  const [to, setTo] = useState<string | undefined>(todayIso());
  const [kind, setKind] = useState<"all" | StockMoveKind>("all");
  const [productId, setProductId] = useState<string | undefined>();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const woById = useMemo(() => new Map(workOrders.map((w) => [w.id, w])), [workOrders]);
  const range = periodRange(period, from, to);
  const rows = useMemo(
    () =>
      moves
        .filter((m) => (!range.from || m.date >= range.from) && (!range.to || m.date <= range.to) && (kind === "all" || m.kind === kind) && (!productId || m.productId === productId))
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [moves, range.from, range.to, kind, productId],
  );
  const inValue = rows.filter((m) => m.quantity > 0).reduce((s, m) => s + Math.round(m.quantity * (m.unitCostCents ?? byId.get(m.productId)?.costCents ?? 0)), 0);
  const outValue = rows.filter((m) => m.quantity < 0).reduce((s, m) => s + Math.round(-m.quantity * (m.unitCostCents ?? byId.get(m.productId)?.costCents ?? 0)), 0);

  const exportCsv = () =>
    saveCsv(
      `Ordo_Lagerbewegungen_${range.from ?? "alle"}_${range.to ?? todayIso()}.csv`,
      ["Datum", "Artikelnummer", "Artikel", "Art", "Menge", "Einheit", "Einzelkosten", "Wert", "Kontakt", "Fertigungsauftrag", "Notiz"],
      [...rows].reverse().map((m) => {
        const p = byId.get(m.productId);
        const unit = m.unitCostCents ?? p?.costCents ?? 0;
        return [m.date, p?.sku ?? "", p?.name ?? "Gelöschter Artikel", MOVE_LABELS[m.kind], csvQty(m.quantity), p?.unit ?? "", fromCents(unit), fromCents(Math.round(m.quantity * unit)), m.contactId ? (contacts.get(m.contactId)?.name ?? "") : "", m.workOrderId ? (woById.get(m.workOrderId)?.number ?? "") : "", m.note];
      }),
    );

  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center gap-2 p-3">
        <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="w-44">
          <option value="30">Letzte 30 Tage</option>
          <option value="month">Dieser Monat</option>
          <option value="lastMonth">Letzter Monat</option>
          <option value="year">Dieses Jahr</option>
          <option value="all">Alles</option>
          <option value="custom">Zeitraum …</option>
        </Select>
        {period === "custom" ? (
          <>
            <DateInput value={from} onChange={setFrom} className="w-40" aria-label="Von" />
            <DateInput value={to} onChange={setTo} className="w-40" aria-label="Bis" />
          </>
        ) : null}
        <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-44">
          <option value="all">Alle Arten</option>
          {(Object.keys(MOVE_LABELS) as StockMoveKind[]).filter((k) => produktion || (k !== "production_in" && k !== "production_out")).map((k) => <option key={k} value={k}>{MOVE_LABELS[k]}</option>)}
        </Select>
        <ProductPicker value={productId} onChange={(id) => setProductId(id)} filter={isStockTracked} levels={levels} placeholder="Alle Artikel" className="min-w-48 flex-1" />
        <Button variant="outline" onClick={() => void exportCsv()} disabled={!rows.length}><Download className="h-4 w-4" /> CSV</Button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-(--text-muted)">
        <span>{rows.length} Bewegungen</span>
        <span>Zugänge <span className="tabular font-medium text-(--text)">{fmtMoney(inValue)}</span></span>
        <span>Abgänge <span className="tabular font-medium text-(--text)">{fmtMoney(outValue)}</span></span>
      </div>
      {!rows.length ? (
        <EmptyState icon={<History className="h-8 w-8" />} title="Keine Bewegungen" body="Im gewählten Zeitraum wurde nichts gebucht. Probier einen längeren Zeitraum." />
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
              <tr>
                <th className="px-4 py-2">Datum</th>
                <th className="px-3 py-2">Artikel</th>
                <th className="px-3 py-2">Art</th>
                <th className="px-3 py-2 text-right">Menge</th>
                <th className="hidden px-3 py-2 text-right lg:table-cell">Wert</th>
                <th className="hidden px-4 py-2 md:table-cell">Notiz</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--border)">
              {rows.map((m) => {
                const p = byId.get(m.productId);
                const wo = m.workOrderId ? woById.get(m.workOrderId) : undefined;
                const unit = m.unitCostCents ?? p?.costCents ?? 0;
                return (
                  <tr key={m.id} className="hover:bg-(--surface-2)">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular">{fmtDate(m.date)}</td>
                    <td className="max-w-0 px-3 py-2.5">
                      {p ? <Link to={`/produkte/${p.id}?tab=bestand`} className="block truncate font-medium hover:underline">{p.name}</Link> : <span className="text-(--text-muted)">Gelöschter Artikel</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5"><Badge tone={m.quantity >= 0 ? "success" : "neutral"}>{MOVE_LABELS[m.kind]}</Badge></td>
                    <td className={cls("whitespace-nowrap px-3 py-2.5 text-right tabular font-medium", m.quantity >= 0 && "text-emerald-700 dark:text-emerald-400")}>{m.quantity >= 0 ? "+" : "−"}{fmtQty(Math.abs(m.quantity))} <span className="font-normal text-(--text-muted)">{p?.unit}</span></td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular text-(--text-muted) lg:table-cell">{fmtMoney(Math.round(Math.abs(m.quantity) * unit))}</td>
                    <td className="hidden max-w-0 px-4 py-2.5 text-(--text-muted) md:table-cell">
                      <span className="block truncate">
                        {wo && produktion ? <Link to={`/produktion/${wo.id}`} className="mr-1 text-brand-700 hover:underline dark:text-brand-400">{wo.number}</Link> : null}
                        {[m.contactId ? contacts.get(m.contactId)?.name : "", m.note].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inventur                                                            */
/* ------------------------------------------------------------------ */

function Inventory() {
  const profile = useProfile();
  const products = useProducts();
  const moves = useList("stockMoves");
  const storageKey = `ordo.inventur.${profile.id}`;
  const [date, setDate] = useState(todayIso());
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  });
  const [confirm, setConfirm] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(counts));
    } catch {
      /* private mode – counts stay in memory */
    }
  }, [counts, storageKey]);

  const tracked = useMemo(() => products.filter((p) => isStockTracked(p) && p.active).sort((a, b) => (a.location || "~").localeCompare(b.location || "~", "de") || a.name.localeCompare(b.name, "de")), [products]);
  const levels = useMemo(() => stockLevels(products, moves, { until: date }), [products, moves, date]);
  const countMap = useMemo(() => new Map(Object.entries(counts).filter(([, v]) => Number.isFinite(v))), [counts]);
  const diffs = useMemo(() => inventoryDifferences(products, levels, countMap), [products, levels, countMap]);
  const diffById = useMemo(() => new Map(diffs.map((d) => [d.productId, d])), [diffs]);
  const changed = diffs.filter((d) => Math.abs(d.difference) > 1e-9);
  const valueDiff = changed.reduce((s, d) => s + d.valueCents, 0);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tracked.filter((p) => !s || `${p.name} ${p.sku} ${p.location} ${p.barcode}`.toLowerCase().includes(s));
  }, [tracked, q]);

  const setCount = (id: string, n: number | undefined) =>
    setCounts((c) => {
      const next = { ...c };
      if (n === undefined) delete next[id];
      else next[id] = n;
      return next;
    });

  const book = () => {
    const drafts = inventoryAdjustments(products, levels, countMap, { date });
    const created = drafts.map((d) => newStockMove(profile.id, d));
    requireStore().mutate((v) => {
      v.stockMoves = [...v.stockMoves, ...created];
    }, { audit: { action: "stock.count", entity: "stockMoves", details: `${created.length} Differenzen` } });
    setCounts({});
    toast.success("Inventur gebucht", created.length ? `${created.length} ${created.length === 1 ? "Differenz" : "Differenzen"} ausgeglichen.` : "Alles hat gestimmt.");
  };

  const exportSheet = () =>
    saveCsv(
      `Ordo_Zaehlliste_${date}.csv`,
      ["Lagerort", "Artikelnummer", "Artikel", "Einheit", "Laut Ordo", "Gezählt", "Differenz"],
      tracked.map((p) => {
        const d = diffById.get(p.id);
        return [p.location, p.sku, p.name, p.unit, csvQty(levels.get(p.id) ?? 0), d ? csvQty(d.counted) : "", d ? csvQty(d.difference) : ""];
      }),
    );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl bg-(--surface-2) px-4 py-3 text-sm text-(--text-muted)">
        <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />
        <p>Bei der <span className="font-medium text-(--text)">Inventur</span> zählst du, was wirklich im Lager liegt. Trag die gezählte Menge ein – leere Felder gelten als nicht gezählt. Am Ende bucht Ordo die Differenzen als Inventur-Bewegungen. Deine Zahlen bleiben auf diesem Gerät gespeichert, bis du buchst.</p>
      </div>
      <div className="surface flex flex-wrap items-end gap-2 p-3">
        <Field label="Stichtag" className="w-40">
          <DateInput value={date} max={todayIso()} onChange={(d) => setDate(d ?? todayIso())} />
        </Field>
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artikel, Lagerort oder Barcode …" className="pl-9" />
        </div>
        <Button variant="outline" onClick={() => void exportSheet()}><Download className="h-4 w-4" /> Zählliste</Button>
        {Object.keys(counts).length ? <Button variant="ghost" onClick={() => setConfirmReset(true)}><RotateCcw className="h-4 w-4" /> Zurücksetzen</Button> : null}
      </div>
      <div className="surface overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
            <tr>
              <th className="px-4 py-2">Artikel</th>
              <th className="px-3 py-2 text-right">Laut Ordo</th>
              <th className="w-36 px-3 py-2 text-right">Gezählt</th>
              <th className="px-4 py-2 text-right">Differenz</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {rows.map((p) => {
              const d = diffById.get(p.id);
              const diff = d?.difference ?? 0;
              return (
                <tr key={p.id} className={cls(d && Math.abs(diff) > 1e-9 && "bg-amber-50/60 dark:bg-amber-900/10")}>
                  <td className="max-w-0 px-4 py-2">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="truncate text-xs text-(--text-muted)">{[p.location, p.sku].filter(Boolean).join(" · ") || KIND_LABELS[p.kind]}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular text-(--text-muted)">{fmtQty(levels.get(p.id) ?? 0)} {p.unit}</td>
                  <td className="px-3 py-2">
                    <QtyInput value={counts[p.id]} onChange={(n) => setCount(p.id, n)} onBlur={(e) => { if (!e.target.value.trim()) setCount(p.id, undefined); }} suffix={p.unit} placeholder="–" />
                  </td>
                  <td className={cls("whitespace-nowrap px-4 py-2 text-right tabular font-medium", diff > 0 && "text-emerald-700 dark:text-emerald-400", diff < 0 && "text-red-600 dark:text-red-400")}>
                    {d ? (Math.abs(diff) > 1e-9 ? `${diff > 0 ? "+" : "−"}${fmtQty(Math.abs(diff))}` : "stimmt") : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sticky bottom-3 z-10 flex justify-end">
        <div className="glass-strong flex flex-wrap items-center gap-3 rounded-2xl p-2 pl-4 shadow-pop">
          <span className="text-sm text-(--text-muted)">
            {diffs.length} von {tracked.length} gezählt
            {changed.length ? <> · {changed.length} {changed.length === 1 ? "Differenz" : "Differenzen"} ({valueDiff >= 0 ? "+" : "−"}{fmtMoney(Math.abs(valueDiff))})</> : null}
          </span>
          <Button size="sm" disabled={!diffs.length} onClick={() => setConfirm(true)}>Inventur buchen</Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Inventur buchen?"
        confirmLabel="Buchen"
        body={
          changed.length ? (
            <div className="space-y-2">
              <p>Ordo bucht {changed.length} {changed.length === 1 ? "Differenz" : "Differenzen"} zum {fmtDate(date)}. Der Lagerwert ändert sich um {valueDiff >= 0 ? "+" : "−"}{fmtMoney(Math.abs(valueDiff))}.</p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
                {changed.map((d) => {
                  const p = products.find((x) => x.id === d.productId);
                  return <li key={d.productId} className="flex justify-between gap-2"><span className="truncate">{p?.name}</span><span className="tabular">{d.difference > 0 ? "+" : "−"}{fmtQty(Math.abs(d.difference))} {p?.unit}</span></li>;
                })}
              </ul>
            </div>
          ) : (
            "Alle gezählten Mengen stimmen mit Ordo überein. Es wird nichts gebucht, die Zählung wird abgeschlossen."
          )
        }
        onConfirm={book}
      />
      <ConfirmDialog open={confirmReset} onClose={() => setConfirmReset(false)} danger title="Zählung verwerfen?" confirmLabel="Verwerfen" body="Alle eingetragenen Mengen werden gelöscht." onConfirm={() => setCounts({})} />
    </div>
  );
}
