import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { can, isStockTracked, stockLevels, toCsv, type Product, type ProductKind, type StockMoveKind, type VatRate } from "@ordo/core";
import { useList } from "@/state/hooks";
import { requirePlatform } from "@/state/session";
import { useMe } from "@/modules/registry";
import { Badge } from "@/components/ui";
import { cls } from "@/lib/format";
import { toast } from "@/state/toasts";

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

export const KIND_LABELS: Record<ProductKind, string> = { service: "Leistung", product: "Produkt", material: "Material" };
export const KIND_PLURAL: Record<ProductKind, string> = { service: "Leistungen", product: "Produkte", material: "Material" };

export const MOVE_LABELS: Record<StockMoveKind, string> = {
  receipt: "Zugang",
  issue: "Abgang",
  adjustment: "Korrektur",
  sale: "Verkauf",
  production_in: "Fertigmeldung",
  production_out: "Materialentnahme",
  count: "Inventur",
};

export const UNIT_SUGGESTIONS = ["Stk", "Std", "Pkg", "Bogen", "Rolle", "m", "m²", "kg", "g", "l", "ml", "Set", "pauschal"];
export const VAT_OPTIONS: VatRate[] = [20, 13, 10, 0];

/** Quantity with up to 3 decimals, German format. */
export function fmtQty(n: number): string {
  return n.toLocaleString("de-AT", { maximumFractionDigits: 3 });
}

/** Quantity for CSV (no thousands separator, comma decimals). */
export function csvQty(n: number): string {
  return n.toLocaleString("de-AT", { maximumFractionDigits: 3, useGrouping: false });
}

export function isoAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Data hooks                                                          */
/* ------------------------------------------------------------------ */

export function useProducts(): Product[] {
  const list = useList("products");
  return useMemo(() => [...list].sort((a, b) => a.name.localeCompare(b.name, "de")), [list]);
}

/** Stock per product of the active profile. */
export function useStockLevels(): Map<string, number> {
  const products = useList("products");
  const moves = useList("stockMoves");
  return useMemo(() => stockLevels(products, moves), [products, moves]);
}

/** What the person may do in Produkte & Lager. */
export function useProductAccess() {
  const { role } = useMe();
  return useMemo(() => ({ canRead: can(role, "products", "read"), canWrite: can(role, "products", "write"), canAdmin: can(role, "products", "admin") }), [role]);
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

export function KindBadge({ kind }: { kind: ProductKind }) {
  return <Badge tone={kind === "service" ? "info" : kind === "material" ? "neutral" : "brand"}>{KIND_LABELS[kind]}</Badge>;
}

/** Stock with unit; amber when below minimum, red when negative. */
export function StockAmount({ product, level, className }: { product: Product; level: number; className?: string }) {
  if (!isStockTracked(product)) return <span className={cls("text-(--text-muted)", className)}>–</span>;
  const low = product.minStock > 0 && level < product.minStock;
  return (
    <span className={cls("tabular whitespace-nowrap", level < 0 ? "font-medium text-red-600 dark:text-red-400" : low ? "font-medium text-amber-700 dark:text-amber-400" : "", className)}>
      {fmtQty(level)} <span className="text-(--text-muted) font-normal">{product.unit}</span>
    </span>
  );
}

/** Parses "1,5" / "1.5" / "1.234,5"; null when empty or invalid. */
export function parseQty(s: string): number | null {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const v = Number(normalized);
  return Number.isFinite(v) ? v : null;
}

/**
 * Decimal input with German comma. Keeps what you type and reports numbers.
 * `commit="blur"` reports only when leaving the field (for lists that save immediately).
 */
export function QtyInput({ value, onChange, commit = "change", suffix, allowNegative, className, ...rest }: { value: number | null | undefined; onChange: (n: number) => void; commit?: "change" | "blur"; suffix?: string; allowNegative?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const show = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? "" : n.toLocaleString("de-AT", { maximumFractionDigits: 3, useGrouping: false }));
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);
  const clean = (n: number) => (allowNegative ? n : Math.abs(n));
  return (
    <div className="relative">
      <input
        {...rest}
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
          rest.onFocus?.(e);
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseQty(e.target.value);
          if (commit === "change" && n !== null) onChange(clean(n));
        }}
        onBlur={(e) => {
          focused.current = false;
          const n = parseQty(e.target.value);
          if (n === null) setText(show(value));
          else {
            setText(show(clean(n)));
            if (commit === "blur" || clean(n) !== value) onChange(clean(n));
          }
          rest.onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          rest.onKeyDown?.(e);
        }}
        className={cls("h-10 w-full rounded-[11px] border border-(--border) bg-(--surface) px-3 text-right text-sm tabular text-(--text) transition-shadow placeholder:text-slate-400 focus:focus-ring disabled:bg-(--surface-2) disabled:opacity-60", suffix && "pr-12", className)}
      />
      {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 max-w-10 -translate-y-1/2 truncate text-xs text-slate-400">{suffix}</span> : null}
    </div>
  );
}

