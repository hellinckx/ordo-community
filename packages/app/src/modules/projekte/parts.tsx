import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatMinutesClock, parseDuration, type Member, type Project, type TaskStatus } from "@ordo/core";
import { Badge } from "@/components/ui";
import { cls, initials } from "@/lib/format";
import { PROJECT_STATUS, TASK_STATUS, TASK_STATUS_ORDER, fmtH } from "./labels";

export function ProjectStatusBadge({ status }: { status: Project["status"] }) {
  const s = PROJECT_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function Avatar({ member, size = "sm", className }: { member?: Member; size?: "xs" | "sm" | "md"; className?: string }) {
  const sizes = { xs: "h-5 w-5 text-[9px]", sm: "h-6 w-6 text-[10px]", md: "h-8 w-8 text-xs" };
  return (
    <span title={member?.name ?? "Unbekannt"} className={cls("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-(--surface)", sizes[size], className)} style={{ background: member?.color ?? "#8e8e93" }}>
      {member ? initials(member.name) : "?"}
    </span>
  );
}

export function AvatarStack({ ids, byId, max = 3, size = "sm" }: { ids: string[]; byId: Map<string, Member>; max?: number; size?: "xs" | "sm" }) {
  if (!ids.length) return null;
  const shown = ids.slice(0, max);
  return (
    <span className="flex -space-x-1.5">
      {shown.map((id) => <Avatar key={id} member={byId.get(id)} size={size} />)}
      {ids.length > max ? <span className="inline-flex h-6 items-center rounded-full bg-(--surface-2) px-1.5 text-[10px] font-medium text-(--text-muted) ring-2 ring-(--surface)">+{ids.length - max}</span> : null}
    </span>
  );
}

/** Small inline status select (keyboard and touch friendly – a native select). */
export function TaskStatusSelect({ value, onChange, disabled, className }: { value: TaskStatus; onChange: (s: TaskStatus) => void; disabled?: boolean; className?: string }) {
  const s = TASK_STATUS[value];
  return (
    <span className={cls("relative inline-flex items-center", className)}>
      <span className={cls("pointer-events-none absolute left-2 h-2 w-2 rounded-full", s.dot)} />
      <select
        value={value}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value as TaskStatus)}
        aria-label="Status"
        className="h-7 appearance-none rounded-full border border-(--border) bg-(--surface) pl-5.5 pr-2.5 text-xs font-medium text-(--text) hover:bg-(--surface-2) focus:focus-ring disabled:cursor-default disabled:opacity-80 disabled:hover:bg-(--surface)"
      >
        {TASK_STATUS_ORDER.map((k) => <option key={k} value={k}>{TASK_STATUS[k].label}</option>)}
      </select>
    </span>
  );
}

