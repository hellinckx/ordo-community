import { z } from "zod";
import {
  InvoiceSchema,
  allocateInvoiceNumber,
  formatCents,
  ids,
  invoiceTotals,
  nowIso,
  type Contact,
  type Invoice,
  type InvoiceLine,
  type Offer,
  type Profile,
  type Project,
  type VatTreatment,
} from "@ordo/core";
import { AtlasToolError, defineTool, type AtlasTool, type AtlasToolContext } from "./tools";
import { resolveRecord, seen } from "./data";
import { zodIssues } from "./schema";
import { atLeast } from "./areas";
import type { ToolEnv } from "./tools-read";

/*
 * Outgoing invoices (Ordo "Rechnungen an Kunden"). Atlas may only write drafts – numbering like Ordo's own editor,
 * never send, finalise or touch sent/paid invoices. The person checks and sends the invoice in Ordo.
 */

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum als YYYY-MM-DD");

const LineInput = z.object({
  title: z.string().describe("Kurzbezeichnung der Leistung, z. B. Webdesign"),
  description: z.string().describe("Details zur Leistung (darf leer sein)"),
  quantity: z.number().describe("Menge, z. B. 12.5"),
  unit: z.string().describe("z. B. Std, Stk, pauschal"),
  unit_net_cents: z.number().int().describe("Einzelpreis netto in Cent"),
  vat_rate: z.literal([0, 10, 13, 20]).describe("USt-Satz in Prozent"),
});
type LineIn = z.infer<typeof LineInput>;

const PeriodInput = z.object({ start: ISO.describe("Erster Tag der Leistung"), end: ISO.describe("Letzter Tag der Leistung (bei einem Tag = start)") }).describe("Leistungszeitraum bzw. Leistungsdatum");

/** Gross above which the customer's UID must be on the invoice (§ 11 Abs. 1 Z 2 UStG). */
export const UID_LIMIT_CENTS = 1_000_000;
/** Small invoices up to this gross need fewer details (Kleinbetragsrechnung, § 11 Abs. 6 UStG). */
export const SMALL_INVOICE_CENTS = 40_000;

const eur = (c: number) => formatCents(c);

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

function periodText(p: { start: string; end: string }): string {
  return p.start === p.end ? shortDate(p.start) : `${shortDate(p.start)} – ${shortDate(p.end)}`;
}

function snapshotOf(c: Contact): Invoice["customerSnapshot"] {
  return { name: c.name, street: c.street, zip: c.zip, city: c.city, country: c.country || "AT", uid: c.uid, email: c.email };
}

/** Same rule as Ordo's own drafts: reverse charge from the offer, Kleinunternehmer from the profile, else standard. */
function treatmentFor(profile: Pick<Profile, "vatRegime">, offer?: Pick<Offer, "reverseCharge">): VatTreatment {
  if (offer?.reverseCharge) return "reverse_charge";
  if (profile.vatRegime === "kleinunternehmer") return "kleinunternehmer";
  return "standard";
}

function toLines(lines: LineIn[], treatment: VatTreatment): InvoiceLine[] {
  if (!lines.length) throw new AtlasToolError("Die Rechnung braucht mindestens eine Position.");
  return lines.map((l, i) => {
    if (!l.title.trim()) throw new AtlasToolError(`Position ${i + 1} hat keine Bezeichnung.`);
    if (!Number.isFinite(l.quantity) || l.quantity === 0) throw new AtlasToolError(`Position ${i + 1}: Menge darf nicht 0 sein.`);
    return {
      id: ids.line(),
      description: l.description.trim() ? `${l.title.trim()}\n${l.description.trim()}` : l.title.trim(),
      quantity: l.quantity,
      unit: l.unit.trim() || "Stk",
      unitNetCents: l.unit_net_cents,
      vatRate: treatment === "standard" ? l.vat_rate : 0,
      discountPct: 0,
    };
  });
}

function validInvoice(value: unknown): Invoice {
  const r = InvoiceSchema.safeParse(value);
  if (!r.success) throw new AtlasToolError(`Ungültige Rechnung: ${zodIssues(r.error)}`);
  return r.data;
}

