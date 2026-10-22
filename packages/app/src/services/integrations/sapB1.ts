/**
 * SAP Business One, live through the Service Layer (REST/OData): business partners → contacts, A/R invoices
 * (Invoices) → open income, A/P invoices (PurchaseInvoices) → open expenses. Read-only towards SAP – Ordo never
 * writes into SAP. Payments are matched in Ordo's Kontoabgleich with the real payment date, because SAP's
 * "paid" flag alone would put the payment on the wrong day for the tax year.
 * Login: POST /Login {CompanyDB, UserName, Password} → cookie B1SESSION (+ ROUTEID behind a load balancer).
 */
import type { Integration, VaultStore } from "@ordo/core";
import { http, type HttpResult } from "./http";
import { createTransaction, upsertContact } from "./apply";

type Row = Record<string, unknown>;
const MAX_ROWS = 5000;

/** "https://sap:50000" or ".../b1s/v2/" → ".../b1s/v2". */
export function serviceLayerBase(input: string): string {
  const s = input.trim().replace(/\/+$/, "");
  return /\/b1s\/v[12]$/i.test(s) ? s : `${s}/b1s/v2`;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const iso = (v: unknown) => str(v).slice(0, 10);

class Session {
  private cookie = "";
  constructor(private base: string) {}

  async login(i: Integration) {
    if (!i.companyDb || !i.user || !i.secret) throw new Error("Firmendatenbank, Benutzer und Passwort eintragen.");
    const res = await http({ method: "POST", url: `${this.base}/Login`, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ CompanyDB: i.companyDb, UserName: i.user, Password: i.secret }) });
    if (!res.ok) throw new Error(res.status === 401 ? "SAP lehnt die Anmeldung ab – Benutzer, Passwort oder Firmendatenbank prüfen." : `SAP-Anmeldung fehlgeschlagen (HTTP ${res.status}).`);
    const cookies = res.all("set-cookie").map((c) => c.split(";")[0]!).filter((c) => /^(B1SESSION|ROUTEID)=/i.test(c));
    if (!cookies.length) {
      const id = res.json<{ SessionId?: string }>().SessionId;
      if (id) cookies.push(`B1SESSION=${id}`);
    }
    if (!cookies.length) throw new Error("SAP hat keine Sitzung zurückgegeben. Im Browser geht das nicht – bitte die Desktop-App verwenden.");
    this.cookie = cookies.join("; ");
  }

  get(path: string): Promise<HttpResult> {
    const url = /^https?:/i.test(path) ? path : `${this.base}/${path.replace(/^\//, "")}`;
    // the session cookie only ever goes to the configured server, whatever a response links to
    if (new URL(url).origin !== new URL(this.base).origin) return Promise.reject(new Error("SAP verweist auf einen anderen Server – abgebrochen."));
    return http({ method: "GET", url, headers: { Cookie: this.cookie, Prefer: "odata.maxpagesize=200", Accept: "application/json" }, timeoutMs: 60_000 });
  }

  /** All pages of a list, following @odata.nextLink (v2) / odata.nextLink (v1). */
  async all(path: string): Promise<Row[]> {
    const rows: Row[] = [];
    let next: string | undefined = path;
    while (next && rows.length < MAX_ROWS) {
      const res = await this.get(next);
      if (!res.ok) throw new Error(`SAP: ${path.split("?")[0]} – HTTP ${res.status}`);
      const body = res.json<{ value?: Row[]; "@odata.nextLink"?: string; "odata.nextLink"?: string }>();
      rows.push(...(body.value ?? []));
      const link = body["@odata.nextLink"] ?? body["odata.nextLink"];
      next = link ? (/^https?:/i.test(link) ? link : `${this.base}/${link.replace(/^\/?(b1s\/v[12]\/)?/i, "")}`) : undefined;
    }
    return rows;
  }

  async count(entity: string): Promise<number | null> {
    const res = await this.get(`${entity}/$count`);
    return res.ok ? Number(res.text) || 0 : null;
  }

  async logout() {
    await http({ method: "POST", url: `${this.base}/Logout`, headers: { Cookie: this.cookie } }).catch(() => undefined);
  }
}

/** Net and VAT per rate from the document lines (TaxPercentagePerRow); falls back to the header totals. */
function vatOf(doc: Row): { rate: 0 | 10 | 13 | 20; net: number; vat: number }[] | undefined {
  const lines = Array.isArray(doc.DocumentLines) ? (doc.DocumentLines as Row[]) : [];
  const by = new Map<number, { net: number; vat: number }>();
  for (const l of lines) {
    const rate = Math.round(Number(l.TaxPercentagePerRow ?? 0));
    const cur = by.get(rate) ?? { net: 0, vat: 0 };
    cur.net += Number(l.LineTotal ?? 0);
    cur.vat += Number(l.TaxTotal ?? 0);
    by.set(rate, cur);
  }
  const out = [...by.entries()].filter(([r]) => [0, 10, 13, 20].includes(r)).map(([rate, v]) => ({ rate: rate as 0 | 10 | 13 | 20, net: Math.round(v.net * 100) / 100, vat: Math.round(v.vat * 100) / 100 }));
  if (out.length && out.length === by.size) {
    const total = Number(doc.DocTotal ?? 0);
    const sum = out.reduce((s, l) => s + l.net + l.vat, 0);
    if (Math.abs(sum - total) < 0.05) return out;
  }
  const total = Number(doc.DocTotal ?? 0);
  const vat = Number(doc.VatSum ?? 0);
  const net = total - vat;
  const guess = net > 0 ? [20, 13, 10, 0].find((r) => Math.abs((net * r) / 100 - vat) < Math.max(0.05, net * 0.001)) : 0;
  return guess === undefined ? undefined : [{ rate: guess as 0 | 10 | 13 | 20, net: Math.round(net * 100) / 100, vat: Math.round(vat * 100) / 100 }];
}

