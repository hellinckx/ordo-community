/* Small building blocks used by the offer screens. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Info } from "lucide-react";
import { parseLocalizedDecimal, type Profile } from "@ordo/core";
import { Button, Input, Textarea } from "@/components/ui";
import { requireStore } from "@/state/session";
import { cls } from "@/lib/format";

/** Number field that understands "2,5" and "1.234,5"; keeps what you type until you leave the field. */
export function NumberInput({ value, onChange, min, max, className, placeholder, disabled, suffix }: { value: number; onChange: (n: number) => void; min?: number; max?: number; className?: string; placeholder?: string; disabled?: boolean; suffix?: string }) {
  const show = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000).replace(".", ",") : "");
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        className={cls("text-right tabular", suffix && "pr-8", className)}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseLocalizedDecimal(e.target.value);
          if (n !== null) onChange(clamp(n));
          else if (!e.target.value.trim()) onChange(clamp(0));
        }}
        onBlur={() => {
          focused.current = false;
          setText(show(value));
        }}
      />
      {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{suffix}</span> : null}
    </div>
  );
}

/** Label with a small text action on the right ("Vorschlag einsetzen"). */
export function LabelRow({ label, action, hint }: { label: string; action?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="text-[13px] font-medium text-(--text-muted)">{label}</span>
      {action}
      {hint ? <span className="w-full text-xs text-(--text-muted)">{hint}</span> : null}
    </div>
  );
}

export function TextAction({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-40 dark:text-brand-400">
      {children}
    </button>
  );
}

/** Textarea with a label and an optional "Vorschlag einsetzen". */
export function TextBlock({ label, value, onChange, suggestion, placeholder, hint, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; suggestion?: () => string; placeholder?: string; hint?: ReactNode; rows?: number }) {
  return (
    <div>
      <LabelRow label={label} hint={hint} action={suggestion ? <TextAction onClick={() => onChange(suggestion())}>Vorschlag einsetzen</TextAction> : undefined} />
      <Textarea value={value} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function SumRow({ label, value, strong, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cls("flex items-baseline justify-between gap-3", strong && "border-t border-(--border) pt-2 text-base font-semibold", muted && "text-(--text-muted)")}>
      <span className={strong ? undefined : "text-(--text-muted)"}>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

/** Calm inline notice (no colour fill – just a hairline and an icon). */
export function Notice({ children, tone = "info", action }: { children: ReactNode; tone?: "info" | "warning"; action?: ReactNode }) {
  return (
    <div className={cls("flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm", tone === "warning" ? "border-amber-300/70 text-amber-900 dark:border-amber-500/40 dark:text-amber-200" : "border-(--border) text-(--text-muted)")}>
      <Info className={cls("mt-0.5 h-4 w-4 shrink-0", tone === "warning" ? "text-amber-500" : "text-brand-700 dark:text-brand-400")} />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** Shown in invoice dialogs when the profile says invoices come from another program. */
export function InvoiceModeNotice({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  if (profile.company.invoiceMode !== "external") return null;
  return (
    <Notice
      tone="warning"
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => requireStore().update("profiles", profile.id, (p) => ({ ...p, company: { ...p.company, invoiceMode: "summa" } }))}
        >
          Umstellen
        </Button>
      }
    >
      Laut deinen Einstellungen schreibst du Rechnungen in einem anderen Programm. Damit du die Rechnung hier fertig machen kannst, stell auf „In Summa schreiben“ um.{" "}
      <button type="button" className="underline" onClick={() => navigate("/einstellungen/rechnungen")}>Einstellungen</button>
    </Notice>
  );
}
