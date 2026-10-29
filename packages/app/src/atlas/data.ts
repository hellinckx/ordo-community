import type { z } from "zod";
import {
  ContactSchema,
  FolderSchema,
  MilestoneSchema,
  OfferSchema,
  ProductSchema,
  ProjectSchema,
  StockMoveSchema,
  TaskSchema,
  TimeEntrySchema,
  TransactionSchema,
  WorkOrderSchema,
  FileEntrySchema,
  formatCents,
  invoiceTotals,
  netOfLines,
  vatOfLines,
  type Area,
  type EntityCollection,
  type Invoice,
  type Offer,
  type Vault,
} from "@ordo/core";
import type { ModuleId } from "@/modules/types";
import { AtlasToolError } from "./tools";
import type { AtlasArea } from "./areas";

/** A record as Atlas sees it – any vault entity. */
export type Rec = Record<string, unknown> & { id: string };

export interface CollectionDef {
  id: EntityCollection;
  /** Plural, as the person says it. */
  label: string;
  module: ModuleId;
  /** Role area (`can()`). */
  area: Area;
  /** Area in Einstellungen → Atlas ("Worauf darf Atlas zugreifen?"). */
  atlasArea: AtlasArea;
  /** Belongs to a profile (Firma / Privat). */
  profileScoped: boolean;
  /** Validation for create/update. */
  schema?: z.ZodType;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
  title(r: Rec, v: Vault): string;
  /** Main date field (for sorting and period grouping). */
  date?: string;
  /** Fields searched by `search`. */
  search: string[];
  /** Where the record lives in the app. */
  path(r: Rec): string;
  /** Fields listed by default (compact). */
  listFields: string[];
  /** Left out of get_record (large or internal). */
  omit?: string[];
  /** Computed fields, available for filters, sorting, grouping and output. */
  virtual?: Record<string, (r: Rec, v: Vault) => unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const nameOf = (v: Vault, coll: EntityCollection, id: unknown, field = "name"): string => {
  if (typeof id !== "string" || !id) return "";
  const rec = (v[coll] as unknown as Rec[]).find((x) => x.id === id);
  return rec ? str(rec[field]) : "";
};

function offerTotals(o: Offer): { netCents: number; grossCents: number } {
  let net = 0;
  let vat = 0;
  for (const l of o.lines) {
    if (l.optional) continue;
    const lineNet = Math.round(l.quantity * l.unitNetCents);
    net += lineNet;
    vat += Math.round((lineNet * l.vatRate) / 100);
  }
  const f = 1 - (o.discountPct || 0) / 100;
  net = Math.round(net * f);
  vat = o.reverseCharge ? 0 : Math.round(vat * f);
  return { netCents: net, grossCents: net + vat };
}

export function stockOnHand(v: Vault, productId: string): number {
  let q = 0;
  for (const m of v.stockMoves) if (!m.deletedAt && m.productId === productId) q += m.quantity;
  return Math.round(q * 1000) / 1000;
}

export const COLLECTIONS: CollectionDef[] = [
  /* ---------------- Basis ---------------- */
  {
    id: "contacts",
    label: "Kontakte",
    module: "basis",
    area: "contacts",
    atlasArea: "contacts",
    profileScoped: true,
    schema: ContactSchema,
    create: true,
    update: true,
    delete: true,
    title: (r) => str(r.name),
    search: ["name", "number", "email", "phone", "city", "uid", "aliases", "notes"],
    path: (r) => `/kontakte/${r.id}`,
    listFields: ["id", "number", "name", "kind", "email", "phone", "city", "active"],
    omit: ["aliases", "legacyRef"],
  },
  {
    id: "members",
    label: "Team",
    module: "basis",
    area: "team",
    atlasArea: "team",
    profileScoped: false,
    title: (r) => str(r.name),
    search: ["name", "email", "title"],
    path: () => "/team",
    listFields: ["id", "name", "role", "title", "email", "weeklyHours", "active"],
    omit: ["legacyRef"],
  },
  {
    id: "folders",
    label: "Ordner",
    module: "basis",
    area: "files",
    atlasArea: "files",
    profileScoped: true,
    schema: FolderSchema,
    create: true,
    update: true,
    title: (r) => str(r.name),
    search: ["name"],
    path: () => "/dateien",
    listFields: ["id", "name", "parentId", "system"],
  },
  {
    id: "files",
    label: "Dateien",
    module: "basis",
    area: "files",
    atlasArea: "files",
    profileScoped: true,
    schema: FileEntrySchema,
    update: true,
    delete: true,
    title: (r) => str(r.name),
    search: ["name", "tags", "note"],
    path: () => "/dateien",
    listFields: ["id", "name", "mime", "size", "folderId", "tags", "createdAt"],
    omit: ["attachmentId", "legacyRef"],
  },
  /* ---------------- Ordo ---------------- */
  {
    id: "transactions",
    label: "Einnahmen & Ausgaben",
    module: "summa",
    area: "summa",
    atlasArea: "bookkeeping",
    profileScoped: true,
    schema: TransactionSchema,
    create: true,
    update: true,
    delete: true,
    title: (r, v) => str(r.description) || nameOf(v, "contacts", r.contactId) || "Buchung",
    date: "date",
    search: ["description", "invoiceNumber", "reference", "notes", "tags"],
    path: () => "/buchungen",
    listFields: ["id", "kind", "date", "paidDate", "description", "contactId", "categoryId", "grossCents", "netCents", "vatTreatment", "paymentMethod", "projectId", "reviewed"],
    omit: ["documentIds", "legacyRef"],
    virtual: {
      netCents: (r) => {
        const lines = (r.vatLines as { rate: number; netCents: number; vatCents: number }[] | undefined) ?? [];
        return lines.length ? netOfLines(lines as never) : (r.grossCents as number);
      },
      vatCents: (r) => {
        const lines = (r.vatLines as { rate: number; netCents: number; vatCents: number }[] | undefined) ?? [];
        return lines.length ? vatOfLines(lines as never) : 0;
      },
      effectiveDate: (r) => str(r.paidDate) || str(r.date),
    },
  },
  {
    id: "documents",
    label: "Eingelesene Rechnungen und Bons",
    module: "summa",
    area: "summa",
    atlasArea: "incoming",
    profileScoped: true,
    title: (r) => str(r.originalName),
    date: "importedAt",
    search: ["originalName", "vendor", "invoiceNumber"],
    path: (r) => `/belege/${r.id}`,
    listFields: ["id", "originalName", "status", "vendor", "invoiceDate", "grossCents", "importedAt", "transactionId"],
    omit: ["extraction", "attachmentId", "previewAttachmentId", "sha256", "originalPath"],
    virtual: {
      vendor: (r) => (r.extraction as { fields?: { vendorName?: string | null } } | undefined)?.fields?.vendorName ?? "",
      invoiceNumber: (r) => (r.extraction as { fields?: { invoiceNumber?: string | null } } | undefined)?.fields?.invoiceNumber ?? "",
      invoiceDate: (r) => (r.extraction as { fields?: { invoiceDate?: string | null } } | undefined)?.fields?.invoiceDate ?? "",
      grossCents: (r) => (r.extraction as { fields?: { grossCents?: number | null } } | undefined)?.fields?.grossCents ?? null,
    },
  },
  {
    id: "invoices",
    label: "Rechnungen an Kunden",
    module: "summa",
    area: "summa",
    atlasArea: "outgoing",
    profileScoped: true,
    title: (r, v) => `${str(r.number)} ${(r.customerSnapshot as { name?: string } | undefined)?.name || nameOf(v, "contacts", r.customerId)}`.trim(),
    date: "issueDate",
    search: ["number", "customerName", "reference", "introText"],
    path: (r) => `/rechnungen/${r.id}`,
    listFields: ["id", "number", "kind", "status", "issueDate", "dueDate", "customerId", "totalNetCents", "totalCents", "openCents", "paidDate", "projectId"],
    omit: ["pdfAttachmentId", "legacyRef", "footerText"],
    virtual: {
      totalNetCents: (r) => invoiceTotals(r as unknown as Invoice).netCents,
      totalCents: (r) => invoiceTotals(r as unknown as Invoice).grossCents,
      openCents: (r) => (r.status === "paid" || r.status === "cancelled" || r.status === "draft" ? 0 : Math.max(0, invoiceTotals(r as unknown as Invoice).grossCents - ((r.paidCents as number) || 0))),
      customerName: (r, v) => (r.customerSnapshot as { name?: string } | undefined)?.name || nameOf(v, "contacts", r.customerId),
    },
  },
  {
    id: "categories",
    label: "Kategorien",
    module: "summa",
    area: "summa",
    atlasArea: "bookkeeping",
    profileScoped: false,
    title: (r) => str(r.name),
    search: ["name", "keywords"],
    path: () => "/einstellungen/kategorien",
    listFields: ["id", "name", "kind", "mode", "e1aKz", "l1Kz", "defaultVatRate", "isArchived"],
    omit: ["keywords", "userKeywords"],
  },
  {
    id: "assets",
    label: "Anlagen",
    module: "summa",
    area: "summa",
    atlasArea: "bookkeeping",
    profileScoped: true,
    title: (r) => str(r.name),
    date: "acquisitionDate",
    search: ["name", "notes"],
    path: () => "/anlagen",
    listFields: ["id", "name", "acquisitionDate", "costCents", "usefulLifeYears", "method", "disposedAt"],
  },
  {
    id: "bankLines",
    label: "Kontoauszugszeilen",
    module: "summa",
    area: "summa",
    atlasArea: "bank",
    profileScoped: true,
    title: (r) => str(r.counterparty) || str(r.purpose),
    date: "date",
    search: ["counterparty", "purpose", "reference"],
    path: () => "/bank",
    listFields: ["id", "date", "amountCents", "counterparty", "purpose", "status", "ignoreReason", "matchedTransactionId"],
    omit: ["hash"],
  },
  {
    id: "recurringRules",
    label: "Wiederkehrende Buchungen",
    module: "summa",
    area: "summa",
    atlasArea: "bookkeeping",
    profileScoped: true,
    title: (r) => str(r.name),
    date: "startDate",
    search: ["name"],
    path: () => "/buchungen",
    listFields: ["id", "name", "active", "interval", "dayOfMonth", "startDate", "endDate", "kind", "grossCents"],
    virtual: {
      kind: (r) => (r.template as { kind?: string } | undefined)?.kind ?? "",
      grossCents: (r) => (r.template as { grossCents?: number } | undefined)?.grossCents ?? 0,
    },
  },
  /* ---------------- Projekte ---------------- */
  {
    id: "projects",
    label: "Projekte",
    module: "projekte",
    area: "projects",
    atlasArea: "projects",
    profileScoped: true,
    schema: ProjectSchema,
    create: true,
    update: true,
    delete: true,
    title: (r) => [str(r.number), str(r.name)].filter(Boolean).join(" "),
    date: "startDate",
    search: ["name", "number", "description", "tags", "notes"],
    path: (r) => `/projekte/${r.id}`,
    listFields: ["id", "number", "name", "status", "customerId", "startDate", "endDate", "budgetCents", "budgetHours", "billing", "managerId"],
    omit: ["legacyRef"],
  },
  {
    id: "tasks",
    label: "Aufgaben",
    module: "projekte",
    area: "projects",
    atlasArea: "projects",
    profileScoped: true,
    schema: TaskSchema,
    create: true,
    update: true,
    delete: true,
    title: (r) => str(r.title),
    date: "dueDate",
    search: ["title", "description"],
    path: (r) => `/projekte/${r.projectId}`,
    listFields: ["id", "projectId", "parentId", "title", "status", "priority", "dueDate", "estimateHours", "assigneeIds", "milestoneId", "completedAt"],
    omit: ["legacyRef"],
  },
  {
    id: "milestones",
    label: "Meilensteine",
    module: "projekte",
    area: "projects",
    atlasArea: "projects",
    profileScoped: true,
    schema: MilestoneSchema,
    create: true,
    update: true,
    delete: true,
    title: (r) => str(r.title),
    date: "dueDate",
    search: ["title", "description"],
    path: (r) => `/projekte/${r.projectId}`,
    listFields: ["id", "projectId", "title", "dueDate", "status", "invoiceAmountCents"],
  },
  {
    id: "timeEntries",
    label: "Zeiten",
    module: "projekte",
    area: "time",
    atlasArea: "time",
    profileScoped: true,
    schema: TimeEntrySchema,
    create: true,
    update: true,
    delete: true,
    title: (r, v) => str(r.description) || nameOf(v, "projects", r.projectId) || "Zeit",
    date: "date",
    search: ["description"],
    path: () => "/zeiten",
    listFields: ["id", "date", "projectId", "taskId", "memberId", "minutes", "hours", "billable", "description", "invoiceId"],
    virtual: {
      hours: (r) => Math.round(((r.minutes as number) / 60) * 100) / 100,
      valueCents: (r) => Math.round((((r.minutes as number) || 0) / 60) * ((r.rateCents as number) || 0)),
    },
  },
  {
    id: "offers",
    label: "Angebote",
    module: "projekte",
    area: "offers",
    atlasArea: "offers",
    profileScoped: true,
    schema: OfferSchema,
    create: true,
    update: true,
    delete: true,
    title: (r) => [str(r.number), str(r.subject)].filter(Boolean).join(" "),
    date: "date",
    search: ["number", "subject", "contractTitle", "internalNote"],
    path: (r) => `/angebote/${r.id}`,
    listFields: ["id", "number", "status", "date", "validUntil", "customerId", "projectId", "subject", "totalNetCents", "totalCents"],
    omit: ["introText", "scopeText", "completionText", "paymentTermsText", "legacyRef"],
    virtual: {
      totalNetCents: (r) => offerTotals(r as unknown as Offer).netCents,
      totalCents: (r) => offerTotals(r as unknown as Offer).grossCents,
    },
  },
  /* ---------------- Produkte & Lager ---------------- */
  {
    id: "products",
    label: "Produkte",
    module: "produkte",
    area: "products",
    atlasArea: "products",
    profileScoped: true,
    schema: ProductSchema,
    create: true,
    update: true,
    delete: true,
    title: (r) => [str(r.sku), str(r.name)].filter(Boolean).join(" "),
    search: ["name", "sku", "description", "category", "barcode"],
    path: (r) => `/produkte/${r.id}`,
    listFields: ["id", "sku", "name", "kind", "unit", "priceCents", "costCents", "vatRate", "trackStock", "onHand", "minStock", "category", "active"],
    omit: ["legacyRef"],
    virtual: { onHand: (r, v) => stockOnHand(v, r.id) },
  },
  {
    id: "stockMoves",
    label: "Lagerbewegungen",
    module: "produkte",
    area: "products",
    atlasArea: "products",
    profileScoped: true,
    schema: StockMoveSchema,
    create: true,
    update: true,
    delete: true,
    title: (r, v) => `${nameOf(v, "products", r.productId)} ${(r.quantity as number) > 0 ? "+" : ""}${r.quantity}`,
    date: "date",
    search: ["note"],
    path: () => "/lager",
    listFields: ["id", "date", "productId", "quantity", "kind", "unitCostCents", "note", "workOrderId"],
  },
  /* ---------------- Produktion ---------------- */
  {
    id: "workOrders",
    label: "Fertigungsaufträge",
    module: "produktion",
    area: "production",
    atlasArea: "production",
    profileScoped: true,
    schema: WorkOrderSchema,
    create: true,
    update: true,
    delete: true,
    title: (r, v) => `${str(r.number)} ${nameOf(v, "products", r.productId)}`.trim(),
    date: "dueDate",
    search: ["number", "notes"],
    path: (r) => `/produktion/${r.id}`,
    listFields: ["id", "number", "productId", "quantity", "status", "priority", "plannedStart", "dueDate", "customerId", "projectId", "stepsDone"],
    virtual: {
      stepsDone: (r) => {
        const steps = (r.steps as { done?: boolean }[] | undefined) ?? [];
        return `${steps.filter((s) => s.done).length}/${steps.length}`;
      },
    },
  },
];

export const COLLECTION_BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]));

