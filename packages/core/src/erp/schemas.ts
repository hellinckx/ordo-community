import { z } from "zod";
import { baseEntity as base, cents, isoDate, isoDateTime, legacyRef, vatRate } from "../model/primitives";

/* ================================================================== */
/* Team & roles (Ordo Basis)                                           */
/* ================================================================== */

/**
 * Roles from most to least rights. Owner = whoever created the workspace. The matrix in erp/permissions.ts
 * decides what each role may see and change per module; Atlas never has more rights than the person using it.
 */
export const RoleSchema = z.enum(["owner", "admin", "manager", "member", "viewer"]);
export type Role = z.infer<typeof RoleSchema>;

export const MemberSchema = z.object({
  ...base,
  name: z.string(),
  email: z.string().default(""),
  role: RoleSchema.default("member"),
  /** Job title, e.g. "Projektleitung", "Werkstatt". */
  title: z.string().default(""),
  /** Internal cost per hour (wage + overhead) – used for project costs and margins. */
  hourlyCostCents: cents.default(0),
  /** Default sales rate per hour – used when time is billed. */
  hourlyRateCents: cents.default(0),
  weeklyHours: z.number().default(38.5),
  color: z.string().default("#0a5fe0"),
  active: z.boolean().default(true),
  phone: z.string().default(""),
  notes: z.string().default(""),
  /** Profile picture (square, small) – an attachment in the vault. */
  avatarAttachmentId: z.string().optional(),
  legacyRef,
});
export type Member = z.infer<typeof MemberSchema>;

/* ================================================================== */
/* Projects                                                            */
/* ================================================================== */

export const ProjectStatusSchema = z.enum(["planning", "active", "on_hold", "completed", "cancelled"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  ...base,
  profileId: z.string(),
  /** Human number, e.g. "P-0012". */
  number: z.string().default(""),
  name: z.string(),
  customerId: z.string().optional(),
  description: z.string().default(""),
  status: ProjectStatusSchema.default("planning"),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  /** Agreed project sum, net. */
  budgetCents: cents.default(0),
  /** Planned effort in hours (optional, for burn-down). */
  budgetHours: z.number().default(0),
  /** fixed = agreed sum, hourly = billed by time, internal = not billed. */
  billing: z.enum(["fixed", "hourly", "internal"]).default("fixed"),
  hourlyRateCents: cents.default(0),
  managerId: z.string().optional(),
  memberIds: z.array(z.string()).default([]),
  /** Productive hours per working day, used by the automatic schedule. */
  hoursPerDay: z.number().min(0.5).max(24).default(6),
  color: z.string().default("#0a5fe0"),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(""),
  completedAt: isoDateTime.optional(),
  legacyRef,
});
export type Project = z.infer<typeof ProjectSchema>;

