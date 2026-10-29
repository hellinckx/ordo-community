import type { Role } from "./schemas";

/** Areas of the workspace that rights are given for. */
export type Area = "summa" | "projects" | "time" | "offers" | "products" | "production" | "files" | "contacts" | "team" | "settings";

/**
 * none  – not visible
 * read  – can look
 * own   – can look, and change only what is theirs (own time entries, tasks assigned to them, own work steps)
 * write – can create and change
 * admin – can also delete and configure
 */
export type Access = "none" | "read" | "own" | "write" | "admin";

const ORDER: Access[] = ["none", "read", "own", "write", "admin"];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Inhaber:in",
  admin: "Administration",
  manager: "Projektleitung",
  member: "Mitarbeit",
  viewer: "Nur ansehen",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Darf alles, auch Rechte vergeben und das Konto verwalten.",
  admin: "Darf alles außer das Konto löschen.",
  manager: "Führt Projekte, Angebote, Lager und Produktion. Sieht die Buchhaltung, ändert sie aber nicht.",
  member: "Sieht Projekte und Aufgaben, erfasst eigene Zeiten und arbeitet Aufgaben und Arbeitsschritte ab.",
  viewer: "Kann alles ansehen, was nicht Buchhaltung ist, aber nichts ändern.",
};

export const AREA_LABELS: Record<Area, string> = {
  summa: "Buchhaltung",
  projects: "Projekte & Aufgaben",
  time: "Zeiterfassung",
  offers: "Angebote",
  products: "Produkte & Lager",
  production: "Produktion",
  files: "Dateien",
  contacts: "Kontakte",
  team: "Team",
  settings: "Einstellungen",
};

export const ROLE_MATRIX: Record<Role, Record<Area, Access>> = {
  owner: { summa: "admin", projects: "admin", time: "admin", offers: "admin", products: "admin", production: "admin", files: "admin", contacts: "admin", team: "admin", settings: "admin" },
  admin: { summa: "admin", projects: "admin", time: "admin", offers: "admin", products: "admin", production: "admin", files: "admin", contacts: "admin", team: "write", settings: "write" },
  manager: { summa: "read", projects: "admin", time: "write", offers: "write", products: "write", production: "admin", files: "write", contacts: "write", team: "read", settings: "none" },
  member: { summa: "none", projects: "own", time: "own", offers: "none", products: "read", production: "own", files: "write", contacts: "read", team: "read", settings: "none" },
  viewer: { summa: "none", projects: "read", time: "read", offers: "read", products: "read", production: "read", files: "read", contacts: "read", team: "read", settings: "none" },
};

export function accessFor(role: Role | undefined, area: Area): Access {
  return ROLE_MATRIX[role ?? "owner"][area];
}

/**
 * Sees everyone's booked time – entries, hours per person, team load. Roles that book only their own time
 * (Mitarbeit: "own") see just their own entries; project totals without names stay visible to them.
 */
export function seesAllTime(role: Role | undefined): boolean {
  const a = accessFor(role, "time");
  return a === "read" || a === "write" || a === "admin";
}

/** True when the role has at least the given access in the area. */
export function can(role: Role | undefined, area: Area, need: Access): boolean {
  return ORDER.indexOf(accessFor(role, area)) >= ORDER.indexOf(need);
}
