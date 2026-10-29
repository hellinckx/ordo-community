import { z } from "zod";
import {
  formatNumber,
  ids,
  lineFromGross,
  nowIso,
  transactionFromBankLine,
  bankIgnoreError,
  needsBankTransferReview,
  candidatesForLine,
  type EntityCollection,
  type Offer,
  type Project,
  type RunningTimer,
  type Task,
  type TimeEntry,
  type Transaction,
  type VatRate,
} from "@ordo/core";
import { fmtDate } from "@/lib/format";
import { AtlasToolError, defineTool, type AtlasTool, type AtlasToolContext } from "./tools";
import { COLLECTION_BY_ID, resolveRecord, seen, type CollectionDef, type Rec } from "./data";
import { zodIssues } from "./schema";
import type { ToolEnv } from "./tools-read";
import { atLeast } from "./areas";
import { invoiceWriteTools } from "./tools-invoice";
import { bookDocument } from "@/services/booking";
import { validateTransaction } from "@/components/TransactionForm";

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");

const SINGULAR: Partial<Record<EntityCollection, string>> = {
  contacts: "Kontakt",
  folders: "Ordner",
  files: "Datei",
  transactions: "Buchung",
  invoices: "Rechnung",
  projects: "Projekt",
  tasks: "Aufgabe",
  milestones: "Meilenstein",
  timeEntries: "Zeiteintrag",
  offers: "Angebot",
  products: "Produkt",
  stockMoves: "Lagerbewegung",
  workOrders: "Fertigungsauftrag",
};

const NEW_ID: Partial<Record<EntityCollection, () => string>> = {
  contacts: ids.contact,
  folders: ids.folder,
  files: ids.file,
  transactions: ids.transaction,
  invoices: ids.invoice,
  projects: ids.project,
  tasks: ids.task,
  milestones: ids.milestone,
  timeEntries: ids.timeEntry,
  offers: ids.offer,
  products: ids.product,
  stockMoves: ids.stockMove,
  workOrders: ids.workOrder,
};

/** Fields Atlas may never set by hand. */
const PROTECTED = ["id", "createdAt", "updatedAt", "deletedAt", "profileId", "legacyRef"];

/* ------------------------------------------------------------------ */
/* Rights                                                              */
/* ------------------------------------------------------------------ */

/** "own" access: the record belongs to the person (own time, tasks or work orders assigned to them). */
function isOwn(collection: EntityCollection, r: Record<string, unknown>, ctx: AtlasToolContext): boolean {
  if (!ctx.memberId) return false;
  if (collection === "timeEntries") return r.memberId === ctx.memberId;
  if (collection === "tasks" || collection === "workOrders") return Array.isArray(r.assigneeIds) && r.assigneeIds.includes(ctx.memberId);
  return false;
}

function requireWrite(def: CollectionDef, ctx: AtlasToolContext, record?: Record<string, unknown>, action: "create" | "update" | "delete" = "update") {
  const need = action === "delete" ? "admin" : "write";
  if (ctx.can(def.area, need)) return;
  if (record && ctx.can(def.area, "own") && isOwn(def.id, record, ctx)) return;
  throw new AtlasToolError(action === "delete" ? `Deine Rolle darf in ${def.label} nichts löschen.` : `Deine Rolle darf ${def.label} nicht ändern${ctx.can(def.area, "own") ? " – nur eigene Einträge" : ""}.`);
}

/** Collections a role may create/update/delete in (shown to the model as enums). */
export function writableDefs(env: ToolEnv, can: AtlasToolContext["can"], action: "create" | "update" | "delete"): CollectionDef[] {
  return env.defs.filter((d) => d[action] && d.schema && atLeast(env.level(d.atlasArea), "write") && (can(d.area, action === "delete" ? "admin" : "write") || (can(d.area, "own") && (d.id === "timeEntries" || (action === "update" && (d.id === "tasks" || d.id === "workOrders"))))));
}

/**
 * Records that hang on other bookkeeping (invoice payments, depreciation, recurring rules, billed time) are changed in
 * their own place in Ordo, never by Atlas – otherwise the books would no longer match.
 */