/**
 * A collection Atlas may look into, for resolving references (customer, project …). Closed areas do not exist for
 * Atlas – not even to look up a name.
 */
export function seen(env: { defs: CollectionDef[] }, id: EntityCollection): CollectionDef {
  const d = env.defs.find((x) => x.id === id);
  if (!d) throw new AtlasToolError(`Auf ${COLLECTION_BY_ID.get(id)?.label ?? id} hat Atlas keinen Zugriff – das ist in den Einstellungen unter Atlas gesperrt. Lass das Feld weg oder trag es in Ordo selbst ein.`);
  return d;
}

/** Which collection a reference field points to (for readable names in the output). */
const REFS: Record<string, { coll: EntityCollection; field: string }> = {
  contactId: { coll: "contacts", field: "name" },
  customerId: { coll: "contacts", field: "name" },
  supplierId: { coll: "contacts", field: "name" },
  categoryId: { coll: "categories", field: "name" },
  projectId: { coll: "projects", field: "name" },
  productId: { coll: "products", field: "name" },
  memberId: { coll: "members", field: "name" },
  managerId: { coll: "members", field: "name" },
  taskId: { coll: "tasks", field: "title" },
  milestoneId: { coll: "milestones", field: "title" },
  folderId: { coll: "folders", field: "name" },
  invoiceId: { coll: "invoices", field: "number" },
  workOrderId: { coll: "workOrders", field: "number" },
};
const MULTI_REFS: Record<string, { coll: EntityCollection; field: string; as: string }> = {
  assigneeIds: { coll: "members", field: "name", as: "assigneeNames" },
  memberIds: { coll: "members", field: "name", as: "memberNames" },
};