const STATUS_REASON: Record<string, string> = {
  sent: "ist schon versendet",
  overdue: "ist schon versendet (und überfällig)",
  paid: "ist schon bezahlt",
  cancelled: "ist storniert",
};

/** Why a non-draft invoice cannot be changed by Atlas. */
export function lockedInvoiceReason(inv: Pick<Invoice, "number" | "status">): string | undefined {
  if (inv.status === "draft") return undefined;
  return `Rechnung ${inv.number} ${STATUS_REASON[inv.status] ?? `hat den Status ${inv.status}`}. Atlas ändert nur Entwürfe: Eine ausgestellte Rechnung muss so bleiben, wie der Kunde sie bekommen hat (§ 11 UStG, Aufbewahrungspflicht). Korrigieren geht in Ordo mit Storno und neuer Rechnung bzw. einer Gutschrift.`;
}

/* ------------------------------------------------------------------ */
/* § 11 UStG check                                                     */
/* ------------------------------------------------------------------ */

export interface InvoiceFinding {
  level: "fehler" | "hinweis" | "ok";
  text: string;
}

/**
 * Checks an invoice for the essentials of § 11 UStG (Austria). Not legal advice – catches the usual gaps: customer
 * name and address, customer UID above 10.000 € gross, own UID, service date, unique number, VAT per rate,
 * reverse-charge and Kleinunternehmer notes.
 */
