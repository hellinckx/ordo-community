import { useCallback, useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { ids, nowIso, type Category, type Contact } from "@ordo/core";
import { useCategories, useContacts, useProfile } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { CategoryIcon } from "@/lib/icons";
import { cls } from "@/lib/format";
import { nextContactNumberFor } from "@/modules/basis/contactNumber";
import { Floating } from "@/components/ui";

export function CategoryPicker({ value, onChange, kind, className, placeholder = "Kategorie wählen …", autoFocus, id }: { value: string | undefined; onChange: (id: string | undefined, cat?: Category) => void; kind: "income" | "expense"; className?: string; placeholder?: string; autoFocus?: boolean; id?: string }) {
  const cats = useCategories(kind);
  const profile = useProfile();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const selected = cats.find((c) => c.id === value);
  const newName = q.trim();
  const canCreate = newName.length >= 2 && !cats.some((c) => c.name.toLowerCase() === newName.toLowerCase());
  // Own categories are categorised like the seeded ones (keywords, contact memory, AI) – see Settings → Kategorien.
  const createNew = () => {
    const now = nowIso();
    const c: Category = { id: ids.category(), name: newName, kind, mode: profile.mode, icon: "tag", color: "#0d9488", defaultVatRate: 20, defaultDeductiblePct: 100, deductibleIncomePct: 100, keywords: [], userKeywords: [], isSystem: false, isArchived: false, sortOrder: 500, createdAt: now, updatedAt: now };
    requireStore().insert("categories", c, "category.create");
    onChange(c.id, c);
    setOpen(false);
    setQ("");
  };
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return cats;
    return cats.filter((c) => c.name.toLowerCase().includes(s) || c.keywords.some((k) => k.includes(s)) || c.e1aKz?.includes(s) || c.l1Kz?.includes(s));
  }, [cats, q]);
  const groups = useMemo(() => {
    const g = new Map<string, Category[]>();
    for (const c of filtered) {
      const key = c.l1Kz ? (["730", "731", "734", "735", "475", "476"].includes(c.l1Kz) ? "Außergewöhnliche Belastungen" : ["460", "280", "458", "455", "456", "281", "282"].includes(c.l1Kz) ? "Sonderausgaben" : "Werbungskosten (absetzbar)") : c.mode === "employee" && c.kind === "expense" ? "Privat (Budget)" : c.kind === "income" ? "Einnahmen" : "Betriebsausgaben";
      (g.get(key) ?? g.set(key, []).get(key)!).push(c);
    }
    return [...g.entries()];
  }, [filtered]);
  return (
    <div ref={ref} className={cls("relative", className)}>
      <button type="button" id={id} autoFocus={autoFocus} onClick={() => setOpen((o) => !o)} className="flex h-10 w-full items-center gap-2 rounded-xl border border-(--border) bg-(--surface) px-3 text-left text-sm focus:focus-ring">
        {selected ? (
          <>
            <span className="flex h-6 w-6 items-center justify-center rounded-md text-white" style={{ background: selected.color }}>
              <CategoryIcon name={selected.icon} className="h-3.5 w-3.5" />
            </span>
            <span className="flex-1 truncate">{selected.name}</span>
            {selected.e1aKz || selected.l1Kz ? <span className="text-xs text-(--text-muted)">KZ {selected.e1aKz ?? selected.l1Kz}</span> : null}
          </>
        ) : (
          <span className="flex-1 text-slate-400">{placeholder}</span>
        )}
      </button>
      <Floating anchor={ref} open={open} onClose={close}>
          <div className="flex shrink-0 items-center gap-2 border-b border-(--border) px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen oder neu anlegen …" className="h-9 flex-1 bg-transparent text-sm outline-none" onKeyDown={(e) => { if (e.key === "Enter" && canCreate && !filtered.length) createNew(); }} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {groups.map(([g, list]) => (
              <div key={g}>
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-(--text-muted)">{g}</div>
                {list.map((c) => (
                  <button key={c.id} type="button" onClick={() => { onChange(c.id, c); setOpen(false); setQ(""); }} className={cls("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-(--surface-2)", c.id === value && "bg-brand-50 dark:bg-brand-900/30")}>
                    <span className="flex h-6 w-6 items-center justify-center rounded-md text-white" style={{ background: c.color }}>
                      <CategoryIcon name={c.icon} className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 truncate">{c.name}</span>
                    {c.e1aKz || c.l1Kz ? <span className="text-[11px] text-(--text-muted)">{c.e1aKz ?? c.l1Kz}</span> : null}
                  </button>
                ))}
              </div>
            ))}
            {!filtered.length && !canCreate ? <div className="px-3 py-4 text-center text-sm text-(--text-muted)">Keine Kategorie gefunden</div> : null}
            {canCreate ? (
              <button type="button" onClick={createNew} className="flex w-full items-center gap-2 border-t border-(--border) px-3 py-2 text-left text-sm text-brand-700 hover:bg-(--surface-2) dark:text-brand-300">
                <Plus className="h-4 w-4" /> „{newName}“ als neue Kategorie anlegen
              </button>
            ) : null}
          </div>
      </Floating>
    </div>
  );
}