/** Tracked vs. planned: "3,5 / 8 h" with a thin bar that turns red when over. */
export function HoursBar({ trackedMinutes, estimateHours, compact }: { trackedMinutes: number; estimateHours: number; compact?: boolean }) {
  const ratio = estimateHours > 0 ? trackedMinutes / 60 / estimateHours : 0;
  const over = estimateHours > 0 && ratio > 1;
  return (
    <span className={cls("inline-flex flex-col items-end gap-1", compact ? "w-20" : "w-24")}>
      <span className={cls("tabular text-xs", over ? "font-medium text-red-600 dark:text-red-400" : "text-(--text-muted)")}>
        {fmtH(trackedMinutes, { unit: false })}
        {estimateHours > 0 ? ` / ${fmtH(estimateHours * 60)}` : " h"}
      </span>
      {estimateHours > 0 ? (
        <span className="h-1 w-full overflow-hidden rounded-full bg-(--surface-2)">
          <span className={cls("block h-full rounded-full", over ? "bg-red-500" : "bg-brand-600")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </span>
      ) : null}
    </span>
  );
}

/** A plain progress bar with label. */
export function ProgressLine({ value, label, tone = "brand", className }: { value: number; label?: ReactNode; tone?: "brand" | "danger" | "success"; className?: string }) {
  const color = tone === "danger" ? "bg-red-500" : tone === "success" ? "bg-emerald-500" : "bg-brand-600";
  return (
    <div className={className}>
      {label ? <div className="mb-1 flex items-center justify-between gap-2 text-xs text-(--text-muted)">{label}</div> : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--surface-2)">
        <div className={cls("h-full rounded-full transition-all", color)} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
      </div>
    </div>
  );
}

/**
 * Text field for durations: understands "1,5", "1:30", "90m", "2h 15m". Calls onChange with minutes (or null while invalid)
 * and shows what it understood.
 */
export function DurationInput({ minutes, onChange, allowNegative, autoFocus, placeholder = "z. B. 1,5 oder 1:30", id, onEnter, className }: { minutes: number | null; onChange: (m: number | null) => void; allowNegative?: boolean; autoFocus?: boolean; placeholder?: string; id?: string; onEnter?: () => void; className?: string }) {
  const [text, setText] = useState(minutes === null ? "" : formatMinutesClock(minutes).replace("−", "-"));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(minutes === null ? "" : formatMinutesClock(minutes).replace("−", "-"));
  }, [minutes]);
  const parsed = text.trim() ? parseDuration(text, { allowNegative }) : null;
  const invalid = !!text.trim() && parsed === null;
  return (
    <div className={className}>
      <div className="relative">
        <input
          id={id}
          autoFocus={autoFocus}
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          onFocus={(e) => {
            focused.current = true;
            e.target.select();
          }}
          onBlur={() => {
            focused.current = false;
            if (parsed !== null) setText(formatMinutesClock(parsed).replace("−", "-"));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const p = e.target.value.trim() ? parseDuration(e.target.value, { allowNegative }) : null;
            onChange(p);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          className={cls("h-10 w-full rounded-[11px] border bg-(--surface) px-3 pr-14 text-sm tabular text-(--text) placeholder:text-slate-400 focus:focus-ring", invalid ? "border-red-400" : "border-(--border)")}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-(--text-muted)">{parsed !== null ? `${fmtH(parsed)}` : "Std."}</span>
      </div>
      {invalid ? <span className="mt-1 block text-xs text-red-600">So nicht lesbar – versuch „1,5“, „1:30“ oder „90m“.</span> : null}
    </div>
  );
}

/** Horizontally scrollable segmented tabs (for many tabs on small screens). */
export function TabBar<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; badge?: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[data-active='true']");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);
  return (
    <div ref={ref} className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      <div role="tablist" className="flex w-max gap-0.5 rounded-[11px] bg-slate-200/70 p-0.5 dark:bg-slate-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={value === t.id}
            data-active={value === t.id}
            onClick={() => onChange(t.id)}
            className={cls("flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition-all", value === t.id ? "bg-(--surface) text-(--text) shadow-[0_1px_3px_rgb(0_0_0/0.1)] dark:bg-slate-600" : "text-(--text-muted) hover:text-(--text)")}
          >
            {t.label}
            {t.badge}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Toggle chips for picking team members. */
export function MemberChips({ members, value, onChange, disabled }: { members: Member[]; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  if (!members.length) return <p className="text-xs text-(--text-muted)">Noch kein Team angelegt – unter Team kannst du Personen hinzufügen.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((m) => {
        const on = value.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}
            className={cls("inline-flex h-8 items-center gap-1.5 rounded-full border pl-1 pr-3 text-[13px] transition-colors disabled:opacity-60", on ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200" : "border-(--border) bg-(--surface) hover:bg-(--surface-2)")}
          >
            <Avatar member={m} size="xs" />
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

/** Small label + value pair used in info lists. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-(--text-muted)">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{children}</span>
    </div>
  );
}

export function KeyHint({ children }: { children: ReactNode }) {
  return <span className="hidden text-[11px] text-(--text-muted) sm:inline">{children}</span>;
}