export const TaskStatusSchema = z.enum(["todo", "in_progress", "review", "done", "blocked"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export const PrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type Priority = z.infer<typeof PrioritySchema>;

/** A task; tasks with children are work packages (Arbeitspakete). */
export const TaskSchema = z.object({
  ...base,
  profileId: z.string(),
  projectId: z.string(),
  parentId: z.string().optional(),
  /** Order among siblings. */
  order: z.number().default(0),
  title: z.string(),
  description: z.string().default(""),
  status: TaskStatusSchema.default("todo"),
  priority: PrioritySchema.default("medium"),
  estimateHours: z.number().default(0),
  startDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  assigneeIds: z.array(z.string()).default([]),
  milestoneId: z.string().optional(),
  completedAt: isoDateTime.optional(),
  legacyRef,
});
export type Task = z.infer<typeof TaskSchema>;

export const MilestoneSchema = z.object({
  ...base,
  profileId: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().default(""),
  dueDate: isoDate.optional(),
  status: z.enum(["open", "done"]).default("open"),
  completedAt: isoDateTime.optional(),
  /** Tasks that must be done for this milestone. */
  taskIds: z.array(z.string()).default([]),
  /** Optional partial invoice when reached (net). */
  invoiceAmountCents: cents.optional(),
  legacyRef,
});
export type Milestone = z.infer<typeof MilestoneSchema>;

export const TimeEntrySchema = z.object({
  ...base,
  profileId: z.string(),
  projectId: z.string(),
  taskId: z.string().optional(),
  memberId: z.string().optional(),
  date: isoDate,
  /** Signed: correction entries may be negative. */
  minutes: z.number().int(),
  description: z.string().default(""),
  billable: z.boolean().default(true),
  /** Timer start/stop when recorded live. */
  startedAt: isoDateTime.optional(),
  endedAt: isoDateTime.optional(),
  /** Snapshot of rates at booking time. */
  rateCents: cents.optional(),
  costCents: cents.optional(),
  /** Set once the time was put on an invoice. */
  invoiceId: z.string().optional(),
  legacyRef,
});
export type TimeEntry = z.infer<typeof TimeEntrySchema>;

/** A running stopwatch (one per member). Lives in settings so it survives reloads and syncs. */
export const RunningTimerSchema = z.object({
  memberId: z.string().optional(),
  projectId: z.string(),
  taskId: z.string().optional(),
  description: z.string().default(""),
  startedAt: isoDateTime,
});
export type RunningTimer = z.infer<typeof RunningTimerSchema>;

/* ================================================================== */
/* Sales: offers (Angebote)                                            */
/* ================================================================== */

export const OfferLineSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  description: z.string().default(""),
  quantity: z.number().default(1),
  unit: z.string().default("Std"),
  unitNetCents: cents.default(0),
  vatRate: vatRate.default(20),
  productId: z.string().optional(),
  /** Optional item, shown but not added to the total. */
  optional: z.boolean().default(false),
});
export type OfferLine = z.infer<typeof OfferLineSchema>;

export const OfferStatusSchema = z.enum(["draft", "sent", "accepted", "declined", "expired"]);
export type OfferStatus = z.infer<typeof OfferStatusSchema>;

export const OfferSchema = z.object({
  ...base,
  profileId: z.string(),
  number: z.string(),
  customerId: z.string().optional(),
  projectId: z.string().optional(),
  date: isoDate,
  validUntil: isoDate.optional(),
  status: OfferStatusSchema.default("draft"),
  subject: z.string().default(""),
  /** e.g. "Werkvertrag". */
  contractTitle: z.string().default(""),
  /** Text blocks printed on the PDF. */
  introText: z.string().default(""),
  scopeText: z.string().default(""),
  completionText: z.string().default(""),
  paymentTermsText: z.string().default(""),
  paymentDueDays: z.number().int().default(14),
  downpaymentPct: z.number().default(0),
  finalPaymentPct: z.number().default(100),
  discountPct: z.number().default(0),
  discountText: z.string().default(""),
  reverseCharge: z.boolean().default(false),
  internalNote: z.string().default(""),
  lines: z.array(OfferLineSchema).default([]),
  /** Invoices created from this offer. */
  invoiceIds: z.array(z.string()).default([]),
  sentAt: isoDateTime.optional(),
  decidedAt: isoDateTime.optional(),
  legacyRef,
});
export type Offer = z.infer<typeof OfferSchema>;

/* ================================================================== */
/* Products & stock                                                    */
/* ================================================================== */

export const ProductKindSchema = z.enum(["service", "product", "material"]);
export type ProductKind = z.infer<typeof ProductKindSchema>;

export const BomComponentSchema = z.object({
  productId: z.string(),
  quantity: z.number(),
});
export const OperationSchema = z.object({
  id: z.string(),
  name: z.string(),
  minutes: z.number().default(0),
  workCenter: z.string().default(""),
});

