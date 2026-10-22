import { describe, expect, it } from "vitest";
import type { Invoice } from "../model/types";
import type { Member, Milestone, Project, Task, TimeEntry } from "./schemas";
import {
  addWorkdaysIso,
  autoSchedule,
  buildTaskTree,
  cleanTaskTitle,
  flattenTaskTree,
  formatMinutesClock,
  invoiceNetForProject,
  isoWeekNumber,
  isTaskOverdue,
  milestoneCode,
  milestoneProgress,
  moveTaskOrder,
  nextWorkdayIso,
  overdueDays,
  parseDuration,
  placeTaskOrder,
  projectInvoiceReminder,
  projectStats,
  taskDescendantIds,
  taskNumbers,
  taskRollups,
  timeEntryRates,
  weekGrid,
  weekOfIso,
  workdaysBetweenIso,
} from "./projects";

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

describe("parseDuration", () => {
  it.each([
    ["1,5", 90],
    ["1.5", 90],
    ["1:30", 90],
    ["0:45", 45],
    ["90m", 90],
    ["90 min", 90],
    ["2h", 120],
    ["2 Std", 120],
    ["2h 15m", 135],
    ["2h15", 135],
    ["1,5h", 90],
    ["8", 480],
    ["  3 h ", 180],
  ])("%s → %d", (input, expected) => expect(parseDuration(input)).toBe(expected));

  it("rejects nonsense", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("1:75")).toBeNull();
    expect(parseDuration("-1")).toBeNull();
  });

  it("allows negative values for corrections", () => {
    expect(parseDuration("-0,5", { allowNegative: true })).toBe(-30);
    expect(parseDuration("-1:15", { allowNegative: true })).toBe(-75);
  });

  it("formats minutes as clock", () => {
    expect(formatMinutesClock(90)).toBe("1:30");
    expect(formatMinutesClock(5)).toBe("0:05");
    expect(formatMinutesClock(-75)).toBe("−1:15");
  });
});

