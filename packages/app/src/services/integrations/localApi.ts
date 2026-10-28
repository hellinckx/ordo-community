/**
 * The local API (Desktop): requests from other programs on this computer, already checked by the shell for a known key
 * and a local Host header, are answered here against the unlocked vault. Each key works in one profile and only with the
 * rights ("scopes") chosen for it. Description for other programs: docs/API.md / website /schnittstellen/.
 */
import {
  ApiIncomingInputSchema,
  ORDO_API_VERSION,
  apiContact,
  apiInvoice,
  apiProduct,
  apiProject,
  apiStockMove,
  apiTimeEntry,
  apiTransaction,
  bmdBuchungen,
  buildEbInterface,
  deriveJournal,
  fromBase64,
  mimeFor,
  stockLevels,
  toBase64,
  type ApiScope,
  type Integration,
  type VaultStore,
} from "@ordo/core";
import { useSession } from "@/state/session";
import { importFiles } from "@/services/importer";
import { ALL_MODULES, isInstalled } from "@/modules/registry";
import type { LocalApiRequest } from "@/platform/types";
import { ApiError, addStockMove, addTimeEntry, createInvoiceDraft, createTransaction, upsertContact } from "./apply";
import { integrations, logRun } from "./registry";

type Answer = { status: number; body: unknown };

const page = <T,>(list: T[], q: URLSearchParams) => {
  const limit = Math.min(1000, Math.max(1, Number(q.get("limit") ?? 200) || 200));
  const offset = Math.max(0, Number(q.get("offset") ?? 0) || 0);
  return { items: list.slice(offset, offset + limit), total: list.length, limit, offset };
};

function need(key: Integration, scope: ApiScope) {
  if (!key.scopes.includes(scope)) throw new ApiError(403, `Dieser Schlüssel darf „${scope}“ nicht. In Ordo unter Einstellungen → Schnittstellen freigeben.`);
}

function needModule(store: VaultStore, id: "projekte" | "produkte") {
  const m = ALL_MODULES.find((x) => x.id === id);
  if (!m || !isInstalled(store.vault.settings, m)) throw new ApiError(404, `Das Modul „${m?.name ?? id}“ ist in Ordo nicht installiert.`);
}

const changed = <T extends { updatedAt: string; deletedAt?: string }>(list: T[], q: URLSearchParams) => {
  const since = q.get("changedSince");
  // with changedSince the caller also learns about deletions; without, it gets the live records only
  return since ? list.filter((x) => x.updatedAt > since) : list.filter((x) => !x.deletedAt);
};

function parseBody(req: LocalApiRequest): unknown {
  if (!req.body.trim()) return {};
  try {
    return JSON.parse(req.body);
  } catch {
    throw new ApiError(400, "Der Inhalt ist kein gültiges JSON.");
  }
}