export const ProductSchema = z.object({
  ...base,
  profileId: z.string(),
  sku: z.string().default(""),
  name: z.string(),
  description: z.string().default(""),
  kind: ProductKindSchema.default("product"),
  unit: z.string().default("Stk"),
  /** Sales price, net. */
  priceCents: cents.default(0),
  vatRate: vatRate.default(20),
  /** Purchase / production cost, net. */
  costCents: cents.default(0),
  category: z.string().default(""),
  supplierId: z.string().optional(),
  trackStock: z.boolean().default(true),
  minStock: z.number().default(0),
  location: z.string().default(""),
  barcode: z.string().default(""),
  active: z.boolean().default(true),
  /** Bill of materials – what one unit is made of (Produktion). */
  components: z.array(BomComponentSchema).default([]),
  /** Work steps to make one unit (Produktion). */
  operations: z.array(OperationSchema).default([]),
  legacyRef,
});
export type Product = z.infer<typeof ProductSchema>;

export const StockMoveKindSchema = z.enum(["receipt", "issue", "adjustment", "sale", "production_in", "production_out", "count"]);
export type StockMoveKind = z.infer<typeof StockMoveKindSchema>;

export const StockMoveSchema = z.object({
  ...base,
  profileId: z.string(),
  productId: z.string(),
  date: isoDate,
  /** Signed quantity: + into stock, − out of stock. */
  quantity: z.number(),
  kind: StockMoveKindSchema,
  /** Unit cost at the time of the movement, net. */
  unitCostCents: cents.optional(),
  note: z.string().default(""),
  workOrderId: z.string().optional(),
  invoiceId: z.string().optional(),
  contactId: z.string().optional(),
});
export type StockMove = z.infer<typeof StockMoveSchema>;

/* ================================================================== */
/* Production                                                          */
/* ================================================================== */

export const WorkOrderStatusSchema = z.enum(["planned", "released", "in_progress", "done", "cancelled"]);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;

export const WorkOrderStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  plannedMinutes: z.number().default(0),
  actualMinutes: z.number().default(0),
  workCenter: z.string().default(""),
  memberId: z.string().optional(),
  done: z.boolean().default(false),
  doneAt: isoDateTime.optional(),
});
export type WorkOrderStep = z.infer<typeof WorkOrderStepSchema>;

export const WorkOrderSchema = z.object({
  ...base,
  profileId: z.string(),
  number: z.string(),
  productId: z.string(),
  quantity: z.number().default(1),
  status: WorkOrderStatusSchema.default("planned"),
  priority: PrioritySchema.default("medium"),
  plannedStart: isoDate.optional(),
  dueDate: isoDate.optional(),
  customerId: z.string().optional(),
  projectId: z.string().optional(),
  assigneeIds: z.array(z.string()).default([]),
  steps: z.array(WorkOrderStepSchema).default([]),
  /** Materials taken from stock / finished goods put into stock. */
  materialsBooked: z.boolean().default(false),
  outputBooked: z.boolean().default(false),
  notes: z.string().default(""),
  startedAt: isoDateTime.optional(),
  completedAt: isoDateTime.optional(),
});
export type WorkOrder = z.infer<typeof WorkOrderSchema>;

/* ================================================================== */
/* Files (Dateiablage, Ordo Basis)                                     */
/* ================================================================== */

export const FolderSchema = z.object({
  ...base,
  profileId: z.string(),
  parentId: z.string().optional(),
  name: z.string(),
  /** Created by Ordo (per customer/project) – cannot be deleted by hand. */
  system: z.boolean().default(false),
  /** Folder that belongs to a record, e.g. { type: "project", id }. */
  owner: z.object({ type: z.string(), id: z.string() }).optional(),
  legacyRef,
});
export type Folder = z.infer<typeof FolderSchema>;

export const EntityLinkSchema = z.object({
  type: z.enum(["contact", "project", "task", "offer", "invoice", "product", "workOrder", "transaction", "member"]),
  id: z.string(),
});
export type EntityLink = z.infer<typeof EntityLinkSchema>;