export interface SapResult {
  message: string;
  counts: Record<string, number>;
}

export async function testSapB1(i: Integration): Promise<SapResult> {
  const s = new Session(serviceLayerBase(i.baseUrl));
  await s.login(i);
  try {
    const counts: Record<string, number> = {};
    for (const e of ["BusinessPartners", "Invoices", "PurchaseInvoices"]) {
      const n = await s.count(e);
      if (n !== null) counts[e] = n;
    }
    return { message: `Angemeldet. ${counts.BusinessPartners ?? "?"} Geschäftspartner, ${counts.Invoices ?? "?"} Ausgangs- und ${counts.PurchaseInvoices ?? "?"} Eingangsrechnungen in SAP.`, counts };
  } finally {
    await s.logout();
  }
}

export async function runSapB1(store: VaultStore, i: Integration): Promise<SapResult> {
  const s = new Session(serviceLayerBase(i.baseUrl));
  await s.login(i);
  const source = `sap_b1:${i.companyDb}`;
  const counts: Record<string, number> = { neu: 0, aktualisiert: 0, übersprungen: 0 };
  const tally = (created: boolean) => counts[created ? "neu" : "aktualisiert"]!++;
  const since = /^\d{4}-\d{2}-\d{2}$/.test(i.since) ? i.since : `${new Date().getFullYear()}-01-01`;
  try {
    if (i.targets.includes("contacts")) {
      const bps = await s.all("BusinessPartners?$select=CardCode,CardName,CardType,FederalTaxID,EmailAddress,Phone1,Address,ZipCode,City,Country,Valid");
      for (const bp of bps) {
        if (bp.CardType === "cLid" || bp.Valid === "tNO" || !str(bp.CardName)) {
          counts.übersprungen!++;
          continue;
        }
        const r = upsertContact(store, i.profileId, { externalId: str(bp.CardCode), name: str(bp.CardName), kind: bp.CardType === "cSupplier" ? "vendor" : "customer", uid: str(bp.FederalTaxID), email: str(bp.EmailAddress), phone: str(bp.Phone1), street: str(bp.Address), zip: str(bp.ZipCode), city: str(bp.City), country: (str(bp.Country) || "AT").slice(0, 2).toUpperCase() }, source);
        tally(r.created);
      }
    }
    const docs = async (entity: "Invoices" | "PurchaseInvoices", kind: "income" | "expense") => {
      const filter = encodeURIComponent(`DocDate ge '${since}'`);
      const rows = await s.all(`${entity}?$select=DocEntry,DocNum,NumAtCard,DocDate,DocDueDate,CardCode,CardName,DocTotal,VatSum,DocCurrency,Cancelled,Comments,DocumentLines&$filter=${filter}&$orderby=DocEntry`);
      for (const d of rows) {
        if (d.Cancelled === "tYES" || !(Number(d.DocTotal) > 0) || (str(d.DocCurrency) && str(d.DocCurrency) !== "EUR")) {
          counts.übersprungen!++;
          continue;
        }
        const number = kind === "income" ? str(d.DocNum) : str(d.NumAtCard) || str(d.DocNum);
        const vat = vatOf(d);
        const r = createTransaction(store, i.profileId, {
          externalId: `${entity}:${str(d.DocEntry)}`,
          kind,
          date: iso(d.DocDate),
          dueDate: iso(d.DocDueDate) || undefined,
          amount: Number(d.DocTotal),
          ...(vat ? { vat } : { vatRate: 20 }),
          description: `${kind === "income" ? "Rechnung" : "Eingangsrechnung"} ${number} – ${str(d.CardName)}`,
          contactName: str(d.CardName) || undefined,
          invoiceNumber: number,
        }, source);
        tally(r.created);
      }
    };
    if (i.targets.includes("outgoing")) await docs("Invoices", "income");
    if (i.targets.includes("incoming")) await docs("PurchaseInvoices", "expense");
  } finally {
    await s.logout();
  }
  return { message: `${counts.neu} neu, ${counts.aktualisiert} aktualisiert${counts.übersprungen ? `, ${counts.übersprungen} übersprungen (storniert, Fremdwährung, Interessenten)` : ""}.`, counts };
}