/** Live records of a collection (not deleted, active profile where it applies). */
export function recordsOf(v: Vault, def: CollectionDef, profileId: string): Rec[] {
  const all = v[def.id] as unknown as Rec[];
  return all.filter((r) => !r.deletedAt && (!def.profileScoped || r.profileId === profileId));
}

/** Value of a field, including computed fields and dotted paths ("customerSnapshot.name"). */
export function fieldValue(def: CollectionDef, r: Rec, field: string, v: Vault): unknown {
  const virt = def.virtual?.[field];
  if (virt) return virt(r, v);
  if (field in r) return r[field];
  if (field.endsWith("Name")) {
    const base = field.slice(0, -4) + "Id";
    const ref = REFS[base];
    if (ref) return nameOf(v, ref.coll, r[base], ref.field);
  }
  if (!field.includes(".")) return undefined;
  let cur: unknown = r;
  for (const part of field.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const fmtEur = (c: number) => formatCents(c);

/**
 * Compact view of a record for the model: chosen fields, readable names next to ids, a formatted copy next to every
 * money field (money itself stays in cents).
 */
export function project(def: CollectionDef, r: Rec, v: Vault, fields?: string[], opts: ViewOpts = {}): Record<string, unknown> {
  const keys = fields?.length ? (fields.includes("id") ? fields : ["id", ...fields]) : def.listFields;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const val = fieldValue(def, r, k, v);
    if (val === undefined || val === "" || (Array.isArray(val) && !val.length)) continue;
    out[k] = val;
  }
  decorate(out, v, opts, def.id);
  return out;
}

/** Full record for get_record (without heavy/internal fields). */
export function full(def: CollectionDef, r: Rec, v: Vault, opts: ViewOpts = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(r)) {
    if (def.omit?.includes(k) || k === "profileId") continue;
    if (val === undefined || val === "" || (Array.isArray(val) && !val.length)) continue;
    out[k] = val;
  }
  for (const [k, fn] of Object.entries(def.virtual ?? {})) {
    const val = fn(r, v);
    if (val !== undefined && val !== "" && val !== null) out[k] = val;
  }
  decorate(out, v, opts, def.id);
  return out;
}