function lockedReason(collection: EntityCollection, r: Record<string, unknown>): string | undefined {
  if (collection === "transactions") {
    if (r.invoiceId || r.origin === "invoice") return "Diese Buchung gehört zu einer Rechnung. Ändere sie bitte über die Rechnung in Ordo.";
    if (r.assetId || r.origin === "afa") return "Diese Buchung gehört zu einer Anlage (AfA). Ändere sie bitte unter Anlagen.";
    if (r.recurringRuleId) return "Diese Buchung stammt aus einer wiederkehrenden Buchung. Ändere sie bitte dort.";
  }
  if (collection === "timeEntries" && r.invoiceId) return "Diese Zeit ist schon verrechnet und lässt sich nicht mehr ändern.";
  if ((collection === "folders" || collection === "files") && r.system) return "System-Ordner kann Atlas nicht ändern.";
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function parseJsonObject(text: string, what: string): Record<string, unknown> {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new AtlasToolError(`${what} ist kein gültiges JSON.`);
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new AtlasToolError(`${what} muss ein JSON-Objekt sein.`);
  const out = { ...(obj as Record<string, unknown>) };
  for (const k of PROTECTED) delete out[k];
  return out;
}

function validate<T>(def: CollectionDef, value: unknown): T {
  const r = def.schema!.safeParse(value);
  if (!r.success) throw new AtlasToolError(`Ungültige Felder: ${zodIssues(r.error)}`);
  return r.data as T;
}

/** Next human number (P-0012, AN-2026-0003, FA-2026-0001) and bump the counter. */
function nextNumber(ctx: AtlasToolContext, kind: "project" | "offer" | "workOrder", date: string): string {
  const s = ctx.store.vault.settings.projects;
  const map = {
    project: ["projectNumberPattern", "nextProjectNumber"],
    offer: ["offerNumberPattern", "nextOfferNumber"],
    workOrder: ["workOrderNumberPattern", "nextWorkOrderNumber"],
  } as const;
  const [patternKey, counterKey] = map[kind];
  const n = s[counterKey];
  const number = formatNumber(s[patternKey], n, date);
  ctx.store.mutate((v) => {
    v.settings = { ...v.settings, projects: { ...v.settings.projects, [counterKey]: n + 1 } };
  });
  return number;
}

function def(id: EntityCollection): CollectionDef {
  return COLLECTION_BY_ID.get(id)!;
}

function project_(env: ToolEnv, ctx: AtlasToolContext, ref: string): Project {
  return resolveRecord(ctx.store.vault, seen(env, "projects"), ctx.profileId, ref) as unknown as Project;
}

function memberRef(env: ToolEnv, ctx: AtlasToolContext, ref: string): string {
  seen(env, "members");
  const v = ctx.store.vault;
  const q = ref.trim().toLocaleLowerCase("de");
  const live = v.members.filter((m) => !m.deletedAt);
  const m = live.find((x) => x.id === ref) ?? live.find((x) => x.name.toLocaleLowerCase("de") === q) ?? live.find((x) => x.name.toLocaleLowerCase("de").includes(q));
  if (!m) throw new AtlasToolError(`Im Team gibt es niemanden namens „${ref}“.`, { team: live.map((x) => x.name) });
  return m.id;
}

const hoursText = (h: number) => `${h.toLocaleString("de-AT", { maximumFractionDigits: 2 })} Std.`;

/** Rates frozen on the time entry: project rate, else the member's, else the default. */
function rates(ctx: AtlasToolContext, p: Project): { rateCents?: number; costCents?: number } {
  const m = ctx.member;
  const rate = p.hourlyRateCents || m?.hourlyRateCents || ctx.store.vault.settings.projects.defaultHourlyRateCents || undefined;
  return { rateCents: rate || undefined, costCents: m?.hourlyCostCents || undefined };
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

export function writeTools(env: ToolEnv, can: AtlasToolContext["can"]): AtlasTool[] {
  const tools: AtlasTool[] = [];
  const creatable = writableDefs(env, can, "create");
  const updatable = writableDefs(env, can, "update");
  const deletable = writableDefs(env, can, "delete");
  const enumOf = (defs: CollectionDef[]) => z.enum(defs.map((d) => d.id) as [string, ...string[]]);
  const has = (m: string) => env.modules.includes(m as never);

  if (creatable.length) {
    tools.push(
      defineTool({
        name: "create_record",
        description:
          "Legt einen neuen Datensatz an. data_json ist ein JSON-Objekt mit den Feldern laut Datenmodell (Beträge in Cent, Datum YYYY-MM-DD, Verweise als id). id, Zeitstempel, Profil und Nummern füllt Ordo selbst. Für Zeiten, Aufgaben, Projekte, Buchungen und Angebote gibt es bequemere Werkzeuge – nimm die, wenn sie passen.",
        input: z.object({ collection: enumOf(creatable), data_json: z.string().describe("JSON-Objekt mit den Feldern, z. B. {\"name\":\"Huber GmbH\",\"kind\":\"customer\"}") }),
        kind: "write",
        preview: (input) => `${SINGULAR[input.collection as EntityCollection] ?? "Eintrag"} anlegen`,
        run(input, ctx) {
          const d = env.defs.find((x) => x.id === input.collection)!;
          const data = parseJsonObject(input.data_json, "data_json");
          const now = nowIso();
          const draft: Record<string, unknown> = { ...data, id: NEW_ID[d.id]!(), createdAt: now, updatedAt: now };
          if (d.profileScoped) draft.profileId = ctx.profileId;
          if (d.id === "timeEntries" && !draft.memberId && ctx.memberId) draft.memberId = ctx.memberId;
          if (d.id === "projects" && !draft.number) draft.number = nextNumber(ctx, "project", ctx.today);
          if (d.id === "offers" && !draft.number) draft.number = nextNumber(ctx, "offer", String(draft.date ?? ctx.today));
          if (d.id === "offers" && !draft.date) draft.date = ctx.today;
          if (d.id === "workOrders" && !draft.number) draft.number = nextNumber(ctx, "workOrder", ctx.today);
          if (d.id === "transactions") {
            for (const k of ["invoiceId", "assetId", "recurringRuleId", "documentIds", "autoBooked"]) delete draft[k];
            draft.origin = "manual";
            draft.notes = draft.notes || "Von Atlas erfasst";
          }
          if (d.id === "timeEntries") delete draft.invoiceId;
          if (d.id === "offers") delete draft.invoiceIds;
          if (Array.isArray(draft.lines)) draft.lines = draft.lines.map((l) => (l && typeof l === "object" && !(l as { id?: string }).id ? { ...l, id: ids.line() } : l));
          const rec = validate<Rec>(d, draft);
          requireWrite(d, ctx, rec, "create");
          ctx.store.insert(d.id, rec as never, "atlas.create");
          const title = d.title(rec, ctx.store.vault);
          return { summary: `${SINGULAR[d.id] ?? "Eintrag"} „${title}“ angelegt`, data: { created: true, collection: d.id, id: rec.id, title }, link: { to: d.path(rec), label: title } };
        },
      }),
    );
  }

  if (updatable.length) {
    tools.push(
      defineTool({
        name: "update_record",
        description: "Ändert Felder eines bestehenden Datensatzes. patch_json enthält nur die zu ändernden Felder (Beträge in Cent, Datum YYYY-MM-DD). Hol vorher mit get_record oder search die richtige id.",
        input: z.object({ collection: enumOf(updatable), id: z.string().describe("id, Nummer oder Name"), patch_json: z.string().describe("JSON-Objekt mit den neuen Werten, z. B. {\"status\":\"active\"}") }),
        kind: "write",
        preview: (input, ctx) => {
          const d = COLLECTION_BY_ID.get(input.collection as EntityCollection);
          let title = input.id;
          try {
            if (d) title = d.title(resolveRecord(ctx.store.vault, d, ctx.profileId, input.id), ctx.store.vault);
          } catch {
            /* shown as entered */
          }
          let fields = "";
          try {
            fields = Object.keys(JSON.parse(input.patch_json)).join(", ");
          } catch {
            /* ignore */
          }
          return `${SINGULAR[input.collection as EntityCollection] ?? "Eintrag"} „${title}“ ändern${fields ? ` (${fields})` : ""}`;
        },
        run(input, ctx) {
          const d = env.defs.find((x) => x.id === input.collection)!;
          const existing = resolveRecord(ctx.store.vault, d, ctx.profileId, input.id);
          requireWrite(d, ctx, existing, "update");
          const patch = parseJsonObject(input.patch_json, "patch_json");
          if (!Object.keys(patch).length) throw new AtlasToolError("patch_json enthält keine Änderungen.");
          const locked = lockedReason(d.id, existing);
          if (locked) throw new AtlasToolError(locked);
          if (d.id === "files") delete patch.attachmentId;
          if (d.id === "transactions" && ("invoiceId" in patch || "assetId" in patch || "recurringRuleId" in patch)) throw new AtlasToolError("Verknüpfungen mit Rechnungen, Anlagen oder wiederkehrenden Buchungen setzt Atlas nicht.");
          const merged = validate<Rec>(d, { ...existing, ...patch, updatedAt: nowIso() });
          if (!ctx.can(d.area, "write")) requireWrite(d, ctx, merged, "update");
          ctx.store.update(d.id, existing.id, () => merged as never, "atlas.update");
          const title = d.title(merged, ctx.store.vault);
          return { summary: `${SINGULAR[d.id] ?? "Eintrag"} „${title}“ geändert (${Object.keys(patch).join(", ")})`, data: { updated: true, collection: d.id, id: existing.id, changed: Object.keys(patch) }, link: { to: d.path(merged), label: title } };
        },
      }),
    );
  }

  if (deletable.length) {
    tools.push(
      defineTool({
        name: "delete_record",
        description: "Löscht einen Datensatz (landet im Papierkorb und lässt sich wiederherstellen). Nur auf ausdrücklichen Wunsch der Person.",
        input: z.object({ collection: enumOf(deletable), id: z.string().describe("id, Nummer oder Name") }),
        kind: "write",
        preview: (input, ctx) => {
          const d = COLLECTION_BY_ID.get(input.collection as EntityCollection);
          let title = input.id;
          try {
            if (d) title = d.title(resolveRecord(ctx.store.vault, d, ctx.profileId, input.id), ctx.store.vault);
          } catch {
            /* shown as entered */
          }
          return `${SINGULAR[input.collection as EntityCollection] ?? "Eintrag"} „${title}“ löschen`;
        },
        run(input, ctx) {
          const d = env.defs.find((x) => x.id === input.collection)!;
          const existing = resolveRecord(ctx.store.vault, d, ctx.profileId, input.id);
          requireWrite(d, ctx, existing, "delete");
          const locked = lockedReason(d.id, existing);
          if (locked) throw new AtlasToolError(locked);
          const title = d.title(existing, ctx.store.vault);
          ctx.store.softDelete(d.id, existing.id, "atlas.delete");
          return { summary: `${SINGULAR[d.id] ?? "Eintrag"} „${title}“ gelöscht`, data: { deleted: true, collection: d.id, id: existing.id, restorable: true } };
        },
      }),
    );
  }

  /* ---------------- Zeiterfassung ---------------- */
  if (has("projekte") && env.defs.some((d) => d.id === "timeEntries") && can("time", "own")) {
    tools.push(
      defineTool({
        name: "log_time",
        description: "Erfasst Arbeitszeit auf ein Projekt (optional auf eine Aufgabe) für die Person selbst. Projekt und Aufgabe per id oder Name.",
        input: z.object({
          project: z.string().describe("Projekt: id, Nummer oder Name"),
          hours: z.number().describe("Dauer in Stunden, z. B. 1.5"),
          date: ISO.describe("Tag der Arbeit, YYYY-MM-DD"),
          description: z.string().describe("Was gemacht wurde (darf leer sein)"),
          task: z.string().optional().describe("Aufgabe: id oder Titel"),
          billable: z.boolean().optional().describe("Verrechenbar (Standard: ja)"),
        }),
        kind: "write",
        atlasArea: "time",
        reads: ["projects"],
        area: "time",
        need: "own",
        preview: (i, ctx) => {
          let name = i.project;
          try {
            name = project_(env, ctx, i.project).name;
          } catch {
            /* as entered */
          }
          return `${hoursText(i.hours)} auf „${name}“ erfassen (${fmtDate(i.date)})`;
        },
        run(i, ctx) {
          if (!(i.hours > 0) || i.hours > 24) throw new AtlasToolError("Stunden müssen zwischen 0 und 24 liegen.");
          const p = project_(env, ctx, i.project);
          const task = i.task ? (resolveRecord(ctx.store.vault, def("tasks"), ctx.profileId, i.task, (t) => t.projectId === p.id) as unknown as Task) : undefined;
          const now = nowIso();
          const entry = validate<TimeEntry>(def("timeEntries"), {
            id: ids.timeEntry(),
            createdAt: now,
            updatedAt: now,
            profileId: ctx.profileId,
            projectId: p.id,
            taskId: task?.id,
            memberId: ctx.memberId,
            date: i.date,
            minutes: Math.round(i.hours * 60),
            description: i.description,
            billable: i.billable ?? p.billing !== "internal",
            ...rates(ctx, p),
          });
          ctx.store.insert("timeEntries", entry, "atlas.log_time");
          return { summary: `${hoursText(i.hours)} auf „${p.name}“ erfasst (${fmtDate(i.date)})`, data: { created: true, id: entry.id, project: p.name, task: task?.title, minutes: entry.minutes, date: entry.date }, link: { to: "/zeiten", label: "Zeiten öffnen" } };
        },
      }),
      defineTool({
        name: "start_timer",
        description: "Startet die Stoppuhr der Person auf ein Projekt (optional Aufgabe). Pro Person läuft höchstens eine Stoppuhr.",
        input: z.object({ project: z.string().describe("Projekt: id, Nummer oder Name"), description: z.string().describe("Woran gearbeitet wird (darf leer sein)"), task: z.string().optional().describe("Aufgabe: id oder Titel") }),
        kind: "write",
        atlasArea: "time",
        reads: ["projects"],
        area: "time",
        need: "own",
        preview: (i, ctx) => {
          let name = i.project;
          try {
            name = project_(env, ctx, i.project).name;
          } catch {
            /* as entered */
          }
          return `Stoppuhr auf „${name}“ starten`;
        },
        run(i, ctx) {
          const v = ctx.store.vault;
          if (v.settings.timers.some((t) => (t.memberId ?? "") === (ctx.memberId ?? ""))) throw new AtlasToolError("Deine Stoppuhr läuft schon. Erst stoppen (stop_timer), dann neu starten.");
          const p = project_(env, ctx, i.project);
          const task = i.task ? (resolveRecord(v, def("tasks"), ctx.profileId, i.task, (t) => t.projectId === p.id) as unknown as Task) : undefined;
          const timer: RunningTimer = { memberId: ctx.memberId, projectId: p.id, taskId: task?.id, description: i.description, startedAt: nowIso() };
          ctx.store.mutate((vv) => {
            vv.settings = { ...vv.settings, timers: [...vv.settings.timers, timer] };
          });
          return { summary: `Stoppuhr läuft auf „${p.name}“`, data: { started: true, project: p.name, task: task?.title, startedAt: timer.startedAt } };
        },
      }),
      defineTool({
        name: "stop_timer",
        description: "Stoppt die laufende Stoppuhr der Person und speichert die Zeit als Zeiteintrag.",
        input: z.object({}),
        kind: "write",
        atlasArea: "time",
        area: "time",
        need: "own",
        preview: () => "Stoppuhr stoppen und Zeit speichern",
        run(_i, ctx) {
          const v = ctx.store.vault;
          const timer = v.settings.timers.find((t) => (t.memberId ?? "") === (ctx.memberId ?? ""));
          if (!timer) throw new AtlasToolError("Es läuft keine Stoppuhr.");
          const p = v.projects.find((x) => x.id === timer.projectId);
          const end = nowIso();
          const minutes = Math.max(1, Math.round((Date.parse(end) - Date.parse(timer.startedAt)) / 60000));
          const startDate = new Date(timer.startedAt);
          const date = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
          const entry = validate<TimeEntry>(def("timeEntries"), {
            id: ids.timeEntry(),
            createdAt: end,
            updatedAt: end,
            profileId: p?.profileId ?? ctx.profileId,
            projectId: timer.projectId,
            taskId: timer.taskId,
            memberId: timer.memberId,
            date,
            minutes,
            description: timer.description,
            billable: p ? p.billing !== "internal" : true,
            startedAt: timer.startedAt,
            endedAt: end,
            ...(p ? rates(ctx, p) : {}),
          });
          ctx.store.mutate((vv) => {
            vv.timeEntries = [...vv.timeEntries, entry];
            vv.settings = { ...vv.settings, timers: vv.settings.timers.filter((t) => t !== timer && !(t.startedAt === timer.startedAt && t.memberId === timer.memberId)) };
          }, { audit: { action: "atlas.stop_timer", entity: "timeEntries", entityId: entry.id } });
          return { summary: `${hoursText(Math.round((minutes / 60) * 100) / 100)} auf „${p?.name ?? "Projekt"}“ gespeichert`, data: { stopped: true, id: entry.id, minutes, project: p?.name } };
        },
      }),
    );
  }

  /* ---------------- Projekte & Aufgaben ---------------- */
  if (has("projekte") && env.defs.some((d) => d.id === "tasks")) {
    if (can("projects", "write")) {
      tools.push(
        defineTool({
          name: "create_task",
          description: "Legt eine Aufgabe in einem Projekt an (optional als Unteraufgabe eines Arbeitspakets, mit Fälligkeit, Priorität und zuständiger Person).",
          input: z.object({
            project: z.string().describe("Projekt: id, Nummer oder Name"),
            title: z.string(),
            due_date: ISO.optional().describe("Fällig am, YYYY-MM-DD"),
            priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
            assignee: z.string().optional().describe("Zuständig: Name oder id aus dem Team"),
          }),
          kind: "write",
          atlasArea: "projects",
          area: "projects",
          preview: (i, ctx) => {
            let name = i.project;
            try {
              name = project_(env, ctx, i.project).name;
            } catch {
              /* as entered */
            }
            return `Aufgabe „${i.title}“ in „${name}“ anlegen${i.due_date ? `, fällig ${fmtDate(i.due_date)}` : ""}`;
          },
          run(i, ctx) {
            const p = project_(env, ctx, i.project);
            const siblings = ctx.store.vault.tasks.filter((t) => !t.deletedAt && t.projectId === p.id && !t.parentId);
            const now = nowIso();
            const task = validate<Task>(def("tasks"), {
              id: ids.task(),
              createdAt: now,
              updatedAt: now,
              profileId: ctx.profileId,
              projectId: p.id,
              title: i.title,
              order: siblings.reduce((m, t) => Math.max(m, t.order), 0) + 1,
              dueDate: i.due_date,
              priority: i.priority ?? "medium",
              assigneeIds: i.assignee ? [memberRef(env, ctx, i.assignee)] : [],
            });
            ctx.store.insert("tasks", task, "atlas.create_task");
            return { summary: `Aufgabe „${task.title}“ in „${p.name}“ angelegt`, data: { created: true, id: task.id, project: p.name }, link: { to: `/projekte/${p.id}`, label: p.name } };
          },
        }),
        defineTool({
          name: "create_project",
          description: "Legt ein neues Projekt an (Nummer vergibt Ordo). Kunde per id oder Name aus den Kontakten.",
          input: z.object({
            name: z.string(),
            customer: z.string().optional().describe("Kunde: id oder Name"),
            budget_cents: z.number().int().optional().describe("Vereinbarte Summe netto in Cent"),
            start_date: ISO.optional(),
            end_date: ISO.optional(),
          }),
          kind: "write",
          atlasArea: "projects",
          area: "projects",
          preview: (i) => `Projekt „${i.name}“ anlegen`,
          run(i, ctx) {
            const v = ctx.store.vault;
            const customer = i.customer ? resolveRecord(v, seen(env, "contacts"), ctx.profileId, i.customer) : undefined;
            const now = nowIso();
            const draft = {
              id: ids.project(),
              createdAt: now,
              updatedAt: now,
              profileId: ctx.profileId,
              name: i.name,
              customerId: customer?.id,
              budgetCents: i.budget_cents ?? 0,
              startDate: i.start_date,
              endDate: i.end_date,
              status: i.start_date && i.start_date <= ctx.today ? "active" : "planning",
              hoursPerDay: v.settings.projects.defaultHoursPerDay,
              hourlyRateCents: v.settings.projects.defaultHourlyRateCents,
              managerId: ctx.memberId,
              memberIds: ctx.memberId ? [ctx.memberId] : [],
            };
            validate<Project>(def("projects"), { ...draft, number: "P-0000" });
            const project = validate<Project>(def("projects"), { ...draft, number: nextNumber(ctx, "project", ctx.today) });
            ctx.store.insert("projects", project, "atlas.create_project");
            return { summary: `Projekt ${project.number} „${project.name}“ angelegt`, data: { created: true, id: project.id, number: project.number }, link: { to: `/projekte/${project.id}`, label: project.name } };
          },
        }),
      );
    }
    if (can("projects", "own")) {
      tools.push(
        defineTool({
          name: "set_task_status",
          description: "Setzt den Status einer Aufgabe: todo (offen), in_progress (in Arbeit), review (zur Prüfung), done (erledigt), blocked (blockiert).",
          input: z.object({ task: z.string().describe("Aufgabe: id oder Titel"), status: z.enum(["todo", "in_progress", "review", "done", "blocked"]) }),
          kind: "write",
          atlasArea: "projects",
          area: "projects",
          need: "own",
          preview: (i, ctx) => {
            let title = i.task;
            try {
              title = String(resolveRecord(ctx.store.vault, def("tasks"), ctx.profileId, i.task).title);
            } catch {
              /* as entered */
            }
            return `Aufgabe „${title}“ auf ${STATUS_LABEL[i.status]} setzen`;
          },
          run(i, ctx) {
            const t = resolveRecord(ctx.store.vault, def("tasks"), ctx.profileId, i.task) as unknown as Task;
            requireWrite(def("tasks"), ctx, t as unknown as Rec, "update");
            const next = validate<Task>(def("tasks"), { ...t, status: i.status, completedAt: i.status === "done" ? (t.completedAt ?? nowIso()) : undefined, updatedAt: nowIso() });
            ctx.store.update("tasks", t.id, () => next, "atlas.set_task_status");
            return { summary: `„${t.title}“ ist jetzt ${STATUS_LABEL[i.status]}`, data: { updated: true, id: t.id, status: i.status }, link: { to: `/projekte/${t.projectId}`, label: "Projekt öffnen" } };
          },
        }),
      );
    }
  }

  /* ---------------- Angebote ---------------- */
  if (has("projekte") && env.defs.some((d) => d.id === "offers") && can("offers", "write")) {
    tools.push(
      defineTool({
        name: "create_offer_draft",
        description: "Legt ein Angebot als Entwurf an – mit Positionen (Menge, Einheit, Einzelpreis netto in Cent, USt-Satz). Texte und Gültigkeit kommen aus den Einstellungen. Das Angebot wird nicht verschickt.",
        input: z.object({
          subject: z.string().describe("Betreff, z. B. Website-Relaunch"),
          lines: z
            .array(
              z.object({
                title: z.string(),
                quantity: z.number(),
                unit: z.string().describe("z. B. Std, Stk, pauschal"),
                unit_net_cents: z.number().int().describe("Einzelpreis netto in Cent"),
                vat_rate: z.literal([0, 10, 13, 20]),
              }),
            )
            .describe("Positionen"),
          customer: z.string().optional().describe("Kunde: id oder Name"),
          project: z.string().optional().describe("Projekt: id, Nummer oder Name"),
        }),
        kind: "write",
        atlasArea: "offers",
        area: "offers",
        preview: (i) => {
          const net = i.lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_net_cents), 0);
          return `Angebot „${i.subject}“ mit ${i.lines.length} Position${i.lines.length === 1 ? "" : "en"} (${(net / 100).toLocaleString("de-AT", { style: "currency", currency: "EUR" })} netto) als Entwurf anlegen`;
        },
        run(i, ctx) {
          const v = ctx.store.vault;
          const s = v.settings.projects;
          const customer = i.customer ? resolveRecord(v, seen(env, "contacts"), ctx.profileId, i.customer) : undefined;
          const proj = i.project ? project_(env, ctx, i.project) : undefined;
          const now = nowIso();
          const valid = new Date(`${ctx.today}T12:00:00`);
          valid.setDate(valid.getDate() + (s.offerValidDays || 30));
          const draft = {
            id: ids.offer(),
            createdAt: now,
            updatedAt: now,
            profileId: ctx.profileId,
            customerId: customer?.id ?? proj?.customerId,
            projectId: proj?.id,
            date: ctx.today,
            validUntil: `${valid.getFullYear()}-${String(valid.getMonth() + 1).padStart(2, "0")}-${String(valid.getDate()).padStart(2, "0")}`,
            status: "draft",
            subject: i.subject,
            contractTitle: s.contractTitle,
            introText: s.offerIntroText,
            scopeText: s.offerScopeText,
            completionText: s.offerCompletionText,
            paymentTermsText: s.offerPaymentTermsText,
            downpaymentPct: s.downpaymentPct,
            finalPaymentPct: 100 - s.downpaymentPct,
            lines: i.lines.map((l) => ({ id: ids.line(), title: l.title, quantity: l.quantity, unit: l.unit, unitNetCents: l.unit_net_cents, vatRate: l.vat_rate })),
          };
          validate<Offer>(def("offers"), { ...draft, number: "AN-0000" });
          const offer = validate<Offer>(def("offers"), { ...draft, number: nextNumber(ctx, "offer", ctx.today) });
          ctx.store.insert("offers", offer, "atlas.create_offer_draft");
          return { summary: `Angebot ${offer.number} „${offer.subject}“ als Entwurf angelegt`, data: { created: true, id: offer.id, number: offer.number }, link: { to: `/angebote/${offer.id}`, label: `Angebot ${offer.number}` } };
        },
      }),
    );
  }

  /* ---------------- Buchhaltung ---------------- */
  if (has("summa") && env.defs.some((d) => d.id === "transactions") && can("summa", "write")) {
    tools.push(
      defineTool({
        name: "book_transaction",
        description:
          "Bucht eine Einnahme oder Ausgabe (Ordo) mit Bruttobetrag in Cent und USt-Satz; Ordo rechnet netto/USt. Gilt als am Datum bezahlt. Kontakt, Kategorie und Projekt per id oder Name. Für Rechnungen an Kunden nicht verwenden – die schreibt die Person in Ordo.",
        input: z.object({
          kind: z.enum(["expense", "income"]),
          date: ISO.describe("Datum, YYYY-MM-DD"),
          description: z.string(),
          gross_cents: z.number().int().describe("Bruttobetrag in Cent, positiv"),
          vat_rate: z.literal([0, 10, 13, 20]).describe("USt-Satz in Prozent"),
          payment_method: z.enum(["bank", "cash", "card", "paypal", "direct_debit", "other"]),
          contact: z.string().optional().describe("Kontakt: id oder Name"),
          category: z.string().optional().describe("Kategorie: id oder Name"),
          project: z.string().optional().describe("Projekt: id, Nummer oder Name (Kosten/Erlös eines Projekts)"),
        }),
        kind: "write",
        atlasArea: "bookkeeping",
        area: "summa",
        preview: (i) => `${i.kind === "income" ? "Einnahme" : "Ausgabe"} „${i.description}“ über ${(i.gross_cents / 100).toLocaleString("de-AT", { style: "currency", currency: "EUR" })} brutto (${i.vat_rate} % USt, ${fmtDate(i.date)}) buchen`,
        run(i, ctx) {
          if (!(i.gross_cents > 0)) throw new AtlasToolError("Der Betrag muss größer als 0 sein.");
          const v = ctx.store.vault;
          const p = ctx.profile;
          const contact = i.contact ? resolveRecord(v, seen(env, "contacts"), ctx.profileId, i.contact) : undefined;
          let categoryId: string | undefined;
          if (i.category) {
            const pool = v.categories.filter((c) => !c.deletedAt && !c.isArchived && c.kind === i.kind && (c.mode === "both" || c.mode === p.mode));
            const q = i.category.toLocaleLowerCase("de");
            const cat = pool.find((c) => c.id === i.category) ?? pool.find((c) => c.name.toLocaleLowerCase("de") === q) ?? pool.find((c) => c.name.toLocaleLowerCase("de").includes(q));
            if (!cat) throw new AtlasToolError(`Keine passende Kategorie für „${i.category}“.`, { categories: pool.map((c) => c.name) });
            categoryId = cat.id;
          }
          const proj = i.project ? project_(env, ctx, i.project) : undefined;
          const ku = i.kind === "income" && p.vatRegime === "kleinunternehmer";
          const now = nowIso();
          const tx = validate<Transaction>(def("transactions"), {
            id: ids.transaction(),
            createdAt: now,
            updatedAt: now,
            profileId: ctx.profileId,
            kind: i.kind,
            date: i.date,
            paidDate: i.date,
            description: i.description,
            contactId: contact?.id,
            categoryId,
            grossCents: i.gross_cents,
            vatLines: ku ? [{ rate: 0, netCents: i.gross_cents, vatCents: 0 }] : [lineFromGross(i.gross_cents, (i.vat_rate as VatRate))],
            vatTreatment: ku ? "kleinunternehmer" : "standard",
            paymentMethod: i.payment_method,
            projectId: proj?.id,
            origin: "manual",
            reviewed: true,
            notes: "Von Atlas erfasst",
          });
          ctx.store.insert("transactions", tx, "atlas.book_transaction");
          return {
            summary: `${i.kind === "income" ? "Einnahme" : "Ausgabe"} „${tx.description}“ über ${(tx.grossCents / 100).toLocaleString("de-AT", { style: "currency", currency: "EUR" })} gebucht`,
            data: { created: true, id: tx.id, netCents: tx.vatLines.reduce((s, l) => s + l.netCents, 0), vatCents: tx.vatLines.reduce((s, l) => s + l.vatCents, 0) },
            link: { to: "/buchungen", label: "Buchungen öffnen" },
          };
        },
      }),
    );
  }

  /* ---------------- Eingelesene Rechnungen ---------------- */
  if (has("summa") && env.defs.some((d) => d.id === "documents") && can("summa", "write")) {
    tools.push(
      defineTool({
        name: "approve_documents",
        description:
          "Bucht eingelesene Rechnungen und Bons mit status \"review\" endgültig: Ordo hat beim Einlesen schon eine Buchung vorbereitet (transactionId), die hier bestätigt wird. Ist die vorbereitete Kategorie falsch, die Buchung vorher mit update_record korrigieren; ist es in Wahrheit eine Einnahme statt einer Ausgabe, der Person sagen. Vorher mit get_record (documents und die Buchung) prüfen; Unklares (Betrag fehlt, unleserlich) nicht buchen, sondern der Person sagen.",
        input: z.object({
          documents: z.array(z.string().describe("id der eingelesenen Rechnung")).min(1).max(150),
        }),
        kind: "write",
        atlasArea: "incoming",
        reads: ["bookkeeping"],
        area: "summa",
        // works on text from third parties (Verwendungszweck, read invoices): one look at the batch before it runs
        alwaysConfirm: true,
        preview: (i) => `${i.documents.length} eingelesene Rechnung${i.documents.length === 1 ? "" : "en"} buchen`,
        // the card shows each invoice in plain words, so the person sees what gets booked before saying yes
        details: (i, ctx) => {
          const v = ctx.store.vault;
          const cats = new Map(v.categories.map((c) => [c.id, c.name]));
          const rows = i.documents.map((id) => {
            const d = v.documents.find((x) => x.id === id);
            const t = d?.transactionId ? v.transactions.find((x) => x.id === d.transactionId) : undefined;
            const who = (t?.contactId ? v.contacts.find((c) => c.id === t.contactId)?.name : undefined) ?? d?.extraction?.fields.vendorName ?? "";
            return [d?.originalName ?? "nicht gefunden", who, t ? (t.grossCents / 100).toLocaleString("de-AT", { style: "currency", currency: "EUR" }) : "–", t?.categoryId ? (cats.get(t.categoryId) ?? "") : "ohne Kategorie"];
          });
          return { type: "table", columns: ["Datei", "Von", "Betrag", "Kategorie"], rows };
        },
        run(i, ctx) {
          const v = ctx.store.vault;
          const done: string[] = [];
          const errors: string[] = [];
          for (const docId of i.documents) {
            const doc = v.documents.find((d) => d.id === docId && d.profileId === ctx.profileId && !d.deletedAt);
            const draft = doc?.transactionId ? v.transactions.find((t) => t.id === doc.transactionId && !t.deletedAt) : undefined;
            if (!doc || doc.status !== "review") {
              errors.push(`${docId}: nicht zum Prüfen offen`);
              continue;
            }
            if (!draft) {
              errors.push(`${doc.originalName}: keine vorbereitete Buchung – bitte in Ordo öffnen`);
              continue;
            }
            const tx = { ...draft, reviewed: true };
            const problem = validateTransaction(tx);
            if (problem) {
              errors.push(`${doc.originalName}: ${problem}`);
              continue;
            }
            bookDocument(doc, tx, { draftCategoryId: draft.categoryId });
            done.push(doc.id);
          }
          return {
            summary: `${done.length} Rechnung${done.length === 1 ? "" : "en"} gebucht${errors.length ? `, ${errors.length} brauchen dich` : ""}`,
            data: { done: done.length, errors },
            link: { to: "/buchungen", label: "Buchungen öffnen" },
          };
        },
      }),
    );
  }

  /* ---------------- Kontoauszüge ---------------- */
  if (has("summa") && env.defs.some((d) => d.id === "bankLines") && can("summa", "write")) {
    tools.push(
      defineTool({
        name: "settle_bank_lines",
        description:
          "Erledigt offene Kontoauszugszeilen (status unmatched/suggested): match ordnet einer bestehenden Buchung zu (target = Buchungs-ID), book legt eine fehlende Einnahme/Ausgabe an (target = Kategorie nur bei besserem Vorschlag). ignore ist nur im Firmenprofil für eindeutig nicht betriebliche Umsätze mit reason erlaubt. Im Privatprofil zählen auch Taschengeld, Geschenke und Unterstützung zum Budget; niemals deshalb ignorieren. Unklare Umbuchungen offen lassen. Erst bankLines und bestehende Buchungen prüfen.",
        input: z.object({
          lines: z
            .array(
              z.object({
                line: z.string().describe("id der Kontoauszugszeile"),
                action: z.enum(["match", "book", "ignore"]),
                target: z.string().optional().describe("Bei match: id der Buchung. Bei book: Kategorie (id oder Name), nur wenn Ordos Vorschlag falsch ist"),
                reason: z.string().optional().describe("Bei ignore: nachvollziehbarer Grund, weshalb der Umsatz nicht betrieblich ist"),
              }),
            )
            .min(1)
            .max(250),
        }),
        kind: "write",
        atlasArea: "bank",
        reads: ["bookkeeping"],
        area: "summa",
        // works on text from third parties (Verwendungszweck, read invoices): one look at the batch before it runs
        alwaysConfirm: true,
        preview: (i) => {
          const n = (a: string) => i.lines.filter((l) => l.action === a).length;
          return [n("match") ? `${n("match")} zuordnen` : "", n("book") ? `${n("book")} neu buchen` : "", n("ignore") ? `${n("ignore")} ignorieren` : ""].filter(Boolean).join(", ") + " (Kontoauszug)";
        },
        // every line in plain words: date, who, amount and what happens to it
        details: (i, ctx) => {
          const v = ctx.store.vault;
          const p = ctx.profile;
          const cats = new Map(v.categories.map((c) => [c.id, c.name]));
          const eur = (c: number) => (c / 100).toLocaleString("de-AT", { style: "currency", currency: "EUR" });
          const contacts = v.contacts.filter((c) => c.profileId === ctx.profileId);
          const rows = i.lines.map((item) => {
            const l = v.bankLines.find((x) => x.id === item.line);
            if (!l) return ["–", "Zeile nicht gefunden", "", ""];
            let what = `Ignorieren: ${item.reason?.trim() || "Begründung fehlt"}`;
            if (item.action === "match") {
              const t = item.target ? v.transactions.find((x) => x.id === item.target) : undefined;
              what = t ? `Zuordnen: ${t.description || cats.get(t.categoryId ?? "") || "Buchung"} vom ${fmtDate(t.date)}` : "Zuordnen: Buchung nicht gefunden";
            } else if (item.action === "book") {
              const base = transactionFromBankLine(l, ctx.profileId, p.mode, v.categories, contacts, p.vatRegime);
              const cat = item.target ? (v.categories.find((c) => c.id === item.target)?.name ?? item.target) : (cats.get(base.categoryId ?? "") ?? "ohne Kategorie");
              what = `Neu buchen als ${l.amountCents > 0 ? "Einnahme" : "Ausgabe"}: ${cat}`;
            }
            return [fmtDate(l.date), l.counterparty || l.purpose.slice(0, 40), eur(l.amountCents), what];
          });
          return { type: "table", columns: ["Datum", "Zahlungspartner", "Betrag", "Was passiert"], rows };
        },
        run(i, ctx) {
          const v = ctx.store.vault;
          const p = ctx.profile;
          const done: string[] = [];
          const errors: string[] = [];
          for (const item of i.lines) {
            const line = ctx.store.vault.bankLines.find((l) => l.id === item.line && l.profileId === ctx.profileId && !l.deletedAt);
            if (!line) {
              errors.push(`${item.line}: Zeile nicht gefunden`);
              continue;
            }
            const now = nowIso();
            if (line.status !== "unmatched" && line.status !== "suggested") {
              errors.push(`${line.id}: bereits erledigt oder ignoriert; zuerst in Kontoauszüge prüfen`);
              continue;
            }
            if (item.action === "ignore") {
              const error = bankIgnoreError(line, p.mode, item.reason);
              if (error) { errors.push(`${line.id}: ${error}`); continue; }
              ctx.store.update("bankLines", line.id, { status: "ignored", ignoreReason: item.reason!.trim(), suggestedTransactionId: undefined, suggestionScore: undefined, updatedAt: now }, "atlas.settle_bank_lines");
              done.push(line.id);
              continue;
            }
            if (item.action === "match") {
              const tx = item.target ? v.transactions.find((t) => t.id === item.target && t.profileId === ctx.profileId && !t.deletedAt) : undefined;
              if (!tx) {
                errors.push(`${line.id}: Buchung ${item.target ?? "(keine)"} nicht gefunden`);
                continue;
              }
              const taken = new Set(ctx.store.vault.bankLines.filter((l) => !l.deletedAt && l.id !== line.id && l.matchedTransactionId).map((l) => l.matchedTransactionId!));
              if (!candidatesForLine(line, [tx], new Map(), taken).length) {
                errors.push(`${line.id}: Betrag, Richtung oder Zeitraum passt nicht, oder die Buchung ist bereits zugeordnet`);
                continue;
              }
              ctx.store.update("bankLines", line.id, { status: "matched", matchedTransactionId: tx.id, suggestedTransactionId: undefined, updatedAt: now }, "atlas.settle_bank_lines");
              done.push(line.id);
              continue;
            }
            if (needsBankTransferReview(line)) {
              errors.push(`${line.id}: Mögliche Umbuchung oder Bargeldbehebung. Eigene Konten und Zahlungsweg zuerst mit der Person klären; nicht als Einnahme oder Ausgabe buchen.`);
              continue;
            }
            const contacts = v.contacts.filter((c) => c.profileId === ctx.profileId);
            const base = transactionFromBankLine(line, ctx.profileId, p.mode, v.categories, contacts, p.vatRegime);
            const kind = base.kind;
            let categoryId = base.categoryId;
            let rate = base.vatLines[0]?.rate ?? 20;
            if (item.target) {
              const pool = v.categories.filter((c) => !c.deletedAt && !c.isArchived && c.kind === kind && (c.mode === "both" || c.mode === p.mode));
              const q = item.target.toLocaleLowerCase("de");
              const cat = pool.find((c) => c.id === item.target) ?? pool.find((c) => c.name.toLocaleLowerCase("de") === q) ?? pool.find((c) => c.name.toLocaleLowerCase("de").includes(q));
              if (!cat) {
                errors.push(`${line.id}: keine Kategorie „${item.target}“`);
                continue;
              }
              categoryId = cat.id;
              rate = cat.defaultVatRate;
            }
            const ku = kind === "income" && p.vatRegime === "kleinunternehmer";
            if (ku || p.mode === "employee") rate = 0;
            try {
              const tx = validate<Transaction>(def("transactions"), {
                ...base,
                kind,
                categoryId,
                vatLines: [lineFromGross(base.grossCents, rate as VatRate)],
                vatTreatment: ku ? "kleinunternehmer" : "standard",
                notes: "Von Atlas aus dem Kontoauszug gebucht",
              });
              ctx.store.insert("transactions", tx, "atlas.settle_bank_lines");
              ctx.store.update("bankLines", line.id, { status: "booked", matchedTransactionId: tx.id, suggestedTransactionId: undefined, updatedAt: now }, "atlas.settle_bank_lines");
              done.push(line.id);
            } catch (e) {
              errors.push(`${line.id}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
          return {
            summary: `${done.length} Kontoauszugszeile${done.length === 1 ? "" : "n"} erledigt${errors.length ? `, ${errors.length} nicht` : ""}`,
            data: { done: done.length, errors },
            link: { to: "/bank", label: "Kontoauszüge öffnen" },
          };
        },
      }),
    );
  }

  tools.push(...invoiceWriteTools(env, can));

  return tools;
}

const STATUS_LABEL: Record<string, string> = { todo: "offen", in_progress: "in Arbeit", review: "zur Prüfung", done: "erledigt", blocked: "blockiert" };

