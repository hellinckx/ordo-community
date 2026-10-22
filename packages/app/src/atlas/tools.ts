import type { z } from "zod";
import type { Access, Area, Member, Profile, Role, Vault, VaultStore } from "@ordo/core";
import type { AtlasArea } from "./areas";

/** A chart Atlas wants to show inline. Rendered by the app's own chart components, in the app's style. */
export interface AtlasChartSpec {
  kind: "bar" | "line" | "area" | "pie" | "stacked-bar";
  title: string;
  /** Rows, e.g. [{ label: "Jän", Einnahmen: 1200, Ausgaben: 800 }]. Money in euros (not cents). */
  data: Record<string, string | number>[];
  /** Key of the label column. */
  x: string;
  /** Numeric series to draw. */
  series: { key: string; label?: string }[];
  /** How to format numbers. */
  unit?: "eur" | "hours" | "count" | "percent";
}

export type AtlasVisual =
  | { type: "chart"; chart: AtlasChartSpec }
  | { type: "table"; title?: string; columns: string[]; rows: (string | number)[][] }
  | { type: "link"; to: string; label: string };

export interface AtlasToolContext {
  store: VaultStore;
  profileId: string;
  role: Role;
  memberId?: string;
  navigate(to: string): void;
  /** Snapshot of the vault at call time (read-only – change data through `store`). */
  vault: Vault;
  profile: Profile;
  member?: Member;
  /** YYYY-MM-DD */
  today: string;
  /** Role check (`can()` with the person's role). */
  can(area: Area, need: Access): boolean;
}

export interface AtlasToolResult {
  /** What the model gets back (keep it compact). */
  data: unknown;
  /** One line for the person, e.g. "3 Aufgaben angelegt". */
  summary: string;
  visual?: AtlasVisual;
  /** Link shown under the result (e.g. the record that was created). */
  link?: { to: string; label: string };
}

export interface AtlasTool<I = unknown> {
  /** snake_case, unique. */
  name: string;
  /** What it does and when to use it – written for the model. */
  description: string;
  input: z.ZodType<I>;
  /** read = only looks at data; write = changes data and is subject to the permission setting. */
  kind: "read" | "write";
  /** Area for role checks (Atlas never has more rights than the person). */
  area?: Area;
  /** Minimum access in `area` (default: "read" for read tools, "write" for write tools). */
  need?: Access;
  /**
   * Area in Einstellungen → Atlas this tool works in: read tools need at least "Nur lesen", write tools "Lesen &
   * ändern". Without it, a tool with a role `area` needs every Atlas area of that role area.
   */
  atlasArea?: AtlasArea;
  /** Further areas the tool reads from (e.g. log_time looks up projects) – each needs at least "Nur lesen". */
  reads?: AtlasArea[];
  /**
   * Always ask before running, even when Atlas may change data without asking – for tools that contact other
   * programs or set up access to them (Schnittstellen).
   */
  alwaysConfirm?: boolean;
  /** One line describing a call before it runs – shown on the chip and on the confirmation card. */
  preview?(input: I, ctx: AtlasToolContext): string;
  /** More on the confirmation card, e.g. what an import would create – computed on the device. */
  details?(input: I, ctx: AtlasToolContext): AtlasVisual | null;
  /** Parts the person can switch off on the confirmation card before running (e.g. the areas of an import). */
  options?(input: I, ctx: AtlasToolContext): { key: string; label: string; hint?: string; on: boolean }[];
  /** The input with the choices from `options`. */
  withOptions?(input: I, choice: Record<string, boolean>): I;
  run(input: I, ctx: AtlasToolContext): Promise<AtlasToolResult> | AtlasToolResult;
}

/** Helper that keeps the generic input type when tools are put into arrays. */
export function defineTool<I>(tool: AtlasTool<I>): AtlasTool {
  return tool as unknown as AtlasTool;
}

/** Thrown by tools for problems the model should see and fix (wrong id, missing right, invalid field). */
export class AtlasToolError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "AtlasToolError";
  }
}