async function route(req: LocalApiRequest, key: Integration, store: VaultStore): Promise<Answer> {
  const q = new URLSearchParams(req.query);
  const p = req.path.replace(/\/+$/, "");
  const pid = key.profileId;
  const profile = store.vault.profiles.find((x) => x.id === pid && !x.deletedAt);
  if (!profile) throw new ApiError(404, "Das Profil dieses Schlüssels gibt es nicht mehr.");
  const source = `api:${key.id}`;
  const all = <C extends "contacts" | "transactions" | "invoices" | "products" | "stockMoves" | "projects" | "timeEntries">(c: C) => store.list(c, { profileId: pid, includeDeleted: true });
  const M = req.method;

  if (M === "GET" && p === "/v1/status") return { status: 200, body: { app: "Ordo", api: ORDO_API_VERSION, version: __APP_VERSION__, profile: { id: profile.id, name: profile.name, mode: profile.mode }, key: { name: key.name, scopes: key.scopes } } };

  if (p === "/v1/contacts") {
    if (M === "GET") {
      need(key, "contacts:read");
      const term = q.get("q")?.toLocaleLowerCase("de");
      const list = changed(all("contacts"), q).filter((c) => !term || c.name.toLocaleLowerCase("de").includes(term) || c.uid.toLowerCase().includes(term));
      return { status: 200, body: page(list.map(apiContact), q) };
    }
    if (M === "POST") {
      need(key, "contacts:write");
      const r = upsertContact(store, pid, parseBody(req), source);
      return { status: r.created ? 201 : 200, body: { created: r.created, contact: apiContact(r.contact) } };
    }
  }

  if (p === "/v1/transactions") {
    if (M === "GET") {
      need(key, "transactions:read");
      const from = q.get("from");
      const to = q.get("to");
      const cats = new Map(store.vault.categories.map((c) => [c.id, c.name]));
      const contacts = new Map(store.vault.contacts.map((c) => [c.id, c.name]));
      const list = changed(all("transactions"), q).filter((t) => (!from || t.date >= from) && (!to || t.date <= to)).sort((a, b) => a.date.localeCompare(b.date));
      return { status: 200, body: page(list.map((t) => apiTransaction(t, { category: t.categoryId ? cats.get(t.categoryId) : undefined, contact: t.contactId ? contacts.get(t.contactId) : undefined })), q) };
    }
    if (M === "POST") {
      need(key, "transactions:write");
      const r = createTransaction(store, pid, parseBody(req), source);
      return { status: r.created ? 201 : 200, body: { created: r.created, transaction: apiTransaction(r.transaction) } };
    }
  }

  if (p === "/v1/invoices") {
    if (M === "GET") {
      need(key, "invoices:read");
      const list = changed(all("invoices"), q).filter((i) => i.kind !== "offer").sort((a, b) => a.issueDate.localeCompare(b.issueDate));
      return { status: 200, body: page(list.map((i) => apiInvoice(i, profile)), q) };
    }
    if (M === "POST") {
      need(key, "invoices:write");
      const r = createInvoiceDraft(store, pid, parseBody(req), source);
      return { status: r.created ? 201 : 200, body: { created: r.created, invoice: apiInvoice(r.invoice, profile), note: "Als Entwurf angelegt – fertigstellen und versenden in Ordo." } };
    }
  }
  const eb = /^\/v1\/invoices\/([^/]+)\/ebinterface$/.exec(p);
  if (eb && M === "GET") {
    need(key, "invoices:read");
    const inv = store.byId("invoices", decodeURIComponent(eb[1]!));
    if (!inv || inv.profileId !== pid || inv.deletedAt) throw new ApiError(404, "Rechnung nicht gefunden.");
    const r = buildEbInterface(inv, profile);
    return { status: 200, body: { fileName: `${inv.number}.xml`, xml: r.xml, warnings: r.warnings } };
  }

  if (p === "/v1/incoming" && M === "POST") {
    need(key, "incoming:write");
    const r = ApiIncomingInputSchema.safeParse(parseBody(req));
    if (!r.success) throw new ApiError(422, "fileName und contentBase64 werden gebraucht.");
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(r.data.contentBase64);
    } catch {
      throw new ApiError(422, "contentBase64 ist kein gültiges Base64.");
    }
    if (bytes.byteLength > 30 * 1048576) throw new ApiError(413, "Datei zu groß (höchstens 30 MB).");
    if (useSession.getState().store?.activeProfile.id !== pid) throw new ApiError(409, `Rechnungen landen im gerade offenen Profil – bitte in Ordo „${profile.name}“ öffnen.`);
    importFiles([{ name: r.data.fileName, mime: r.data.mimeType || mimeFor(r.data.fileName), bytes }], "api", { direction: r.data.direction === "outgoing" ? "outgoing" : undefined });
    return { status: 202, body: { accepted: true, note: "Wird gelesen. Eindeutiges bucht Ordo selbst, der Rest wartet unter „Prüfen“." } };
  }

  if (p === "/v1/products" && M === "GET") {
    need(key, "products:read");
    needModule(store, "produkte");
    const products = all("products");
    const levels = stockLevels(products, store.list("stockMoves", { profileId: pid }));
    return { status: 200, body: page(changed(products, q).map((x) => apiProduct(x, levels.get(x.id) ?? 0)), q) };
  }
  if (p === "/v1/stock-moves") {
    needModule(store, "produkte");
    if (M === "GET") {
      need(key, "products:read");
      return { status: 200, body: page(changed(all("stockMoves"), q).map(apiStockMove), q) };
    }
    if (M === "POST") {
      need(key, "stock:write");
      return { status: 201, body: { created: true, move: apiStockMove(addStockMove(store, pid, parseBody(req), source)) } };
    }
  }

  if (p === "/v1/projects" && M === "GET") {
    need(key, "projects:read");
    needModule(store, "projekte");
    return { status: 200, body: page(changed(all("projects"), q).map(apiProject), q) };
  }
  if (p === "/v1/time-entries") {
    needModule(store, "projekte");
    if (M === "GET") {
      need(key, "projects:read");
      return { status: 200, body: page(changed(all("timeEntries"), q).map(apiTimeEntry), q) };
    }
    if (M === "POST") {
      need(key, "time:write");
      return { status: 201, body: { created: true, entry: apiTimeEntry(addTimeEntry(store, pid, parseBody(req), source)) } };
    }
  }

  if (p === "/v1/export/bmd" && M === "GET") {
    need(key, "export:read");
    const from = q.get("from") ?? `${new Date().getFullYear()}-01-01`;
    const to = q.get("to") ?? `${new Date().getFullYear()}-12-31`;
    const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])];
    const journal = deriveJournal(profile, store.list("transactions", { profileId: pid }), store.list("assets", { profileId: pid }), store.vault.categories, store.list("journalEntries", { profileId: pid }), years).filter((e) => e.date >= from && e.date <= to);
    const refs = new Map(store.list("transactions", { profileId: pid }).map((t) => [t.id, t.invoiceNumber || t.reference]));
    const r = bmdBuchungen(journal, { references: refs, encoding: q.get("encoding") === "utf-8" ? "utf-8" : "windows-1252" });
    return { status: 200, body: { fileName: `BMD-Buchungen-${from}-${to}.csv`, rows: r.rows, warnings: r.warnings, contentBase64: toBase64(r.bytes) } };
  }

  throw new ApiError(404, `Unbekannter Pfad ${M} ${p}. Übersicht: GET /v1/status – Beschreibung auf ordo-business.netlify.app/schnittstellen/.`);
}

/** Entry point for every request from the shell. */
export async function handleLocalApi(req: LocalApiRequest): Promise<Answer> {
  const store = useSession.getState().store;
  if (!store || useSession.getState().status !== "unlocked") return { status: 423, body: { error: "Ordo ist gesperrt – bitte in Ordo entsperren, dann noch einmal." } };
  const key = integrations().find((i) => i.kind === "api_key" && i.enabled && i.secret === req.token);
  if (!key) return { status: 401, body: { error: "Schlüssel unbekannt oder ausgeschaltet." } };
  const write = req.method !== "GET";
  try {
    const answer = await route(req, key, store);
    if (write) logRun(key.id, true, `${req.method} ${req.path} → ${answer.status}`);
    return answer;
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    const message = e instanceof Error ? e.message : String(e);
    if (write || status >= 500) logRun(key.id, false, `${req.method} ${req.path} → ${status}`);
    return { status, body: { error: message, ...(e instanceof ApiError && e.details ? { details: e.details } : {}) } };
  }
}

/** Keys the shell accepts – every enabled API key. */
export function activeApiTokens(): string[] {
  return integrations().filter((i) => i.kind === "api_key" && i.enabled && i.secret).map((i) => i.secret);
}
