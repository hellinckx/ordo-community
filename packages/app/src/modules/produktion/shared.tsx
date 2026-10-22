import { useMemo } from "react";
import { can, formatNumber, todayIso, type Member, type Priority, type Vault, type WorkOrder, type WorkOrderStatus } from "@ordo/core";
import { useList } from "@/state/hooks";
import { useMe } from "@/modules/registry";
import { Badge } from "@/components/ui";
import { cls, fmtDate, initials } from "@/lib/format";

export const STATUS_LABELS: Record<WorkOrderStatus, string> = { planned: "Geplant", released: "Freigegeben", in_progress: "In Arbeit", done: "Fertig", cancelled: "Storniert" };
export const BOARD_STATUSES: WorkOrderStatus[] = ["planned", "released", "in_progress", "done"];
export const PRIORITY_LABELS: Record<Priority, string> = { low: "Niedrig", medium: "Normal", high: "Hoch", urgent: "Dringend" };

export function StatusBadge({ status }: { status: WorkOrderStatus }) {
  const tone = status === "done" ? "success" : status === "in_progress" ? "brand" : status === "released" ? "info" : status === "cancelled" ? "danger" : "neutral";
  return <Badge tone={tone}>{STATUS_LABELS[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "medium") return null;
  return <Badge tone={priority === "urgent" ? "danger" : priority === "high" ? "warning" : "neutral"}>{PRIORITY_LABELS[priority]}</Badge>;
}

/** What the person may do in Produktion. "own" = may tick and time their own work steps. */
export function useProductionAccess() {
  const { role, member } = useMe();
  return useMemo(
    () => ({ me: member, canRead: can(role, "production", "read"), canOwn: can(role, "production", "own"), canWrite: can(role, "production", "write"), canAdmin: can(role, "production", "admin") }),
    [role, member],
  );
}

/** Active team members, by name. */
export function useMembers(): Member[] {
  const list = useList("members");
  return useMemo(() => list.filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name, "de")), [list]);
}

/** Hourly cost for production labour: average internal hourly cost of the active team (0 when none is set). */
export function useLabourRate(): { cents: number; fromTeam: boolean } {
  const members = useMembers();
  return useMemo(() => {
    const rates = members.map((m) => m.hourlyCostCents).filter((c) => c > 0);
    if (!rates.length) return { cents: 0, fromTeam: false };
    return { cents: Math.round(rates.reduce((s, c) => s + c, 0) / rates.length), fromTeam: true };
  }, [members]);
}

export function MemberAvatar({ member, className }: { member: Pick<Member, "name" | "color"> | undefined; className?: string }) {
  if (!member) return null;
  return (
    <span title={member.name} className={cls("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-(--surface)", className)} style={{ background: member.color || "#8e8e93" }}>
      {initials(member.name)}
    </span>
  );
}

/** Takes the next work order number and counts up. Call inside `store.mutate`. */
export function takeWorkOrderNumber(v: Vault, date: string = todayIso()): string {
  const s = v.settings.projects;
  const number = formatNumber(s.workOrderNumberPattern || "FA-{YYYY}-{NNNN}", s.nextWorkOrderNumber, date);
  v.settings = { ...v.settings, projects: { ...s, nextWorkOrderNumber: s.nextWorkOrderNumber + 1 } };
  return number;
}

export function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (Math.abs(m) < 60) return `${m} min`;
  const h = Math.floor(Math.abs(m) / 60);
  const r = Math.abs(m) % 60;
  return `${m < 0 ? "−" : ""}${h} h${r ? ` ${r} min` : ""}`;
}

/** Monday of the week of `iso` and the Sunday after. */
export function weekRange(iso: string = todayIso()): { from: string; to: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  const dow = (dt.getDay() + 6) % 7;
  const mon = new Date(y!, m! - 1, d! - dow);
  const sun = new Date(y!, m! - 1, d! - dow + 6);
  const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: f(mon), to: f(sun) };
}

/** Due date in words: overdue, today, tomorrow, in n days. */
export function dueInfo(wo: Pick<WorkOrder, "dueDate" | "status">): { label: string; tone: "danger" | "warning" | "neutral" } | null {
  if (!wo.dueDate) return null;
  if (wo.status === "done" || wo.status === "cancelled") return { label: fmtDate(wo.dueDate), tone: "neutral" };
  const today = todayIso();
  const days = Math.round((new Date(wo.dueDate).getTime() - new Date(today).getTime()) / 86400000);
  if (days < 0) return { label: `${-days} ${days === -1 ? "Tag" : "Tage"} überfällig`, tone: "danger" };
  if (days === 0) return { label: "heute fällig", tone: "warning" };
  if (days === 1) return { label: "morgen fällig", tone: "warning" };
  if (days <= 7) return { label: `in ${days} Tagen`, tone: "neutral" };
  return { label: fmtDate(wo.dueDate), tone: "neutral" };
}
