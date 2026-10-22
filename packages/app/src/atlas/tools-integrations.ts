/**
 * Atlas and Schnittstellen: explain the right way for a program (catalog), prepare a connection, test it, read the
 * fields of an API for a mapping, run an import. Every tool that touches a connection asks first (alwaysConfirm) –
 * also when Atlas may otherwise change data without asking. Passwords, API keys and signing secrets never reach Atlas:
 * the person types them in Einstellungen → Schnittstellen, tools only ever see redacted connections.
 * Inputs stay flat (settings as a JSON text) so every write tool fits the strict-schema budget.
 */
import { z } from "zod";
import { API_SCOPES, WEBHOOK_EVENTS, redactIntegration, type Integration, type PullTarget } from "@ordo/core";
import { isTauri } from "@/platform";
import { CATALOG } from "@/services/integrations/catalog";
import { KIND_LABEL, draftIntegration, integrationById, saveIntegration } from "@/services/integrations/registry";
import { runIntegration, testIntegration, useIntegrationRuntime } from "@/services/integrations/runner";
import { MAPPING_FIELDS, probeRest } from "@/services/integrations/restPull";
import { serviceLayerBase } from "@/services/integrations/sapB1";
import { AtlasToolError, defineTool, type AtlasTool, type AtlasToolContext } from "./tools";
import type { ToolEnv } from "./tools-read";
import { zodIssues } from "./schema";
import { atLeast, type AtlasArea } from "./areas";

const LINK = { to: "/einstellungen/schnittstellen", label: "Schnittstellen öffnen" };

/** Where a pull target writes – Atlas may only set it up when that area is open for writing. */
const TARGET_AREA: Record<"contacts" | "incoming" | "outgoing", AtlasArea> = { contacts: "contacts", incoming: "bookkeeping", outgoing: "bookkeeping" };

const Config = z
  .object({
    scopes: z.array(z.enum(API_SCOPES)),
    url: z.string(),
    events: z.array(z.enum(WEBHOOK_EVENTS)),
    base_url: z.string(),
    company_db: z.string(),
    user: z.string(),
    targets: z.array(z.enum(["contacts", "incoming", "outgoing"])),
    auth_header: z.string(),
    items_path: z.string(),
    mapping: z.record(z.string(), z.string()),
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "since als YYYY-MM-DD"),
    every_minutes: z.number().int().min(0).max(1440),
  })
  .partial()
  .strict();
type ConfigT = z.infer<typeof Config>;

const CONFIG_HINT =
  "Einstellungen als JSON-Objekt, nur die nötigen Schlüssel, nie Passwörter: scopes (api_key, Liste der Rechte), url und events (webhook), base_url, company_db, user, targets, since, every_minutes (sap_b1), base_url, auth_header, items_path, targets (genau eines), mapping (Ordo-Feld → Pfad im Datensatz), every_minutes (rest_pull). {} wenn nichts.";

function parseConfig(text: string): ConfigT {
  let obj: unknown;
  try {
    obj = JSON.parse(text || "{}");
  } catch {
    throw new AtlasToolError("config ist kein gültiges JSON.");
  }
  if (obj && typeof obj === "object" && ["password", "secret", "token", "api_key", "key"].some((k) => k in (obj as object))) throw new AtlasToolError("Passwörter und Schlüssel trägt die Person selbst unter Einstellungen → Schnittstellen ein – nicht über Atlas.");
  const r = Config.safeParse(obj);
  if (!r.success) throw new AtlasToolError(`Ungültige Einstellungen: ${zodIssues(r.error)}`);
  return r.data;
}

