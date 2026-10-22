/**
 * REST pull: reads a JSON list from any program with an HTTP API (sevDesk, lexoffice, an ERP's OData feed, an own
 * script) and maps each record onto Ordo fields. The mapping is "Ordo field → path in the record" (e.g.
 * name → "CardName", amount → "sumGross"); Atlas proposes it from a sample (probeRest) so nobody has to write it by hand.
 */
import { describeFields, pickPath, type Integration, type VaultStore } from "@ordo/core";
import { http } from "./http";
import { createTransaction, upsertContact } from "./apply";

/** Fields per target – `required` must be mapped. */
export const MAPPING_FIELDS = {
  contacts: { required: ["name"], optional: ["externalId", "kind", "uid", "email", "phone", "street", "zip", "city", "country", "iban"] },
  transactions: { required: ["date", "amount"], optional: ["externalId", "description", "contactName", "vatRate", "invoiceNumber", "dueDate", "paidDate", "category"] },
} as const;

export const MAPPING_LABEL: Record<string, string> = {
  name: "Name", externalId: "Eindeutige Nummer (gegen Doppelte)", kind: "Art (Kunde/Lieferant)", uid: "UID-Nummer", email: "E-Mail", phone: "Telefon", street: "Straße", zip: "PLZ", city: "Ort", country: "Land (AT, DE …)", iban: "IBAN",
  date: "Datum", amount: "Bruttobetrag", description: "Text", contactName: "Kunde/Lieferant", vatRate: "USt-Satz", invoiceNumber: "Rechnungsnummer", dueDate: "Fällig am", paidDate: "Bezahlt am", category: "Kategorie",
};

function headers(i: Integration): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (i.secret) h[i.authHeader || "Authorization"] = i.secret;
  return h;
}

/** First array in the response, when no path is given. */
function findList(json: unknown, path: string): { items: unknown[]; path: string } {
  if (path) {
    const v = pickPath(json, path);
    return { items: Array.isArray(v) ? v : [], path };
  }
  if (Array.isArray(json)) return { items: json, path: "" };
  if (json && typeof json === "object") {
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (Array.isArray(v)) return { items: v, path: k };
      if (v && typeof v === "object") for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) if (Array.isArray(v2)) return { items: v2, path: `${k}.${k2}` };
    }
  }
  return { items: [], path };
}

async function fetchList(i: Integration) {
  if (!i.baseUrl) throw new Error("Keine Adresse eingetragen.");
  const res = await http({ method: "GET", url: i.baseUrl, headers: headers(i), timeoutMs: 60_000 });
  if (res.status === 401 || res.status === 403) throw new Error(`Zugang abgelehnt (HTTP ${res.status}) – Schlüssel und Header-Name prüfen.`);
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.text ? ` – ${res.text.slice(0, 120)}` : ""}`);
  return findList(res.json(), i.itemsPath);
}

/** Reads one page and describes the fields of the first record – no data is stored, only names and short examples. */
export async function probeRest(i: Integration): Promise<{ count: number; itemsPath: string; fields: { path: string; type: string; example: string }[] }> {
  const { items, path } = await fetchList(i);
  return { count: items.length, itemsPath: path, fields: items.length ? describeFields(items[0]) : [] };
}

const DATE_DE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
function isoDate(v: unknown): string | undefined {
  const s = v === null || v === undefined ? "" : String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = DATE_DE.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  if (/^\d{10,13}$/.test(s)) return new Date(Number(s) * (s.length === 10 ? 1000 : 1)).toISOString().slice(0, 10);
  return undefined;
}

function mapped(item: unknown, mapping: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(mapping)) {
    if (!path) continue;
    const v = pickPath(item, path);
    if (v !== undefined && v !== null && v !== "") out[field] = v;
  }
  return out;
}

export async function runRestPull(store: VaultStore, i: Integration): Promise<{ message: string; counts: Record<string, number> }> {
  const target = i.targets[0] ?? "contacts";
  const fields = target === "contacts" ? MAPPING_FIELDS.contacts : MAPPING_FIELDS.transactions;
  const missing = fields.required.filter((f) => !i.mapping[f]);
  if (missing.length) throw new Error(`Feldzuordnung fehlt für: ${missing.map((f) => MAPPING_LABEL[f] ?? f).join(", ")}.`);
  const { items } = await fetchList(i);
  const source = `rest:${i.id}`;
  const counts = { neu: 0, aktualisiert: 0, fehler: 0 };
  const errors: string[] = [];
  for (const item of items.slice(0, 5000)) {
    const m = mapped(item, i.mapping);
    try {
      if (target === "contacts") {
        const kind = String(m.kind ?? "").toLowerCase();
        const r = upsertContact(store, i.profileId, { ...m, externalId: m.externalId === undefined ? undefined : String(m.externalId), name: String(m.name ?? ""), kind: /lief|vend|supp|kred/.test(kind) ? "vendor" : "customer", country: String(m.country ?? "AT").slice(0, 2).toUpperCase(), uid: String(m.uid ?? ""), zip: String(m.zip ?? "") }, source);
        counts[r.created ? "neu" : "aktualisiert"]++;
      } else {
        const rate = m.vatRate === undefined ? undefined : Math.round(Number(m.vatRate));
        const r = createTransaction(store, i.profileId, {
          ...m,
          kind: target === "outgoing" ? "income" : "expense",
          externalId: m.externalId === undefined ? undefined : String(m.externalId),
          date: isoDate(m.date),
          dueDate: isoDate(m.dueDate),
          paidDate: isoDate(m.paidDate),
          amount: typeof m.amount === "number" ? Math.abs(m.amount) : String(m.amount ?? "").replace(/^-/, ""),
          vatRate: rate !== undefined && [0, 10, 13, 20].includes(rate) ? rate : undefined,
          description: String(m.description ?? ""),
          contactName: m.contactName === undefined ? undefined : String(m.contactName),
          invoiceNumber: String(m.invoiceNumber ?? ""),
          category: m.category === undefined ? undefined : String(m.category),
        }, source);
        counts[r.created ? "neu" : "aktualisiert"]++;
      }
    } catch (e) {
      counts.fehler++;
      if (errors.length < 3) errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { message: `${items.length} gelesen: ${counts.neu} neu, ${counts.aktualisiert} aktualisiert${counts.fehler ? `, ${counts.fehler} mit Fehlern (${errors.join(" · ")})` : ""}.`, counts };
}