/** Wage-related rates of people are only shown to those who manage the team. */
export const RATE_FIELDS: Partial<Record<EntityCollection, RegExp>> = { members: /^hourly(Cost|Rate)Cents$/, timeEntries: /^(costCents|rateCents|valueCents)$/ };

/**
 * Hidden fields must not be usable indirectly either (filter, sort, sum, group) – otherwise a role without
 * team rights could read wages by bisecting with filters. Throws for the model to see.
 */
export function assertFieldsVisible(coll: EntityCollection, fields: (string | undefined)[], hide: boolean): void {
  const rule = RATE_FIELDS[coll];
  if (!hide || !rule) return;
  for (const f of fields) {
    if (!f) continue;
    const base = f.replace(/_eur$/, "");
    if (rule.test(base)) throw new AtlasToolError(`Das Feld ${f} ist für deine Rolle nicht sichtbar.`);
  }
}

function decorate(out: Record<string, unknown>, v: Vault, opts: ViewOpts, coll: EntityCollection) {
  const visible = opts.visible ?? (() => true);
  const own = new Set(Object.keys(COLLECTION_BY_ID.get(coll)?.virtual ?? {}));
  for (const [k, val] of Object.entries({ ...out })) {
    if (opts.hideRates && RATE_FIELDS[coll]?.test(k)) {
      delete out[k];
      continue;
    }
    // a name read through a field of a collection Atlas may not see would leak it
    const target = own.has(k) ? undefined : refTarget(k);
    if (target && !visible(target) && k.endsWith("Name")) {
      delete out[k];
      continue;
    }
    if (typeof val === "number" && /Cents$/.test(k)) out[`${k}_eur`] = fmtEur(val);
    const ref = REFS[k];
    if (ref && typeof val === "string" && visible(ref.coll)) {
      const name = nameOf(v, ref.coll, val, ref.field);
      if (name) out[k.slice(0, -2) + "Name"] = name;
    }
    const multi = MULTI_REFS[k];
    if (multi && Array.isArray(val) && visible(multi.coll)) out[multi.as] = val.map((id) => nameOf(v, multi.coll, id, multi.field)).filter(Boolean);
  }
}