describe("dates", () => {
  it("skips weekends", () => {
    expect(nextWorkdayIso("2026-10-03")).toBe("2026-10-05"); // Sat → Mon
    expect(nextWorkdayIso("2026-10-05")).toBe("2026-10-05");
    expect(addWorkdaysIso("2026-10-02", 1)).toBe("2026-10-05"); // Fri + 1 → Mon
    expect(addWorkdaysIso("2026-10-05", -1)).toBe("2026-10-02");
    expect(workdaysBetweenIso("2026-10-01", "2026-10-07")).toBe(5);
  });
  it("gives the week and its number", () => {
    expect(weekOfIso("2026-10-21")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(isoWeekNumber("2026-10-21")).toBe(43);
    expect(isoWeekNumber("2027-01-01")).toBe(53);
  });
});

describe("task tree", () => {
  const tasks = [
    task("b", { order: 1 }),
    task("a", { order: 0 }),
    task("a2", { parentId: "a", order: 1 }),
    task("a1", { parentId: "a", order: 0 }),
    task("a1x", { parentId: "a1", order: 0 }),
    task("gone", { deletedAt: NOW }),
    task("orphan", { parentId: "missing", order: 5 }),
  ];

  it("numbers in order and marks work packages", () => {
    const nums = taskNumbers(tasks);
    expect(nums.get("a")).toBe("1");
    expect(nums.get("a1")).toBe("1.1");
    expect(nums.get("a1x")).toBe("1.1.1");
    expect(nums.get("a2")).toBe("1.2");
    expect(nums.get("b")).toBe("2");
    expect(nums.get("orphan")).toBe("3");
    expect(nums.has("gone")).toBe(false);
    const roots = buildTaskTree(tasks);
    expect(roots[0]!.isPackage).toBe(true);
    expect(roots[1]!.isPackage).toBe(false);
  });

  it("hides children of collapsed nodes", () => {
    const flat = flattenTaskTree(buildTaskTree(tasks), new Set(["a"]));
    expect(flat.map((n) => n.task.id)).toEqual(["a", "b", "orphan"]);
  });

  it("survives a parent loop", () => {
    const loop = [task("x", { parentId: "y" }), task("y", { parentId: "x" })];
    expect(flattenTaskTree(buildTaskTree(loop)).length).toBe(2);
  });

  it("finds descendants", () => {
    expect([...taskDescendantIds(tasks, "a")].sort()).toEqual(["a1", "a1x", "a2"]);
  });

  it("moves among siblings", () => {
    const order = moveTaskOrder(tasks, "a2", -1)!;
    expect(order.get("a2")).toBe(0);
    expect(order.get("a1")).toBe(1);
    expect(moveTaskOrder(tasks, "a1", -1)).toBeNull();
    const placed = placeTaskOrder(tasks, "b", "a", "a2");
    expect([...placed.entries()].sort((x, y) => x[1] - y[1]).map((x) => x[0])).toEqual(["a1", "b", "a2"]);
  });

  it("cleans typed numbering from titles", () => {
    expect(cleanTaskTitle("1.2. Entwurf")).toBe("Entwurf");
    expect(cleanTaskTitle("3. Umsetzung")).toBe("Umsetzung");
    expect(cleanTaskTitle("2.1 Umsetzung")).toBe("Umsetzung");
    expect(cleanTaskTitle("3 Entwürfe erstellen")).toBe("3 Entwürfe erstellen");
    expect(cleanTaskTitle("2026 Planung")).toBe("2026 Planung");
    expect(cleanTaskTitle("Logo")).toBe("Logo");
  });
});

describe("roll-ups", () => {
  const tasks = [
    task("wp", { order: 0, estimateHours: 99 }),
    task("t1", { parentId: "wp", order: 0, estimateHours: 6, status: "done" }),
    task("t2", { parentId: "wp", order: 1, estimateHours: 2 }),
    task("solo", { order: 1, estimateHours: 4 }),
  ];
  const entries = [entry("e1", 120, { taskId: "t1" }), entry("e2", 60, { taskId: "t2" }), entry("e3", 30, { taskId: "wp" }), entry("e4", 45, { taskId: "solo", deletedAt: NOW })];

  it("sums time and estimates up the tree", () => {
    const r = taskRollups(tasks, entries);
    expect(r.get("wp")!.trackedMinutes).toBe(210);
    expect(r.get("wp")!.ownMinutes).toBe(30);
    expect(r.get("wp")!.estimateHours).toBe(8);
    expect(r.get("wp")!.progress).toBeCloseTo(6 / 8);
    expect(r.get("solo")!.trackedMinutes).toBe(0);
  });
});

describe("projectStats", () => {
  const tasks = [task("t1", { status: "done", estimateHours: 4 }), task("t2", { dueDate: "2026-10-05", estimateHours: 4 }), task("x", { projectId: "other" })];
  const entries = [
    entry("e1", 120, { memberId: "m1", date: "2026-10-18" }),
    entry("e2", 60, { memberId: "m1", billable: false, date: "2026-10-01" }),
    entry("e3", 60, { memberId: "m2", costCents: 6000, rateCents: 12000, date: "2026-10-20" }),
    entry("e4", 600, { projectId: "other" }),
  ];
  const members = [member("m1"), member("m2", { hourlyCostCents: 5000 })];
  const invoices = [
    invoice("i1", [{ q: 1, c: 300_000 }], { discountPct: 10 }),
    invoice("i2", [{ q: 2, c: 100_000, d: 50 }]),
    invoice("i3", [{ q: 1, c: 500_000 }], { status: "cancelled" }),
    invoice("i4", [{ q: 1, c: 50_000 }], { kind: "credit_note" }),
    invoice("i5", [{ q: 1, c: 999 }], { projectId: "other" }),
  ];
  const ms = [milestone("m-late", { dueDate: "2026-10-10" }), milestone("m-next", { dueDate: "2026-11-01" }), milestone("m-done", { dueDate: "2026-09-01", status: "done" })];
  const s = projectStats({ project: project(), tasks, timeEntries: entries, milestones: ms, invoices, members, today: "2026-10-21" });

  it("counts time", () => {
    expect(s.trackedMinutes).toBe(240);
    expect(s.billableMinutes).toBe(180);
    expect(s.last7DaysMinutes).toBe(180);
    expect(s.entryCount).toBe(3);
  });

  it("counts tasks and overdue", () => {
    expect(s.taskCount).toBe(2);
    expect(s.tasksDonePct).toBe(0.5);
    expect(s.progress).toBe(0.5);
    expect(s.overdueTaskCount).toBe(1);
    expect(s.overdueMilestoneCount).toBe(1);
    expect(s.nextMilestone?.id).toBe("m-late");
  });

  it("calculates money", () => {
    // 3 h × 40 € (m1) + 1 h × 60 € snapshot
    expect(s.costCents).toBe(18_000);
    // 270 000 + 100 000 − 50 000
    expect(s.invoicedNetCents).toBe(320_000);
    expect(s.invoiceCount).toBe(3);
    expect(s.remainingBudgetCents).toBe(680_000);
    expect(s.budgetUsedPct).toBeCloseTo(0.32);
    expect(s.hoursUsedPct).toBeCloseTo(0.04);
    expect(s.revenueCents).toBe(1_000_000);
    expect(s.marginCents).toBe(982_000);
    expect(s.billableValueCents).toBe(2 * 9000 + 12_000);
  });

  it("uses billable value for hourly projects", () => {
    const h = projectStats({ project: project({ billing: "hourly", budgetCents: 0 }), tasks, timeEntries: entries, milestones: [], invoices: [], members, today: "2026-10-21" });
    expect(h.revenueCents).toBe(30_000);
    expect(h.marginCents).toBe(12_000);
    expect(h.marginPct).toBeCloseTo(0.4);
  });

  it("computes invoice net with discounts", () => {
    expect(invoiceNetForProject(invoice("x", [{ q: 2, c: 1000, d: 10 }], { discountPct: 50 }))).toBe(900);
  });
});

describe("invoice reminder", () => {
  it("suggests a down payment when nothing was invoiced", () => {
    const r = projectInvoiceReminder(project(), [], "2026-10-21");
    expect(r?.kind).toBe("downpayment");
    expect(r?.amountCents).toBe(300_000);
  });
  it("suggests the final invoice after the end date", () => {
    const r = projectInvoiceReminder(project({ endDate: "2026-10-01" }), [invoice("i1", [{ q: 1, c: 300_000 }])], "2026-10-21");
    expect(r?.kind).toBe("final");
    expect(r?.amountCents).toBe(700_000);
  });
  it("stays quiet otherwise", () => {
    expect(projectInvoiceReminder(project({ endDate: "2026-12-01" }), [invoice("i1", [{ q: 1, c: 300_000 }])], "2026-10-21")).toBeNull();
    expect(projectInvoiceReminder(project({ status: "completed" }), [], "2026-10-21")).toBeNull();
    expect(projectInvoiceReminder(project({ billing: "internal" }), [], "2026-10-21")).toBeNull();
  });
});

describe("autoSchedule", () => {
  it("plans leaves one after another and lets packages span them", () => {
    const tasks = [
      task("wp", { order: 0 }),
      task("t1", { parentId: "wp", order: 0, estimateHours: 12 }), // 2 days
      task("t2", { parentId: "wp", order: 1, estimateHours: 1 }), // 1 day
      task("t3", { order: 1, estimateHours: 13 }), // 3 days
    ];
    const ms = [milestone("m1", { taskIds: ["wp"] }), milestone("m2", { dueDate: "2026-10-05", taskIds: ["t3"] })];
    // Thu 2026-10-01
    const r = autoSchedule(project({ startDate: "2026-10-01", hoursPerDay: 6 }), tasks, ms);
    expect(r.tasks.get("t1")).toEqual({ startDate: "2026-10-01", dueDate: "2026-10-02" });
    expect(r.tasks.get("t2")).toEqual({ startDate: "2026-10-05", dueDate: "2026-10-05" });
    expect(r.tasks.get("wp")).toEqual({ startDate: "2026-10-01", dueDate: "2026-10-05" });
    expect(r.tasks.get("t3")).toEqual({ startDate: "2026-10-06", dueDate: "2026-10-08" });
    expect(r.milestoneDates.get("m1")).toBe("2026-10-05");
    expect(r.lateMilestones).toEqual([{ id: "m2", plannedEnd: "2026-10-08" }]);
    expect(r.endDate).toBe("2026-10-08");
  });

  it("starts on a workday and can keep done tasks", () => {
    const tasks = [task("a", { order: 0, status: "done", startDate: "2026-09-01", dueDate: "2026-09-02" }), task("b", { order: 1, estimateHours: 0 })];
    const r = autoSchedule(project({ startDate: "2026-09-01" }), tasks, [], { startDate: "2026-10-03", keepDone: true });
    expect(r.tasks.get("a")).toEqual({ startDate: "2026-09-01", dueDate: "2026-09-02" });
    expect(r.tasks.get("b")).toEqual({ startDate: "2026-10-05", dueDate: "2026-10-05" });
  });
});

describe("milestones and misc", () => {
  it("builds codes from the shared task number prefix", () => {
    expect(milestoneCode(["2.1", "2.3"], 0)).toBe("M2");
    expect(milestoneCode(["1.2.1", "1.2.4"], 0)).toBe("M1.2");
    expect(milestoneCode(["1", "2"], 2)).toBe("M3");
    expect(milestoneCode([], 1)).toBe("M2");
  });

  it("takes progress from linked tasks in both directions", () => {
    const tasks = [task("a", { status: "done", milestoneId: "m" }), task("b")];
    const ms = milestone("m", { taskIds: ["b"] });
    expect(milestoneProgress(ms, tasks, taskRollups(tasks, []))).toBe(0.5);
  });

  it("knows what is overdue", () => {
    expect(isTaskOverdue({ dueDate: "2026-10-01", status: "todo" }, "2026-10-21")).toBe(true);
    expect(isTaskOverdue({ dueDate: "2026-10-01", status: "done" }, "2026-10-21")).toBe(false);
    expect(overdueDays("2026-10-18", "2026-10-21")).toBe(3);
  });

  it("snapshots rates", () => {
    expect(timeEntryRates(project({ hourlyRateCents: 0 }), member("m"))).toEqual({ rateCents: 9000, costCents: 4000 });
    expect(timeEntryRates(project({ hourlyRateCents: 11000 }), member("m"))).toEqual({ rateCents: 11000, costCents: 4000 });
  });

  it("builds the week grid", () => {
    const week = weekOfIso("2026-10-21");
    const g = weekGrid([entry("a", 60, { date: "2026-10-19", taskId: "t" }), entry("b", 30, { date: "2026-10-21", taskId: "t" }), entry("c", 30, { date: "2026-10-30" })], week, [{ projectId: "p2" }]);
    expect(g).toHaveLength(2);
    expect(g[0]!.days).toEqual([60, 0, 30, 0, 0, 0, 0]);
    expect(g[0]!.total).toBe(90);
    expect(g[1]!.total).toBe(0);
  });
});