/** Searchable product picker (name, Artikelnummer, Barcode). */
export function ProductPicker({ value, onChange, filter, placeholder = "Artikel wählen …", className, levels, autoFocus, disabled }: { value: string | undefined; onChange: (id: string | undefined, product?: Product) => void; filter?: (p: Product) => boolean; placeholder?: string; className?: string; levels?: Map<string, number>; autoFocus?: boolean; disabled?: boolean }) {
  const products = useProducts();
  const [open, setOpen] = useState(!!autoFocus);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const selected = products.find((p) => p.id === value);
  const options = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) => (!filter || filter(p)) && (!s || `${p.name} ${p.sku} ${p.barcode} ${p.category}`.toLowerCase().includes(s))).slice(0, 80);
  }, [products, filter, q]);
  return (
    <div ref={ref} className={cls("relative", className)}>
      <div className={cls("flex h-10 w-full items-center gap-2 rounded-[11px] border border-(--border) bg-(--surface) px-3 text-sm focus-within:focus-ring", disabled && "opacity-60")}>
        <button type="button" disabled={disabled} className="min-w-0 flex-1 truncate text-left" onClick={() => setOpen((o) => !o)}>
          {selected ? (
            <span className="truncate">
              {selected.name}
              {selected.sku ? <span className="ml-1.5 text-xs text-(--text-muted)">{selected.sku}</span> : null}
            </span>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </button>
        {selected && !disabled ? (
          <button type="button" onClick={() => onChange(undefined)} className="rounded p-0.5 text-slate-400 hover:text-(--text)" aria-label="Entfernen">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="glass-strong animate-pop-in absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-2xl shadow-pop">
          <div className="flex items-center gap-2 border-b border-(--glass-border) px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, Nummer oder Barcode …" className="h-10 flex-1 bg-transparent text-sm outline-none" />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {options.map((p) => (
              <button key={p.id} type="button" onClick={() => { onChange(p.id, p); setOpen(false); setQ(""); }} className={cls("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-(--sidebar-hover)", p.id === value && "bg-brand-50 dark:bg-brand-900/30")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.name}</span>
                  <span className="block truncate text-xs text-(--text-muted)">{[KIND_LABELS[p.kind], p.sku].filter(Boolean).join(" · ")}</span>
                </span>
                {levels && isStockTracked(p) ? <span className="shrink-0 text-xs tabular text-(--text-muted)">{fmtQty(levels.get(p.id) ?? 0)} {p.unit}</span> : null}
              </button>
            ))}
            {!options.length ? <div className="px-3 py-4 text-center text-sm text-(--text-muted)">Nichts gefunden</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Saves a CSV (semicolon, German numbers) through the platform's save dialog. */
export async function saveCsv(name: string, headers: string[], rows: (string | number | null | undefined)[][]): Promise<void> {
  try {
    const ok = await requirePlatform().saveFile(name, toCsv(headers, rows), "text/csv");
    if (ok) toast.success("CSV gespeichert", name);
  } catch (e) {
    toast.error("CSV konnte nicht gespeichert werden", e instanceof Error ? e.message : undefined);
  }
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; className?: string }) {
  return (
    <div className={cls("flex gap-0.5 rounded-[11px] bg-(--surface-2) p-0.5", className)}>
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} className={cls("flex-1 rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition-all", value === o.id ? "bg-(--surface) text-(--text) shadow-[0_1px_3px_rgb(0_0_0/0.1)] dark:bg-slate-600" : "text-(--text-muted) hover:text-(--text)")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Like Field, but a div – for button groups (a <label> would press the first button when its text is clicked). */
export function Group({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className="mb-1.5 block text-[13px] font-medium text-(--text-muted)">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs text-(--text-muted)">{hint}</span> : null}
    </div>
  );
}
