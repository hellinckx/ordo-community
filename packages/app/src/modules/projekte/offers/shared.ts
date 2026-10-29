/* Shared bits of the offer screens: labels, permissions, saving invoice drafts, PDF download. */
import { can, offerFileName, type Contact, type InvoiceDraft, type Offer, type OfferStatus, type Profile, type Project, type ProjectSettings } from "@ordo/core";
import { useMe, useIsInstalled } from "@/modules/registry";
import { requirePlatform, requireStore } from "@/state/session";
import { offerPdf } from "./offerPdf";

export const OFFER_STATUS: Record<OfferStatus, { label: string; tone: "neutral" | "success" | "warning" | "info" | "brand" }> = {
  draft: { label: "Entwurf", tone: "neutral" },
  sent: { label: "Versendet", tone: "brand" },
  accepted: { label: "Angenommen", tone: "success" },
  declined: { label: "Abgelehnt", tone: "neutral" },
  expired: { label: "Abgelaufen", tone: "warning" },
};

export const INVOICE_STATUS: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Entwurf", tone: "neutral" },
  sent: { label: "Gesendet", tone: "info" },
  paid: { label: "Bezahlt", tone: "success" },
  overdue: { label: "Überfällig", tone: "danger" },
  cancelled: { label: "Storniert", tone: "neutral" },
};

export const UNITS = ["Std", "Tag", "Stk", "pauschal", "m", "m²", "m³", "kg", "km", "Monat"];

export function useOfferRights() {
  const { role } = useMe();
  const summa = useIsInstalled("summa");
  return {
    canRead: can(role, "offers", "read"),
    canWrite: can(role, "offers", "write"),
    canDelete: can(role, "offers", "admin"),
    /** Ordo installed and allowed to write invoices. */
    canInvoice: summa && can(role, "summa", "write"),
    canSeeInvoices: summa && can(role, "summa", "read"),
    summaInstalled: summa,
  };
}

/**
 * Stores a Ordo invoice draft like Ordo's own editor does: insert, bump the invoice counter on the profile,
 * remember the invoice on the offer. Returns the new invoice id.
 */
export function saveInvoiceDraft(draft: InvoiceDraft, profileId: string, offerId?: string): string {
  const store = requireStore();
  const inv = draft.invoice;
  store.insert("invoices", inv, "invoice.create");
  store.update("profiles", profileId, (p) => ({ ...p, company: { ...p.company, nextInvoiceNumber: Math.max(p.company.nextInvoiceNumber + 1, draft.nextInvoiceNumber) } }));
  if (offerId) store.update("offers", offerId, (o) => ({ ...o, invoiceIds: o.invoiceIds.includes(inv.id) ? o.invoiceIds : [...o.invoiceIds, inv.id] }), "offer.invoice");
  return inv.id;
}

/** Builds the offer PDF (with logo) and lets the user save it. */
export async function downloadOfferPdf(offer: Offer, ctx: { profile: Profile; customer?: Contact; project?: Project; settings: ProjectSettings }): Promise<void> {
  const store = requireStore();
  let logo: Uint8Array | null = null;
  if (ctx.profile.company.logoAttachmentId) {
    try {
      logo = await store.getAttachmentBytes(ctx.profile.company.logoAttachmentId);
    } catch {
      logo = null;
    }
  }
  const bytes = await offerPdf({ offer, profile: ctx.profile, customer: ctx.customer, project: ctx.project, settings: ctx.settings, logo });
  await requirePlatform().saveFile(offerFileName(offer, ctx.customer?.name), bytes, "application/pdf");
}

/** "P-0012 · Halle 3" */
export function projectLabel(p: Pick<Project, "number" | "name"> | undefined): string {
  if (!p) return "";
  return [p.number, p.name].filter(Boolean).join(" · ");
}
