import type { Borders, Fill, Font, Worksheet } from "exceljs";
import {
  buildTaskTree,
  flattenTaskTree,
  invoiceNetForProject,
  isTaskOverdue,
  isWeekendIso,
  isoDaysBetween,
  milestoneCode,
  milestoneProgress,
  milestoneTaskIds,
  projectInvoices,
  projectStats,
  shiftIsoDate,
  taskRollups,
  todayIso,
  type Invoice,
  type Offer,
  type Task,
} from "@ordo/core";
import { requirePlatform, requireStore } from "@/state/session";
import { BILLING, PRIORITY, PROJECT_STATUS, TASK_STATUS, fileSafe } from "./labels";
import { sortMilestones } from "./data";

const BRAND = "FF0A5FE0";
const BRAND_LIGHT = "FFDCEAFF";
const TIME = "FFFFC66E";
const MILESTONE = "FF0B4FB8";
const WEEKEND = "FFF2F2F7";
const LABEL = "FFF5F5F7";
const BORDER = "FFE5E5EA";
const MUTED = "FF6E6E73";

const thin = { style: "thin" as const, color: { argb: BORDER } };
const borders: Partial<Borders> = { top: thin, bottom: thin, left: thin, right: thin };
const solid = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const headerFont: Partial<Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const MONEY = '#,##0.00 "€";-#,##0.00 "€"';
const HOURS = "#,##0.00";

const INVOICE_STATUS: Record<Invoice["status"], string> = { draft: "Entwurf", sent: "Offen", paid: "Bezahlt", overdue: "Überfällig", cancelled: "Storniert" };
const OFFER_STATUS: Record<Offer["status"], string> = { draft: "Entwurf", sent: "Versendet", accepted: "Angenommen", declined: "Abgelehnt", expired: "Abgelaufen" };

/** Excel date cell value (UTC midnight, so the day never shifts). */
function xDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function title(ws: Worksheet, text: string, sub: string, span: number) {
  ws.getCell(1, 1).value = text;
  ws.getCell(1, 1).font = { bold: true, size: 16 };
  ws.getRow(1).height = 26;
  ws.getCell(2, 1).value = sub;
  ws.getCell(2, 1).font = { size: 9, color: { argb: MUTED } };
  if (span > 1) {
    ws.mergeCells(1, 1, 1, span);
    ws.mergeCells(2, 1, 2, span);
  }
}

/** Writes a header row and data rows starting at `row`; returns the next free row. */
function table(ws: Worksheet, row: number, headers: { label: string; width?: number; fmt?: string; align?: "left" | "right" | "center" }[], rows: (string | number | Date | null | undefined)[][]): number {
  const h = ws.getRow(row);
  headers.forEach((c, i) => {
    const cell = h.getCell(i + 1);
    cell.value = c.label;
    cell.font = headerFont;
    cell.fill = solid(BRAND);
    cell.border = borders;
    cell.alignment = { vertical: "middle", horizontal: c.align ?? (c.fmt ? "right" : "left") };
    if (c.width) ws.getColumn(i + 1).width = c.width;
  });
  h.height = 22;
  rows.forEach((values, r) => {
    const xr = ws.getRow(row + 1 + r);
    values.forEach((v, i) => {
      const cell = xr.getCell(i + 1);
      cell.value = v ?? null;
      cell.border = borders;
      const fmt = headers[i]?.fmt;
      if (fmt) cell.numFmt = fmt;
      if (v instanceof Date) cell.numFmt = "dd.mm.yyyy";
      if (headers[i]?.align) cell.alignment = { horizontal: headers[i]!.align };
    });
  });
  ws.views = [{ state: "frozen", ySplit: row, xSplit: 0 }];
  if (rows.length) ws.autoFilter = { from: { row, column: 1 }, to: { row: row + rows.length, column: headers.length } };
  return row + rows.length + 1;
}

