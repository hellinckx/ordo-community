import { can as canRole, type Area, type Role } from "@ordo/core";
import type { ModuleId } from "@/modules/types";

/**
 * Areas the owner can open or close for Atlas (Einstellungen → Atlas → "Worauf darf Atlas zugreifen?").
 * Finer than the role areas: Summa is split, so e.g. bank lines can be hidden while bookings stay visible.
 */
export type AtlasArea =
  | "bookkeeping"
  | "incoming"
  | "outgoing"
  | "bank"
  | "taxes"
  | "contacts"
  | "projects"
  | "time"
  | "offers"
  | "products"
  | "production"
  | "files"
  | "team"
  | "integrations";

export type AtlasLevel = "none" | "read" | "write";

export interface AtlasAreaDef {
  id: AtlasArea;
  label: string;
  /** One line under the label in the settings. */
  hint: string;
  module: ModuleId;
  /** Role area that caps it (`can()`). */
  role: Area;
  default: AtlasLevel;
}

/** Fixed order – also the order in the settings. */
export const ATLAS_AREAS: AtlasAreaDef[] = [
  { id: "bookkeeping", label: "Buchhaltung – Einnahmen & Ausgaben", hint: "Buchungen, Kategorien, Anlagen, wiederkehrende Buchungen", module: "summa", role: "summa", default: "write" },
  { id: "incoming", label: "Eingehende Rechnungen", hint: "Eingelesene Rechnungen und Kassenbons", module: "summa", role: "summa", default: "write" },
  { id: "outgoing", label: "Ausgehende Rechnungen", hint: "Deine Rechnungen an Kunden – Atlas schreibt höchstens Entwürfe, versendet nie", module: "summa", role: "summa", default: "read" },
  { id: "bank", label: "Kontoauszüge", hint: "Importierte Kontoauszugszeilen", module: "summa", role: "summa", default: "write" },
  { id: "taxes", label: "Steuern", hint: "UVA, E1a und L1 aus deinen Buchungen", module: "summa", role: "summa", default: "write" },
  { id: "contacts", label: "Kontakte", hint: "Kunden und Lieferanten", module: "basis", role: "contacts", default: "write" },
  { id: "projects", label: "Projekte & Aufgaben", hint: "Projekte, Aufgaben, Meilensteine", module: "projekte", role: "projects", default: "write" },
  { id: "time", label: "Zeiterfassung", hint: "Zeiten und Stoppuhren", module: "projekte", role: "time", default: "write" },
  { id: "offers", label: "Angebote", hint: "Angebote an Kunden", module: "projekte", role: "offers", default: "write" },
  { id: "products", label: "Produkte & Lager", hint: "Artikel und Lagerbewegungen", module: "produkte", role: "products", default: "write" },
  { id: "production", label: "Produktion", hint: "Fertigungsaufträge", module: "produktion", role: "production", default: "write" },
  { id: "files", label: "Dateien", hint: "Ordner und Dateien", module: "basis", role: "files", default: "write" },
  { id: "team", label: "Team", hint: "Personen im Team, inklusive Stundensätze", module: "basis", role: "team", default: "read" },
  { id: "integrations", label: "Schnittstellen", hint: "Verbindungen zu anderen Programmen erklären, vorbereiten und testen – jedes Mal nur nach deinem OK, Passwörter und Schlüssel sieht Atlas nie", module: "basis", role: "settings", default: "write" },
];

export const ATLAS_AREA_BY_ID = new Map(ATLAS_AREAS.map((a) => [a.id, a]));

const RANK: Record<AtlasLevel, number> = { none: 0, read: 1, write: 2 };

/** Setting for an area: stored value, else the area's default. Unknown values fall back to the default too. */
export function areaSetting(areas: Record<string, string> | undefined, area: AtlasArea): AtlasLevel {
  const v = areas?.[area];
  if (v === "none" || v === "read" || v === "write") return v;
  return ATLAS_AREA_BY_ID.get(area)?.default ?? "none";
}

export function minLevel(a: AtlasLevel, b: AtlasLevel): AtlasLevel {
  return RANK[a] <= RANK[b] ? a : b;
}

export function atLeast(have: AtlasLevel, need: "read" | "write"): boolean {
  return RANK[have] >= RANK[need];
}

/** What the role allows in the area, in Atlas terms ("own" counts as write – the tools check ownership themselves). */
export function roleLevel(role: Role, area: Area): AtlasLevel {
  if (canRole(role, area, "own")) return "write";
  if (canRole(role, area, "read")) return "read";
  return "none";
}

/**
 * Effective right of Atlas in an area: the minimum of the person's role, the global permission ("Nur lesen" caps
 * everything at read) and the area setting.
 */
export function effectiveLevel(opts: { role: Role; permission: "read" | "confirm" | "auto"; areas?: Record<string, string> }, area: AtlasArea): AtlasLevel {
  const def = ATLAS_AREA_BY_ID.get(area);
  if (!def) return "none";
  const global: AtlasLevel = opts.permission === "read" ? "read" : "write";
  return minLevel(minLevel(roleLevel(opts.role, def.role), global), areaSetting(opts.areas, area));
}

/** Atlas areas a role area stands for (tools that only name a role area must pass all of them). */
export function areasOfRole(area: Area): AtlasArea[] {
  return ATLAS_AREAS.filter((a) => a.role === area).map((a) => a.id);
}