function apply(i: Integration, c: ConfigT, env: ToolEnv): Integration {
  const targets = c.targets ? (i.kind === "rest_pull" ? c.targets.slice(0, 1) : c.targets) : i.targets;
  for (const t of targets) if (t !== "products" && !atLeast(env.level(TARGET_AREA[t]), "write")) throw new AtlasToolError("Dieser Bereich ist für Atlas nicht freigegeben (Einstellungen → Atlas).");
  if (c.url && !/^https?:\/\//.test(c.url.trim())) throw new AtlasToolError("Die Adresse muss mit https:// beginnen.");
  if (c.base_url && !/^https?:\/\//.test(c.base_url.trim())) throw new AtlasToolError("base_url muss mit https:// beginnen.");
  const next: Integration = {
    ...i,
    scopes: c.scopes ?? i.scopes,
    url: c.url?.trim() ?? i.url,
    events: c.events ?? i.events,
    baseUrl: c.base_url !== undefined ? (i.kind === "sap_b1" ? serviceLayerBase(c.base_url) : c.base_url.trim()) : i.baseUrl,
    companyDb: c.company_db ?? i.companyDb,
    user: c.user ?? i.user,
    targets: targets as PullTarget[],
    authHeader: c.auth_header ?? i.authHeader,
    itemsPath: c.items_path ?? i.itemsPath,
    mapping: c.mapping ? { ...i.mapping, ...c.mapping } : i.mapping,
    since: c.since ?? i.since,
    everyMinutes: c.every_minutes ?? i.everyMinutes,
  };
  // a password or token only ever goes to the host it was entered for: a new address means typing it in again
  if ((i.kind === "sap_b1" || i.kind === "rest_pull") && i.secret && originOf(next.baseUrl) !== originOf(i.baseUrl)) next.secret = "";
  return next;
}

function originOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return url.trim();
  }
}

/** "– neue Adresse: host" when Atlas wants to point a connection somewhere else, so the person sees it before saying yes. */
function addressChange(i: Integration | undefined, config: string): string {
  if (!i) return "";
  try {
    const c = JSON.parse(config || "{}") as { url?: unknown; base_url?: unknown };
    const to = typeof c.base_url === "string" ? c.base_url : typeof c.url === "string" ? c.url : "";
    const from = typeof c.base_url === "string" ? i.baseUrl : i.url;
    if (!to || originOf(to) === originOf(from)) return "";
    const again = (i.kind === "sap_b1" || i.kind === "rest_pull") && i.secret ? " – das Passwort musst du danach neu eintragen" : "";
    return ` – neue Adresse: ${safeHost(to)} (bisher ${from ? safeHost(from) : "keine"})${again}`;
  } catch {
    return "";
  }
}

const forAtlas = (i: Integration) => {
  const r = redactIntegration(i);
  return { id: r.id, kind: r.kind, name: r.name, enabled: r.enabled, scopes: r.scopes, url: r.url, events: r.events, baseUrl: r.baseUrl, companyDb: r.companyDb, user: r.user, targets: r.targets, itemsPath: r.itemsPath, mapping: r.mapping, since: r.since, everyMinutes: r.everyMinutes, hasSecret: r.hasSecret, lastRunAt: r.lastRunAt ?? null, lastOk: r.lastOk ?? null, lastMessage: r.lastMessage ?? null };
};

function find(id: string): Integration {
  const i = integrationById(id);
  if (!i) throw new AtlasToolError(`Keine Verbindung mit id „${id}“. Erst integrations_overview aufrufen.`);
  return i;
}

