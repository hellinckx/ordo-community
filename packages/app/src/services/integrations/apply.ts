/**
 * Writing data that comes from another program into the vault – shared by the local API, SAP Business One and the
 * REST pull. Every record from outside carries legacyRef "<source>:<external id>", so running an import twice updates
 * instead of duplicating, and nothing a person deleted in Ordo comes back.
 */
import {
  ApiContactInputSchema,
  ApiInvoiceInputSchema,
  ApiStockMoveInputSchema,
  ApiTimeEntryInputSchema,
  ApiTransactionInputSchema,
  ContactSchema,
  InvoiceSchema,
  StockMoveSchema,
  TimeEntrySchema,
  TransactionSchema,
  apiCents,
  formatNumber,
  ids,
  lineFromGross,
  nowIso,
  todayIso,
  type ApiContactInput,
  type ApiInvoiceInput,
  type ApiStockMoveInput,
  type ApiTimeEntryInput,
  type ApiTransactionInput,
  type Contact,
  type Invoice,
  type StockMove,
  type TimeEntry,
  type Transaction,
  type VatLine,
  type VatRate,
  type VaultStore,
} from "@ordo/core";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/** zod issues → one readable line. */
function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new ApiError(422, `Ungültige Felder: ${r.error.issues.map((i) => `${i.path.map(String).join(".") || "(Inhalt)"}: ${i.message}`).join("; ")}`);
  return r.data;
}

const norm = (s: string) => s.trim().toLocaleLowerCase("de");

function byRef<T extends { legacyRef?: string; deletedAt?: string; profileId: string }>(list: T[], profileId: string, ref: string | undefined): T | undefined {
  return ref ? list.find((x) => x.profileId === profileId && x.legacyRef === ref) : undefined;
}

export function findContact(store: VaultStore, profileId: string, name: string, uid?: string): Contact | undefined {
  const list = store.list("contacts", { profileId });
  const u = uid?.replace(/\s+/g, "").toUpperCase();
  return (u ? list.find((c) => c.uid.replace(/\s+/g, "").toUpperCase() === u) : undefined) ?? list.find((c) => norm(c.name) === norm(name) || c.aliases.includes(norm(name)));
}

/**
 * Creates or updates a contact. Matching: same external id, else same UID, else same name.
 * `patchExisting: false` (invoices, bookings) only finds or creates: changing a known contact – its IBAN, say – needs contacts:write.
 */
export function upsertContact(store: VaultStore, profileId: string, raw: unknown, source: string, patchExisting = true): { contact: Contact; created: boolean } {
  const input: ApiContactInput = parse(ApiContactInputSchema, raw);
  const ref = input.externalId ? `${source}:${input.externalId}` : undefined;
  const existing = byRef(store.vault.contacts, profileId, ref) ?? findContact(store, profileId, input.name, input.uid || undefined);
  if (existing?.deletedAt || (existing && !patchExisting)) return { contact: existing, created: false };
  const fields = { name: input.name.trim(), uid: input.uid, email: input.email, phone: input.phone, street: input.street, zip: input.zip, city: input.city, country: input.country.toUpperCase(), iban: input.iban.replace(/\s+/g, "").toUpperCase(), notes: input.notes };
  if (existing) {
    // only fill what is empty in Ordo or changed at the source – never overwrite with blanks
    const patch: Partial<Contact> = {};
    for (const [k, v] of Object.entries(fields) as [keyof typeof fields, string][]) if (v && v !== existing[k]) (patch as Record<string, string>)[k] = v;
    if (existing.kind !== "both" && existing.kind !== input.kind) patch.kind = "both";
    if (ref && !existing.legacyRef) patch.legacyRef = ref;
    const contact = Object.keys(patch).length ? store.update("contacts", existing.id, patch, `api.${source}.contact`)! : existing;
    return { contact, created: false };
  }
  const now = nowIso();
  const contact = ContactSchema.parse({ id: ids.contact(), profileId, kind: input.kind, ...fields, legacyRef: ref, createdAt: now, updatedAt: now });
  store.insert("contacts", contact, `api.${source}.contact`);
  return { contact, created: true };
}

