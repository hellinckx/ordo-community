import type { Settings, Vault } from "../model/types";
import { ENTITY_COLLECTIONS, VaultSchema } from "../model/types";

export interface DataExport {
  format: "summa-data";
  version: number;
  exportedAt: string;
  app: string;
  data: Vault;
}

/** Plain (decrypted!) JSON export of all data. Attachments are exported separately (ZIP). */
export function exportJson(vault: Vault, opts: { includeSecrets?: boolean } = {}): Uint8Array {
  const data: Vault = JSON.parse(JSON.stringify(vault));
  if (!opts.includeSecrets) {
    data.settings.ai.openaiApiKey = "";
    data.settings.ai.anthropicApiKey = "";
    data.settings.sync.supabaseAnonKey = "";
  }
  const out: DataExport = { format: "summa-data", version: data.version, exportedAt: new Date().toISOString(), app: "Summa", data };
  return new TextEncoder().encode(JSON.stringify(out, null, 2));
}

export function parseDataExport(bytes: Uint8Array): Vault {
  const text = new TextDecoder().decode(bytes);
  const obj = JSON.parse(text) as Partial<DataExport>;
  if (obj.format !== "summa-data" || !obj.data) throw new Error("Keine gültige Summa-Datenexport-Datei.");
  return VaultSchema.parse(obj.data);
}

/** Settings areas that belong to one device (folder paths, the local interface on this computer) and never travel with sync. */
export const DEVICE_SETTINGS = ["watchFolders", "localApi"] as const;

/**
 * Settings from another device merged into this one's, area by area (ai, atlas, integrations, …): the area changed
 * last wins (settings.stamps). On a tie – e.g. vaults from before the stamps – `prefer` decides. AI usage counters
 * only ever grow, so the larger count per month, feature and model is kept from both sides.
 */
export function mergeSettings(local: Settings, remote: Settings, prefer: "local" | "remote" = "local"): Settings {
  const out = { ...local } as unknown as Record<string, unknown>;
  const theirs = remote as unknown as Record<string, unknown>;
  const stamps = { ...(local.stamps ?? {}) };
  for (const k of Object.keys(theirs)) {
    if (k === "stamps" || (DEVICE_SETTINGS as readonly string[]).includes(k)) continue;
    const r = remote.stamps?.[k] ?? "";
    const l = local.stamps?.[k] ?? "";
    if (r > l || (r === l && prefer === "remote")) {
      out[k] = theirs[k];
      if (r) stamps[k] = r;
    }
  }
  const months = { ...remote.aiUsage.months } as Settings["aiUsage"]["months"];
  for (const [month, features] of Object.entries(local.aiUsage.months)) {
    for (const [feature, models] of Object.entries(features)) {
      for (const [model, bucket] of Object.entries(models)) {
        const other = months[month]?.[feature]?.[model];
        if (other && other.calls >= bucket.calls) continue;
        months[month] = { ...months[month], [feature]: { ...months[month]?.[feature], [model]: bucket } };
      }
    }
  }
  const usage = out.aiUsage as Settings["aiUsage"];
  return { ...(out as unknown as Settings), aiUsage: { ...usage, months }, stamps };
}

/**
 * Merges an imported vault into the current one (entity-level, newest updatedAt wins).
 * Returns a new Vault object.
 */
export function mergeVaults(current: Vault, incoming: Vault): { vault: Vault; added: number; updated: number } {
  const collections = ENTITY_COLLECTIONS;
  let added = 0;
  let updated = 0;
  const next: Vault = { ...current };
  for (const c of collections) {
    const map = new Map<string, { id: string; updatedAt?: string; createdAt?: string }>((current[c] as { id: string }[]).map((e) => [e.id, e]));
    for (const e of incoming[c] as { id: string; updatedAt?: string; createdAt?: string }[]) {
      const cur = map.get(e.id);
      if (!cur) {
        map.set(e.id, e);
        added++;
      } else if ((e.updatedAt ?? e.createdAt ?? "") > (cur.updatedAt ?? cur.createdAt ?? "")) {
        map.set(e.id, e);
        updated++;
      }
    }
    (next[c] as unknown[]) = [...map.values()];
  }
  return { vault: next, added, updated };
}