function sumRow(ws: Worksheet, row: number, label: string, values: Record<number, { v: number; fmt: string }>, span: number) {
  const r = ws.getRow(row);
  r.getCell(1).value = label;
  for (let c = 1; c <= span; c++) {
    const cell = r.getCell(c);
    cell.font = { bold: true };
    cell.fill = solid(LABEL);
    cell.border = borders;
    const v = values[c];
    if (v) {
      cell.value = v.v;
      cell.numFmt = v.fmt;
    }
  }
}

function invoiceAmounts(inv: Invoice): { net: number; vat: number; gross: number } {
  const sign = inv.kind === "credit_note" ? -1 : 1;
  const disc = 1 - (inv.discountPct || 0) / 100;
  const taxable = inv.vatTreatment === "standard";
  let vat = 0;
  for (const l of inv.lines) {
    const lineNet = l.quantity * l.unitNetCents * (1 - (l.discountPct || 0) / 100) * disc;
    vat += taxable ? Math.round((lineNet * l.vatRate) / 100) : 0;
  }
  const net = invoiceNetForProject(inv);
  vat = sign * Math.abs(vat);
  return { net, vat, gross: net + vat };
}

function offerAmounts(o: Offer): { net: number; vat: number; gross: number } {
  const disc = 1 - (o.discountPct || 0) / 100;
  let net = 0;
  let vat = 0;
  for (const l of o.lines) {
    if (l.optional) continue;
    const n = l.quantity * l.unitNetCents * disc;
    net += n;
    vat += o.reverseCharge ? 0 : (n * l.vatRate) / 100;
  }
  return { net: Math.round(net), vat: Math.round(vat), gross: Math.round(net) + Math.round(vat) };
}

