/**
 * What Ordo sends through the person's own Brevo account: invoices with the PDF, payment reminders, newsletters.
 * Always started by a click – never by Atlas or in the background.
 */
import { can, invoicePdf, invoiceTotals, nowIso, type Contact, type EmailSettings, type Invoice, type Profile, type Role, type Vault } from "@ordo/core";
import { requireStore } from "@/state/session";
import { fmtDate, fmtMoney } from "@/lib/format";
import { brevoEnsureList, brevoListEmails, brevoSend, brevoSendCampaign, brevoSyncList } from "./brevo";

/** One Brevo list per profile, so a private profile's contacts never get the firm's newsletter. */
export const newsletterListName = (p: Profile) => `Ordo Newsletter – ${p.company.name || p.name}`;

/** Role of the person on this device (owner when there is no team). */
function roleOf(v: Vault): Role {
  return v.members.find((m) => m.id === v.settings.meMemberId && !m.deletedAt)?.role ?? "owner";
}

/** Invoice mails and reminders: whoever may write in the bookkeeping. Newsletters: whoever may change the settings. */
export const canMailInvoices = (role: Role) => can(role, "summa", "write");
export const canSendNewsletter = (role: Role) => can(role, "settings", "write");

export function emailReady(e: EmailSettings): { ok: true } | { ok: false; message: string } {
  if (e.provider !== "brevo") return { ok: false, message: "E-Mail ist noch nicht verbunden – unter Einstellungen → E-Mail dein Brevo-Konto eintragen." };
  if (!e.brevoApiKey.trim()) return { ok: false, message: "Es fehlt der API-Schlüssel von Brevo (Einstellungen → E-Mail)." };
  if (!e.senderEmail.trim()) return { ok: false, message: "Es fehlt die Absender-Adresse (Einstellungen → E-Mail)." };
  return { ok: true };
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Fills {nummer} {kunde} {betrag} {faellig} {firma}. */
export function fillInvoiceText(template: string, inv: Invoice, profile: Profile): string {
  const t = invoiceTotals(inv);
  const values: Record<string, string> = {
    nummer: inv.number,
    kunde: inv.customerSnapshot.name,
    betrag: fmtMoney(inv.kind === "credit_note" ? -t.grossCents : t.grossCents),
    faellig: fmtDate(inv.dueDate),
    firma: profile.company.name || profile.name,
  };
  return template.replace(/\{(nummer|kunde|betrag|faellig|firma)\}/g, (_, k: string) => values[k] ?? "");
}

/** Where an invoice goes: the e-mail on the invoice, else the customer's. */
export function invoiceRecipient(inv: Invoice, contacts: Map<string, Contact>): string {
  return (inv.customerSnapshot.email || (inv.customerId ? contacts.get(inv.customerId)?.email : "") || "").trim();
}

/** Sends a finished invoice (or a payment reminder for it) with the PDF attached. */
export async function sendInvoiceMail(inv: Invoice, opts: { to: string; subject: string; text: string; reminder?: boolean }): Promise<void> {
  const store = requireStore();
  if (!canMailInvoices(roleOf(store.vault))) throw new Error("Rechnungen verschicken dürfen nur Personen, die in der Buchhaltung schreiben dürfen.");
  const settings = store.vault.settings.email;
  const ready = emailReady(settings);
  if (!ready.ok) throw new Error(ready.message);
  if (!isEmail(opts.to)) throw new Error("Bitte eine gültige E-Mail-Adresse für den Kunden eintragen.");
  if (inv.status === "draft") throw new Error("Nur fertiggestellte Rechnungen können verschickt werden.");
  const profile = store.vault.profiles.find((p) => p.id === inv.profileId) ?? store.activeProfile;
  let pdf = inv.pdfAttachmentId ? await store.getAttachmentBytes(inv.pdfAttachmentId) : null;
  if (!pdf) {
    const logo = profile.company.logoAttachmentId ? await store.getAttachmentBytes(profile.company.logoAttachmentId) : null;
    pdf = await invoicePdf(inv, profile, logo ?? undefined);
  }
  await brevoSend(
    settings.brevoApiKey,
    { name: settings.senderName || profile.company.name || profile.name, email: settings.senderEmail, replyTo: settings.replyTo || undefined },
    {
      to: [{ email: opts.to.trim(), name: inv.customerSnapshot.name || undefined }],
      bcc: settings.bccSelf ? [{ email: settings.senderEmail }] : undefined,
      subject: opts.subject,
      text: opts.text,
      attachments: [{ name: `${inv.number}.pdf`, bytes: pdf }],
    },
  );
  const now = nowIso();
  store.update("invoices", inv.id, opts.reminder ? { remindedAt: now, updatedAt: now } : { emailedAt: now, emailedTo: opts.to.trim(), updatedAt: now }, opts.reminder ? "invoice.remind" : "invoice.email");
}

/** Contacts who agreed to the newsletter and have an address. */
export function newsletterRecipients(contacts: Contact[]): Contact[] {
  return contacts.filter((c) => !c.deletedAt && c.active !== false && c.newsletter && isEmail(c.email));
}

/**
 * Rebuilds this profile's Brevo list from scratch – exactly the contacts who agreed, nobody else (also not people
 * who were on it before and have since withdrawn or been deleted) – and sends the newsletter to it.
 * Returns the number of recipients.
 */
export async function sendNewsletter(profileId: string, subject: string, text: string): Promise<number> {
  const store = requireStore();
  if (!canSendNewsletter(roleOf(store.vault))) throw new Error("Den Newsletter verschicken nur Inhaber:in oder Administration.");
  const settings = store.vault.settings.email;
  const ready = emailReady(settings);
  if (!ready.ok) throw new Error(ready.message);
  const profile = store.vault.profiles.find((p) => p.id === profileId) ?? store.activeProfile;
  const keep = newsletterRecipients(store.list("contacts", { profileId }));
  if (!keep.length) throw new Error("Noch niemand hat dem Newsletter zugestimmt – das hakst du beim Kontakt an.");
  const keepSet = new Set(keep.map((c) => c.email.trim().toLowerCase()));
  const listId = await brevoEnsureList(settings.brevoApiKey, newsletterListName(profile));
  const remove = (await brevoListEmails(settings.brevoApiKey, listId)).filter((e) => !keepSet.has(e.toLowerCase()));
  await brevoSyncList(settings.brevoApiKey, listId, keep.map((c) => ({ email: c.email.trim(), name: c.name })), remove);
  const c = profile.company;
  const imprint = [c.name || profile.name, [c.street, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  await brevoSendCampaign(settings.brevoApiKey, { name: settings.senderName || c.name || profile.name, email: settings.senderEmail, replyTo: settings.replyTo || undefined }, listId, subject, text, imprint);
  return keep.length;
}
