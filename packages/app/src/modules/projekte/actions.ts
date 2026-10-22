import { ids, nowIso, nextTaskOrder, taskDescendantIds, type Milestone, type Task, type TaskStatus, type Vault } from "@ordo/core";
import { requireStore } from "@/state/session";

/** Status change incl. completedAt bookkeeping. */
export function setTaskStatus(task: Task, status: TaskStatus): void {
  if (task.status === status) return;
  requireStore().update("tasks", task.id, { status, completedAt: status === "done" ? task.completedAt ?? nowIso() : undefined }, "task.status");
}

/** Keeps milestone.taskIds in step with task.milestoneId (inside a mutate). */
function syncMilestoneLink(v: Vault, taskId: string, milestoneId: string | undefined): void {
  const now = nowIso();
  v.milestones = v.milestones.map((m) => {
    const has = m.taskIds.includes(taskId);
    if (m.id === milestoneId && !has) return { ...m, taskIds: [...m.taskIds, taskId], updatedAt: now };
    if (m.id !== milestoneId && has) return { ...m, taskIds: m.taskIds.filter((x) => x !== taskId), updatedAt: now };
    return m;
  });
}

export type TaskFields = Pick<Task, "title" | "description" | "status" | "priority" | "estimateHours" | "startDate" | "dueDate" | "assigneeIds" | "milestoneId" | "parentId">;

export function createTask(profileId: string, projectId: string, fields: Partial<TaskFields> & { title: string }): Task {
  const store = requireStore();
  const now = nowIso();
  const status = fields.status ?? "todo";
  const task: Task = {
    id: ids.task(),
    profileId,
    projectId,
    order: nextTaskOrder(store.vault.tasks, projectId, fields.parentId),
    description: "",
    priority: "medium",
    estimateHours: 0,
    assigneeIds: [],
    ...fields,
    status,
    completedAt: status === "done" ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };
  store.mutate((v) => {
    v.tasks = [...v.tasks, task];
    if (task.milestoneId) syncMilestoneLink(v, task.id, task.milestoneId);
  }, { audit: { action: "task.create", entity: "tasks", entityId: task.id } });
  return task;
}

export function updateTask(task: Task, fields: Partial<TaskFields>): void {
  const store = requireStore();
  const now = nowIso();
  store.mutate((v) => {
    v.tasks = v.tasks.map((t) => {
      if (t.id !== task.id) return t;
      const next: Task = { ...t, ...fields, updatedAt: now };
      if ("parentId" in fields && (t.parentId ?? "") !== (next.parentId ?? "")) next.order = nextTaskOrder(v.tasks, t.projectId, next.parentId);
      if (fields.status && fields.status !== t.status) next.completedAt = fields.status === "done" ? t.completedAt ?? now : undefined;
      return next;
    });
    if ("milestoneId" in fields) syncMilestoneLink(v, task.id, fields.milestoneId);
  }, { audit: { action: "task.update", entity: "tasks", entityId: task.id } });
}

/** Minutes booked on the task and everything below it. */
export function bookedMinutesInTree(v: Vault, taskId: string): number {
  const scope = new Set([taskId, ...taskDescendantIds(v.tasks, taskId)]);
  return v.timeEntries.filter((e) => !e.deletedAt && e.taskId && scope.has(e.taskId)).reduce((s, e) => s + e.minutes, 0);
}

/** Soft-deletes a task with its children and unlinks milestones. Refuses when time is booked (returns false). */
export function deleteTaskTree(task: Task): boolean {
  const store = requireStore();
  if (bookedMinutesInTree(store.vault, task.id) !== 0) return false;
  const scope = new Set([task.id, ...taskDescendantIds(store.vault.tasks, task.id)]);
  const now = nowIso();
  store.mutate((v) => {
    v.tasks = v.tasks.map((t) => (scope.has(t.id) ? { ...t, deletedAt: now, updatedAt: now } : t));
    v.milestones = v.milestones.map((m) => (m.taskIds.some((x) => scope.has(x)) ? { ...m, taskIds: m.taskIds.filter((x) => !scope.has(x)), updatedAt: now } : m));
  }, { audit: { action: "task.delete", entity: "tasks", entityId: task.id, details: `${scope.size}` } });
  return true;
}

/** Writes new sibling orders (and optionally a new parent for one task). */
export function applyTaskOrder(order: Map<string, number>, reparent?: { id: string; parentId: string | undefined }): void {
  const now = nowIso();
  requireStore().mutate((v) => {
    v.tasks = v.tasks.map((t) => {
      const o = order.get(t.id);
      const moved = reparent && reparent.id === t.id;
      if (o === undefined && !moved) return t;
      return { ...t, order: o ?? t.order, parentId: moved ? reparent!.parentId : t.parentId, updatedAt: now };
    });
  }, { audit: { action: "task.reorder", entity: "tasks" } });
}

/** Milestone save incl. two-way task links. */
export function saveMilestone(m: Milestone, taskIds: string[]): void {
  const now = nowIso();
  const linked = new Set(taskIds);
  requireStore().mutate((v) => {
    const exists = v.milestones.some((x) => x.id === m.id);
    const next = { ...m, taskIds, updatedAt: now };
    v.milestones = exists ? v.milestones.map((x) => (x.id === m.id ? next : x)) : [...v.milestones, next];
    v.tasks = v.tasks.map((t) => {
      if (linked.has(t.id) && t.milestoneId !== m.id) return { ...t, milestoneId: m.id, updatedAt: now };
      if (!linked.has(t.id) && t.milestoneId === m.id) return { ...t, milestoneId: undefined, updatedAt: now };
      return t;
    });
    // a task belongs to one milestone: drop it from others
    v.milestones = v.milestones.map((x) => (x.id !== m.id && x.taskIds.some((id) => linked.has(id)) ? { ...x, taskIds: x.taskIds.filter((id) => !linked.has(id)), updatedAt: now } : x));
  }, { audit: { action: exists(m.id) ? "milestone.update" : "milestone.create", entity: "milestones", entityId: m.id } });
}

function exists(milestoneId: string): boolean {
  return requireStore().vault.milestones.some((x) => x.id === milestoneId);
}

export function deleteMilestone(m: Milestone): void {
  const now = nowIso();
  requireStore().mutate((v) => {
    v.milestones = v.milestones.map((x) => (x.id === m.id ? { ...x, deletedAt: now, updatedAt: now } : x));
    v.tasks = v.tasks.map((t) => (t.milestoneId === m.id ? { ...t, milestoneId: undefined, updatedAt: now } : t));
  }, { audit: { action: "milestone.delete", entity: "milestones", entityId: m.id } });
}

export function setMilestoneStatus(m: Milestone, status: Milestone["status"]): void {
  requireStore().update("milestones", m.id, { status, completedAt: status === "done" ? m.completedAt ?? nowIso() : undefined }, "milestone.status");
}