export function checkInvoice(inv: Invoice, profile: Pick<Profile, "vatRegime" | "company" | "name">, others: Pick<Invoice, "id" | "number" | "deletedAt" | "profileId">[]): { ok: boolean; findings: InvoiceFinding[] } {
  const f: InvoiceFinding[] = [];
  const add = (level: InvoiceFinding["level"], text: string) => f.push({ level, text });
  const totals = invoiceTotals(inv);
  const gross = totals.grossCents;
  const small = Math.abs(gross) <= SMALL_INVOICE_CENTS;
  const cs = inv.customerSnapshot;
  const c = profile.company;
  const ku = profile.vatRegime === "kleinunternehmer";

  // number
  if (!inv.number.trim()) add("fehler", "Die Rechnungsnummer fehlt. Sie muss fortlaufend und eindeutig sein.");
  else if (others.some((o) => o.id !== inv.id && !o.deletedAt && o.profileId === inv.profileId && o.number.trim() === inv.number.trim())) add("fehler", `Die Rechnungsnummer ${inv.number} gibt es schon ein zweites Mal. Jede Nummer darf nur einmal vorkommen.`);
  else add("ok", `Rechnungsnummer ${inv.number} ist eindeutig.`);

  // own details
  if (!(c.name || profile.name) || !c.street || !(c.zip || c.city)) add("fehler", "Name oder Anschrift deines Unternehmens fehlen (Einstellungen → Firma).");
  if (!ku && !c.uid && !small) add("fehler", "Deine eigene UID-Nummer fehlt (Einstellungen → Firma). Über 400 € brutto muss sie auf der Rechnung stehen.");

  // customer
  const level = small ? "hinweis" : "fehler";
  if (!cs.name.trim()) add(level, small ? "Kein Kundenname – bei einer Kleinbetragsrechnung bis 400 € erlaubt, aber üblich." : "Der Name des Kunden fehlt.");
  else if (!cs.street.trim() || !(cs.zip.trim() || cs.city.trim())) add(level, small ? "Die Anschrift des Kunden ist unvollständig – bis 400 € brutto nicht nötig." : "Die Anschrift des Kunden ist unvollständig (Straße, PLZ, Ort).");
  else add("ok", `Kunde: ${cs.name}, ${[cs.street, [cs.zip, cs.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}.`);
  if (inv.vatTreatment === "reverse_charge") {
    if (!cs.uid.trim()) add("fehler", "Reverse Charge braucht die UID-Nummer des Kunden.");
    if (!c.uid) add("fehler", "Reverse Charge braucht auch deine eigene UID-Nummer.");
  } else if (Math.abs(gross) > UID_LIMIT_CENTS && !cs.uid.trim()) {
    add("fehler", `Über 10.000 € brutto (hier ${eur(gross)}) muss die UID-Nummer des Kunden auf der Rechnung stehen, wenn er ein Unternehmen ist.`);
  }

  // service date
  if (!inv.servicePeriod.trim() && !inv.servicePeriodStart && !inv.servicePeriodEnd) add("hinweis", `Kein Leistungsdatum oder -zeitraum. Auf der Rechnung steht dann das Rechnungsdatum (${shortDate(inv.issueDate)}) – passt nur, wenn die Leistung an diesem Tag erbracht wurde.`);
  else add("ok", `Leistungszeitraum: ${inv.servicePeriod || [inv.servicePeriodStart, inv.servicePeriodEnd].filter(Boolean).map((d) => shortDate(d!)).join(" – ")}.`);

  // lines
  if (!inv.lines.length) add("fehler", "Die Rechnung hat keine Positionen.");
  inv.lines.forEach((l, i) => {
    if (!l.description.trim()) add("fehler", `Position ${i + 1} hat keine Bezeichnung (Menge und Art der Leistung müssen erkennbar sein).`);
  });
  if (inv.kind === "invoice" && gross <= 0 && inv.lines.length) add("hinweis", "Der Rechnungsbetrag ist 0 oder negativ – für eine Korrektur nimm in Ordo eine Gutschrift.");

  // VAT
  if (inv.vatTreatment === "standard") {
    if (ku) add("fehler", "Du bist als Kleinunternehmer eingestellt, die Rechnung weist aber Umsatzsteuer aus. Wer USt ausweist, schuldet sie auch.");
    const zero = inv.lines.filter((l) => l.vatRate === 0);
    if (zero.length) add("hinweis", `${zero.length === 1 ? "Eine Position hat" : `${zero.length} Positionen haben`} 0 % USt. Bei Regelbesteuerung braucht das einen Grund (steuerfrei) – sonst 20, 13 oder 10 % wählen.`);
    const rates = totals.byRate.filter((r) => r.netCents !== 0);
    if (rates.length) add("ok", `USt je Satz ausgewiesen: ${rates.map((r) => `${r.rate} % auf ${eur(r.netCents)} = ${eur(r.vatCents)}`).join("; ")}.`);
    if (cs.country && cs.country !== "AT" && cs.uid.trim()) add("hinweis", `Kunde im Ausland (${cs.country}) mit UID – prüfe, ob Reverse Charge gilt (dann ohne USt mit Hinweis).`);
  } else if (inv.vatTreatment === "kleinunternehmer") {
    if (!ku) add("fehler", "Die Rechnung ist als Kleinunternehmer-Rechnung markiert, dein Profil ist aber regelbesteuert.");
    else add("ok", "Kleinunternehmer: ohne USt; den Hinweis „Umsatzsteuerbefreit gemäß § 6 Abs. 1 Z 27 UStG“ druckt Ordo automatisch auf die Rechnung.");
  } else if (inv.vatTreatment === "reverse_charge") {
    add("ok", "Reverse Charge: ohne USt; den Hinweis auf den Übergang der Steuerschuld druckt Ordo automatisch auf die Rechnung.");
  }

  if (inv.dueDate < inv.issueDate) add("hinweis", "Das Fälligkeitsdatum liegt vor dem Rechnungsdatum.");
  if (inv.status === "draft") add("hinweis", "Die Rechnung ist ein Entwurf. Prüfen und versenden kannst du sie in Ordo unter Rechnungen.");

  return { ok: !f.some((x) => x.level === "fehler"), findings: f };
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

function profileNow(ctx: AtlasToolContext): Profile {
  return ctx.store.vault.profiles.find((p) => p.id === ctx.profileId) ?? ctx.profile;
}

function linesPreview(lines: LineIn[]): string {
  const net = lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_net_cents), 0);
  return `${lines.length} Position${lines.length === 1 ? "" : "en"}, ${eur(net)} netto`;
}

