import { useMemo } from "react";
import { projectStats, todayIso, type Milestone, type Project, type ProjectStats, type Task, type TimeEntry } from "@ordo/core";
import { useList, useVault } from "@/state/hooks";

function groupBy<T extends { projectId?: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.projectId) continue;
    (m.get(r.projectId) ?? m.set(r.projectId, []).get(r.projectId)!).push(r);
  }
  return m;
}

/** Stats for every project of the active profile (grouped once, so lists stay fast). */
export function useAllProjectStats(): Map<string, ProjectStats> {
  const projects = useList("projects");
  const tasks = useList("tasks");
  const entries = useList("timeEntries");
  const milestones = useList("milestones");
  const invoices = useList("invoices");
  const vault = useVault();
  return useMemo(() => {
    const today = todayIso();
    const t = groupBy(tasks);
    const e = groupBy(entries);
    const m = groupBy(milestones);
    const i = groupBy(invoices);
    const out = new Map<string, ProjectStats>();
    for (const p of projects) out.set(p.id, projectStats({ project: p, tasks: t.get(p.id) ?? [], timeEntries: e.get(p.id) ?? [], milestones: m.get(p.id) ?? [], invoices: i.get(p.id) ?? [], members: vault.members, today }));
    return out;
  }, [projects, tasks, entries, milestones, invoices, vault.members]);
}

/** Everything belonging to one project. */
export function useProjectData(projectId: string | undefined): { project?: Project; tasks: Task[]; entries: TimeEntry[]; milestones: Milestone[] } {
  const projects = useList("projects");
  const tasks = useList("tasks");
  const entries = useList("timeEntries");
  const milestones = useList("milestones");
  return useMemo(
    () => ({
      project: projects.find((p) => p.id === projectId),
      tasks: tasks.filter((t) => t.projectId === projectId),
      entries: entries.filter((e) => e.projectId === projectId),
      milestones: milestones.filter((m) => m.projectId === projectId),
    }),
    [projects, tasks, entries, milestones, projectId],
  );
}

/** Milestones by due date (undated last), the order their codes are numbered in. */
export function sortMilestones(milestones: Milestone[]): Milestone[] {
  return [...milestones].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.createdAt.localeCompare(b.createdAt));
}
