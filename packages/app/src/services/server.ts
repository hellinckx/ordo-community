/**
 * Which database an account lives in: the Ordo server (preconfigured, operated by us) or the person's own Supabase
 * project ("Eigene Datenbank", free on Supabase's free plan). With an own project Ordo has no part in it at all – the
 * app talks straight to that project, we never see the address, the key or any data.
 */
import { SUMMA_SYNC_DEFAULT } from "@/config";

export interface ServerTarget {
  url: string;
  anonKey: string;
}

export const ORDO_SERVER: ServerTarget = { url: SUMMA_SYNC_DEFAULT.url, anonKey: SUMMA_SYNC_DEFAULT.anonKey };

/** Schema version the app needs on an own project (supabase/schema.sql → summa_schema_version). */
export const REQUIRED_SCHEMA = 3;

/**
 * Supabase free plan, as of October 2026 (supabase.com/pricing). Fixed values for context – Supabase does not tell an
 * app its plan. Above them a project needs Supabase Pro, billed by Supabase to the project owner.
 */
export const SUPABASE_FREE = {
  dbBytes: 500 * 1048576,
  storageBytes: 1024 * 1048576,
  egressBytes: 5 * 1024 * 1048576,
  maxUploadMb: 50,
  pauseDays: 7,
  proUsd: 25,
};

const PENDING_KEY = "summa.sync.target";

const trimUrl = (u: string) => u.trim().replace(/\/+$/, "");

export function isOrdoServer(url?: string | null): boolean {
  return !url || trimUrl(url) === trimUrl(ORDO_SERVER.url);
}

/** Project ref of a Supabase cloud URL (https://<ref>.supabase.co), null for self-hosted addresses. */
export function projectRef(url: string): string | null {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/i.exec(trimUrl(url));
  return m ? m[1]!.toLowerCase() : null;
}

/** Short label for the UI: "abcd…wxyz.supabase.co" or the host of a self-hosted server. */
export function serverLabel(url?: string | null): string {
  if (isOrdoServer(url)) return SUMMA_SYNC_DEFAULT.label;
  try {
    return new URL(trimUrl(url!)).host;
  } catch {
    return url ?? "";
  }
}