function checkFor(ctx: AtlasToolContext, inv: Invoice) {
  return checkInvoice(inv, profileNow(ctx), ctx.store.vault.invoices);
}

function totalsData(inv: Invoice) {
  const t = invoiceTotals(inv);
  return { netCents: t.netCents, net_eur: eur(t.netCents), vatCents: t.vatCents, vat_eur: eur(t.vatCents), grossCents: t.grossCents, gross_eur: eur(t.grossCents), byRate: t.byRate.map((r) => ({ rate: r.rate, net_eur: eur(r.netCents), vat_eur: eur(r.vatCents) })) };
}

function findInvoice(env: ToolEnv, ctx: AtlasToolContext, ref: string): Invoice {
  return resolveRecord(ctx.store.vault, seen(env, "invoices"), ctx.profileId, ref) as unknown as Invoice;
}

/** Draft tools – only when outgoing invoices are on "Lesen & ändern" and the role may write in Ordo. */
export function invoiceWriteTools(env: ToolEnv, can: AtlasToolContext["can"]): AtlasTool[] {
  if (!env.modules.includes("summa") || !env.defs.some((d) => d.id === "invoices")) return [];
  const tools: AtlasTool[] = [];

  if (atLeast(env.level("outgoing"), "write") && can("summa", "write")) {
    tools.push(
      defineTool({
        name: "create_invoice_draft",
        description:
          "Legt eine Rechnung an einen Kunden als ENTWURF in Ordo an – Nummer, Fälligkeit, Texte und USt-Behandlung (Regelbesteuerung, Kleinunternehmer, Reverse Charge aus dem Angebot) setzt Ordo wie Ordo selbst. Positionen mit Menge, Einheit, Einzelpreis netto in Cent und USt-Satz. Atlas versendet nie: Die Person prüft den Entwurf und versendet ihn in Ordo. Das Ergebnis enthält gleich die Prüfung nach § 11 UStG.",
        input: z.object({
          customer: z.string().describe("Kunde: id oder Name aus den Kontakten"),
          lines: z.array(LineInput).describe("Positionen der Rechnung"),
          project: z.string().optional().describe("Projekt: id, Nummer oder Name"),
          offer: z.string().optional().describe("Angebot, auf dem die Rechnung beruht: id oder Nummer"),
          service_period: PeriodInput.optional(),
          due_date: ISO.optional().describe("Fällig am, YYYY-MM-DD (Standard: Zahlungsziel des Kunden, sonst 14 Tage)"),
        }),
        kind: "write",
        area: "summa",
        atlasArea: "outgoing",
        reads: ["contacts"],
        preview: (i, ctx) => {
          let name = i.customer;
          try {
            name = String(resolveRecord(ctx.store.vault, seen(env, "contacts"), ctx.profileId, i.customer).name);
          } catch {
            /* as entered */
          }
          return `Rechnungsentwurf an „${name}“ anlegen (${linesPreview(i.lines)})`;
        },
        run(i, ctx) {
          const v = ctx.store.vault;
          const profile = profileNow(ctx);
          const customer = resolveRecord(v, seen(env, "contacts"), ctx.profileId, i.customer) as unknown as Contact;
          const offer = i.offer ? (resolveRecord(v, seen(env, "offers"), ctx.profileId, i.offer) as unknown as Offer) : undefined;
          const project = i.project ? (resolveRecord(v, seen(env, "projects"), ctx.profileId, i.project) as unknown as Project) : undefined;
          if (i.service_period && i.service_period.end < i.service_period.start) throw new AtlasToolError("Der Leistungszeitraum endet vor seinem Beginn.");
          const treatment = treatmentFor(profile, offer);
          const issue = ctx.today;
          const used = v.invoices.filter((x) => x.profileId === ctx.profileId).map((x) => x.number);
          const { number, next } = allocateInvoiceNumber(profile.company, issue, used);
          const now = nowIso();
          const projectId = project?.id ?? offer?.projectId;
          const proj = projectId ? v.projects.find((p) => p.id === projectId) : undefined;
          const inv = validInvoice({
            id: ids.invoice(),
            profileId: ctx.profileId,
            number,
            kind: "invoice",
            customerId: customer.id,
            customerSnapshot: snapshotOf(customer),
            issueDate: issue,
            dueDate: i.due_date ?? addDays(issue, Math.max(0, customer.paymentDueDays ?? offer?.paymentDueDays ?? 14)),
            servicePeriod: i.service_period ? periodText(i.service_period) : "",
            ...(i.service_period ? { servicePeriodStart: i.service_period.start, servicePeriodEnd: i.service_period.end } : {}),
            lines: toLines(i.lines, treatment),
            introText: "Vielen Dank für Ihren Auftrag. Wir erlauben uns, folgende Leistungen in Rechnung zu stellen:",
            footerText: profile.company.invoiceFooter ?? "",
            status: "draft",
            paidCents: 0,
            vatTreatment: treatment,
            reference: [proj?.number ? `Projekt ${proj.number}` : "", offer ? `Angebot ${offer.number}` : ""].filter(Boolean).join(" · "),
            ...(projectId ? { projectId } : {}),
            ...(offer ? { offerId: offer.id } : {}),
            createdAt: now,
            updatedAt: now,
          });
          // stored like Ordo's own drafts (offers/shared.ts saveInvoiceDraft): insert, bump the counter, link the offer
          ctx.store.insert("invoices", inv, "atlas.create_invoice_draft");
          ctx.store.update("profiles", ctx.profileId, (p) => ({ ...p, company: { ...p.company, nextInvoiceNumber: Math.max(p.company.nextInvoiceNumber + 1, next) } }));
          if (offer && atLeast(env.level("offers"), "write") && can("offers", "write") && !offer.invoiceIds.includes(inv.id)) {
            ctx.store.update("offers", offer.id, (o) => ({ ...o, invoiceIds: o.invoiceIds.includes(inv.id) ? o.invoiceIds : [...o.invoiceIds, inv.id] }), "atlas.offer_invoice");
          }
          const check = checkFor(ctx, inv);
          return {
            summary: `Rechnungsentwurf ${inv.number} an „${customer.name}“ angelegt (${eur(invoiceTotals(inv).grossCents)} brutto)`,
            data: {
              created: true,
              id: inv.id,
              number: inv.number,
              status: "draft",
              vatTreatment: inv.vatTreatment,
              dueDate: inv.dueDate,
              totals: totalsData(inv),
              check,
              note: "Nur ein Entwurf. Die Person prüft ihn und versendet ihn in Ordo – Atlas versendet keine Rechnungen.",
            },
            link: { to: `/rechnungen/${inv.id}`, label: `Rechnung ${inv.number} öffnen` },
          };
        },
      }),
      defineTool({
        name: "update_invoice_draft",
        description:
          "Ändert einen Rechnungsentwurf (nur Status Entwurf): Kunde, Positionen (ersetzt alle), Leistungszeitraum, Fälligkeit. Versendete, bezahlte oder stornierte Rechnungen ändert Atlas nie – die korrigiert die Person in Ordo mit Storno bzw. Gutschrift. Status und Versand ändert Atlas nicht.",
        input: z.object({
          invoice: z.string().describe("Rechnung: id oder Nummer"),
          customer: z.string().optional().describe("Neuer Kunde: id oder Name"),
          lines: z.array(LineInput).optional().describe("Neue Positionen – ersetzen alle bisherigen"),
          service_period: PeriodInput.optional(),
          due_date: ISO.optional().describe("Neues Fälligkeitsdatum, YYYY-MM-DD"),
        }),
        kind: "write",
        area: "summa",
        atlasArea: "outgoing",
        preview: (i, ctx) => {
          let label = i.invoice;
          try {
            label = findInvoice(env, ctx, i.invoice).number;
          } catch {
            /* as entered */
          }
          const what = [i.customer ? "Kunde" : "", i.lines ? linesPreview(i.lines) : "", i.service_period ? "Leistungszeitraum" : "", i.due_date ? "Fälligkeit" : ""].filter(Boolean).join(", ");
          return `Rechnungsentwurf ${label} ändern${what ? ` (${what})` : ""}`;
        },
        run(i, ctx) {
          const v = ctx.store.vault;
          const existing = findInvoice(env, ctx, i.invoice);
          const locked = lockedInvoiceReason(existing);
          if (locked) throw new AtlasToolError(locked);
          if (existing.transactionId) throw new AtlasToolError(`Rechnung ${existing.number} ist schon gebucht. Ändere sie bitte in Ordo.`);
          if (!i.customer && !i.lines && !i.service_period && !i.due_date) throw new AtlasToolError("Es ist nichts zu ändern – gib customer, lines, service_period oder due_date an.");
          if (i.service_period && i.service_period.end < i.service_period.start) throw new AtlasToolError("Der Leistungszeitraum endet vor seinem Beginn.");
          const patch: Partial<Invoice> = {};
          const changed: string[] = [];
          if (i.customer) {
            const c = resolveRecord(v, seen(env, "contacts"), ctx.profileId, i.customer) as unknown as Contact;
            patch.customerId = c.id;
            patch.customerSnapshot = snapshotOf(c);
            changed.push("Kunde");
          }
          if (i.lines) {
            patch.lines = toLines(i.lines, existing.vatTreatment);
            changed.push("Positionen");
          }
          if (i.service_period) {
            patch.servicePeriod = periodText(i.service_period);
            patch.servicePeriodStart = i.service_period.start;
            patch.servicePeriodEnd = i.service_period.end;
            changed.push("Leistungszeitraum");
          }
          if (i.due_date) {
            patch.dueDate = i.due_date;
            changed.push("Fälligkeit");
          }
          const next = validInvoice({ ...existing, ...patch, status: "draft", updatedAt: nowIso() });
          ctx.store.update("invoices", existing.id, () => next, "atlas.update_invoice_draft");
          const check = checkFor(ctx, next);
          return {
            summary: `Rechnungsentwurf ${next.number} geändert (${changed.join(", ")})`,
            data: { updated: true, id: next.id, number: next.number, status: "draft", changed, totals: totalsData(next), check },
            link: { to: `/rechnungen/${next.id}`, label: `Rechnung ${next.number} öffnen` },
          };
        },
      }),
    );
  }
  return tools;
}

