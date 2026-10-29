import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Primitive schemas                                                   */
/* ------------------------------------------------------------------ */

import { baseEntity, cents, isoDate, isoDateTime, legacyRef, vatRate } from "./primitives";
import { IntegrationSchema, LocalApiSettingsSchema } from "../interfaces/integrations";
import { AiUsageSchema } from "../interfaces/aiUsage";
import {
  AtlasChatSchema,
  AtlasSettingsSchema,
  FileEntrySchema,
  FolderSchema,
  MemberSchema,
  MilestoneSchema,
  ModuleStateSchema,
  OfferSchema,
  ProductSchema,
  ProjectSchema,
  ProjectSettingsSchema,
  RunningTimerSchema,
  StockMoveSchema,
  TaskSchema,
  TimeEntrySchema,
  WorkOrderSchema,
} from "../erp/schemas";
export { baseEntity, cents, isoDate, isoDateTime, legacyRef, vatRate };

export const VatLineSchema = z.object({
  rate: vatRate,
  netCents: cents,
  vatCents: cents,
});

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

export const ModeSchema = z.enum(["employee", "business"]);
export type Mode = z.infer<typeof ModeSchema>;

export const AccountingMethodSchema = z.enum(["eur", "doppik"]);
export type AccountingMethod = z.infer<typeof AccountingMethodSchema>;

export const VatRegimeSchema = z.enum(["kleinunternehmer", "regelbesteuerung"]);
export type VatRegime = z.infer<typeof VatRegimeSchema>;

export const UvaPeriodSchema = z.enum(["monthly", "quarterly", "none"]);
export type UvaPeriod = z.infer<typeof UvaPeriodSchema>;

export const PauschalierungSchema = z.enum(["none", "basis", "kleinunternehmer"]);
export type Pauschalierung = z.infer<typeof PauschalierungSchema>;

/**
 * VAT treatment of a transaction, mirrors the UVA (U30) logic:
 * - standard:         normal domestic supply with VAT
 * - kleinunternehmer: tax-exempt small business (KZ 016), no input VAT
 * - reverse_charge:   service received from abroad, § 19 Abs. 1 (KZ 057 + 066) / supplied abroad (KZ 021)
 * - ig_erwerb:        intra-community acquisition of goods (KZ 070/072 + 065)
 * - ig_lieferung:     intra-community supply (KZ 017)
 * - export:           export to third country (KZ 011)
 * - exempt:           other tax-exempt without input VAT deduction (KZ 020)
 * - private:          not business related, ignored for tax
 */
export const VatTreatmentSchema = z.enum([
  "standard",
  "kleinunternehmer",
  "reverse_charge",
  "ig_erwerb",
  "ig_lieferung",
  "export",
  "exempt",
  "private",
]);
export type VatTreatment = z.infer<typeof VatTreatmentSchema>;

export const TxKindSchema = z.enum(["expense", "income", "transfer", "private"]);
export type TxKind = z.infer<typeof TxKindSchema>;