/** Creates an income or expense (idempotent with externalId). Open when a due date is given and nothing paid. */
export function createTransaction(store: VaultStore, profileId: string, raw: unknown, source: string): { transaction: Transaction; created: boolean } {
  const input: ApiTransactionInput = parse(ApiTransactionInputSchema, raw);
  const ref = input.externalId ? `${source}:${input.externalId}` : undefined;
  const existing = byRef(store.vault.transactions, profileId, ref);
  const profile = store.vault.profiles.find((p) => p.id === profileId);
  if (!profile) throw new ApiError(404, "Profil nicht gefunden.");
  const gross = apiCents(input.amount);
  if (!(gross > 0)) throw new ApiError(422, "amount muss größer als 0 sein (Ausgaben ebenfalls positiv, kind: \"expense\").");
  const ku = input.kind === "income" && profile.vatRegime === "kleinunternehmer";
  let vatLines: VatLine[];
  if (input.vat?.length) vatLines = input.vat.map((l) => ({ rate: l.rate as VatRate, netCents: apiCents(l.net), vatCents: apiCents(l.vat) }));
  else if (ku || input.vatTreatment !== "standard") vatLines = [{ rate: 0 as VatRate, netCents: gross, vatCents: 0 }];
  else vatLines = [lineFromGross(gross, (input.vatRate ?? 20) as VatRate)];
  let contactId = input.contactId && store.byId("contacts", input.contactId)?.profileId === profileId ? input.contactId : undefined;
  if (!contactId && input.contactName?.trim()) contactId = upsertContact(store, profileId, { name: input.contactName, kind: input.kind === "income" ? "customer" : "vendor" }, source, false).contact.id;
  let categoryId: string | undefined;
  if (input.category) {
    const pool = store.vault.categories.filter((c) => !c.deletedAt && !c.isArchived && c.kind === input.kind && (c.mode === "both" || c.mode === profile.mode));
    const q = norm(input.category);
    categoryId = (pool.find((c) => c.id === input.category) ?? pool.find((c) => norm(c.name) === q) ?? pool.find((c) => norm(c.name).includes(q)))?.id;
  }
  const fields = {
    kind: input.kind,
    date: input.date,
    description: input.description,
    contactId,
    categoryId,
    grossCents: gross,
    vatLines,
    vatTreatment: ku ? ("kleinunternehmer" as const) : input.vatTreatment,
    paymentMethod: input.paymentMethod,
    invoiceNumber: input.invoiceNumber,
    reference: input.reference,
    dueDate: input.dueDate,
    paidDate: input.paidDate ?? (input.dueDate ? undefined : input.date),
    projectId: input.projectId && store.byId("projects", input.projectId) ? input.projectId : undefined,
  };
  if (existing) {
    if (existing.deletedAt || existing.reviewed === false) return { transaction: existing, created: false };
    // keep what a person changed in Ordo (category, notes); follow the source for amounts, dates and payment
    const transaction = store.update("transactions", existing.id, { ...fields, categoryId: existing.categoryId ?? fields.categoryId }, `api.${source}.transaction`)!;
    return { transaction, created: false };
  }
  const now = nowIso();
  const transaction = TransactionSchema.parse({ id: ids.transaction(), profileId, ...fields, origin: "import", reviewed: true, notes: `Über Schnittstelle (${source})`, legacyRef: ref, createdAt: now, updatedAt: now });
  store.insert("transactions", transaction, `api.${source}.transaction`);
  return { transaction, created: true };
}

