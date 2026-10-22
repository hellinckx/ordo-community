/**
 * Webhooks: Ordo sends changes (new invoice, payment, booking, stock movement …) as signed JSON to an address the
 * person chose – n8n, Make, Power Automate, an ERP's import endpoint. Works like an outbox: a cursor (last delivered
 * updatedAt) lives with the webhook, everything newer goes out in batches of up to 50, and a failed delivery is simply
 * tried again later. Receivers check X-Ordo-Signature: sha256=HMAC(secret, body).
 */
import {
  ORDO_API_VERSION,
  apiContact,
  apiInvoice,
  apiProduct,
  apiProject,
  apiStockMove,
  apiTimeEntry,
  apiTransaction,
  changeOf,
  nowIso,
  type EntityCollection,
  type Integration,
  type Profile,
  type VaultStore,
  type WebhookEvent,
} from "@ordo/core";
import { hmacHex, http } from "./http";
import { logRun } from "./registry";

const COLLECTION: Record<WebhookEvent, EntityCollection> = {
  contact: "contacts",
  transaction: "transactions",
  invoice: "invoices",
  document: "documents",
  product: "products",
  stock: "stockMoves",
  project: "projects",
  time: "timeEntries",
};

type Rec = { id: string; createdAt: string; updatedAt: string; deletedAt?: string; profileId?: string } & Record<string, unknown>;

function payload(event: WebhookEvent, e: Rec, profile: Profile): unknown {
  switch (event) {
    case "contact":
      return apiContact(e as never);
    case "transaction":
      return apiTransaction(e as never);
    case "invoice":
      return apiInvoice(e as never, profile);
    case "product":
      return apiProduct(e as never);
    case "stock":
      return apiStockMove(e as never);
    case "project":
      return apiProject(e as never);
    case "time":
      return apiTimeEntry(e as never);
    case "document": {
      const f = (e.extraction as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
      return { id: e.id, fileName: e.originalName, status: e.status, transactionId: e.transactionId ?? null, vendorName: f.vendorName ?? null, invoiceNumber: f.invoiceNumber ?? null, invoiceDate: f.invoiceDate ?? null, gross: typeof f.grossCents === "number" ? f.grossCents / 100 : null, updatedAt: e.updatedAt, deleted: !!e.deletedAt };
    }
  }
}

export interface WebhookEventOut {
  event: string;
  id: string;
  at: string;
  data: unknown;
}

/** Changes newer than the webhook's cursor, oldest first; a batch never splits records with the same timestamp. */
export function pendingEvents(store: VaultStore, hook: Integration, max = 50): WebhookEventOut[] {
  const since = hook.cursor ?? hook.createdAt;
  const profile = store.vault.profiles.find((p) => p.id === hook.profileId);
  if (!profile) return [];
  const out: WebhookEventOut[] = [];
  for (const ev of hook.events) {
    const list = store.list(COLLECTION[ev], { profileId: hook.profileId, includeDeleted: true }) as unknown as Rec[];
    for (const e of list) {
      if (!(e.updatedAt > since)) continue;
      // incoming invoices are interesting once they are booked, not while they are being read
      if (ev === "document" && e.status !== "approved" && !e.deletedAt) continue;
      out.push({ event: `${ev}.${changeOf(e, since)}`, id: e.id, at: e.updatedAt, data: payload(ev, e, profile) });
    }
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  if (out.length <= max) return out;
  let n = max;
  while (n < out.length && out[n]!.at === out[n - 1]!.at) n++;
  return out.slice(0, n);
}

async function post(hook: Integration, body: string, kind: string) {
  const res = await http({
    method: "POST",
    url: hook.url,
    headers: { "Content-Type": "application/json", "User-Agent": "Ordo-Webhook/1", "X-Ordo-Event": kind, "X-Ordo-Delivery": crypto.randomUUID(), "X-Ordo-Signature": `sha256=${await hmacHex(hook.secret, body)}` },
    body,
    timeoutMs: 20_000,
  });
  if (!res.ok) throw new Error(`Empfänger antwortet mit HTTP ${res.status}${res.text ? ` – ${res.text.slice(0, 120)}` : ""}`);
}

/** Sends what is pending. Returns the number of events delivered (0 = nothing to do). */
export async function deliverWebhook(store: VaultStore, hook: Integration): Promise<number> {
  if (!hook.url) throw new Error("Keine Ziel-Adresse eingetragen.");
  const events = pendingEvents(store, hook);
  if (!events.length) return 0;
  const profile = store.vault.profiles.find((p) => p.id === hook.profileId);
  const body = JSON.stringify({ api: ORDO_API_VERSION, sentAt: nowIso(), profile: profile ? { id: profile.id, name: profile.name } : null, events });
  try {
    await post(hook, body, "changes");
  } catch (e) {
    logRun(hook.id, false, e instanceof Error ? e.message : String(e));
    throw e;
  }
  logRun(hook.id, true, `${events.length} ${events.length === 1 ? "Änderung" : "Änderungen"} gesendet`, { cursor: events[events.length - 1]!.at });
  return events.length;
}

/** "Testen": one ping, nothing from the books. */
export async function pingWebhook(hook: Integration): Promise<void> {
  const body = JSON.stringify({ api: ORDO_API_VERSION, sentAt: nowIso(), events: [{ event: "ping", id: "ping", at: nowIso(), data: { message: "Test von Ordo – die Verbindung funktioniert." } }] });
  try {
    await post(hook, body, "ping");
  } catch (e) {
    logRun(hook.id, false, e instanceof Error ? e.message : String(e));
    throw e;
  }
  logRun(hook.id, true, "Test gesendet");
}
