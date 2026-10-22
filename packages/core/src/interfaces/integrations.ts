/**
 * Connections to other programs ("Schnittstellen"). They live in the encrypted vault like everything else; secrets
 * (API keys, passwords, signing keys) stay in `secret` and are never shown to Atlas or written to any log.
 * Ordo itself never sees what flows through them – data goes straight between this device and the other program.
 */
import { z } from "zod";
import { isoDateTime } from "../model/primitives";

/** What a key for the local API (Desktop) may do. Read and write are separate per area. */
export const API_SCOPES = [
  "contacts:read",
  "contacts:write",
  "transactions:read",
  "transactions:write",
  "invoices:read",
  "invoices:write",
  "incoming:write",
  "products:read",
  "stock:write",
  "projects:read",
  "time:write",
  "export:read",
] as const;
export const ApiScopeSchema = z.enum(API_SCOPES);
export type ApiScope = z.infer<typeof ApiScopeSchema>;

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  "contacts:read": "Kontakte lesen",
  "contacts:write": "Kontakte anlegen und ändern",
  "transactions:read": "Einnahmen & Ausgaben lesen",
  "transactions:write": "Einnahmen & Ausgaben anlegen",
  "invoices:read": "Ausgehende Rechnungen lesen",
  "invoices:write": "Ausgehende Rechnungen als Entwurf anlegen",
  "incoming:write": "Eingehende Rechnungen einliefern (PDF, XML, Bild)",
  "products:read": "Produkte & Lagerstand lesen",
  "stock:write": "Lagerbewegungen buchen",
  "projects:read": "Projekte lesen",
  "time:write": "Zeiten erfassen",
  "export:read": "Exporte abrufen (BMD, Buchungsjournal)",
};

/** Events a webhook can send. */
export const WEBHOOK_EVENTS = ["contact", "transaction", "invoice", "document", "product", "stock", "project", "time"] as const;
export const WebhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  contact: "Kontakte",
  transaction: "Einnahmen & Ausgaben",
  invoice: "Ausgehende Rechnungen",
  document: "Eingehende Rechnungen (gebucht)",
  product: "Produkte",
  stock: "Lagerbewegungen",
  project: "Projekte",
  time: "Zeiten",
};

export const IntegrationKindSchema = z.enum(["api_key", "webhook", "sap_b1", "rest_pull"]);
export type IntegrationKind = z.infer<typeof IntegrationKindSchema>;

/** What a pull connection brings into Ordo. */
export const PullTargetSchema = z.enum(["contacts", "incoming", "outgoing", "products"]);
export type PullTarget = z.infer<typeof PullTargetSchema>;

export const IntegrationLogSchema = z.object({
  at: isoDateTime,
  ok: z.boolean(),
  /** Plain words, never data values. */
  message: z.string(),
});
export type IntegrationLog = z.infer<typeof IntegrationLogSchema>;

export const IntegrationSchema = z.object({
  id: z.string(),
  kind: IntegrationKindSchema,
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  /** Profile the connection reads from and writes to. */
  profileId: z.string(),
  /** api_key */
  scopes: z.array(ApiScopeSchema).default([]),
  /** webhook */
  url: z.string().default(""),
  events: z.array(WebhookEventSchema).default([]),
  /** webhook: last delivered change (updatedAt) – everything newer is sent next. */
  cursor: isoDateTime.optional(),
  /** sap_b1 / rest_pull: server address, company database, user (never the password). */
  baseUrl: z.string().default(""),
  companyDb: z.string().default(""),
  user: z.string().default(""),
  targets: z.array(PullTargetSchema).default([]),
  /** rest_pull: header that carries the secret (e.g. "Authorization" or "X-Api-Key"), path to the list and field mapping. */
  authHeader: z.string().default("Authorization"),
  itemsPath: z.string().default(""),
  mapping: z.record(z.string(), z.string()).default({}),
  /** Only records from this date on (YYYY-MM-DD). */
  since: z.string().default(""),
  /** Minutes between automatic runs, 0 = only by hand. */
  everyMinutes: z.number().int().min(0).default(0),
  /** Device that runs the automatic part (webhooks, timed pulls) – so two open devices never send twice. Empty = any. */
  deviceId: z.string().default(""),
  /** API token, password, signing secret – never leaves the vault except to the program it belongs to. */
  secret: z.string().default(""),
  /** Who set it up: the person or Atlas (still confirmed by the person). */
  createdBy: z.enum(["person", "atlas"]).default("person"),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  lastRunAt: isoDateTime.optional(),
  lastOk: z.boolean().optional(),
  lastMessage: z.string().optional(),
  log: z.array(IntegrationLogSchema).default([]),
});
export type Integration = z.infer<typeof IntegrationSchema>;

export const LocalApiSettingsSchema = z.object({
  /** Desktop only: HTTP on 127.0.0.1 – other programs on this computer can talk to Ordo while it is open and unlocked. */
  enabled: z.boolean().default(false),
  port: z.number().int().min(1024).max(65535).default(47110),
});
export type LocalApiSettings = z.infer<typeof LocalApiSettingsSchema>;

/** Strips everything secret – what Atlas, logs and exports may see of a connection. */
export function redactIntegration(i: Integration): Omit<Integration, "secret" | "log"> & { hasSecret: boolean } {
  const { secret, log: _log, ...rest } = i;
  return { ...rest, hasSecret: !!secret };
}

/** Keeps the last 50 log lines. */
export function withLog(i: Integration, ok: boolean, message: string, at: string): Integration {
  return { ...i, lastRunAt: at, lastOk: ok, lastMessage: message, log: [{ at, ok, message }, ...i.log].slice(0, 50) };
}