/** How records are shown to the model. */
export interface ViewOpts {
  /** Hide wage-related rates (RATE_FIELDS). */
  hideRates?: boolean;
  /** Collections Atlas may see; names from other collections are left out. Default: all. */
  visible?: (coll: EntityCollection) => boolean;
}

/** Collection a reference-like field points to: contactId, contactName, assigneeIds, memberNames … */
export function refTarget(field: string | undefined): EntityCollection | undefined {
  if (!field) return undefined;
  if (REFS[field]) return REFS[field]!.coll;
  if (MULTI_REFS[field]) return MULTI_REFS[field]!.coll;
  if (field.endsWith("Name")) {
    const ref = REFS[field.slice(0, -4) + "Id"];
    if (ref) return ref.coll;
  }
  for (const m of Object.values(MULTI_REFS)) if (m.as === field) return m.coll;
  return undefined;
}

/**
 * Filters, sorting and grouping over references must not reach into collections Atlas may not see (grouping by
 * memberId would print team names). Throws for the model to see.
 */
export function assertRefsVisible(def: CollectionDef, fields: (string | undefined)[], visible: (coll: EntityCollection) => boolean, opts: { namesOnly?: boolean } = {}): void {
  for (const f of fields) {
    if (!f || def.virtual?.[f]) continue;
    // a bare id (filter contactId = …) reveals nothing; a name or a grouping that prints names does
    if (opts.namesOnly && (REFS[f] || MULTI_REFS[f])) continue;
    const target = refTarget(f);
    if (target && !visible(target)) {
      const label = COLLECTION_BY_ID.get(target)?.label ?? target;
      throw new AtlasToolError(`Das Feld ${f} verweist auf ${label} – darauf hat Atlas keinen Zugriff (in den Einstellungen gesperrt).`);
    }
  }
}

