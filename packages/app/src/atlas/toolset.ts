import type { z } from "zod";
import { can as canRole, seesAllTime, todayIso, type Access, type Area, type Role, type Vault, type VaultStore } from "@ordo/core";
import type { ModuleId, OrdoModule } from "@/modules/types";
import { AtlasToolError, type AtlasTool, type AtlasToolContext, type AtlasToolResult } from "./tools";
import { COLLECTIONS } from "./data";
import { pickStrict, toolJsonSchema, zodIssues } from "./schema";
import { readTools, visualTools, type ToolEnv } from "./tools-read";
import { writeTools } from "./tools-write";
import { invoiceReadTools } from "./tools-invoice";
import { integrationTools } from "./tools-integrations";
import { fileTools } from "./tools-files";
import { askTools } from "./tools-ask";
import { PARTS } from "@/operator";
import { ATLAS_AREAS, areasOfRole, atLeast, effectiveLevel, type AtlasArea, type AtlasLevel } from "./areas";

export type AtlasPermission = "read" | "confirm" | "auto";

export interface ToolsetConfig {
  modules: OrdoModule[];
  role: Role;
  permission: AtlasPermission;
  /** Per-area setting from Einstellungen → Atlas (`settings.atlas.areas`); missing keys use the area default. */
  areas?: Record<string, string>;
  /** The chat contains file content (from anyone): every change then waits for the person's confirmation. */
  untrusted?: boolean;
}

/** What a provider sends to the model for one tool. */
export interface ProviderToolDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  strict: boolean;
  kind: "read" | "write";
}

export interface Toolset {
  tools: AtlasTool[];
  defs: ProviderToolDef[];
  byName: Map<string, AtlasTool>;
}

const ROUTE_ORDER: ModuleId[] = ["basis", "summa", "projekte", "produkte", "produktion"];

function routesOf(modules: OrdoModule[]): string[] {
  const set = new Set<string>();
  for (const m of modules) for (const r of m.routes) {
    const base = "/" + (r.path.split("/")[1] ?? "");
    if (base !== "/" && !base.includes(":")) set.add(base);
  }
  set.add("/einstellungen");
  return [...set].sort();
}

/** Effective right of Atlas per area for this configuration (role, global permission, area setting). */
export function areaLevels(cfg: Pick<ToolsetConfig, "role" | "permission" | "areas">): Record<AtlasArea, AtlasLevel> {
  const out = {} as Record<AtlasArea, AtlasLevel>;
  for (const a of ATLAS_AREAS) out[a.id] = effectiveLevel(cfg, a.id);
  return out;
}

/** Whether a tool fits the area rights: its own area at read/write (by kind), every area it reads from at read. */
function toolAllowed(t: AtlasTool, level: (a: AtlasArea) => AtlasLevel): boolean {
  const need = t.kind === "write" ? "write" : "read";
  const main = t.atlasArea ? [t.atlasArea] : t.area ? areasOfRole(t.area) : [];
  return main.every((a) => atLeast(level(a), need)) && (t.reads ?? []).every((a) => atLeast(level(a), "read"));
}

/**
 * The tools Atlas may use right now: only for installed modules, never more than the person's role allows, without
 * any write tool when Atlas may only read, and only in the areas the owner opened for Atlas (a closed area does not
 * exist for Atlas – its collections are missing from every collection list, search and summary). The order is fixed
 * (built-in tools, then module tools by name) so the prompt prefix stays byte-identical between requests (prompt
 * caching) as long as the settings do not change.
 */
export function buildToolset(cfg: ToolsetConfig): Toolset {
  const ids = new Set(cfg.modules.map((m) => m.id));
  const can = (area: Area, need: Access) => canRole(cfg.role, area, need);
  const levels = areaLevels(cfg);
  const level = (a: AtlasArea) => levels[a] ?? "none";
  const env: ToolEnv = {
    defs: COLLECTIONS.filter((d) => ids.has(d.module) && can(d.area, "read") && atLeast(level(d.atlasArea), "read")),
    modules: ROUTE_ORDER.filter((m) => ids.has(m)),
    routes: routesOf(cfg.modules),
    moduleNames: cfg.modules.map((m) => (m.id === "basis" ? "Ordo Basis" : `${m.name} – ${m.title}`)),
    level,
  };
  const builtIn = [...readTools(env), ...invoiceReadTools(env), ...visualTools(env), ...askTools(), ...(cfg.permission === "read" ? [] : writeTools(env, can)), ...integrationTools(env, can), ...(cfg.untrusted ? fileTools(env, cfg.permission !== "read") : [])].filter((t) => toolAllowed(t, level));
  const taken = new Set(builtIn.map((t) => t.name));
  // module tools, and – in a chat with files – the tools for files only this edition understands (e.g. the old ERP backup)
  const extra = [...cfg.modules.flatMap((m) => m.atlasTools ?? []), ...(cfg.untrusted ? PARTS.atlasFiles?.tools ?? [] : [])]
    .filter((t) => !taken.has(t.name) && /^[a-z][a-z0-9_]{0,63}$/.test(t.name))
    .filter((t) => (t.kind === "write" ? cfg.permission !== "read" : true))
    .filter((t) => !t.area || can(t.area, t.need ?? (t.kind === "write" ? "write" : "read")))
    .filter((t) => toolAllowed(t, level))
    .sort((a, b) => a.name.localeCompare(b.name));
  // a file can contain text that tries to steer Atlas – in a chat with files, every change waits for the person
  const guard = !!cfg.untrusted;
  const tools = [...builtIn, ...extra.filter((t, i, all) => all.findIndex((x) => x.name === t.name) === i)].map((t) => (guard && t.kind === "write" && !t.alwaysConfirm ? { ...t, alwaysConfirm: true } : t));
  const raw = tools.map((t) => ({ name: t.name, kind: t.kind, schema: toolJsonSchema(t.input as z.ZodType) }));
  // strict slots are limited: tools that ask before every run anyway come last
  const confirmed = new Set(tools.filter((t) => t.alwaysConfirm).map((t) => t.name));
  const strict = pickStrict([...raw.filter((r) => !confirmed.has(r.name)), ...raw.filter((r) => confirmed.has(r.name))]);
  const defs: ProviderToolDef[] = tools.map((t, i) => ({ name: t.name, description: t.description, schema: raw[i]!.schema, strict: strict.has(t.name), kind: t.kind }));
  return { tools, defs, byName: new Map(tools.map((t) => [t.name, t])) };
}

