import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, Info, Loader2, X, XCircle } from "lucide-react";
import { cls, moneyInputValue, parseMoneyInput } from "@/lib/format";
import { useToasts } from "@/state/toasts";

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-600 active:bg-brand-800 shadow-[0_1px_2px_rgb(10_95_224/0.25)] disabled:bg-brand-700/50",
  secondary: "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white",
  outline: "border border-(--border) bg-(--surface) hover:bg-(--surface-2) text-(--text) shadow-[0_1px_1px_rgb(0_0_0/0.03)]",
  ghost: "hover:bg-(--surface-2) text-(--text)",
  subtle: "bg-(--surface-2) hover:bg-slate-200 dark:hover:bg-slate-800 text-(--text)",
  danger: "bg-red-600 text-white hover:bg-red-700",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[9px]",
  md: "h-10 px-4 text-sm gap-2 rounded-[11px]",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-[13px]",
  icon: "h-9 w-9 rounded-[10px] justify-center",
};

export function Button({ variant = "primary", size = "md", loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cls("inline-flex items-center font-medium transition-[background-color,color,transform,box-shadow] duration-150 select-none whitespace-nowrap active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 focus-visible:focus-ring", variants[variant], sizes[size], className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

const control = "w-full rounded-[11px] border border-(--border) bg-(--surface) px-3 text-sm text-(--text) placeholder:text-slate-400 transition-shadow focus:focus-ring disabled:opacity-60 disabled:bg-(--surface-2)";

export function Field({ label, hint, error, children, className, required }: { label?: string; hint?: string; error?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cls("block", className)}>
      {label ? (
        <span className="mb-1.5 block text-[13px] font-medium text-(--text-muted)">
          {label}
          {required ? <span className="text-red-500"> *</span> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-(--text-muted)">{hint}</span> : null}
    </label>
  );
}

/** A titled group of fields inside a form – long forms stay readable and short. */
export function FormSection({ title, hint, children, className, cols = 2 }: { title: string; hint?: string; children: ReactNode; className?: string; cols?: 1 | 2 | 3 }) {
  return (
    <section className={cls("space-y-2.5", className)}>
      <div>
        <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
        {hint ? <p className="text-xs text-(--text-muted)">{hint}</p> : null}
      </div>
      <div className={cls("grid gap-3", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3")}>{children}</div>
    </section>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cls(control, "h-10", className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cls(control, "min-h-20 py-2", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...rest} className={cls(control, "h-10 appearance-none pr-9", className)}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

export function Checkbox({ label, checked, onChange, hint, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className={cls("flex cursor-pointer items-start gap-3 rounded-xl p-2 -m-2 hover:bg-(--surface-2)", disabled && "opacity-60")}>
      <span className={cls("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors", checked ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-(--surface) dark:border-slate-600")}>
        {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-xs text-(--text-muted)">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: string; disabled?: boolean }) {
  return (
    <label className={cls("flex cursor-pointer items-center justify-between gap-4 py-1", disabled && "opacity-60")}>
      {label ? (
        <span className="text-sm">
          <span className="font-medium">{label}</span>
          {hint ? <span className="block text-xs text-(--text-muted)">{hint}</span> : null}
        </span>
      ) : null}
      <span role="switch" aria-checked={checked} onClick={() => !disabled && onChange(!checked)} className={cls("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors", checked ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600")}>
        <span className={cls("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5.5" : "translate-x-0.5")} />
      </span>
    </label>
  );
}

/** Money input in EUR with German formatting; value in cents. */
export function MoneyInput({ value, onChange, className, allowNegative, ...rest }: { value: number | null; onChange: (cents: number | null) => void; allowNegative?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(moneyInputValue(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(moneyInputValue(value));
  }, [value]);
  return (
    <div className="relative">
      <input
        {...rest}
        inputMode="decimal"
        value={text}
        onFocus={(e) => {
          focused.current = true;
          rest.onFocus?.(e);
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const c = parseMoneyInput(e.target.value);
          if (c === null) onChange(e.target.value.trim() ? value : null);
          else onChange(allowNegative ? c : Math.abs(c));
        }}
        onBlur={(e) => {
          focused.current = false;
          const c = parseMoneyInput(e.target.value);
          setText(moneyInputValue(c === null ? null : allowNegative ? c : Math.abs(c)));
          rest.onBlur?.(e);
        }}
        className={cls(control, "h-10 pr-8 text-right tabular", className)}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">€</span>
    </div>
  );
}

export function DateInput({ value, onChange, className, ...rest }: { value: string | undefined; onChange: (iso: string | undefined) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return <input {...rest} type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className={cls(control, "h-10", className)} />;
}

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

/** A card. In a grid row all cards get the same height; with fill the body is a column, so a chart can grow into the space. */
export function Card({ children, className, title, action, padded = true, fill }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; padded?: boolean; fill?: boolean }) {
  return (
    <section className={cls("surface flex min-w-0 flex-col", className)}>
      {title || action ? (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-(--glass-border) px-5 py-2.5">
          <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
          {action}
        </header>
      ) : null}
      <div className={cls("min-w-0 flex-1", padded && "p-5", fill && "flex flex-col")}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em]">{title}</h1>
        {subtitle ? <p className="mt-1.5 max-w-2xl text-sm text-(--text-muted)">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info" | "brand"; className?: string }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    danger: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    info: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    brand: "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200",
  };
  return <span className={cls("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function EmptyState({ icon, title, body, action, bare }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; /** inside a card: no frame of its own */ bare?: boolean }) {
  return (
    <div className={cls("flex flex-col items-center justify-center px-6 py-12 text-center", !bare && "rounded-2xl border border-dashed border-(--border)")}>
      {icon ? <div className="mb-3 text-brand-700 dark:text-brand-400">{icon}</div> : null}
      <h3 className="text-base font-semibold">{title}</h3>
      {body ? <p className="mt-1 max-w-md text-sm text-(--text-muted)">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cls("h-5 w-5 animate-spin text-brand-600", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-(--border) bg-(--surface-2) px-1.5 py-0.5 font-mono text-[11px] text-(--text-muted)">{children}</kbd>;
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; badge?: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cls("flex flex-wrap gap-0.5 rounded-[11px] bg-slate-200/70 p-0.5 dark:bg-slate-800", className)}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={cls("flex items-center gap-2 whitespace-nowrap rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition-all", value === t.id ? "bg-(--surface) text-(--text) shadow-[0_1px_3px_rgb(0_0_0/0.1)] dark:bg-slate-600" : "text-(--text-muted) hover:text-(--text)")}>
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "up" | "down" | "neutral" }) {
  return (
    <div className="surface px-5 py-4">
      <div className="text-[13px] font-medium text-(--text-muted)">{label}</div>
      <div className={cls("mt-1.5 text-[26px] leading-none font-semibold tracking-[-0.02em] tabular", tone === "up" && "text-emerald-700 dark:text-emerald-400", tone === "down" && "text-red-600 dark:text-red-400")}>{value}</div>
      {sub ? <div className="mt-2 text-xs text-(--text-muted)">{sub}</div> : null}
    </div>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cls("h-2 w-full overflow-hidden rounded-full bg-(--surface-2)", className)}>
      <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function ConfidenceDot({ value }: { value: number | undefined }) {
  const v = value ?? 0;
  const color = v >= 0.85 ? "bg-emerald-500" : v >= 0.6 ? "bg-amber-400" : "bg-red-500";
  return <span title={`Sicherheit ${Math.round(v * 100)} %`} className={cls("inline-block h-2 w-2 rounded-full", color)} />;
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text)"
      title="In Zwischenablage kopieren"
    >
      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Modal / Confirm                                                     */
/* ------------------------------------------------------------------ */

export function Modal({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl" | "full" }) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl", full: "max-w-[96vw]" };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal aria-labelledby={id}>
      {/* Dialogs are always solid (never glass): over a white PDF a translucent dialog is hard to read. */}
      <div className={cls("animate-pop-in flex max-h-[95vh] w-full flex-col overflow-hidden rounded-t-[22px] border border-(--border) bg-(--surface) shadow-pop sm:rounded-[22px]", widths[size])}>
        {title ? (
          <header className="flex items-center justify-between border-b border-(--border) px-5 py-3.5">
            <h2 id={id} className="text-base font-semibold">
              {title}
            </h2>
            <button onClick={onClose} className="rounded-lg p-1.5 text-(--text-muted) hover:bg-(--surface-2)" aria-label="Schließen">
              <X className="h-4 w-4" />
            </button>
          </header>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-(--border) bg-(--surface) px-5 py-3">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = "Bestätigen", danger, extra }: { open: boolean; onClose: () => void; onConfirm: () => void | Promise<void>; title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean; /** Additional action shown left of the main button. */ extra?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
        {extra}
        <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirmLabel}</Button>
      </>
    }>
      <div className="text-sm text-(--text-muted)">{body}</div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const icons = { success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />, error: <XCircle className="h-5 w-5 text-red-500" />, info: <Info className="h-5 w-5 text-sky-500" />, warning: <AlertTriangle className="h-5 w-5 text-amber-500" /> };
  // top, not bottom: the free Netlify plan puts its badge in the bottom-right corner
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:top-16 sm:items-end sm:px-6">
      {toasts.map((t) => (
        <div key={t.id} className="glass-strong pointer-events-auto animate-slide-up flex w-full max-w-sm items-start gap-3 rounded-2xl p-3 shadow-pop">
          {icons[t.kind]}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t.title}</div>
            {t.body ? <div className="mt-0.5 text-xs text-(--text-muted)">{t.body}</div> : null}
            {t.action ? (
              <button onClick={() => { t.action!.onClick(); dismiss(t.id); }} className="mt-1 text-xs font-medium text-brand-700 hover:underline">
                {t.action.label}
              </button>
            ) : null}
          </div>
          <button onClick={() => dismiss(t.id)} className="rounded-md p-1 text-(--text-muted) hover:bg-(--surface-2)" aria-label="Schließen">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Dropdown menu                                                       */
/* ------------------------------------------------------------------ */

export function Menu({ trigger, items, align = "right", block, menuClassName }: { trigger: ReactNode; items: { label: ReactNode; onClick: () => void; danger?: boolean; icon?: ReactNode; disabled?: boolean }[]; align?: "left" | "right"; /** Trigger fills the parent width (needed for truncating content). */ block?: boolean; menuClassName?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={ref} className={cls("relative", block ? "block w-full min-w-0" : "inline-block")}>
      <div onClick={() => setOpen((o) => !o)} className={block ? "w-full min-w-0" : undefined}>{trigger}</div>
      {open ? (
        <div className={cls("glass-strong animate-pop-in absolute z-40 mt-1 min-w-44 max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl p-1 text-(--text) shadow-pop", align === "right" ? "right-0" : "left-0", block && "w-full", menuClassName)}>
          {items.map((it, i) => (
            <button key={i} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }} className={cls("flex w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-(--sidebar-hover) disabled:opacity-50", it.danger && "text-red-600")}>
              {it.icon}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