/** Accepts "https://abcd….supabase.co", "abcd….supabase.co", the bare project ref or a self-hosted https address. */
export function normalizeServerUrl(input: string): string | null {
  const s = input.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  if (/^[a-z0-9]{20}$/i.test(s)) return `https://${s.toLowerCase()}.supabase.co`;
  if (/^[a-z0-9]{20}\.supabase\.co$/i.test(s)) return `https://${s.toLowerCase()}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * The public key is safe in an app (every table is protected by row-level security); the secret/service key is not –
 * it bypasses all of it. Returns a German explanation when the key is the wrong one, else null.
 */
export function keyProblem(key: string): string | null {
  const k = key.trim();
  if (!k) return "Der Schlüssel fehlt.";
  if (/^sb_secret_/i.test(k)) return "Das ist der geheime Schlüssel (sb_secret_…). Er hat volle Rechte und darf nie in eine App. Nimm den öffentlichen „Publishable key“ (sb_publishable_…).";
  if (/^eyJ/.test(k)) {
    try {
      const payload = JSON.parse(atob(k.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string };
      if (payload.role === "service_role") return "Das ist der „service_role“-Schlüssel mit vollen Rechten. Nimm den „anon“-Schlüssel oder den „Publishable key“.";
      if (payload.role && payload.role !== "anon") return `Unbekannter Schlüssel (Rolle „${payload.role}“). Nimm den „anon“-Schlüssel oder den „Publishable key“.`;
      return null;
    } catch {
      return "Der Schlüssel ist nicht lesbar – bitte vollständig kopieren.";
    }
  }
  if (/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(k)) return null;
  return "Das sieht nicht wie ein Supabase-Schlüssel aus. Er beginnt mit „sb_publishable_“ (oder bei älteren Projekten mit „eyJ“).";
}

/* ------------------------------------------------------------------ */
/* Pending target: chosen on the start screen before a vault exists    */
/* ------------------------------------------------------------------ */

export function pendingTarget(): ServerTarget | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as ServerTarget | null;
    return raw?.url && raw.anonKey ? raw : null;
  } catch {
    return null;
  }
}

export function setPendingTarget(t: ServerTarget | null): void {
  try {
    if (t && !isOrdoServer(t.url)) localStorage.setItem(PENDING_KEY, JSON.stringify(t));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode – the choice then lasts for this page only */
  }
}

/* ------------------------------------------------------------------ */
/* Connection code: hands an own project to another device or person   */
/* ------------------------------------------------------------------ */

const CODE_PREFIX = "ORDO-DB1:";

/** Address + public key in one line, for the second device or a colleague. Contains no password and no data. */
export function connectionCode(t: ServerTarget): string {
  const json = JSON.stringify({ u: trimUrl(t.url), k: t.anonKey.trim() });
  return CODE_PREFIX + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function parseConnectionCode(text: string): ServerTarget | null {
  const s = text.trim();
  if (!s.startsWith(CODE_PREFIX)) return null;
  try {
    const b64 = s.slice(CODE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    const obj = JSON.parse(decodeURIComponent(escape(atob(b64 + "===".slice((b64.length + 3) % 4))))) as { u?: string; k?: string };
    const url = obj.u ? normalizeServerUrl(obj.u) : null;
    return url && obj.k && !keyProblem(obj.k) ? { url, anonKey: obj.k } : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Probe: is the project reachable, is Ordo set up in it?              */
/* ------------------------------------------------------------------ */

export type ProbeResult =
  | { ok: true; schemaVersion: number; signupsOpen: boolean | null }
  | { ok: false; problem: "unreachable" | "key" | "schema" | "outdated"; message: string; schemaVersion?: number };

/** Anonymous calls only (version and "may sign up?") – nothing about the people or data in the project. */
export async function probeServer(t: ServerTarget, fetcher: typeof fetch = fetch): Promise<ProbeResult> {
  const base = trimUrl(t.url);
  const headers = { apikey: t.anonKey.trim(), "Content-Type": "application/json" };
  let res: Response;
  try {
    res = await fetcher(`${base}/rest/v1/rpc/summa_schema_version`, { method: "POST", headers, body: "{}" });
  } catch {
    return { ok: false, problem: "unreachable", message: "Das Projekt ist nicht erreichbar. Stimmt die Adresse? Ein Gratis-Projekt, das eine Woche nicht benutzt wurde, pausiert – im Supabase-Dashboard auf „Restore project“ drücken." };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, problem: "key", message: "Supabase lehnt den Schlüssel ab. Kopiere den „Publishable key“ (oder „anon“) noch einmal aus Project Settings → API Keys." };
  if (res.status === 404) return { ok: false, problem: "schema", message: "Ordo ist in diesem Projekt noch nicht eingerichtet. Spiel das SQL im SQL Editor ein (Schritt 3)." };
  if (res.status === 540 || res.status === 503) return { ok: false, problem: "unreachable", message: "Das Projekt ist pausiert oder startet gerade. Im Supabase-Dashboard auf „Restore project“ drücken und kurz warten." };
  if (!res.ok) return { ok: false, problem: "unreachable", message: `Supabase antwortet mit Fehler ${res.status}. Versuch es in einer Minute noch einmal.` };
  const version = Number(await res.json().catch(() => 0));
  if (!(version >= REQUIRED_SCHEMA)) return { ok: false, problem: "outdated", schemaVersion: version, message: `Das Projekt hat eine ältere Ordo-Einrichtung (Version ${version || "?"}). Spiel das SQL noch einmal ein – es ändert keine Daten.` };
  let signupsOpen: boolean | null = null;
  try {
    const r = await fetcher(`${base}/rest/v1/rpc/summa_signups_open`, { method: "POST", headers, body: "{}" });
    if (r.ok) signupsOpen = ((await r.json()) as { open?: boolean }).open !== false;
  } catch {
    /* only a hint */
  }
  return { ok: true, schemaVersion: version, signupsOpen };
}

/* ------------------------------------------------------------------ */
/* Usage against the free plan                                         */
/* ------------------------------------------------------------------ */

export interface ProjectUsage {
  own_project: boolean;
  schema_version: number;
  db_bytes: number;
  storage_bytes: number;
  objects: number;
  accounts: number;
  accounts_max: number | null;
  egress_30d: number;
  active_7d: number;
  last_activity: string | null;
}

export interface UsageMeter {
  id: "db" | "storage" | "egress" | "accounts";
  label: string;
  used: number;
  limit: number;
  unit: "bytes" | "count";
  hint: string;
}

export function usageMeters(u: ProjectUsage): UsageMeter[] {
  return [
    { id: "storage", label: "Dateien gesamt (Rechnungen, Tresore)", used: Number(u.storage_bytes), limit: SUPABASE_FREE.storageBytes, unit: "bytes", hint: "Gratis: 1 GB für das ganze Projekt." },
    { id: "db", label: "Datenbank", used: Number(u.db_bytes), limit: SUPABASE_FREE.dbBytes, unit: "bytes", hint: "Gratis: 500 MB. Ordo braucht hier sehr wenig – die Daten liegen verschlüsselt bei den Dateien." },
    { id: "egress", label: "Datenverkehr (30 Tage, geschätzt)", used: Number(u.egress_30d), limit: SUPABASE_FREE.egressBytes, unit: "bytes", hint: "Gratis: 5 GB im Monat. Geschätzt aus dem Abgleich – den genauen Wert zeigt Supabase unter Usage." },
    { id: "accounts", label: "Konten", used: Number(u.accounts), limit: Number(u.accounts_max ?? 50) || 50, unit: "count", hint: "Grenze, die du im Admin-Bereich unter Server-Einstellungen änderst." },
  ];
}

/** Highest share of any limit (0..1+). */
export function usagePeak(u: ProjectUsage): { share: number; meter: UsageMeter } {
  const meters = usageMeters(u).filter((m) => m.id !== "accounts");
  return meters.map((meter) => ({ share: meter.limit ? meter.used / meter.limit : 0, meter })).sort((a, b) => b.share - a.share)[0]!;
}

export function dashboardUrl(url: string): string {
  const ref = projectRef(url);
  return ref ? `https://supabase.com/dashboard/project/${ref}` : "https://supabase.com/dashboard/projects";
}