/** What the person still has to do in the settings after Atlas prepared a connection. */
function todo(i: Integration): string {
  if (i.kind === "api_key") return isTauri ? "Den API-Schlüssel unter Einstellungen → Schnittstellen kopieren und im anderen Programm eintragen; die lokale Schnittstelle dort einschalten." : "Der Schlüssel wirkt in der Desktop-App – dort die lokale Schnittstelle einschalten.";
  if (i.kind === "webhook") return "Den Signatur-Schlüssel unter Einstellungen → Schnittstellen kopieren, wenn der Empfänger Nachrichten prüfen soll; dann testen.";
  if (!i.secret) return i.kind === "sap_b1" ? "Das SAP-Passwort trägt die Person selbst unter Einstellungen → Schnittstellen ein – Atlas sieht es nie. Danach testen." : "Den Schlüssel/Token trägt die Person selbst unter Einstellungen → Schnittstellen ein – Atlas sieht ihn nie. Danach Felder lesen.";
  return "Bereit zum Testen.";
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function integrationTools(env: ToolEnv, can: AtlasToolContext["can"]): AtlasTool[] {
  if (!can("settings", "admin") || !atLeast(env.level("integrations"), "read")) return [];
  const base = { atlasArea: "integrations" as const, area: "settings" as const, need: "admin" as const };
  const openTargets = (["contacts", "incoming", "outgoing"] as const).filter((t) => atLeast(env.level(TARGET_AREA[t]), "read"));
  const fieldsFor = (t: string) => (t === "contacts" ? MAPPING_FIELDS.contacts : MAPPING_FIELDS.transactions);
  const tools: AtlasTool[] = [
    defineTool({
      ...base,
      name: "integrations_overview",
      description:
        "Schnittstellen: welche fertigen Wege es für verbreitete Programme gibt (BMD, RZL, SAP Business One, SAP S/4HANA, Business Central, E-Rechnung, n8n …) und welche Verbindungen schon eingerichtet sind – ohne Passwörter und Schlüssel. Zuerst aufrufen, wenn jemand ein Programm anbinden will.",
      input: z.object({}),
      kind: "read",
      run(_i, ctx) {
        const list = ctx.store.vault.settings.integrations ?? [];
        const rt = useIntegrationRuntime.getState();
        return {
          summary: `${CATALOG.length} Programme im Katalog, ${list.length} Verbindungen`,
          data: {
            catalog: CATALOG.map((c) => ({ id: c.id, name: c.name, who: c.who, ways: c.ways, steps: c.steps, setupKind: c.setup ?? null })),
            connections: list.map(forAtlas),
            localApi: { desktop: isTauri, enabled: ctx.store.vault.settings.localApi.enabled, running: rt.apiRunning, port: ctx.store.vault.settings.localApi.port },
            pullTargets: Object.fromEntries(openTargets.map((t) => [t, fieldsFor(t)])),
            note: "Daten fließen direkt zwischen diesem Gerät und dem anderen Programm, nie über Ordo. Ordo schreibt nie in SAP. Rechnungen kommen als offene Posten, Zahlungen ordnet der Kontoabgleich zu.",
          },
          link: LINK,
        };
      },
    }),
  ];
  if (!atLeast(env.level("integrations"), "write")) return tools;
  tools.push(
    defineTool({
      ...base,
      name: "integration_setup",
      description: "Bereitet eine neue Verbindung vor – ohne Passwort, das trägt die Person selbst ein. Fragt immer vorher. Danach sagen, was noch zu tun ist, und den Test anbieten.",
      input: z.object({
        kind: z.enum(["api_key", "webhook", "sap_b1", "rest_pull"]).describe("api_key = lokale Schnittstelle für ein Programm auf diesem PC; webhook = Ordo sendet Änderungen; sap_b1 = SAP Business One Service Layer; rest_pull = JSON-Liste einer anderen API abholen"),
        name: z.string().min(1).describe("Kurzer Name, z. B. SAP Firma"),
        config: z.string().describe(CONFIG_HINT),
      }),
      kind: "write",
      alwaysConfirm: true,
      preview: (i) => {
        let host = "";
        try {
          const c = JSON.parse(i.config || "{}") as { url?: unknown; base_url?: unknown };
          const to = typeof c.base_url === "string" ? c.base_url : typeof c.url === "string" ? c.url : "";
          host = to ? ` (Adresse: ${safeHost(to)})` : "";
        } catch {
          /* parseConfig reports it */
        }
        return `${KIND_LABEL[i.kind]} „${i.name}“ einrichten${host}`;
      },
      run(input, ctx) {
        const draft = apply(draftIntegration(input.kind, { name: input.name, createdBy: "atlas", deviceId: ctx.store.vault.settings.sync.deviceId }), parseConfig(input.config), env);
        const saved = saveIntegration(draft);
        return { summary: `${KIND_LABEL[saved.kind]} „${saved.name}“ vorbereitet`, data: { connection: forAtlas(saved), next: todo(saved) }, link: LINK };
      },
    }),
    defineTool({
      ...base,
      name: "integration_update",
      description: "Ändert eine bestehende Verbindung, z. B. die Feldzuordnung nach dem Felder-Lesen, Rechte, Ereignisse oder den Zeitplan. Nie Passwörter. Fragt immer vorher.",
      input: z.object({ id: z.string(), config: z.string().describe(CONFIG_HINT) }),
      kind: "write",
      alwaysConfirm: true,
      preview: (i) => {
        const c = integrationById(i.id);
        return `Verbindung „${c?.name ?? i.id}“ ändern${addressChange(c, i.config)}`;
      },
      run(input) {
        const saved = saveIntegration(apply(find(input.id), parseConfig(input.config), env));
        return { summary: `„${saved.name}“ geändert`, data: { connection: forAtlas(saved), next: todo(saved) }, link: LINK };
      },
    }),
    defineTool({
      ...base,
      name: "integration_test",
      description: "Testet eine Verbindung: meldet sich beim anderen Programm an bzw. schickt einen Test-Webhook und zählt, ändert in Ordo nichts. Fragt immer vorher.",
      input: z.object({ id: z.string() }),
      kind: "write",
      alwaysConfirm: true,
      preview: (i) => {
        const c = integrationById(i.id);
        return `Verbindung „${c?.name ?? i.id}“ testen${c?.baseUrl ? ` (verbindet mit ${safeHost(c.baseUrl)})` : c?.url ? ` (sendet an ${safeHost(c.url)})` : ""} – ändert nichts`;
      },
      async run(input) {
        const message = await testIntegration(find(input.id).id).catch((e: unknown) => {
          throw new AtlasToolError(e instanceof Error ? e.message : String(e));
        });
        return { summary: message, data: { ok: true, message }, link: LINK };
      },
    }),
    defineTool({
      ...base,
      name: "integration_probe",
      description: "REST-Abruf: liest eine Seite der Liste und beschreibt die Felder des ersten Datensatzes (Pfad, Typ, kurzes Beispiel), damit du die Feldzuordnung vorschlägst und mit integration_update einträgst. Fragt immer vorher.",
      input: z.object({ id: z.string() }),
      kind: "write",
      alwaysConfirm: true,
      preview: (i) => `Felder von „${integrationById(i.id)?.name ?? i.id}“ lesen (eine Abfrage, nichts wird gespeichert)`,
      async run(input) {
        const c = find(input.id);
        if (c.kind !== "rest_pull") throw new AtlasToolError("Felder lesen geht nur beim REST-Abruf.");
        const r = await probeRest(c).catch((e: unknown) => {
          throw new AtlasToolError(e instanceof Error ? e.message : String(e));
        });
        // examples stay short – enough to recognise a field, not to copy records
        return { summary: `${r.count} Datensätze, ${r.fields.length} Felder`, data: { count: r.count, itemsPath: r.itemsPath, fields: r.fields.map((f) => ({ ...f, example: f.example.slice(0, 20) })), ordoFields: fieldsFor(c.targets[0] ?? "contacts") } };
      },
    }),
    defineTool({
      ...base,
      name: "integration_run",
      description: "Startet einen Abgleich sofort (SAP/REST holen Daten nach Ordo, ein Webhook sendet offene Änderungen). Fragt immer vorher. Ergebnis kurz zusammenfassen.",
      input: z.object({ id: z.string() }),
      kind: "write",
      alwaysConfirm: true,
      preview: (i) => {
        const c = integrationById(i.id);
        return c?.kind === "webhook" ? `Offene Änderungen an „${c.name}“ senden` : `Daten aus „${c?.name ?? i.id}“ nach Ordo holen`;
      },
      async run(input, ctx) {
        const c = find(input.id);
        for (const t of c.targets) if (t !== "products" && !atLeast(env.level(TARGET_AREA[t]), "write")) throw new AtlasToolError("Dieser Bereich ist für Atlas nicht freigegeben (Einstellungen → Atlas).");
        const message = await runIntegration(ctx.store, c.id).catch((e: unknown) => {
          throw new AtlasToolError(e instanceof Error ? e.message : String(e));
        });
        return { summary: message, data: { ok: true, message }, link: LINK };
      },
    }),
  );
  return tools;
}
