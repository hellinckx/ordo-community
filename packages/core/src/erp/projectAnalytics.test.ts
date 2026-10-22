import { describe, expect, it } from "vitest";
import type { Invoice } from "../model/types";
import type { Member, Milestone, Project, Task, TimeEntry } from "./schemas";
import { projectStats } from "./projects";
import { projectAnalytics, projectRisk, teamLoad } from "./projectAnalytics";
import { seesAllTime } from "./permissions";

const NOW = "2026-10-01T08:00:00.000Z";

function project(extra: Partial<Project> = {}): Project {
  return {
    id: "p1", profileId: "prf", number: "P-0001", name: "Website", description: "", status: "active", budgetCents: 1_000_000, budgetHours: 100,
    billing: "fixed", hourlyRateCents: 9000, memberIds: [], hoursPerDay: 6, color: "#0a5fe0", tags: [], notes: "", createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

let seq = 0;
function task(id: string, extra: Partial<Task> = {}): Task {
  seq++;
  return { id, profileId: "prf", projectId: "p1", order: 0, title: id, description: "", status: "todo", priority: "medium", estimateHours: 0, assigneeIds: [], createdAt: `2026-10-01T08:00:${String(seq % 60).padStart(2, "0")}.000Z`, updatedAt: NOW, ...extra };
}

function entry(id: string, minutes: number, extra: Partial<TimeEntry> = {}): TimeEntry {
  return { id, profileId: "prf", projectId: "p1", date: "2026-10-10", minutes, description: "", billable: true, createdAt: NOW, updatedAt: NOW, ...extra };
}

function member(id: string, extra: Partial<Member> = {}): Member {
  return { id, name: id, email: "", role: "member", title: "", hourlyCostCents: 4000, hourlyRateCents: 9000, weeklyHours: 38.5, color: "#000", active: true, phone: "", notes: "", createdAt: NOW, updatedAt: NOW, ...extra };
}

function milestone(id: string, extra: Partial<Milestone> = {}): Milestone {
  return { id, profileId: "prf", projectId: "p1", title: id, description: "", status: "open", taskIds: [], createdAt: NOW, updatedAt: NOW, ...extra };
}

function invoice(id: string, lines: { q: number; c: number; d?: number }[], extra: Partial<Invoice> = {}): Invoice {
  return {
    id, profileId: "prf", number: id, kind: "invoice", customerSnapshot: { name: "", street: "", zip: "", city: "", country: "AT", uid: "", email: "" }, issueDate: "2026-10-01", dueDate: "2026-10-15",
    servicePeriod: "", lines: lines.map((l, i) => ({ id: `${id}-${i}`, description: "", quantity: l.q, unit: "Stk", unitNetCents: l.c, vatRate: 20, discountPct: l.d ?? 0 })), introText: "", footerText: "", status: "sent", paidCents: 0,
    vatTreatment: "standard", reference: "", projectId: "p1", createdAt: NOW, updatedAt: NOW, ...extra,
  };
}

describe("projectAnalytics", () => {
  // two work packages: A (10 h estimate, half done) and B (10 h, nothing done); 100 h planned from 1.10. to 30.11.
  const p = project({ startDate: "2026-10-01", endDate: "2026-11-30", budgetHours: 0 });
  const tasks = [task("A"), task("a1", { parentId: "A", estimateHours: 5, status: "done" }), task("a2", { parentId: "A", estimateHours: 5 }), task("B"), task("b1", { parentId: "B", estimateHours: 10, dueDate: "2026-10-05" })];
  const entries = [entry("e1", 6 * 60, { taskId: "a1", memberId: "m1", date: "2026-10-05" }), entry("e2", 2 * 60, { taskId: "a2", memberId: "m2", date: "2026-10-13", billable: false }), entry("e3", 60, { taskId: "b1", memberId: "m1", date: "2026-10-14" })];
  const a = projectAnalytics({ project: p, tasks, entries, today: "2026-10-15" });

  it("puts booked hours into weeks with a running total and the plan line", () => {
    expect(a.weeks[0]!.week).toBe("2026-09-28");
    expect(a.weeks.find((w) => w.week === "2026-10-12")).toMatchObject({ minutes: 180, billableMinutes: 60, cumulativeMinutes: 540 });
    expect(a.weeks.at(-1)!.planHours).toBe(20);
    expect(a.weeks.at(-1)!.week).toBe("2026-11-30");
  });

  it("forecasts from effort per progress and the recent pace", () => {
    expect(a.forecast.plannedHours).toBe(20);
    expect(a.forecast.progress).toBeCloseTo(0.25);
    expect(a.forecast.forecastHours).toBeCloseTo(36);
    expect(a.forecast.overrunHours).toBeCloseTo(16);
    expect(a.forecast.weeklyHours).toBeCloseTo(9 / 4);
    expect(a.forecast.remainingHours).toBeCloseTo(27);
    expect(a.forecast.expectedEnd! > "2026-11-30").toBe(true);
    expect(a.forecast.late).toBe(true);
  });

  it("lists packages, people and task status", () => {
    expect(a.packages.map((r) => [r.number, r.title, r.trackedMinutes])).toEqual([["1", "A", 480], ["2", "B", 60]]);
    expect(a.packages[0]!.overHours).toBeCloseTo(8 - 5);
    expect(a.people[0]).toMatchObject({ memberId: "m1", minutes: 420, billableMinutes: 420 });
    expect(a.status).toMatchObject({ todo: 2, done: 1, overdue: 1 });
  });

  it("names the risks of a project", () => {
    const stats = projectStats({ project: p, tasks, timeEntries: entries, milestones: [], invoices: [], members: [member("m1"), member("m2")], today: "2026-10-15" });
    const r = projectRisk({ project: p, stats, forecast: a.forecast, milestones: [milestone("M", { dueDate: "2026-10-10" })], today: "2026-10-15" });
    expect(r?.level).toBe("high");
    expect(r?.reasons).toEqual(expect.arrayContaining(["Prognose 80 % über Plan", "1 Meilenstein überfällig", "Wird beim jetzigen Tempo nach dem Enddatum fertig", "1 Aufgabe überfällig"]));
    expect(projectRisk({ project: { ...p, status: "completed" }, stats, forecast: a.forecast, milestones: [], today: "2026-10-15" })).toBeNull();
  });

  it("leaves money reasons out completely without the right to see money – level included", () => {
    // on plan in hours and dates, but the margin is negative: a reason only about money
    const fine = { ...a.forecast, plannedHours: 0, overrunHours: null, late: false };
    const loss = { ...projectStats({ project: p, tasks: [], timeEntries: [], milestones: [], invoices: [], members: [], today: "2026-10-15" }), marginPct: -0.2 };
    expect(projectRisk({ project: p, stats: loss, forecast: fine, milestones: [], today: "2026-10-15" })).toEqual({ level: "high", reasons: ["Marge negativ"] });
    expect(projectRisk({ project: p, stats: loss, forecast: fine, milestones: [], today: "2026-10-15", money: false })).toBeNull();
  });
});

describe("teamLoad", () => {
  it("compares booked time with each person's capacity", () => {
    const tasks = [task("t1", { assigneeIds: ["m1"], dueDate: "2026-10-01" }), task("t2", { assigneeIds: ["m1"], status: "done" })];
    const entries = [entry("e1", 20 * 60, { memberId: "m1", date: "2026-10-06" }), entry("e2", 10 * 60, { memberId: "m1", date: "2026-10-07", billable: false }), entry("e3", 60, { memberId: "m2", date: "2026-09-01" })];
    const load = teamLoad({ members: [member("m1", { weeklyHours: 40 }), member("m2"), member("m3", { active: false })], entries, tasks, from: "2026-10-05", to: "2026-10-09", today: "2026-10-09" });
    expect(load.map((l) => l.memberId)).toEqual(["m1", "m2"]);
    expect(load[0]).toMatchObject({ capacityMinutes: 2400, bookedMinutes: 1800, utilization: 0.75, openTasks: 1, overdueTasks: 1 });
    expect(load[0]!.billableShare).toBeCloseTo(2 / 3);
    expect(load[0]!.byProject).toEqual({ p1: 1800 });
  });
});

describe("seesAllTime", () => {
  it("lets every role see everyone's time except Mitarbeit", () => {
    expect(["owner", "admin", "manager", "viewer"].every((r) => seesAllTime(r as never))).toBe(true);
    expect(seesAllTime("member")).toBe(false);
  });
});
