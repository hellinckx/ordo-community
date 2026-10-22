import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AlertTriangle, Download, MoreHorizontal, PackagePlus, PackageSearch, Search } from "lucide-react";
import { fromCents, isBelowMinimum, isStockTracked, type ProductKind } from "@ordo/core";
import { Badge, Button, EmptyState, Input, Menu, PageHeader, Select, Tabs } from "@/components/ui";
import { useContactMap } from "@/state/hooks";
import { cls, fmtMoney } from "@/lib/format";
import { csvQty, KIND_LABELS, KindBadge, saveCsv, StockAmount, useProductAccess, useProducts, useStockLevels } from "./shared";

type KindFilter = "all" | ProductKind;
type ActiveFilter = "active" | "inactive" | "all";

export default function ProductsPage() {
  const products = useProducts();
  const levels = useStockLevels();
  const contacts = useContactMap();
  const access = useProductAccess();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>((params.get("art") as KindFilter) || "all");
  const [category, setCategory] = useState("all");
  const [active, setActive] = useState<ActiveFilter>("active");
  const [onlyLow, setOnlyLow] = useState(params.get("filter") === "unter-minimum");

  // "+ Neu → Neues Produkt" lands here with ?neu=1
  useEffect(() => {
    if (params.get("neu") !== "1") return;
    if (access.canWrite) navigate("/produkte/neu", { replace: true });
    else {
      const next = new URLSearchParams(params);
      next.delete("neu");
      setParams(next, { replace: true });
    }
  }, [params, setParams, navigate, access.canWrite]);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")), [products]);
  const counts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: 0, service: 0, product: 0, material: 0 };
    for (const p of products) {
      if (active === "active" && !p.active) continue;
      if (active === "inactive" && p.active) continue;
      c.all++;
      c[p.kind]++;
    }
    return c;
  }, [products, active]);
  const lowCount = useMemo(() => products.filter((p) => p.active && isBelowMinimum(p, levels.get(p.id) ?? 0)).length, [products, levels]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => {
      if (kind !== "all" && p.kind !== kind) return false;
      if (category !== "all" && p.category !== category) return false;
      if (active === "active" && !p.active) return false;
      if (active === "inactive" && p.active) return false;
      if (onlyLow && !isBelowMinimum(p, levels.get(p.id) ?? 0)) return false;
      if (s && !`${p.name} ${p.sku} ${p.barcode} ${p.category} ${p.description} ${p.location}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [products, q, kind, category, active, onlyLow, levels]);

  const exportCsv = () =>
    saveCsv(
      "Ordo_Artikel.csv",
      ["Artikelnummer", "Name", "Art", "Kategorie", "Einheit", "Preis netto", "USt %", "Kosten netto", "Bestand", "Mindestbestand", "Lagerort", "Barcode", "Lieferant", "Aktiv"],
      filtered.map((p) => [p.sku, p.name, KIND_LABELS[p.kind], p.category, p.unit, fromCents(p.priceCents), String(p.vatRate), fromCents(p.costCents), isStockTracked(p) ? csvQty(levels.get(p.id) ?? 0) : "", isStockTracked(p) ? csvQty(p.minStock) : "", p.location, p.barcode, p.supplierId ? (contacts.get(p.supplierId)?.name ?? "") : "", p.active ? "ja" : "nein"]),
    );

  const open = (id: string) => navigate(`/produkte/${id}`);
  const create = () => navigate(kind === "all" ? "/produkte/neu" : `/produkte/neu?art=${kind}`);

  if (!access.canRead) return <><PageHeader title="Produkte" /><EmptyState title="Kein Zugriff" body="Deine Rolle sieht Produkte & Lager nicht. Frag die Inhaberin oder den Inhaber, wenn du Zugriff brauchst." /></>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Produkte"
        subtitle="Alles, was du verkaufst oder verbrauchst – Produkte, Material und Leistungen mit Preisen und Bestand."
        actions={
          <>
            {access.canWrite ? <Button onClick={create}><PackagePlus className="h-4 w-4" /> Neues Produkt</Button> : null}
            <Menu trigger={<Button variant="outline" size="icon" aria-label="Mehr"><MoreHorizontal className="h-4 w-4" /></Button>} items={[{ label: "Liste als CSV exportieren", icon: <Download className="h-4 w-4" />, onClick: () => void exportCsv(), disabled: !filtered.length }]} />
          </>
        }
      />

      {!products.length ? (
        <EmptyState
          icon={<PackageSearch className="h-8 w-8" />}
          title="Noch keine Artikel"
          body="Leg an, was du verkaufst (Produkte), was du dafür verbrauchst (Material) und was du als Arbeit verrechnest (Leistungen). Preise und Steuersätze stehen dann überall bereit."
          action={access.canWrite ? <Button onClick={create}><PackagePlus className="h-4 w-4" /> Ersten Artikel anlegen</Button> : undefined}
        />
      ) : (
        <>
          <div className="surface flex flex-wrap items-center gap-2 p-3">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen (Name, Nummer, Barcode) …" className="pl-9" />
            </div>
            {categories.length ? (
              <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-44">
                <option value="all">Alle Kategorien</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            ) : null}
            <Select value={active} onChange={(e) => setActive(e.target.value as ActiveFilter)} className="w-32">
              <option value="active">Aktive</option>
              <option value="inactive">Inaktive</option>
              <option value="all">Alle</option>
            </Select>
            {lowCount ? (
              <button onClick={() => setOnlyLow((v) => !v)} className={cls("inline-flex h-10 items-center gap-1.5 rounded-[11px] border px-3 text-sm", onlyLow ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200" : "border-(--border) text-(--text)")}>
                <AlertTriangle className="h-4 w-4" /> Unter Minimum ({lowCount})
              </button>
            ) : null}
          </div>
          <div className="-mx-1 overflow-x-auto px-1">
            <Tabs
              value={kind}
              onChange={setKind}
              className="w-fit flex-nowrap!"
              tabs={[
                { id: "all", label: "Alle", badge: <span className="text-xs text-(--text-muted) tabular">{counts.all}</span> },
                { id: "product", label: "Produkte", badge: <span className="text-xs text-(--text-muted) tabular">{counts.product}</span> },
                { id: "material", label: "Material", badge: <span className="text-xs text-(--text-muted) tabular">{counts.material}</span> },
                { id: "service", label: "Leistungen", badge: <span className="text-xs text-(--text-muted) tabular">{counts.service}</span> },
              ]}
            />
          </div>

          {!filtered.length ? (
            <EmptyState title="Nichts gefunden" body="Passe Suche oder Filter an." action={<Button variant="outline" onClick={() => { setQ(""); setKind("all"); setCategory("all"); setActive("active"); setOnlyLow(false); }}>Filter zurücksetzen</Button>} />
          ) : (
            <>
              <ul className="surface divide-y divide-(--border) overflow-hidden md:hidden">
                {filtered.map((p) => {
                  const level = levels.get(p.id) ?? 0;
                  const low = isBelowMinimum(p, level);
                  return (
                    <li key={p.id}>
                      <button type="button" onClick={() => open(p.id)} className={cls("flex w-full items-center gap-3 px-4 py-3 text-left active:bg-(--surface-2)", !p.active && "opacity-60")}>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{p.name}</span>
                            {low ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" /> : null}
                          </span>
                          <span className="block truncate text-xs text-(--text-muted)">{[KIND_LABELS[p.kind], p.sku, p.category].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-medium tabular">{p.priceCents ? fmtMoney(p.priceCents) : "–"}</span>
                          {isStockTracked(p) ? <StockAmount product={p} level={level} className="block text-xs" /> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="surface hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
                    <tr>
                      <th className="px-4 py-2">Artikel</th>
                      <th className="px-3 py-2">Art</th>
                      <th className="hidden px-3 py-2 lg:table-cell">Kategorie</th>
                      <th className="px-3 py-2 text-right">Preis netto</th>
                      <th className="hidden px-3 py-2 text-right xl:table-cell">Kosten</th>
                      <th className="px-4 py-2 text-right">Bestand</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--border)">
                    {filtered.map((p) => {
                      const level = levels.get(p.id) ?? 0;
                      const low = isBelowMinimum(p, level);
                      return (
                        <tr key={p.id} onClick={() => open(p.id)} className={cls("cursor-pointer hover:bg-(--surface-2)", low && "bg-amber-50/60 dark:bg-amber-900/10", !p.active && "opacity-60")}>
                          <td className="max-w-0 px-4 py-2.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{p.name}</span>
                              {!p.active ? <Badge>inaktiv</Badge> : null}
                            </div>
                            {p.sku ? <div className="truncate text-xs text-(--text-muted)">{p.sku}</div> : null}
                          </td>
                          <td className="px-3 py-2.5"><KindBadge kind={p.kind} /></td>
                          <td className="hidden px-3 py-2.5 text-(--text-muted) lg:table-cell"><span className="block max-w-[12rem] truncate">{p.category || "–"}</span></td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">{p.priceCents ? fmtMoney(p.priceCents) : <span className="text-(--text-muted)">–</span>}<span className="text-xs text-(--text-muted)"> / {p.unit}</span></td>
                          <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular text-(--text-muted) xl:table-cell">{p.costCents ? fmtMoney(p.costCents) : "–"}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right">
                            <span className="inline-flex items-center gap-1.5">
                              {low ? <span title={`Mindestbestand ${p.minStock} ${p.unit}`}><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /></span> : null}
                              <StockAmount product={p} level={level} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-(--text-muted)">{filtered.length} Artikel{lowCount ? ` · ${lowCount} unter Mindestbestand` : ""}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