const norm = (s: string) => s.toLocaleLowerCase("de").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/**
 * Finds a record by id, number or name ("Website", "P-0003"). Throws a helpful error with suggestions when nothing or
 * more than one record fits.
 */
export function resolveRecord(v: Vault, def: CollectionDef, profileId: string, ref: string, extra?: (r: Rec) => boolean): Rec {
  const list = recordsOf(v, def, profileId).filter((r) => !extra || extra(r));
  const byId = list.find((r) => r.id === ref);
  if (byId) return byId;
  const q = norm(ref);
  if (!q) throw new AtlasToolError(`Bitte sag, welche ${def.label} gemeint ist.`);
  const titleOf = (r: Rec) => norm(def.title(r, v));
  const fields = (r: Rec) => [titleOf(r), norm(String(r.name ?? "")), norm(String(r.number ?? "")), norm(String(r.title ?? "")), norm(String(r.sku ?? ""))].filter(Boolean);
  const exact = list.filter((r) => fields(r).includes(q));
  if (exact.length === 1) return exact[0]!;
  const partial = exact.length ? exact : list.filter((r) => fields(r).some((f) => f.includes(q)));
  if (partial.length === 1) return partial[0]!;
  const suggestions = (partial.length ? partial : list).slice(0, 8).map((r) => ({ id: r.id, title: def.title(r, v) }));
  if (!partial.length) throw new AtlasToolError(`Keine ${def.label} gefunden für „${ref}“.`, { suggestions });
  throw new AtlasToolError(`Mehrere ${def.label} passen zu „${ref}“ – bitte genauer.`, { candidates: suggestions });
}

/** Text match for search: every word must appear somewhere in the searched fields. */
export function matches(def: CollectionDef, r: Rec, v: Vault, words: string[]): boolean {
  const hay = norm(
    [def.title(r, v), ...def.search.map((f) => {
      const val = fieldValue(def, r, f, v);
      return Array.isArray(val) ? val.join(" ") : val == null ? "" : String(val);
    })].join(" "),
  );
  return words.every((w) => hay.includes(w));
}

export function searchWords(q: string): string[] {
  return norm(q).split(/\s+/).filter((w) => w.length > 0);
}
