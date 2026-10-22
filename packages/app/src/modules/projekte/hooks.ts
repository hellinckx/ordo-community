import { useEffect, useMemo, useState } from "react";
import { can, ids, nowIso, timeEntryRates, timerFor, timerElapsedMinutes, todayIso, type Member, type Project, type RunningTimer, type Task, type TimeEntry } from "@ordo/core";
import { useList, useProfile, useVault } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { useMe } from "@/modules/registry";

export interface ProjectRights {
  member?: Member;
  /** Create and change projects, tasks and milestones. */
  canWrite: boolean;
  /** Delete projects and change project settings. */
  canAdmin: boolean;
  /** May change tasks assigned to them. */
  canOwnTasks: boolean;
  /** Book time for anyone and change every entry. */
  canWriteTime: boolean;
  /** Book own time. */
  canOwnTime: boolean;
  /** Budget, costs and margins are visible. */
  canSeeMoney: boolean;
  canEditTask(t: Task): boolean;
  canEditEntry(e: TimeEntry): boolean;
}

export function useProjectRights(): ProjectRights {
  const { member, role } = useMe();
  return useMemo(() => {
    const canWrite = can(role, "projects", "write");
    const canOwnTasks = can(role, "projects", "own");
    const canWriteTime = can(role, "time", "write");
    const canOwnTime = can(role, "time", "own");
    return {
      member,
      canWrite,
      canAdmin: can(role, "projects", "admin"),
      canOwnTasks,
      canWriteTime,
      canOwnTime,
      canSeeMoney: can(role, "projects", "write") || can(role, "summa", "read"),
      canEditTask: (t) => canWrite || (canOwnTasks && !!member && t.assigneeIds.includes(member.id)),
      canEditEntry: (e) => canWriteTime || (canOwnTime && (e.memberId ?? "") === (member?.id ?? "")),
    };
  }, [member, role]);
}

/** Active team members, sorted by name, and a map of all (incl. inactive) by id. */
export function useMembers(): { active: Member[]; byId: Map<string, Member> } {
  const vault = useVault();
  return useMemo(() => {
    const all = vault.members.filter((m) => !m.deletedAt);
    return { active: all.filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name, "de")), byId: new Map(vault.members.map((m) => [m.id, m])) };
  }, [vault.members]);
}

export function useProjectsById(): Map<string, Project> {
  const projects = useList("projects");
  return useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
}

/** Re-renders every `ms` (for live stopwatches). */
export function useTick(ms = 1000, enabled = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
  return n;
}

/* ------------------------------------------------------------------ */
/* Stopwatch                                                           */
/* ------------------------------------------------------------------ */

export function useTimers(): RunningTimer[] {
  return useVault().settings.timers;
}

export function useMyTimer(): RunningTimer | undefined {
  const timers = useTimers();
  const { member } = useMe();
  return timerFor(timers, member?.id);
}

export function startTimer(memberId: string | undefined, t: { projectId: string; taskId?: string; description?: string }): void {
  requireStore().mutate((v) => {
    const others = v.settings.timers.filter((x) => (x.memberId ?? "") !== (memberId ?? ""));
    v.settings = { ...v.settings, timers: [...others, { memberId, projectId: t.projectId, taskId: t.taskId, description: t.description ?? "", startedAt: nowIso() }] };
  }, { audit: { action: "timer.start", entity: "timeEntries", details: t.projectId } });
}

export function updateTimer(memberId: string | undefined, patch: Partial<RunningTimer>): void {
  requireStore().mutate((v) => {
    v.settings = { ...v.settings, timers: v.settings.timers.map((x) => ((x.memberId ?? "") === (memberId ?? "") ? { ...x, ...patch } : x)) };
  });
}

export function discardTimer(memberId: string | undefined): void {
  requireStore().mutate((v) => {
    v.settings = { ...v.settings, timers: v.settings.timers.filter((x) => (x.memberId ?? "") !== (memberId ?? "")) };
  }, { audit: { action: "timer.discard", entity: "timeEntries" } });
}

/** Stops the stopwatch and books the time. `minutes` overrides the measured time (e.g. after forgetting to stop). */
export function stopTimer(memberId: string | undefined, profileId: string, minutesOverride?: number): TimeEntry | undefined {
  const store = requireStore();
  const timer = timerFor(store.vault.settings.timers, memberId);
  if (!timer) return undefined;
  const now = new Date();
  const minutes = Math.max(1, Math.round(minutesOverride ?? timerElapsedMinutes(timer, now)));
  const project = store.vault.projects.find((p) => p.id === timer.projectId);
  const member = memberId ? store.vault.members.find((m) => m.id === memberId) : undefined;
  const ts = nowIso();
  const entry: TimeEntry = {
    id: ids.timeEntry(),
    profileId: project?.profileId ?? profileId,
    projectId: timer.projectId,
    taskId: timer.taskId,
    memberId,
    date: todayIso(new Date(timer.startedAt)),
    minutes,
    description: timer.description,
    billable: project ? project.billing !== "internal" : true,
    startedAt: timer.startedAt,
    endedAt: now.toISOString(),
    ...timeEntryRates(project, member),
    createdAt: ts,
    updatedAt: ts,
  };
  store.mutate((v) => {
    v.timeEntries = [...v.timeEntries, entry];
    v.settings = { ...v.settings, timers: v.settings.timers.filter((x) => (x.memberId ?? "") !== (memberId ?? "")) };
  }, { audit: { action: "timer.stop", entity: "timeEntries", entityId: entry.id } });
  return entry;
}

/** Starts a stopwatch; a running one of the same person is stopped and booked first. Returns the booked entry, if any. */
export function switchTimer(memberId: string | undefined, profileId: string, t: { projectId: string; taskId?: string; description?: string }): TimeEntry | undefined {
  const running = timerFor(requireStore().vault.settings.timers, memberId);
  const booked = running ? stopTimer(memberId, profileId) : undefined;
  startTimer(memberId, t);
  return booked;
}

/** Books a new time entry with rate snapshots. */
export function bookTime(input: Omit<TimeEntry, "id" | "createdAt" | "updatedAt" | "rateCents" | "costCents"> & { rateCents?: number; costCents?: number }): TimeEntry {
  const store = requireStore();
  const project = store.vault.projects.find((p) => p.id === input.projectId);
  const member = input.memberId ? store.vault.members.find((m) => m.id === input.memberId) : undefined;
  const ts = nowIso();
  const entry: TimeEntry = { ...timeEntryRates(project, member), ...input, id: ids.timeEntry(), createdAt: ts, updatedAt: ts };
  store.insert("timeEntries", entry, "time.create");
  return entry;
}

/** Helper for pages: "?neu=1" opens a dialog once and is then removed from the URL. */
export function useNewParam(params: URLSearchParams, setParams: (p: URLSearchParams, o?: { replace?: boolean }) => void, open: () => void): void {
  useEffect(() => {
    if (params.get("neu") !== "1") return;
    open();
    const next = new URLSearchParams(params);
    next.delete("neu");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
}

export function useProfileId(): string {
  return useProfile().id;
}