export function ContactPicker({ value, onChange, kind, className, placeholder = "Kontakt (optional)", suggestedName, id }: { value: string | undefined; onChange: (id: string | undefined) => void; kind?: Contact["kind"]; className?: string; placeholder?: string; suggestedName?: string | null; id?: string }) {
  const contacts = useContacts();
  const profile = useProfile();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const selected = contacts.find((c) => c.id === value);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    // archived contacts stay out of the list (unless one is already chosen)
    return contacts.filter((c) => (c.active !== false || c.id === value) && (!kind || c.kind === kind || c.kind === "both") && (!s || c.name.toLowerCase().includes(s) || c.uid.toLowerCase().includes(s) || (c.number ?? "").toLowerCase().includes(s)));
  }, [contacts, q, kind, value]);
  const createNew = (name: string) => {
    const store = requireStore();
    const now = nowIso();
    const c: Contact = { id: ids.contact(), profileId: profile.id, name: name.trim(), kind: kind ?? "vendor", number: nextContactNumberFor(store.vault, profile.id), uid: "", email: "", phone: "", street: "", zip: "", city: "", country: "AT", iban: "", notes: "", aliases: [], createdAt: now, updatedAt: now };
    store.insert("contacts", c, "contact.create");
    onChange(c.id);
    setOpen(false);
    setQ("");
  };
  const newName = q.trim() || suggestedName?.trim() || "";
  return (
    <div ref={ref} className={cls("relative", className)}>
      <div className="flex h-10 w-full items-center gap-2 rounded-xl border border-(--border) bg-(--surface) px-3 text-sm focus-within:focus-ring">
        <button type="button" id={id} className="flex-1 truncate text-left" onClick={() => setOpen((o) => !o)}>
          {selected ? selected.name : <span className="text-slate-400">{placeholder}</span>}
        </button>
        {selected ? (
          <button type="button" onClick={() => onChange(undefined)} className="rounded p-0.5 text-slate-400 hover:text-(--text)" aria-label="Entfernen">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <Floating anchor={ref} open={open} onClose={close}>
          <div className="flex shrink-0 items-center gap-2 border-b border-(--border) px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen oder neu anlegen …" className="h-9 flex-1 bg-transparent text-sm outline-none" onKeyDown={(e) => { if (e.key === "Enter" && newName && !filtered.length) createNew(newName); }} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {filtered.map((c) => (
              <button key={c.id} type="button" onClick={() => { onChange(c.id); setOpen(false); setQ(""); }} className={cls("flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-(--surface-2)", c.id === value && "bg-brand-50 dark:bg-brand-900/30")}>
                <span className="min-w-0 truncate">{c.name}</span>
                {c.number || c.uid ? <span className="shrink-0 text-[11px] tabular text-(--text-muted)">{[c.number, c.uid].filter(Boolean).join(" · ")}</span> : null}
              </button>
            ))}
            {newName && !filtered.some((c) => c.name.toLowerCase() === newName.toLowerCase()) ? (
              <button type="button" onClick={() => createNew(newName)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-700 hover:bg-(--surface-2)">
                <Plus className="h-4 w-4" /> „{newName}“ neu anlegen
              </button>
            ) : null}
            {!filtered.length && !newName ? <div className="px-3 py-3 text-center text-sm text-(--text-muted)">Tippen, um einen Kontakt anzulegen</div> : null}
          </div>
      </Floating>
    </div>
  );
}
