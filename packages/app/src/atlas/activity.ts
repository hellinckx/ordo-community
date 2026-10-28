import type { AtlasArea } from "./areas";
import { COLLECTIONS } from "./data";
import type { AtlasTool } from "./tools";
import type { Vault } from "@ordo/core";
import type { RunState } from "./engine";

export interface AtlasWorkArea { label: string; path: string }
export function activeAtlasRuns(vault: Vault | null, runs: Record<string, RunState>) {
  return (vault?.atlasChats ?? []).filter((chat) => !chat.deletedAt && (!chat.profileId || chat.profileId === vault?.activeProfileId) && runs[chat.id] && runs[chat.id]!.status !== "idle")
    .map((chat) => ({ chat, run: runs[chat.id]! })).sort((a, b) => (b.run.startedAt ?? 0) - (a.run.startedAt ?? 0));
}
const AREAS: Record<AtlasArea, AtlasWorkArea> = {
  bookkeeping: { label: "Einnahmen & Ausgaben", path: "/buchungen" },
  incoming: { label: "Eingehende Rechnungen", path: "/belege" },
  outgoing: { label: "Ausgehende Rechnungen", path: "/rechnungen" },
  bank: { label: "Kontoauszüge", path: "/bank" },
  taxes: { label: "Steuern", path: "/steuern" },
  contacts: { label: "Kontakte", path: "/kontakte" },
  projects: { label: "Projekte & Aufgaben", path: "/projekte" },
  time: { label: "Zeiterfassung", path: "/zeiten" },
  offers: { label: "Angebote", path: "/angebote" },
  products: { label: "Produkte & Lager", path: "/produkte" },
  production: { label: "Produktion", path: "/produktion" },
  files: { label: "Dateien", path: "/dateien" },
  team: { label: "Team", path: "/team" },
  integrations: { label: "Schnittstellen", path: "/einstellungen/schnittstellen" },
};

/** Derives location from the actual tool/collection, never from guessed model text. */
export function workAreaFor(tool: AtlasTool | undefined, input: unknown): AtlasWorkArea | undefined {
  if (!tool) return;
  const args = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const collection = COLLECTIONS.find((c) => c.id === args.collection);
  if (collection) {
    const special: Record<string, string> = { assets: "/anlagen", categories: "/einstellungen/kategorien", tasks: "/aufgaben", stockMoves: "/lager" };
    return { label: collection.label, path: special[collection.id] ?? AREAS[collection.atlasArea].path };
  }
  return tool.atlasArea ? AREAS[tool.atlasArea] : undefined;
}