export const FileEntrySchema = z.object({
  ...base,
  profileId: z.string(),
  folderId: z.string().optional(),
  attachmentId: z.string(),
  name: z.string(),
  mime: z.string().default("application/octet-stream"),
  size: z.number().default(0),
  tags: z.array(z.string()).default([]),
  links: z.array(EntityLinkSchema).default([]),
  note: z.string().default(""),
  legacyRef,
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

/* ================================================================== */
/* Atlas – the AI assistant                                            */
/* ================================================================== */

/** Provider-neutral transcript entry; the provider adapters translate to their own formats. */
export const AtlasMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "tool"]),
  text: z.string().default(""),
  at: isoDateTime,
  /** Tool calls the assistant made in this turn. */
  toolCalls: z
    .array(z.object({ id: z.string(), name: z.string(), input: z.unknown(), status: z.enum(["done", "denied", "error", "pending"]).default("done"), summary: z.string().default("") }))
    .default([]),
  /** For role "tool": result of a call. */
  toolCallId: z.string().optional(),
  /** Charts and tables Atlas rendered inline. */
  visuals: z.array(z.unknown()).default([]),
  model: z.string().optional(),
  /** Provider-specific raw content needed to continue the conversation (e.g. thinking blocks). */
  raw: z.unknown().optional(),
});
export type AtlasMessage = z.infer<typeof AtlasMessageSchema>;

export const AtlasChatSchema = z.object({
  ...base,
  title: z.string().default("Neues Gespräch"),
  profileId: z.string().optional(),
  messages: z.array(AtlasMessageSchema).default([]),
  pinned: z.boolean().default(false),
});
export type AtlasChat = z.infer<typeof AtlasChatSchema>;

/* ================================================================== */
/* Settings parts                                                      */
/* ================================================================== */

export const ModuleStateSchema = z.object({
  installed: z.boolean(),
  installedAt: isoDateTime.optional(),
});
export type ModuleState = z.infer<typeof ModuleStateSchema>;

export const AtlasSettingsSchema = z.object({
  provider: z.enum(["none", "claude", "codex"]).default("none"),
  /** "auto" picks effort/model per request; otherwise a fixed model id. */
  model: z.string().default("auto"),
  /** read = only looks, confirm = asks before every change, auto = changes on its own. */
  permission: z.enum(["read", "confirm", "auto"]).default("confirm"),
  /** Allow Atlas to send the workspace data it reads to the AI provider. */
  consent: z.boolean().default(false),
  /** Custom instructions ("Antworte immer kurz"). */
  instructions: z.string().default(""),
  codexModel: z.string().default(""),
  /**
   * Access per Atlas area (see `ATLAS_AREAS` in the app): none = invisible, read = look only, write = may change.
   * A missing key means the area's default ("write", except outgoing invoices and team = "read").
   */
  areas: z.record(z.string(), z.enum(["none", "read", "write"])).default({}),
});
export type AtlasSettings = z.infer<typeof AtlasSettingsSchema>;

export const ProjectSettingsSchema = z.object({
  projectNumberPattern: z.string().default("P-{NNNN}"),
  nextProjectNumber: z.number().int().default(1),
  offerNumberPattern: z.string().default("AN-{YYYY}-{NNNN}"),
  nextOfferNumber: z.number().int().default(1),
  offerValidDays: z.number().int().default(30),
  defaultHoursPerDay: z.number().default(6),
  defaultHourlyRateCents: cents.default(0),
  contractTitle: z.string().default("Werkvertrag"),
  offerIntroText: z.string().default("Vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen folgende Leistungen an:"),
  offerScopeText: z.string().default(""),
  offerCompletionText: z.string().default(""),
  offerPaymentTermsText: z.string().default(""),
  offerFooterText: z.string().default(""),
  downpaymentPct: z.number().default(30),
  workOrderNumberPattern: z.string().default("FA-{YYYY}-{NNNN}"),
  nextWorkOrderNumber: z.number().int().default(1),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
