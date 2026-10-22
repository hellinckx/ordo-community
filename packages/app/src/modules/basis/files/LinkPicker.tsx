import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { EntityLink, Vault } from "@ordo/core";
import { useProfile, useVault } from "@/state/hooks";
import { useInstalledModules } from "@/modules/registry";
import type { ModuleId } from "@/modules/types";
import { Input, Modal, Tabs } from "@/components/ui";
import { cls, fmtDate } from "@/lib/format";
import { LINK_TYPE_LABELS, sameLink } from "./fileStore";

type PickType = "contact" | "project" | "offer" | "invoice" | "product" | "workOrder";

const TYPES: { type: PickType; module?: ModuleId }[] = [
  { type: "contact" },
  { type: "project", module: "projekte" },
  { type: "offer", module: "projekte" },
  { type: "invoice", module: "summa" },
  { type: "product", module: "produkte" },
  { type: "workOrder", module: "produktion" },
];

interface Row {
  id: string;
  label: string;
  sub: string;
}

function recordsOf(vault: Vault, profileId: string, type: PickType): Row[] {
  const mine = <T extends { profileId: string; deletedAt?: string }>(list: T[]) => list.filter((x) => x.profileId === profileId && !x.deletedAt);
  const contactName = (id?: string) => (id ? vault.contacts.find((c) => c.id === id)?.name ?? "" : "");
  const join = (...p: (string | undefined)[]) => p.filter(Boolean).join(" · ");
  switch (type) {
    case "contact":
      return mine(vault.contacts).filter((c) => c.active !== false).sort((a, b) => a.name.localeCompare(b.name, "de")).map((c) => ({ id: c.id, label: c.name, sub: join(c.number, c.city) }));
    case "project":
      return mine(vault.projects).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({ id: p.id, label: join(p.number, p.name), sub: contactName(p.customerId) }));
    case "offer":
      return mine(vault.offers).sort((a, b) => b.date.localeCompare(a.date)).map((o) => ({ id: o.id, label: join(o.number, o.subject), sub: join(contactName(o.customerId), fmtDate(o.date)) }));
    case "invoice":
      return mine(vault.invoices).sort((a, b) => b.issueDate.localeCompare(a.issueDate)).map((i) => ({ id: i.id, label: i.number || "Entwurf", sub: join(i.customerSnapshot.name, fmtDate(i.issueDate)) }));
    case "product":
      return mine(vault.products).sort((a, b) => a.name.localeCompare(b.name, "de")).map((p) => ({ id: p.id, label: p.name, sub: p.sku }));
    case "workOrder":
      return mine(vault.workOrders).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((w) => ({ id: w.id, label: w.number, sub: vault.products.find((p) => p.id === w.productId)?.name ?? "" }));
  }
}

/** Choose a record (customer, project, offer, invoice, product, work order) to link a file with. */
export function LinkPicker({ open, onClose, onPick, existing = [] }: { open: boolean; onClose: () => void; onPick: (link: EntityLink) => void; existing?: EntityLink[] }) {
  const vault = useVault();
  const profile = useProfile();
  const installed = useInstalledModules();
  const types = TYPES.filter((t) => !t.module || installed.some((m) => m.id === t.module)).filter((t) => t.type !== "invoice" || profile.mode === "business");
  const [type, setType] = useState<PickType>("contact");
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return recordsOf(vault, profile.id, type)
      .filter((r) => !s || r.label.toLowerCase().includes(s) || r.sub.toLowerCase().includes(s))
      .slice(0, 80);
  }, [vault, profile.id, type, q]);
  return (
    <Modal open={open} onClose={onClose} title="Verknüpfen mit …" size="md">
      <div className="space-y-3">
        {types.length > 1 ? <Tabs tabs={types.map((t) => ({ id: t.type, label: LINK_TYPE_LABELS[t.type] }))} value={type} onChange={setType} className="w-fit" /> : null}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen …" className="pl-9" />
        </div>
        <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-(--border)">
          {rows.length ? (
            <ul className="divide-y divide-(--border)">
              {rows.map((r) => {
                const linked = existing.some((l) => sameLink(l, { type, id: r.id }));
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      disabled={linked}
                      onClick={() => {
                        onPick({ type, id: r.id });
                        onClose();
                      }}
                      className={cls("flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-(--surface-2) disabled:cursor-default disabled:opacity-50")}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.label}</span>
                        {r.sub ? <span className="block truncate text-xs text-(--text-muted)">{r.sub}</span> : null}
                      </span>
                      {linked ? <span className="text-xs text-(--text-muted)">verknüpft</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-(--text-muted)">{q ? "Nichts gefunden." : `Noch keine Einträge unter „${LINK_TYPE_LABELS[type]}“.`}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
