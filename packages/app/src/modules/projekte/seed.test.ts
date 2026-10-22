import { describe, expect, it } from "vitest";
import { VaultSchema, projectStats, seedDemoVault, todayIso, type Vault, type VaultStore } from "@ordo/core";
import { seedProjekteDemo } from "./seed";

function fakeStore(vault: Vault): VaultStore {
  const store = {
    vault,
    mutate(fn: (v: Vault) => void) {
      const next = { ...store.vault };
      fn(next);
      store.vault = next;
    },
  };
  return store as unknown as VaultStore;
}

describe("seedProjekteDemo", () => {
  const now = new Date().toISOString();
  const vault = VaultSchema.parse({ createdAt: now, updatedAt: now });
  seedDemoVault(vault);
  const business = vault.profiles.find((p) => p.mode === "business")!;
  const store = fakeStore(vault);
  seedProjekteDemo(store, business.id);
  const v = store.vault;
  const today = todayIso();

  it("creates three numbered projects with a team", () => {
    expect(v.projects).toHaveLength(3);
    expect(v.projects.map((p) => p.number)).toEqual(["P-0001", "P-0002", "P-0003"]);
    expect(v.settings.projects.nextProjectNumber).toBe(4);
    expect(v.members.length).toBeGreaterThanOrEqual(3);
    expect(v.projects.map((p) => p.status).sort()).toEqual(["active", "completed", "planning"]);
    expect(v.projects.every((p) => p.customerId && v.contacts.some((c) => c.id === p.customerId))).toBe(true);
  });

  it("plans tasks and milestones", () => {
    expect(v.tasks.length).toBeGreaterThan(25);
    expect(v.tasks.every((t) => t.startDate && t.dueDate && t.startDate <= t.dueDate)).toBe(true);
    expect(v.milestones).toHaveLength(6);
    expect(v.milestones.every((m) => m.dueDate && m.taskIds.length)).toBe(true);
    const completed = v.projects.find((p) => p.status === "completed")!;
    expect(v.tasks.filter((t) => t.projectId === completed.id).every((t) => t.status === "done")).toBe(true);
  });

  it("books plausible time in the past six weeks", () => {
    expect(v.timeEntries.length).toBeGreaterThan(40);
    expect(v.timeEntries.every((e) => e.minutes > 0 && e.date <= today)).toBe(true);
    for (const p of v.projects) {
      const s = projectStats({ project: p, tasks: v.tasks, timeEntries: v.timeEntries, milestones: v.milestones, invoices: v.invoices, members: v.members, today });
      expect(s.trackedMinutes).toBeGreaterThan(0);
    }
  });

  it("links the matching demo invoices", () => {
    expect(v.invoices.filter((i) => i.projectId).length).toBeGreaterThanOrEqual(1);
  });
});