/** A draft invoice in Ordo – numbered like one written by hand; sending it stays a person's decision. */
export function createInvoiceDraft(store: VaultStore, profileId: string, raw: unknown, source: string): { invoice: Invoice; created: boolean } {
  const input: ApiInvoiceInput = parse(ApiInvoiceInputSchema, raw);
  const ref = input.externalId ? `${source}:${input.externalId}` : undefined;
  const existing = byRef(store.vault.invoices, profileId, ref);
  if (existing) return { invoice: existing, created: false };
  const profile = store.vault.profiles.find((p) => p.id === profileId);
  if (!profile) throw new ApiError(404, "Profil nicht gefunden.");
  let customerId = input.customerId && store.byId("contacts", input.customerId)?.profileId === profileId ? input.customerId : undefined;
  if (!customerId && input.customer) customerId = upsertContact(store, profileId, { ...input.customer, kind: "customer" }, source, false).contact.id;
  const c = customerId ? store.byId("contacts", customerId) : undefined;
  if (!c) throw new ApiError(422, "customerId oder customer (mit name) fehlt.");
  const ku = profile.vatRegime === "kleinunternehmer";
  const issue = input.issueDate ?? todayIso();
  const due = input.dueDate ?? new Date(Date.parse(issue) + (c.paymentDueDays ?? 14) * 86400_000).toISOString().slice(0, 10);
  const now = nowIso();
  const invoice = InvoiceSchema.parse({
    id: ids.invoice(),
    profileId,
    number: formatNumber(profile.company.invoiceNumberPattern, profile.company.nextInvoiceNumber, issue),
    kind: "invoice",
    customerId,
    customerSnapshot: { name: c.name, street: c.street, zip: c.zip, city: c.city, country: c.country, uid: c.uid, email: c.email },
    issueDate: issue,
    dueDate: due,
    lines: input.lines.map((l) => ({ id: ids.line(), description: l.description, quantity: l.quantity, unit: l.unit, unitNetCents: apiCents(l.unitNet), vatRate: ku ? 0 : l.vatRate, discountPct: l.discountPct })),
    introText: input.introText,
    footerText: input.footerText || profile.company.invoiceFooter,
    status: "draft",
    vatTreatment: ku ? "kleinunternehmer" : "standard",
    reference: input.reference,
    projectId: input.projectId && store.byId("projects", input.projectId) ? input.projectId : undefined,
    legacyRef: ref,
    createdAt: now,
    updatedAt: now,
  });
  store.insert("invoices", invoice, `api.${source}.invoice`);
  store.update("profiles", profileId, (p) => ({ ...p, company: { ...p.company, nextInvoiceNumber: p.company.nextInvoiceNumber + 1 } }));
  return { invoice, created: true };
}

export function addStockMove(store: VaultStore, profileId: string, raw: unknown, source: string): StockMove {
  const input: ApiStockMoveInput = parse(ApiStockMoveInputSchema, raw);
  const products = store.list("products", { profileId });
  const product = (input.productId ? products.find((p) => p.id === input.productId) : undefined) ?? (input.sku ? products.find((p) => p.sku && norm(p.sku) === norm(input.sku!)) : undefined);
  if (!product) throw new ApiError(404, "Produkt nicht gefunden (productId oder sku).");
  const now = nowIso();
  const move = StockMoveSchema.parse({ id: ids.stockMove(), profileId, productId: product.id, date: input.date ?? todayIso(), quantity: input.quantity, kind: input.kind, note: input.note || `Über Schnittstelle (${source})`, createdAt: now, updatedAt: now });
  store.insert("stockMoves", move, `api.${source}.stock`);
  return move;
}

export function addTimeEntry(store: VaultStore, profileId: string, raw: unknown, source: string): TimeEntry {
  const input: ApiTimeEntryInput = parse(ApiTimeEntryInputSchema, raw);
  const projects = store.list("projects", { profileId });
  const project = (input.projectId ? projects.find((p) => p.id === input.projectId) : undefined) ?? (input.projectNumber ? projects.find((p) => norm(p.number) === norm(input.projectNumber!)) : undefined);
  if (!project) throw new ApiError(404, "Projekt nicht gefunden (projectId oder projectNumber).");
  const memberId = input.memberId && store.byId("members", input.memberId) ? input.memberId : store.vault.settings.meMemberId;
  const now = nowIso();
  const entry = TimeEntrySchema.parse({ id: ids.timeEntry(), profileId, projectId: project.id, memberId, date: input.date, minutes: input.minutes, description: input.description, billable: input.billable, createdAt: now, updatedAt: now });
  store.insert("timeEntries", entry, `api.${source}.time`);
  return entry;
}
