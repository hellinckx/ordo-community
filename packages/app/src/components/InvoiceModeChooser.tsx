import { FileInput, PenLine, Check } from "lucide-react";
import type { Profile } from "@ordo/core";
import { nowIso } from "@ordo/core";
import { requireStore } from "@/state/session";
import { INVOICE_MODE_INFO, type InvoiceMode } from "@/lib/invoiceMode";
import { cls } from "@/lib/format";

export function setInvoiceMode(profile: Profile, mode: InvoiceMode) {
  requireStore().update("profiles", profile.id, (p) => ({ ...p, company: { ...p.company, invoiceMode: mode }, updatedAt: nowIso() }), "profile.invoiceMode");
}

/** Two large choice cards: write invoices in Summa vs. import them from another program. */
export function InvoiceModeChooser({ profile, value, onChange, compact }: { profile: Profile; value: InvoiceMode | undefined; onChange?: (m: InvoiceMode) => void; compact?: boolean }) {
  const pick = (m: InvoiceMode) => {
    setInvoiceMode(profile, m);
    onChange?.(m);
  };
  const options: { mode: InvoiceMode; icon: React.ReactNode }[] = [
    { mode: "external", icon: <FileInput className="h-6 w-6" /> },
    { mode: "summa", icon: <PenLine className="h-6 w-6" /> },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map(({ mode, icon }) => {
        const info = INVOICE_MODE_INFO[mode];
        const active = value === mode;
        return (
          <button key={mode} type="button" onClick={() => pick(mode)} className={cls("relative rounded-2xl border-2 p-4 text-left transition-all hover:shadow-card", active ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20" : "border-(--border) hover:border-brand-300")}>
            {active ? <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white"><Check className="h-4 w-4" strokeWidth={3} /></span> : null}
            <div className={cls("mb-2 inline-flex rounded-xl p-2", active ? "bg-brand-600 text-white" : "bg-(--surface-2) text-(--text-muted)")}>{icon}</div>
            <div className="font-semibold">{info.short}</div>
            <div className="mt-1 text-sm text-(--text-muted)">{compact ? info.hint : info.body}</div>
          </button>
        );
      })}
    </div>
  );
}