/** Fresh context for one tool call (vault snapshot at call time). */
export function toolContext(store: VaultStore, role: Role, navigate: (to: string) => void): AtlasToolContext {
  const profile = store.activeProfile;
  const member = store.vault.members.find((m) => m.id === store.vault.settings.meMemberId && !m.deletedAt);
  // Mitarbeit sees only their own time entries – in every read tool alike (lists, sums, search, related records)
  const vault: Vault = seesAllTime(role) ? store.vault : { ...store.vault, timeEntries: store.vault.timeEntries.filter((e) => !!member && e.memberId === member.id) };
  return {
    store,
    vault,
    profile,
    profileId: profile.id,
    role,
    member,
    memberId: member?.id,
    navigate,
    today: todayIso(),
    can: (area, need) => canRole(role, area, need),
  };
}

export interface ToolRun {
  ok: boolean;
  /** JSON text for the model. */
  content: string;
  result?: AtlasToolResult;
  error?: string;
}

const MAX_RESULT_CHARS = 24_000;

/** Validates the input with zod, runs the tool and turns every outcome into something the model can read. */
export async function runTool(tool: AtlasTool, input: unknown, ctx: AtlasToolContext): Promise<ToolRun> {
  const parsed = tool.input.safeParse(input ?? {});
  if (!parsed.success) {
    const msg = `Ungültige Eingabe: ${zodIssues(parsed.error)}`;
    return { ok: false, content: JSON.stringify({ error: msg, input }), error: msg };
  }
  if (tool.area && !ctx.can(tool.area, tool.need ?? (tool.kind === "write" ? "write" : "read"))) {
    const msg = "Dafür hat deine Rolle keine Berechtigung.";
    return { ok: false, content: JSON.stringify({ error: msg }), error: msg };
  }
  try {
    const result = await tool.run(parsed.data, ctx);
    let content = JSON.stringify(result.data ?? null);
    if (content.length > MAX_RESULT_CHARS) content = content.slice(0, MAX_RESULT_CHARS) + ' …"(gekürzt – bitte genauer filtern)"';
    return { ok: true, content, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const details = e instanceof AtlasToolError ? e.details : undefined;
    return { ok: false, content: JSON.stringify({ error: msg, ...(details ? { details } : {}) }), error: msg };
  }
}

/** One-line description of a call before it runs. */
export function previewCall(tool: AtlasTool | undefined, input: unknown, ctx: AtlasToolContext): string {
  if (!tool) return "Unbekanntes Werkzeug";
  const parsed = tool.input.safeParse(input ?? {});
  if (parsed.success && tool.preview) {
    try {
      return tool.preview(parsed.data, ctx);
    } catch {
      /* fall through */
    }
  }
  return TOOL_LABELS[tool.name] ?? tool.name.replace(/_/g, " ");
}

export const TOOL_LABELS: Record<string, string> = {
  describe_workspace: "Überblick lesen",
  search: "Suchen",
  list_records: "Daten auflisten",
  get_record: "Datensatz öffnen",
  aggregate: "Auswerten",
  project_status: "Projektstand prüfen",
  tax_overview: "Steuern berechnen",
  stock_status: "Lager prüfen",
  show_chart: "Diagramm zeichnen",
  show_table: "Tabelle zeigen",
  open_page: "Seite öffnen",
  create_record: "Anlegen",
  update_record: "Ändern",
  delete_record: "Löschen",
  log_time: "Zeit erfassen",
  start_timer: "Stoppuhr starten",
  stop_timer: "Stoppuhr stoppen",
  create_task: "Aufgabe anlegen",
  set_task_status: "Aufgabenstatus setzen",
  create_project: "Projekt anlegen",
  book_transaction: "Buchen",
  ask_choice: "Rückfrage",
  approve_documents: "Rechnungen buchen",
  settle_bank_lines: "Kontoauszug abgleichen",
  create_offer_draft: "Angebot entwerfen",
  create_invoice_draft: "Rechnung entwerfen",
  update_invoice_draft: "Rechnungsentwurf ändern",
  check_invoice: "Rechnung prüfen",
  read_attachment: "Datei lesen",
  add_invoice_files: "Rechnungen einlesen",
  import_old_erp: "Altes ERP übernehmen",
  run_all_check: "Alles-Check",
  team_load: "Auslastung prüfen",
  integrations_overview: "Verbindungen ansehen",
  integration_setup: "Verbindung einrichten",
  integration_update: "Verbindung ändern",
  integration_test: "Verbindung testen",
  integration_probe: "Verbindung abfragen",
  integration_run: "Verbindung ausführen",
};