export const PaymentMethodSchema = z.enum(["bank", "cash", "card", "paypal", "direct_debit", "other"]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const DocumentStatusSchema = z.enum(["inbox", "processing", "review", "approved", "rejected", "error", "duplicate"]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentSourceSchema = z.enum(["upload", "folder", "camera", "manual", "invoice", "sync", "bank", "api"]);
export type DocumentSource = z.infer<typeof DocumentSourceSchema>;

export const AiProviderSchema = z.enum(["none", "codex", "openai", "anthropic", "ollama"]);
export type AiProvider = z.infer<typeof AiProviderSchema>;

export const RecurringIntervalSchema = z.enum(["weekly", "monthly", "quarterly", "half_yearly", "yearly"]);
export type RecurringInterval = z.infer<typeof RecurringIntervalSchema>;

export const InvoiceStatusSchema = z.enum(["draft", "sent", "paid", "overdue", "cancelled"]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

const base = baseEntity;

export const CompanySchema = z.object({
  name: z.string().default(""),
  legalForm: z.string().default(""),
  street: z.string().default(""),
  zip: z.string().default(""),
  city: z.string().default(""),
  country: z.string().default("AT"),
  uid: z.string().default(""),
  steuernummer: z.string().default(""),
  iban: z.string().default(""),
  bic: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  website: z.string().default(""),
  /** Owner / managing director as printed on offers. */
  owner: z.string().optional(),
  bankName: z.string().optional(),
  registerNumber: z.string().optional(),
  registerCourt: z.string().optional(),
  /** Accent colour on PDFs. */
  brandColor: z.string().optional(),
  logoAttachmentId: z.string().optional(),
  invoiceFooter: z.string().default(""),
  invoiceNumberPattern: z.string().default("RE-{YYYY}-{NNNN}"),
  nextInvoiceNumber: z.number().int().default(1),
  /**
   * How outgoing invoices come into Ordo:
   *  - "summa":    written in Ordo (numbering, PDF, § 11 UStG)
   *  - "external": produced elsewhere (ERP, Word, Online-Tool) and imported like receipts – no numbering setup
   * Undefined = not decided yet (asked in the welcome tour).
   */
  invoiceMode: z.enum(["summa", "external"]).optional(),
});
export type Company = z.infer<typeof CompanySchema>;

export const ProfileSchema = z.object({
  ...base,
  name: z.string(),
  mode: ModeSchema,
  accountingMethod: AccountingMethodSchema.default("eur"),
  vatRegime: VatRegimeSchema.default("regelbesteuerung"),
  uvaPeriod: UvaPeriodSchema.default("quarterly"),
  /** EÜR: USt-Brutto- oder Nettosystem (relevant für E1a KZ 9093/9233). */
  ustSystem: z.enum(["brutto", "netto"]).default("netto"),
  pauschalierung: PauschalierungSchema.default("none"),
  /** "service" => 6 % Basispauschale / 20 % Kleinunternehmerpauschale, "regular" => 15 % / 45 %. */
  pauschalierungBranch: z.enum(["regular", "service"]).default("regular"),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(1),
  company: CompanySchema.default(() => CompanySchema.parse({})),
  color: z.string().default("#0f766e"),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ContactPersonSchema = z.object({
  id: z.string(),
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  role: z.string().default(""),
  notes: z.string().default(""),
});
export type ContactPerson = z.infer<typeof ContactPersonSchema>;

export const ContactSchema = z.object({
  ...base,
  profileId: z.string(),
  name: z.string(),
  kind: z.enum(["vendor", "customer", "both"]).default("vendor"),
  uid: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  street: z.string().default(""),
  zip: z.string().default(""),
  city: z.string().default(""),
  country: z.string().default("AT"),
  iban: z.string().default(""),
  defaultCategoryId: z.string().optional(),
  defaultVatTreatment: VatTreatmentSchema.optional(),
  notes: z.string().default(""),
  /** Lower-cased aliases used by the matcher (e.g. "billa", "billa ag"). */
  aliases: z.array(z.string()).default([]),
  /** Human number, e.g. "K-0007". */
  number: z.string().optional(),
  /** People at this company. */
  persons: z.array(ContactPersonSchema).optional(),
  paymentDueDays: z.number().int().optional(),
  paymentTerms: z.string().optional(),
  website: z.string().optional(),
  /** false = archived customer/supplier. */
  active: z.boolean().optional(),
  /** Logo or photo – an attachment in the vault. */
  logoAttachmentId: z.string().optional(),
  /** Agreed to receive the newsletter (needed for marketing e-mails, TKG § 174) – and when. */
  newsletter: z.boolean().optional(),
  newsletterConsentAt: z.string().optional(),
  legacyRef,
});
export type Contact = z.infer<typeof ContactSchema>;

export const CategorySchema = z.object({
  ...base,
  name: z.string(),
  kind: z.enum(["income", "expense"]),
  mode: z.enum(["business", "employee", "both"]).default("both"),
  icon: z.string().default("receipt"),
  color: z.string().default("#64748b"),
  /** Österreichischer Einheitskontenrahmen (EKR) Kontonummer für die doppelte Buchführung. */
  ekrAccount: z.string().optional(),
  /** E1a-Kennzahl (Unternehmer) */
  e1aKz: z.string().optional(),
  /** L1 / L1ab / L1d Kennzahl (Angestellte) */
  l1Kz: z.string().optional(),
  defaultVatRate: vatRate.default(20),
  /** Vorsteuerabzug in Prozent (z. B. 0 bei PKW, 100 Standard). */
  defaultDeductiblePct: z.number().min(0).max(100).default(100),
  /** Einkommensteuerlich abzugsfähiger Anteil in Prozent (z. B. 50 bei Bewirtung). */
  deductibleIncomePct: z.number().min(0).max(100).default(100),
  keywords: z.array(z.string()).default([]),
  /** Keywords the user added (system keywords are re-seeded on every open, these survive). */
  userKeywords: z.array(z.string()).default([]),
  parentId: z.string().optional(),
  isSystem: z.boolean().default(false),
  /** Hidden from pickers and auto-categorisation; existing bookings keep it. */
  isArchived: z.boolean().default(false),
  sortOrder: z.number().default(0),
});
export type Category = z.infer<typeof CategorySchema>;

export const TransactionSchema = z.object({
  ...base,
  profileId: z.string(),
  kind: TxKindSchema,
  date: isoDate,
  description: z.string().default(""),
  contactId: z.string().optional(),
  categoryId: z.string().optional(),
  vatLines: z.array(VatLineSchema).default([]),
  grossCents: cents,
  currency: z.string().default("EUR"),
  /** Original amount/currency if the receipt was in a foreign currency. */
  originalAmountCents: cents.optional(),
  originalCurrency: z.string().optional(),
  vatTreatment: VatTreatmentSchema.default("standard"),
  vatDeductiblePct: z.number().min(0).max(100).default(100),
  paymentMethod: PaymentMethodSchema.default("bank"),
  /** For transfers: the receiving account (paymentMethod is the source). */
  counterPaymentMethod: PaymentMethodSchema.optional(),
  paidDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  invoiceNumber: z.string().default(""),
  reference: z.string().default(""),
  documentIds: z.array(z.string()).default([]),
  recurringRuleId: z.string().optional(),
  invoiceId: z.string().optional(),
  assetId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(""),
  /** Overrides for the automatic mapping. */
  ekrAccountOverride: z.string().optional(),
  e1aKzOverride: z.string().optional(),
  l1KzOverride: z.string().optional(),
  /** Set when a row was generated automatically (recurring, invoice, AfA). */
  origin: z.enum(["manual", "extraction", "recurring", "invoice", "afa", "import"]).default("manual"),
  reviewed: z.boolean().default(true),
  /** Booked by the importer without a human review (confident extraction). */
  autoBooked: z.boolean().optional(),
  /** Cost or income of a project (Ordo Projekte). */
  projectId: z.string().optional(),
  /** Parameters reviewed alongside an investment invoice. */
  assetSettings: z.object({
    inServiceDate: isoDate.optional(),
    usefulLifeYears: z.number().min(1).max(100),
    method: z.enum(["linear", "degressive", "gwg", "none"]),
    degressiveRatePct: z.number().min(0.01).max(30).default(30),
    privateUsePct: z.number().min(0).max(100).default(0),
    ekrAccount: z.string().regex(/^0\d{3}$/),
  }).optional(),
  legacyRef,
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const ExtractedLineItemSchema = z.object({
  description: z.string().nullable(),
  quantity: z.number().nullable(),
  unitPriceCents: cents.nullable(),
  totalCents: cents.nullable(),
  vatRate: z.number().nullable(),
});
export type ExtractedLineItem = z.infer<typeof ExtractedLineItemSchema>;

export const ExtractedFieldsSchema = z.object({
  documentType: z.enum(["invoice", "receipt", "credit_note", "bank_statement", "salary_slip", "other"]).default("other"),
  direction: z.enum(["incoming", "outgoing", "unknown"]).default("unknown"),
  vendorName: z.string().nullable().default(null),
  vendorUid: z.string().nullable().default(null),
  vendorAddress: z.string().nullable().default(null),
  vendorIban: z.string().nullable().default(null),
  customerName: z.string().nullable().default(null),
  invoiceNumber: z.string().nullable().default(null),
  invoiceDate: isoDate.nullable().default(null),
  dueDate: isoDate.nullable().default(null),
  serviceDate: z.string().nullable().default(null),
  currency: z.string().nullable().default(null),
  grossCents: cents.nullable().default(null),
  netCents: cents.nullable().default(null),
  vatCents: cents.nullable().default(null),
  vatLines: z.array(VatLineSchema).default([]),
  paymentMethod: PaymentMethodSchema.nullable().default(null),
  isPaid: z.boolean().nullable().default(null),
  description: z.string().nullable().default(null),
  lineItems: z.array(ExtractedLineItemSchema).default([]),
  suggestedCategory: z.string().nullable().default(null),
  reverseCharge: z.boolean().nullable().default(null),
  notes: z.string().nullable().default(null),
});
export type ExtractedFields = z.infer<typeof ExtractedFieldsSchema>;

export const ExtractionSchema = z.object({
  provider: z.enum(["rules", "codex", "openai", "anthropic", "ollama", "manual"]),
  model: z.string().optional(),
  extractedAt: isoDateTime,
  /** Raw OCR / text-layer text used as evidence; shown next to the original. */
  text: z.string().default(""),
  fields: ExtractedFieldsSchema,
  /** 0..1 per field */
  confidence: z.record(z.string(), z.number()).default({}),
  overall: z.number().min(0).max(1).default(0),
  warnings: z.array(z.string()).default([]),
  durationMs: z.number().optional(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const AttachmentSchema = z.object({
  ...base,
  profileId: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int(),
  sha256: z.string(),
  /** Width/height for images, pages for PDFs. */
  width: z.number().optional(),
  height: z.number().optional(),
  pages: z.number().optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const DocumentSchema = z.object({
  ...base,
  profileId: z.string(),
  attachmentId: z.string(),
  /** Rendered preview (PNG) for PDFs/Office files so the review UI can show it instantly. */
  previewAttachmentId: z.string().optional(),
  originalName: z.string(),
  originalPath: z.string().optional(),
  mime: z.string(),
  sha256: z.string(),
  source: DocumentSourceSchema,
  importedAt: isoDateTime,
  status: DocumentStatusSchema.default("inbox"),
  extraction: ExtractionSchema.optional(),
  transactionId: z.string().optional(),
  invoiceId: z.string().optional(),
  /** Forced direction: "outgoing" = own invoice issued elsewhere (becomes income). */
  direction: z.enum(["incoming", "outgoing"]).optional(),
  error: z.string().optional(),
  duplicateOfId: z.string().optional(),
  reviewedAt: isoDateTime.optional(),
  /** Approved automatically by the importer (see extraction/autobook). */
  autoBooked: z.boolean().optional(),
  /** Why the importer left this document in review (German, shown above the form). */
  autoBookReasons: z.array(z.string()).optional(),
});
export type SummaDocument = z.infer<typeof DocumentSchema>;

export const RecurringTemplateSchema = z.object({
  kind: TxKindSchema,
  description: z.string(),
  contactId: z.string().optional(),
  categoryId: z.string().optional(),
  vatLines: z.array(VatLineSchema).default([]),
  grossCents: cents,
  vatTreatment: VatTreatmentSchema.default("standard"),
  vatDeductiblePct: z.number().default(100),
  paymentMethod: PaymentMethodSchema.default("bank"),
  tags: z.array(z.string()).default([]),
});
export type RecurringTemplate = z.infer<typeof RecurringTemplateSchema>;

export const RecurringRuleSchema = z.object({
  ...base,
  profileId: z.string(),
  name: z.string(),
  active: z.boolean().default(true),
  interval: RecurringIntervalSchema,
  /** 1..31; clamped to month length. */
  dayOfMonth: z.number().int().min(1).max(31).default(1),
  startDate: isoDate,
  endDate: isoDate.optional(),
  lastMaterializedDate: isoDate.optional(),
  autoBook: z.boolean().default(true),
  template: RecurringTemplateSchema,
});
export type RecurringRule = z.infer<typeof RecurringRuleSchema>;

export const AssetSchema = z.object({
  ...base,
  profileId: z.string(),
  name: z.string(),
  acquisitionDate: isoDate,
  inServiceDate: isoDate.optional(),
  supplierName: z.string().optional(),
  supplierAddress: z.string().optional(),
  inventoryNumber: z.string().optional(),
  /** Explicitly reviewed eligibility, never inferred from the invoice amount or useful life alone. */
  gfbEligible: z.boolean().optional(),
  /** Optional opening balance for historical assets imported at the start of a financial year. */
  openingBalanceDate: isoDate.optional(),
  /** Purchase cost last synchronised from the linked booking; preserves subsequent capitalised costs. */
  purchaseCostCents: cents.optional(),
  costCents: cents,
  usefulLifeYears: z.number().min(1).max(100),
  method: z.enum(["linear", "degressive", "gwg", "none"]).default("linear"),
  degressiveRatePct: z.number().default(30),
  /** Nutzung für Privatanteil (in %) – mindert AfA. */
  privateUsePct: z.number().min(0).max(100).default(0),
  disposedAt: isoDate.optional(),
  disposalProceedsCents: cents.optional(),
  disposalTransactionId: z.string().optional(),
  transactionId: z.string().optional(),
  ekrAccount: z.string().default("0600"),
  categoryId: z.string().optional(),
  notes: z.string().default(""),
});
export type Asset = z.infer<typeof AssetSchema>;

export const InvoiceLineSchema = z.object({
  id: z.string(),
  description: z.string(),
  quantity: z.number().default(1),
  unit: z.string().default("Stk"),
  unitNetCents: cents,
  vatRate: vatRate.default(20),
  discountPct: z.number().default(0),
  /** Article from Produkte & Lager – a stock-tracked one leaves the stock when the invoice is finished. */
  productId: z.string().optional(),
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const CustomerSnapshotSchema = z.object({
  name: z.string().default(""),
  street: z.string().default(""),
  zip: z.string().default(""),
  city: z.string().default(""),
  country: z.string().default("AT"),
  uid: z.string().default(""),
  email: z.string().default(""),
});
export type CustomerSnapshot = z.infer<typeof CustomerSnapshotSchema>;

export const InvoiceSchema = z.object({
  ...base,
  profileId: z.string(),
  number: z.string(),
  kind: z.enum(["invoice", "credit_note", "offer"]).default("invoice"),
  customerId: z.string().optional(),
  customerSnapshot: CustomerSnapshotSchema.default(() => CustomerSnapshotSchema.parse({})),
  issueDate: isoDate,
  dueDate: isoDate,
  servicePeriod: z.string().default(""),
  lines: z.array(InvoiceLineSchema).default([]),
  introText: z.string().default(""),
  footerText: z.string().default(""),
  status: InvoiceStatusSchema.default("draft"),
  paidDate: isoDate.optional(),
  paidCents: cents.default(0),
  vatTreatment: VatTreatmentSchema.default("standard"),
  transactionId: z.string().optional(),
  pdfAttachmentId: z.string().optional(),
  reference: z.string().default(""),
  projectId: z.string().optional(),
  offerId: z.string().optional(),
  /** Discount on the whole invoice in %, applied to net and VAT. */
  discountPct: z.number().optional(),
  discountText: z.string().optional(),
  servicePeriodStart: isoDate.optional(),
  servicePeriodEnd: isoDate.optional(),
  /** Sent by e-mail from Ordo (E-Mail module): when and to whom; last payment reminder. */
  emailedAt: z.string().optional(),
  emailedTo: z.string().optional(),
  remindedAt: z.string().optional(),
  legacyRef,
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const JournalLineSchema = z.object({
  account: z.string(),
  debitCents: cents.default(0),
  creditCents: cents.default(0),
  text: z.string().default(""),
  vatRate: vatRate.optional(),
});
export type JournalLine = z.infer<typeof JournalLineSchema>;

export const JournalEntrySchema = z.object({
  ...base,
  profileId: z.string(),
  number: z.number().int(),
  date: isoDate,
  description: z.string().default(""),
  lines: z.array(JournalLineSchema),
  transactionId: z.string().optional(),
  documentIds: z.array(z.string()).default([]),
  source: z.enum(["auto", "manual", "closing", "opening"]).default("auto"),
  locked: z.boolean().default(false),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export const EmployeeInfoSchema = z.object({
  /** Monthly gross salary (brutto) for budget and tax estimate. */
  monthlyGrossCents: cents.default(0),
  monthlyNetCents: cents.default(0),
  employerName: z.string().default(""),
  /** Pendlerpauschale pro Jahr (KZ 718) und Pendlereuro (KZ 916), laut Pendlerrechner. */
  pendlerpauschaleCents: cents.default(0),
  pendlereuroCents: cents.default(0),
  homeofficeDays: z.number().int().default(0),
});
export type EmployeeInfo = z.infer<typeof EmployeeInfoSchema>;

export const WatchFolderSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  path: z.string(),
  /** "receipts": Eingangsbelege · "outgoing": eigene Ausgangsrechnungen aus anderem Programm · "bank": Kontoauszüge */
  kind: z.enum(["receipts", "outgoing", "bank"]).default("receipts"),
  active: z.boolean().default(true),
  /** Also watch subfolders (e.g. one per year). Hidden folders and "Verarbeitet" are skipped. */
  recursive: z.boolean().default(true),
  /** Move processed files into a "Verarbeitet" subfolder. */
  moveProcessed: z.boolean().default(false),
  lastScanAt: isoDateTime.optional(),
});
export type WatchFolder = z.infer<typeof WatchFolderSchema>;

export const AiSettingsSchema = z.object({
  provider: AiProviderSchema.default("none"),
  autoExtract: z.boolean().default(true),
  /**
   * local_first: QR/E-Rechnung/Textebene/OCR zuerst, KI nur wenn die lokale Sicherheit unter aiThreshold liegt
   * always:      KI immer zusätzlich (lokal als Gegenprüfung)
   * local_only:  nie KI (auch wenn ein Anbieter konfiguriert ist)
   */
  strategy: z.enum(["local_first", "always", "local_only"]).default("local_first"),
  /** 0..1 – unterhalb dieser lokalen Gesamtsicherheit wird die KI gefragt (local_first). */
  aiThreshold: z.number().min(0).max(1).default(0.9),
  /** Only send documents to a cloud model after explicit consent. */
  cloudConsent: z.boolean().default(false),
  codexModel: z.string().default(""),
  codexReasoning: z.enum(["low", "medium", "high", "xhigh"]).default("medium"),
  openaiModel: z.string().default("gpt-5.4-mini"),
  /** "auto" = Haiku 5.5 first, Opus 5.5 reads again when unsure (see extraction/escalation). Or a fixed Claude model id. */
  anthropicModel: z.string().default("auto"),
  ollamaUrl: z.string().default("http://127.0.0.1:11434"),
  ollamaModel: z.string().default("qwen3-vl:8b"),
  /** API keys are stored inside the encrypted vault – never in plain settings. */
  openaiApiKey: z.string().default(""),
  anthropicApiKey: z.string().default(""),
  /** Use local OCR text as additional context for the model (improves accuracy). */
  includeOcrText: z.boolean().default(true),
  /**
   * confident: book documents without review when a trusted source (AI, e-invoice, RKSV QR) agrees and
   *            every essential field is above minAutoApproveConfidence · off: everything waits in "Prüfen"
   */
  autoBook: z.enum(["off", "confident"]).default("confident"),
  minAutoApproveConfidence: z.number().min(0).max(1).default(0.9),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const SyncSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  supabaseUrl: z.string().default(""),
  supabaseAnonKey: z.string().default(""),
  lastSyncAt: isoDateTime.optional(),
  deviceId: z.string().default(""),
  /** Ordo account (e-mail + one password). The login secret is derived from the password – see deriveAccountSecret. */
  email: z.string().default(""),
  /** Derived login secret for the sync server; lives only inside the encrypted vault. */
  authSecret: z.string().default(""),
});
export type SyncSettings = z.infer<typeof SyncSettingsSchema>;

export const NotificationPrefsSchema = z.object({
  enabled: z.boolean().default(true),
  uvaDeadline: z.boolean().default(true),
  uvaDaysBefore: z.number().int().default(7),
  inboxReminder: z.boolean().default(true),
  recurringDue: z.boolean().default(true),
  invoiceOverdue: z.boolean().default(true),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

/**
 * E-mail through the person's own Brevo account (free plan: 300 e-mails a day): invoices with PDF, payment
 * reminders and newsletters. Mails go from this device straight to Brevo – Ordo as a company sees none of it.
 */
export const EmailSettingsSchema = z.object({
  provider: z.enum(["none", "brevo"]).default("none"),
  brevoApiKey: z.string().default(""),
  senderName: z.string().default(""),
  /** Must be a sender verified in Brevo. */
  senderEmail: z.string().default(""),
  replyTo: z.string().default(""),
  /** Copy of every invoice mail to the sender. */
  bccSelf: z.boolean().default(true),
  /** Placeholders: {nummer} {kunde} {betrag} {faellig} {firma} */
  invoiceSubject: z.string().default("Rechnung {nummer}"),
  invoiceText: z.string().default("Guten Tag,\n\nim Anhang finden Sie unsere Rechnung {nummer} über {betrag}, fällig am {faellig}.\n\nVielen Dank für Ihren Auftrag!\n\nFreundliche Grüße\n{firma}"),
  reminderSubject: z.string().default("Zahlungserinnerung: Rechnung {nummer}"),
  reminderText: z.string().default("Guten Tag,\n\nunsere Rechnung {nummer} über {betrag} war am {faellig} fällig. Vielleicht ist sie untergegangen – wir freuen uns über die Zahlung in den nächsten Tagen. Die Rechnung liegt nochmals bei.\n\nFalls Sie bereits bezahlt haben, betrachten Sie diese Nachricht bitte als gegenstandslos.\n\nFreundliche Grüße\n{firma}"),
});
export type EmailSettings = z.infer<typeof EmailSettingsSchema>;

export const SettingsSchema = z.object({
  locale: z.string().default("de-AT"),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  autoLockMinutes: z.number().int().min(0).default(10),
  notifications: NotificationPrefsSchema.default(() => NotificationPrefsSchema.parse({})),
  ai: AiSettingsSchema.default(() => AiSettingsSchema.parse({})),
  sync: SyncSettingsSchema.default(() => SyncSettingsSchema.parse({})),
  watchFolders: z.array(WatchFolderSchema).default([]),
  ocrLanguages: z.array(z.string()).default(["deu", "eng"]),
  employee: z.record(z.string(), EmployeeInfoSchema).default({}),
  backupKeep: z.number().int().default(10),
  onboardingDone: z.boolean().default(false),
  /** Welcome tour finished or skipped. */
  tourDone: z.boolean().default(false),
  /** Version of the welcome tour that was seen – a new tour (e.g. the Ordo intro) shows once more. */
  tourVersion: z.number().int().default(0),
  /** Guest mode with generated sample data. */
  demoMode: z.boolean().default(false),
  /** Installed modules (Ordo). Missing key = module default. */
  modules: z.record(z.string(), ModuleStateSchema).default({}),
  /** Who is using this device – a member of the team. */
  meMemberId: z.string().optional(),
  atlas: AtlasSettingsSchema.default(() => AtlasSettingsSchema.parse({})),
  projects: ProjectSettingsSchema.default(() => ProjectSettingsSchema.parse({})),
  /** Running stopwatches (Zeiterfassung). */
  timers: z.array(RunningTimerSchema).default([]),
  /** What AI reading and Atlas cost at the provider – numbers per month/feature/model only. */
  aiUsage: AiUsageSchema.default(() => AiUsageSchema.parse({})),
  /** Connections to other programs (Einstellungen → Schnittstellen). */
  integrations: z.array(IntegrationSchema).default([]),
  localApi: LocalApiSettingsSchema.default(() => LocalApiSettingsSchema.parse({})),
  /** E-Mail module: own Brevo account. */
  email: EmailSettingsSchema.default(() => EmailSettingsSchema.parse({})),
  /** Der Alles-Check: how often it runs by itself while Ordo is open, and the counts of the last run. */
  allCheck: z
    .object({
      interval: z.enum(["daily", "weekly", "off"]).default("daily"),
      lastRunAt: z.string().optional(),
      lastErrors: z.number().int().default(0),
      lastWarnings: z.number().int().default(0),
    })
    .default(() => ({ interval: "daily" as const, lastErrors: 0, lastWarnings: 0 })),
  /** Small UI choices that should follow the user across devices. */
  ui: z
    .object({
      hideUpgrade: z.boolean().default(false),
      collapsedNav: z.array(z.string()).default([]),
    })
    .default(() => ({ hideUpgrade: false, collapsedNav: [] })),
  /** When each settings area last changed ("ai" → ISO time), set by VaultStore.mutate – sync keeps the newer one per area. */
  stamps: z.record(z.string(), z.string()).default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  at: isoDateTime,
  action: z.string(),
  entity: z.string(),
  entityId: z.string().optional(),
  details: z.string().default(""),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  profileId: z.string().optional(),
  kind: z.enum(["uva_deadline", "inbox", "recurring", "invoice_overdue", "info", "warning", "success"]),
  title: z.string(),
  body: z.string().default(""),
  dueDate: isoDate.optional(),
  createdAt: isoDateTime,
  readAt: isoDateTime.optional(),
  dismissedAt: isoDateTime.optional(),
  link: z.string().optional(),
  /** Stable key to avoid duplicates (e.g. "uva:2026-Q1"). */
  dedupeKey: z.string().optional(),
});
export type SummaNotification = z.infer<typeof NotificationSchema>;

/* ------------------------------------------------------------------ */
/* Bank statements (Kontoauszüge) & reconciliation                     */
/* ------------------------------------------------------------------ */

export const BankStatementSchema = z.object({
  ...base,
  profileId: z.string(),
  documentId: z.string(),
  /** Own account of this statement. */
  iban: z.string().default(""),
  accountName: z.string().default(""),
  bankName: z.string().default(""),
  from: isoDate.optional(),
  to: isoDate.optional(),
  openingBalanceCents: cents.optional(),
  closingBalanceCents: cents.optional(),
  lineCount: z.number().int().default(0),
  format: z.enum(["csv", "camt", "pdf", "ai", "manual"]).default("csv"),
  importedAt: isoDateTime,
  warnings: z.array(z.string()).default([]),
});
export type BankStatement = z.infer<typeof BankStatementSchema>;

export const BankLineStatusSchema = z.enum(["unmatched", "suggested", "matched", "booked", "ignored"]);
export type BankLineStatus = z.infer<typeof BankLineStatusSchema>;

export const BankLineSchema = z.object({
  ...base,
  profileId: z.string(),
  statementId: z.string(),
  date: isoDate,
  valueDate: isoDate.optional(),
  /** Signed: negative = Abbuchung, positive = Gutschrift */
  amountCents: cents,
  currency: z.string().default("EUR"),
  counterparty: z.string().default(""),
  counterpartyIban: z.string().default(""),
  purpose: z.string().default(""),
  reference: z.string().default(""),
  /** Stable fingerprint for de-duplication across overlapping statements. */
  hash: z.string(),
  status: BankLineStatusSchema.default("unmatched"),
  ignoreReason: z.string().optional(),
  matchedTransactionId: z.string().optional(),
  /** Suggested match before confirmation. */
  suggestedTransactionId: z.string().optional(),
  suggestionScore: z.number().optional(),
  balanceAfterCents: cents.optional(),
});
export type BankLine = z.infer<typeof BankLineSchema>;

/* ------------------------------------------------------------------ */
/* Vault document                                                      */
/* ------------------------------------------------------------------ */

export const VAULT_VERSION = 1;

export const VaultSchema = z.object({
  version: z.number().int().default(VAULT_VERSION),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  /** Monotonic revision for sync conflict detection. */
  revision: z.number().int().default(0),
  activeProfileId: z.string().optional(),
  profiles: z.array(ProfileSchema).default([]),
  contacts: z.array(ContactSchema).default([]),
  categories: z.array(CategorySchema).default([]),
  transactions: z.array(TransactionSchema).default([]),
  documents: z.array(DocumentSchema).default([]),
  attachments: z.array(AttachmentSchema).default([]),
  recurringRules: z.array(RecurringRuleSchema).default([]),
  assets: z.array(AssetSchema).default([]),
  invoices: z.array(InvoiceSchema).default([]),
  journalEntries: z.array(JournalEntrySchema).default([]),
  notifications: z.array(NotificationSchema).default([]),
  bankStatements: z.array(BankStatementSchema).default([]),
  bankLines: z.array(BankLineSchema).default([]),
  /* Ordo modules */
  members: z.array(MemberSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  tasks: z.array(TaskSchema).default([]),
  milestones: z.array(MilestoneSchema).default([]),
  timeEntries: z.array(TimeEntrySchema).default([]),
  offers: z.array(OfferSchema).default([]),
  products: z.array(ProductSchema).default([]),
  stockMoves: z.array(StockMoveSchema).default([]),
  workOrders: z.array(WorkOrderSchema).default([]),
  folders: z.array(FolderSchema).default([]),
  files: z.array(FileEntrySchema).default([]),
  atlasChats: z.array(AtlasChatSchema).default([]),
  settings: SettingsSchema.default(() => SettingsSchema.parse({})),
  auditLog: z.array(AuditEntrySchema).default([]),
});
export type Vault = z.infer<typeof VaultSchema>;

/** Every entity list in the vault – sync, merge, export and Atlas iterate over this. */
export const ENTITY_COLLECTIONS = [
  "profiles",
  "contacts",
  "categories",
  "transactions",
  "documents",
  "attachments",
  "recurringRules",
  "assets",
  "invoices",
  "journalEntries",
  "notifications",
  "bankStatements",
  "bankLines",
  "members",
  "projects",
  "tasks",
  "milestones",
  "timeEntries",
  "offers",
  "products",
  "stockMoves",
  "workOrders",
  "folders",
  "files",
  "atlasChats",
] as const;

export type EntityCollection = (typeof ENTITY_COLLECTIONS)[number];

export type EntityOf<C extends EntityCollection> = Vault[C][number];

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