const eur = (cents: number) => cents / 100;
const hrs = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
const clock = (minutes: number) => {
  const a = Math.abs(minutes);
  return `${minutes < 0 ? "-" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
};

/** Builds the project workbook and lets the user save it. Returns false when the save was cancelled. */
/** onlyMemberId: the time sheet holds only that person's entries (Mitarbeit sees only their own times). */
export async function exportProjectXlsx(projectId: string, opts: { onlyMemberId?: string | null } = {}): Promise<boolean> {
  const store = requireStore();
  const v = store.vault;
  const project = v.projects.find((p) => p.id === projectId);
  if (!project) throw new Error("Projekt nicht gefunden.");
  const profile = v.profiles.find((p) => p.id === project.profileId);
  const company = profile?.company.name || profile?.name || "Ordo";
  const customer = project.customerId ? v.contacts.find((c) => c.id === project.customerId) : undefined;
  const tasks = v.tasks.filter((t) => !t.deletedAt && t.projectId === projectId);
  const entries = v.timeEntries.filter((e) => !e.deletedAt && e.projectId === projectId && (opts.onlyMemberId === undefined || e.memberId === opts.onlyMemberId)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const milestones = sortMilestones(v.milestones.filter((m) => !m.deletedAt && m.projectId === projectId));
  const invoices = projectInvoices(projectId, v.invoices).sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  const allInvoices = v.invoices.filter((i) => !i.deletedAt && i.projectId === projectId && i.kind !== "offer").sort((a, b) => a.issueDate.localeCompare(b.issueDate));
  const offers = v.offers.filter((o) => !o.deletedAt && o.projectId === projectId).sort((a, b) => a.date.localeCompare(b.date));
  const members = new Map(v.members.map((m) => [m.id, m]));
  const today = todayIso();
  const stats = projectStats({ project, tasks, timeEntries: entries, milestones, invoices: v.invoices, members: v.members, today });
  const flat = flattenTaskTree(buildTaskTree(tasks));
  const numbers = new Map(flat.map((n) => [n.task.id, n.number]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const rollups = taskRollups(tasks, entries);
  const msCodes = new Map(milestones.map((m, i) => [m.id, milestoneCode(milestoneTaskIds(m, tasks).map((id) => numbers.get(id) ?? "").filter(Boolean), i)]));
  const taskName = (t?: Task) => (t ? `${numbers.get(t.id) ?? ""} ${t.title}`.trim() : "");
  const sub = `${project.number ? `${project.number} · ` : ""}${project.name} – erstellt am ${today.split("-").reverse().join(".")} · ${company}`;

  const mod = await import("exceljs");
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = company;
  wb.created = new Date();
  wb.title = `${project.name} – Projektexport`;

  /* Übersicht */
  {
    const ws = wb.addWorksheet("Übersicht", { properties: { tabColor: { argb: BRAND } } });
    title(ws, "Projektübersicht", sub, 2);
    ws.getColumn(1).width = 30;
    ws.getColumn(2).width = 42;
    const section = (row: number, label: string) => {
      const r = ws.getRow(row);
      r.getCell(1).value = label;
      r.getCell(1).font = { bold: true, size: 12, color: { argb: BRAND } };
      ws.mergeCells(row, 1, row, 2);
      r.height = 22;
    };
    const pairs = (row: number, list: [string, string | number | Date | null, string?][]) => {
      list.forEach(([label, value, fmt], i) => {
        const r = ws.getRow(row + i);
        r.getCell(1).value = label;
        r.getCell(1).font = { color: { argb: MUTED } };
        r.getCell(1).fill = solid(LABEL);
        r.getCell(1).border = borders;
        r.getCell(2).value = value;
        r.getCell(2).border = borders;
        r.getCell(2).alignment = { horizontal: typeof value === "number" || value instanceof Date ? "right" : "left" };
        if (fmt) r.getCell(2).numFmt = fmt;
        else if (value instanceof Date) r.getCell(2).numFmt = "dd.mm.yyyy";
      });
      return row + list.length;
    };
    section(4, "Projektdaten");
    let row = pairs(5, [
      ["Nummer", project.number],
      ["Projekt", project.name],
      ["Kunde", customer?.name ?? "–"],
      ["Status", PROJECT_STATUS[project.status].label],
      ["Start", xDate(project.startDate)],
      ["Ende", xDate(project.endDate)],
      ["Dauer (Tage)", project.startDate && project.endDate ? isoDaysBetween(project.startDate, project.endDate) + 1 : null],
      ["Abrechnung", BILLING[project.billing].label],
      ["Projektsumme / Budget (netto)", eur(project.budgetCents), MONEY],
      ["Stundensatz (netto)", project.hourlyRateCents ? eur(project.hourlyRateCents) : null, MONEY],
      ["Geplante Stunden", project.budgetHours || null, HOURS],
      ["Leitung", project.managerId ? members.get(project.managerId)?.name ?? "–" : "–"],
    ]);
    section(row + 1, "Kennzahlen");
    pairs(row + 2, [
      ["Erfasste Stunden", hrs(stats.trackedMinutes), HOURS],
      ["davon verrechenbar", hrs(stats.billableMinutes), HOURS],
      ["nicht verrechenbar", hrs(stats.trackedMinutes - stats.billableMinutes), HOURS],
      ["Zeiteinträge", stats.entryCount],
      ["Geschätzte Stunden (Aufgaben)", stats.estimateHours, HOURS],
      ["Aufgaben gesamt", stats.taskCount],
      ["Aufgaben erledigt", stats.doneTaskCount],
      ["Aufgaben überfällig", stats.overdueTaskCount],
      ["Fortschritt", stats.progress, "0%"],
      ["Meilensteine (erreicht / gesamt)", `${milestones.filter((m) => m.status === "done").length} / ${milestones.length}`],
      ["Angebote", offers.length],
      ["Rechnungen", invoices.length],
      ["Fakturiert (netto)", eur(stats.invoicedNetCents), MONEY],
      ["Restbudget (netto)", project.budgetCents ? eur(stats.remainingBudgetCents) : null, MONEY],
      ["Kosten (Zeit × Kostensatz)", eur(stats.costCents), MONEY],
      ["Marge", project.billing === "internal" ? null : eur(stats.marginCents), MONEY],
    ]);
  }

  /* Zeiterfassung */
  {
    const ws = wb.addWorksheet("Zeiterfassung");
    title(ws, "Zeiterfassung", sub, 7);
    const next = table(
      ws,
      4,
      [{ label: "Datum", width: 12 }, { label: "Person", width: 20 }, { label: "Aufgabe", width: 36 }, { label: "Beschreibung", width: 44 }, { label: "Stunden", width: 11, fmt: HOURS }, { label: "Dauer", width: 10, align: "right" }, { label: "Verrechenbar", width: 13, align: "center" }],
      entries.map((e) => [xDate(e.date), e.memberId ? members.get(e.memberId)?.name ?? "" : "", taskName(e.taskId ? taskById.get(e.taskId) : undefined), e.description, hrs(e.minutes), clock(e.minutes), e.billable ? "Ja" : "Nein"]),
    );
    sumRow(ws, next + 1, "Gesamt", { 5: { v: hrs(stats.trackedMinutes), fmt: HOURS } }, 7);
    sumRow(ws, next + 2, "Verrechenbar", { 5: { v: hrs(stats.billableMinutes), fmt: HOURS } }, 7);
    sumRow(ws, next + 3, "Nicht verrechenbar", { 5: { v: hrs(stats.trackedMinutes - stats.billableMinutes), fmt: HOURS } }, 7);
  }

  /* Stunden pro Aufgabe */
  {
    const ws = wb.addWorksheet("Stunden pro Aufgabe");
    title(ws, "Stunden pro Aufgabe", sub, 7);
    const without = entries.filter((e) => !e.taskId || !taskById.has(e.taskId)).reduce((s, e) => s + e.minutes, 0);
    const rows = flat.map((n) => {
      const r = rollups.get(n.task.id)!;
      return [n.number, `${"   ".repeat(n.depth)}${n.task.title}`, n.task.milestoneId ? msCodes.get(n.task.milestoneId) ?? "" : "", r.estimateHours || null, hrs(r.trackedMinutes), r.estimateHours ? hrs(r.trackedMinutes - r.estimateHours * 60) : null, r.progress];
    });
    if (without) rows.push(["", "Ohne Aufgabe", "", null, hrs(without), null, null as unknown as number]);
    const next = table(ws, 4, [{ label: "Nr.", width: 8 }, { label: "Aufgabe", width: 44 }, { label: "Meilenstein", width: 12 }, { label: "Geplant (h)", width: 12, fmt: HOURS }, { label: "Erfasst (h)", width: 12, fmt: HOURS }, { label: "Abweichung (h)", width: 15, fmt: HOURS }, { label: "Fortschritt", width: 12, fmt: "0%" }], rows);
    flat.forEach((n, i) => {
      if (n.isPackage) ws.getRow(5 + i).font = { bold: true };
      const dev = ws.getRow(5 + i).getCell(6);
      if (typeof dev.value === "number" && dev.value > 0) dev.font = { color: { argb: "FFD70015" }, bold: n.isPackage };
    });
    sumRow(ws, next + 1, "Summe", { 4: { v: stats.estimateHours, fmt: HOURS }, 5: { v: hrs(stats.trackedMinutes), fmt: HOURS } }, 7);
  }

  /* Aufgaben */
  {
    const ws = wb.addWorksheet("Aufgaben");
    title(ws, "Aufgaben", sub, 13);
    table(
      ws,
      4,
      [{ label: "Nr.", width: 8 }, { label: "Aufgabe", width: 38 }, { label: "Beschreibung", width: 40 }, { label: "Status", width: 13 }, { label: "Priorität", width: 11 }, { label: "Meilenstein", width: 12 }, { label: "Zuständig", width: 24 }, { label: "Start", width: 12 }, { label: "Fällig", width: 12 }, { label: "Geschätzt (h)", width: 13, fmt: HOURS }, { label: "Erfasst (h)", width: 12, fmt: HOURS }, { label: "Erstellt am", width: 12 }, { label: "Erledigt am", width: 12 }],
      flat.map((n) => {
        const t = n.task;
        const r = rollups.get(t.id)!;
        return [n.number, `${"   ".repeat(n.depth)}${t.title}`, t.description, n.isPackage ? `Arbeitspaket (${Math.round(r.progress * 100)} %)` : `${TASK_STATUS[t.status].label}${isTaskOverdue(t, today) ? " (überfällig)" : ""}`, PRIORITY[t.priority].label, t.milestoneId ? msCodes.get(t.milestoneId) ?? "" : "", t.assigneeIds.map((id) => members.get(id)?.name ?? "").filter(Boolean).join(", "), xDate(t.startDate), xDate(t.dueDate), r.estimateHours || null, hrs(r.trackedMinutes), xDate(t.createdAt.slice(0, 10)), xDate(t.completedAt?.slice(0, 10))];
      }),
    );
    flat.forEach((n, i) => {
      if (n.isPackage) ws.getRow(5 + i).font = { bold: true };
    });
  }

  /* Meilensteine */
  {
    const ws = wb.addWorksheet("Meilensteine");
    title(ws, "Meilensteine", sub, 9);
    table(
      ws,
      4,
      [{ label: "Code", width: 9 }, { label: "Meilenstein", width: 34 }, { label: "Beschreibung", width: 40 }, { label: "Status", width: 12 }, { label: "Fällig", width: 12 }, { label: "Erreicht am", width: 12 }, { label: "Aufgaben", width: 11, align: "right" }, { label: "davon offen", width: 12, align: "right" }, { label: "Fortschritt", width: 12, fmt: "0%" }],
      milestones.map((m) => {
        const linked = milestoneTaskIds(m, tasks);
        return [msCodes.get(m.id) ?? "", m.title, m.description, m.status === "done" ? "Erreicht" : m.dueDate && m.dueDate < today ? "Überfällig" : "Offen", xDate(m.dueDate), xDate(m.completedAt?.slice(0, 10)), linked.length, linked.filter((id) => taskById.get(id)?.status !== "done").length, milestoneProgress(m, tasks, rollups)];
      }),
    );
  }

  /* Zeitplan (one column per day) */
  {
    const ws = wb.addWorksheet("Zeitplan");
    const ranges = new Map<string, { s: string; e: string }>();
    const visit = (id: string): { s: string; e: string } | undefined => {
      const n = flat.find((x) => x.task.id === id)!;
      const own = n.task.startDate || n.task.dueDate ? { s: n.task.startDate ?? n.task.dueDate!, e: n.task.dueDate ?? n.task.startDate! } : undefined;
      const kids = n.children.map((c) => visit(c.task.id)).filter((x): x is { s: string; e: string } => !!x);
      const all = own ? [...kids, own] : kids;
      if (!all.length) return undefined;
      const r = { s: all.map((k) => k.s).sort()[0]!, e: all.map((k) => k.e).sort().at(-1)! };
      ranges.set(id, r);
      return r;
    };
    flat.filter((n) => n.depth === 0).forEach((n) => visit(n.task.id));
    const ds = [project.startDate, project.endDate, ...[...ranges.values()].flatMap((r) => [r.s, r.e]), ...milestones.map((m) => m.dueDate), ...entries.map((e) => e.date)].filter((d): d is string => !!d).sort();
    const from = ds[0] ?? today;
    const to = ds.at(-1) ?? shiftIsoDate(today, 30);
    const days = Math.min(370, isoDaysBetween(from, to) + 1);
    const FIRST = 5;
    title(ws, "Zeitplan", sub, 4);
    // legend
    const legend: [string, string][] = [["Aufgabe (Plan)", BRAND_LIGHT], ["Arbeitspaket", "FFC7C7CC"], ["Erfasste Zeit (Stunden)", TIME], ["Meilenstein", MILESTONE], ["Wochenende", WEEKEND]];
    legend.forEach(([label, color], i) => {
      const c = ws.getRow(3).getCell(FIRST + i * 4);
      c.fill = solid(color);
      const l = ws.getRow(3).getCell(FIRST + i * 4 + 1);
      l.value = label;
      l.font = { size: 9, color: { argb: MUTED } };
    });
    const head = 5;
    const headers = ["Nr.", "Aufgabe", "Start", "Ende"];
    headers.forEach((h, i) => {
      const c = ws.getRow(head).getCell(i + 1);
      c.value = h;
      c.font = headerFont;
      c.fill = solid(BRAND);
      c.border = borders;
      const m = ws.getRow(head - 1).getCell(i + 1);
      m.fill = solid(BRAND);
    });
    ws.getColumn(1).width = 7;
    ws.getColumn(2).width = 34;
    ws.getColumn(3).width = 11;
    ws.getColumn(4).width = 11;
    for (let i = 0; i < days; i++) {
      const d = shiftIsoDate(from, i);
      const col = FIRST + i;
      ws.getColumn(col).width = 3.6;
      const top = ws.getRow(head - 1).getCell(col);
      if (i === 0 || d.endsWith("-01")) {
        top.value = new Date(`${d}T00:00:00`).toLocaleDateString("de-AT", { month: "short", year: "2-digit" });
        top.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
      }
      top.fill = solid(BRAND);
      const c = ws.getRow(head).getCell(col);
      c.value = Number(d.slice(8, 10));
      c.font = { ...headerFont, size: 8, color: { argb: d === today ? "FFFFD60A" : "FFFFFFFF" } };
      c.fill = solid(BRAND);
      c.alignment = { horizontal: "center" };
    }
    const hoursByTaskDay = new Map<string, number>();
    for (const e of entries) if (e.taskId) hoursByTaskDay.set(`${e.taskId}|${e.date}`, (hoursByTaskDay.get(`${e.taskId}|${e.date}`) ?? 0) + e.minutes);
    let row = head + 1;
    const paint = (r: number, s: string | undefined, e: string | undefined, color: string, valueFor?: (d: string) => number | undefined) => {
      const xr = ws.getRow(r);
      for (let i = 0; i < days; i++) {
        const d = shiftIsoDate(from, i);
        const cell = xr.getCell(FIRST + i);
        const inside = s && e && d >= s && d <= e;
        cell.fill = solid(inside ? color : isWeekendIso(d) ? WEEKEND : "FFFFFFFF");
        const val = valueFor?.(d);
        if (val) {
          cell.value = Math.round((val / 60) * 10) / 10;
          cell.fill = solid(TIME);
          cell.font = { size: 8 };
          cell.alignment = { horizontal: "center" };
        }
      }
    };
    // project
    ws.getRow(row).getCell(2).value = "Projekt";
    ws.getRow(row).font = { bold: true };
    ws.getRow(row).getCell(3).value = xDate(project.startDate);
    ws.getRow(row).getCell(4).value = xDate(project.endDate);
    paint(row, project.startDate, project.endDate, "FF86B8FF");
    row++;
    for (const n of flat) {
      const r = ranges.get(n.task.id);
      const xr = ws.getRow(row);
      xr.getCell(1).value = n.number;
      xr.getCell(2).value = `${"  ".repeat(n.depth)}${n.task.title}`;
      xr.getCell(3).value = xDate(r?.s);
      xr.getCell(4).value = xDate(r?.e);
      if (n.isPackage) xr.font = { bold: true };
      paint(row, r?.s, r?.e, n.isPackage ? "FFC7C7CC" : BRAND_LIGHT, n.isPackage ? undefined : (d) => hoursByTaskDay.get(`${n.task.id}|${d}`));
      row++;
    }
    for (const m of milestones) {
      const xr = ws.getRow(row);
      xr.getCell(1).value = msCodes.get(m.id) ?? "";
      xr.getCell(2).value = `◆ ${m.title}`;
      xr.getCell(4).value = xDate(m.dueDate);
      paint(row, undefined, undefined, MILESTONE);
      if (m.dueDate && m.dueDate >= from) {
        const i = isoDaysBetween(from, m.dueDate);
        if (i < days) {
          const c = xr.getCell(FIRST + i);
          c.value = "◆";
          c.font = { color: { argb: m.status === "done" ? "FF8E8E93" : MILESTONE }, bold: true };
          c.alignment = { horizontal: "center" };
        }
      }
      row++;
    }
    for (let r = head + 1; r < row; r++) for (let c = 3; c <= 4; c++) ws.getRow(r).getCell(c).numFmt = "dd.mm.yy";
    ws.views = [{ state: "frozen", xSplit: 4, ySplit: head }];
  }

  /* Rechnungen */
  {
    const ws = wb.addWorksheet("Rechnungen");
    title(ws, "Rechnungen", sub, 8);
    const rows = allInvoices.map((i) => {
      const a = invoiceAmounts(i);
      return [i.number, xDate(i.issueDate), xDate(i.dueDate), `${i.kind === "credit_note" ? "Gutschrift · " : ""}${INVOICE_STATUS[i.status]}`, eur(a.net), eur(a.vat), eur(a.gross), i.servicePeriod || [i.servicePeriodStart, i.servicePeriodEnd].filter(Boolean).map((d) => d!.split("-").reverse().join(".")).join(" – ")];
    });
    const next = table(ws, 4, [{ label: "Nr.", width: 16 }, { label: "Datum", width: 12 }, { label: "Fällig", width: 12 }, { label: "Status", width: 18 }, { label: "Netto", width: 14, fmt: MONEY }, { label: "USt", width: 12, fmt: MONEY }, { label: "Brutto", width: 14, fmt: MONEY }, { label: "Leistungszeitraum", width: 26 }], rows.length ? rows : [["Noch keine Rechnungen"]]);
    if (rows.length) {
      const counted = invoices.map(invoiceAmounts);
      sumRow(ws, next + 1, "Summe (ohne stornierte)", { 5: { v: eur(counted.reduce((s, a) => s + a.net, 0)), fmt: MONEY }, 6: { v: eur(counted.reduce((s, a) => s + a.vat, 0)), fmt: MONEY }, 7: { v: eur(counted.reduce((s, a) => s + a.gross, 0)), fmt: MONEY } }, 8);
    }
  }

  /* Angebote */
  {
    const ws = wb.addWorksheet("Angebote");
    title(ws, "Angebote", sub, 8);
    const rows = offers.map((o) => {
      const a = offerAmounts(o);
      return [o.number, xDate(o.date), xDate(o.validUntil), OFFER_STATUS[o.status], o.subject, eur(a.net), eur(a.vat), eur(a.gross)];
    });
    table(ws, 4, [{ label: "Nr.", width: 16 }, { label: "Datum", width: 12 }, { label: "Gültig bis", width: 12 }, { label: "Status", width: 13 }, { label: "Betreff", width: 40 }, { label: "Netto", width: 14, fmt: MONEY }, { label: "USt", width: 12, fmt: MONEY }, { label: "Brutto", width: 14, fmt: MONEY }], rows.length ? rows : [["Noch keine Angebote"]]);
  }

  const buf = await wb.xlsx.writeBuffer();
  const name = `${today.replace(/-/g, "")}_${fileSafe(project.name)}_Projektexport.xlsx`;
  return requirePlatform().saveFile(name, new Uint8Array(buf as ArrayBuffer), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
