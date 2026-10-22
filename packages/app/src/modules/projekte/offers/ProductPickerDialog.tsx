import { useMemo, useState } from "react";
import { Package, Search } from "lucide-react";
import type { Product } from "@ordo/core";
import { EmptyState, Input, Modal } from "@/components/ui";
import { fmtMoney } from "@/lib/format";

/** Picks a product from the article master; its name, description, unit, price and VAT become a position. */
export function ProductPickerDialog({ open, onClose, products, onPick }: { open: boolean; onClose: () => void; products: Product[]; onPick: (p: Product) => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...products]
      .filter((p) => !s || [p.name, p.sku, p.category, p.description].join(" ").toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [products, q]);
  const close = () => {
    setQ("");
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title="Produkt übernehmen" size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, Artikelnummer …" className="pl-9" />
        </div>
        {!list.length ? (
          <EmptyState bare icon={<Package className="h-7 w-7" />} title="Kein Produkt gefunden" />
        ) : (
          <ul className="-mx-2 max-h-[55vh] divide-y divide-(--border) overflow-y-auto">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(p);
                    close();
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-(--surface-2)"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-(--text-muted)">{[p.sku, p.category, p.kind === "service" ? "Leistung" : p.kind === "material" ? "Material" : "Produkt"].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="shrink-0 text-right text-sm tabular">
                    {fmtMoney(p.priceCents)}
                    <div className="text-xs text-(--text-muted)">je {p.unit} · {p.vatRate} %</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