/** check_invoice – whenever outgoing invoices are visible to Atlas. */
export function invoiceReadTools(env: ToolEnv): AtlasTool[] {
  if (!env.modules.includes("summa") || !env.defs.some((d) => d.id === "invoices")) return [];
  return [
    defineTool({
      name: "check_invoice",
      description:
        "Prüft eine Rechnung an einen Kunden (Entwurf oder ausgestellt) auf die Pflichtangaben nach § 11 UStG: Name und Anschrift des Kunden, UID des Kunden über 10.000 € brutto, eigene UID, Leistungsdatum/-zeitraum, eindeutige fortlaufende Nummer, USt je Steuersatz, Hinweis bei Reverse Charge oder Kleinunternehmer. Liefert Befunde (fehler, hinweis, ok).",
      input: z.object({ invoice: z.string().describe("Rechnung: id oder Nummer") }),
      kind: "read",
      area: "summa",
      atlasArea: "outgoing",
      run(i, ctx) {
        const inv = findInvoice(env, ctx, i.invoice);
        const check = checkFor(ctx, inv);
        const errors = check.findings.filter((x) => x.level === "fehler").length;
        const hints = check.findings.filter((x) => x.level === "hinweis").length;
        return {
          summary: `Rechnung ${inv.number} geprüft: ${errors ? `${errors} Fehler` : "keine Fehler"}${hints ? `, ${hints} Hinweis${hints === 1 ? "" : "e"}` : ""}`,
          data: { id: inv.id, number: inv.number, status: inv.status, totals: totalsData(inv), ...check, note: "Prüfung der üblichen Pflichtangaben – keine Steuerberatung." },
          link: { to: `/rechnungen/${inv.id}`, label: `Rechnung ${inv.number} öffnen` },
        };
      },
    }),
  ];
}
