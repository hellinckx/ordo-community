/**
 * Der Alles-Check: fixed rules over the bookkeeping of one profile – no AI, so it is free, fast and gives the same
 * answer every time. "error" = not right as it stands (e.g. an expense without an invoice: no input VAT, not
 * deductible), "warning" = needs a look, "info" = good to know. Every finding links to where it is fixed.
 */
import type { BankLine, Category, Contact, Invoice, Profile, SummaDocument, Transaction, Vault } from "../model/types";
import type { Project } from "../erp/schemas";
import { invoiceTotals } from "../analytics/stats";
import { reconcileStats } from "../bank/reconcile";

export type CheckLevel = "error" | "warning" | "info";

export interface CheckFinding {
  /** Stable key (rule + record), so a finding can be recognised again. */
  id: string;
  level: CheckLevel;
  area: "buchungen" | "rechnungen" | "bank" | "eingang" | "projekte";
  title: string;
  detail: string;
  link?: string;
  /** Records the finding is about (transaction, invoice …). */
  ids?: string[];
}

export interface CheckResult {
  at: string;
  findings: CheckFinding[];
  errors: number;
  warnings: number;
}

/**
 * Expense categories that need no invoice of their own: the proof is a statement, a payslip, a calculation or a
 * notice (SVS, Finanzamt), or it is private anyway.
 */
export const NO_INVOICE_NEEDED = new Set([
  "cat_b_ex_personal",
  "cat_b_ex_afa",
  "cat_b_ex_trinkgeld",
  "cat_b_ex_km",
  "cat_b_ex_arbeitsplatz",
  "cat_b_ex_svs",
  "cat_b_ex_bank",
  "cat_b_ex_zinsen",
  "cat_b_ex_steuern",
  "cat_b_ex_privat",
]);

const eur = (c: number) => (c / 100).toLocaleString("de-AT", { style: "currency", currency: "EUR" });
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const label = (t: Transaction, cats: Map<string, Category>, contacts: Map<string, Contact>) =>
  `${t.description || cats.get(t.categoryId ?? "")?.name || "Buchung"}${t.contactId && contacts.get(t.contactId) ? ` (${contacts.get(t.contactId)!.name})` : ""}, ${dmy(t.date)}, ${eur(Math.abs(t.grossCents))}`;

/** Does this transaction need an invoice or receipt it does not have? */
export function missingReceipt(t: Transaction, profile: Pick<Profile, "mode">, cat?: Category): boolean {
  if (t.deletedAt || t.kind !== "expense" || t.documentIds.length || t.invoiceId) return false;
  if (t.origin === "afa" || t.origin === "recurring") return false;
  if (t.categoryId && NO_INVOICE_NEEDED.has(t.categoryId)) return false;
  // private profiles: only what goes into the Arbeitnehmerveranlagung needs proof
  if (profile.mode === "employee") return !!cat?.l1Kz;
  return true;
}

/** Which parts the caller may see (Atlas with locked areas, roles). Missing = everything. */
export interface CheckScope {
  bookings?: boolean;
  outgoing?: boolean;
  incoming?: boolean;
  bank?: boolean;
  projects?: boolean;
  /** Names of customers and suppliers in the details. */
  contacts?: boolean;
}

/** Runs every rule for one profile. `today` as YYYY-MM-DD. */
export function runAllCheck(v: Vault, profileId: string, today: string, scope: CheckScope = {}): CheckResult {
  const see = (k: keyof CheckScope) => scope[k] !== false;
  const profile = v.profiles.find((p) => p.id === profileId);
  const findings: CheckFinding[] = [];
  if (!profile) return { at: new Date().toISOString(), findings, errors: 0, warnings: 0 };
  const business = profile.mode === "business";
  const txs = v.transactions.filter((t) => !t.deletedAt && t.profileId === profileId);
  const cats = new Map(v.categories.map((c) => [c.id, c]));
  const contacts = new Map(see("contacts") ? v.contacts.filter((c) => c.profileId === profileId).map((c) => [c.id, c]) : []);
  const list = (items: Transaction[], max = 5) => items.slice(0, max).map((t) => label(t, cats, contacts)).join(" · ") + (items.length > max ? ` · und ${items.length - max} weitere` : "");

  // 1) expenses without an invoice
  const noReceipt = txs.filter((t) => missingReceipt(t, profile, cats.get(t.categoryId ?? "")));
  const withVat = noReceipt.filter((t) => t.vatLines.some((l) => l.vatCents > 0));
  if (noReceipt.length)
    findings.push({
      id: "expense-no-receipt",
      level: business ? "error" : "warning",
      area: "buchungen",
      title: `${noReceipt.length} ${noReceipt.length === 1 ? "Ausgabe" : "Ausgaben"} ohne Rechnung`,
      detail: business
        ? `Ohne Rechnung ist eine Ausgabe nicht absetzbar${withVat.length ? `, und für ${withVat.length} davon gibt es keine Vorsteuer` : ""}. Rechnung dazulegen oder die Buchung korrigieren: ${list(noReceipt)}`
        : `Für die Arbeitnehmerveranlagung kann das Finanzamt Rechnungen verlangen: ${list(noReceipt)}`,
      link: "/buchungen",
      ids: noReceipt.map((t) => t.id),
    });

  // 2) amounts that do not add up
  const off = txs.filter((t) => t.kind !== "transfer" && t.vatLines.length && Math.abs(t.vatLines.reduce((s, l) => s + l.netCents + l.vatCents, 0) - Math.abs(t.grossCents)) > 2);
  if (off.length) findings.push({ id: "vat-sum", level: "error", area: "buchungen", title: `${off.length} ${off.length === 1 ? "Buchung" : "Buchungen"}, bei denen Netto + USt nicht den Betrag ergibt`, detail: `Das verfälscht UVA und Gewinn: ${list(off)}`, link: "/buchungen", ids: off.map((t) => t.id) });

  // 3) without category – missing from UVA, E 1a or L 1
  const noCat = txs.filter((t) => t.kind !== "transfer" && !t.categoryId);
  if (noCat.length) findings.push({ id: "no-category", level: "error", area: "buchungen", title: `${noCat.length} ${noCat.length === 1 ? "Buchung" : "Buchungen"} ohne Kategorie`, detail: `Ohne Kategorie fehlen sie in den Steuerwerten: ${list(noCat)}`, link: "/buchungen", ids: noCat.map((t) => t.id) });

  // 4) not yet confirmed
  const unreviewed = txs.filter((t) => !t.reviewed);
  if (unreviewed.length) findings.push({ id: "unreviewed", level: "warning", area: "buchungen", title: `${unreviewed.length} ungeprüfte ${unreviewed.length === 1 ? "Buchung" : "Buchungen"}`, detail: `Vorgeschlagen, aber noch nicht bestätigt: ${list(unreviewed)}`, link: "/buchungen", ids: unreviewed.map((t) => t.id) });

  // 5) possible duplicates: same partner, same amount, same invoice number (or same day)
  const seen = new Map<string, Transaction>();
  const dupes: Transaction[] = [];
  for (const t of txs) {
    if (t.kind === "transfer") continue;
    const key = `${t.kind}|${t.contactId ?? t.description.toLowerCase()}|${t.grossCents}|${t.invoiceNumber || t.date}`;
    if (seen.has(key)) dupes.push(t);
    else seen.set(key, t);
  }
  if (dupes.length) findings.push({ id: "duplicates", level: "warning", area: "buchungen", title: `${dupes.length} mögliche ${dupes.length === 1 ? "Doppelbuchung" : "Doppelbuchungen"}`, detail: `Gleicher Partner, gleicher Betrag und gleiche Rechnungsnummer oder gleicher Tag: ${list(dupes)}`, link: "/buchungen", ids: dupes.map((t) => t.id) });

  // 6) dates in the future
  const future = txs.filter((t) => t.date > today && t.origin !== "recurring");
  if (future.length) findings.push({ id: "future", level: "warning", area: "buchungen", title: `${future.length} ${future.length === 1 ? "Buchung" : "Buchungen"} mit Datum in der Zukunft`, detail: `Tippfehler beim Datum? ${list(future)}`, link: "/buchungen", ids: future.map((t) => t.id) });

  if (business) {
    // 7) income without an invoice of yours
    const incomeNoInvoice = txs.filter((t) => t.kind === "income" && !t.invoiceId && !t.documentIds.length && t.origin !== "recurring");
    if (incomeNoInvoice.length) findings.push({ id: "income-no-invoice", level: "warning", area: "rechnungen", title: `${incomeNoInvoice.length} ${incomeNoInvoice.length === 1 ? "Einnahme" : "Einnahmen"} ohne Rechnung`, detail: `An Unternehmen ist ab 400 € eine Rechnung Pflicht. Rechnung schreiben oder dazulegen: ${list(incomeNoInvoice)}`, link: "/rechnungen", ids: incomeNoInvoice.map((t) => t.id) });

    // 8) invoices
    const invoices = v.invoices.filter((i: Invoice) => !i.deletedAt && i.profileId === profileId && i.kind === "invoice");
    const finishedNoTx = invoices.filter((i) => i.status !== "draft" && i.status !== "cancelled" && !i.transactionId);
    if (finishedNoTx.length) findings.push({ id: "invoice-no-booking", level: "error", area: "rechnungen", title: `${finishedNoTx.length} fertige ${finishedNoTx.length === 1 ? "Rechnung" : "Rechnungen"} ohne Einnahme-Buchung`, detail: `Sie fehlen im Umsatz und in der UVA: ${finishedNoTx.slice(0, 5).map((i) => i.number).join(", ")}`, link: "/rechnungen", ids: finishedNoTx.map((i) => i.id) });
    const overdue = invoices.filter((i) => (i.status === "overdue" || (i.status === "sent" && i.dueDate < today)) && i.paidCents < invoiceTotals(i).grossCents);
    if (overdue.length) findings.push({ id: "invoice-overdue", level: "warning", area: "rechnungen", title: `${overdue.length} überfällige ${overdue.length === 1 ? "Rechnung" : "Rechnungen"}`, detail: `Offen: ${eur(overdue.reduce((s, i) => s + invoiceTotals(i).grossCents - i.paidCents, 0))} – ${overdue.slice(0, 5).map((i) => `${i.number} (${i.customerSnapshot.name})`).join(", ")}`, link: "/rechnungen", ids: overdue.map((i) => i.id) });
  }

  // 9) incoming invoices waiting or not readable
  const docs = v.documents.filter((d: SummaDocument) => !d.deletedAt && d.profileId === profileId);
  const review = docs.filter((d) => d.status === "review" || d.status === "inbox");
  if (review.length) findings.push({ id: "docs-review", level: "warning", area: "eingang", title: `${review.length} eingelesene ${review.length === 1 ? "Rechnung wartet" : "Rechnungen warten"} auf Bestätigung`, detail: "Erst nach dem Bestätigen zählen sie fix in Steuer und Gewinn.", link: "/belege", ids: review.map((d) => d.id) });
  const unreadable = docs.filter((d) => d.status === "error");
  if (unreadable.length) findings.push({ id: "docs-error", level: "warning", area: "eingang", title: `${unreadable.length} ${unreadable.length === 1 ? "Datei" : "Dateien"} nicht lesbar`, detail: unreadable.slice(0, 5).map((d) => d.originalName).join(", "), link: "/belege", ids: unreadable.map((d) => d.id) });

  // 10) bank statements
  const lines = v.bankLines.filter((l: BankLine) => !l.deletedAt && l.profileId === profileId);
  if (lines.length) {
    const open = lines.filter((l) => l.status === "unmatched" || l.status === "suggested");
    if (open.length) findings.push({ id: "bank-open", level: "warning", area: "bank", title: `${open.length} ${open.length === 1 ? "Kontobewegung" : "Kontobewegungen"} ohne Buchung`, detail: `Abgänge ${eur(open.filter((l) => l.amountCents < 0).reduce((s, l) => s - l.amountCents, 0))}, Eingänge ${eur(open.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0))}. Fehlt hier eine Rechnung oder ist es privat?`, link: "/bank", ids: open.map((l) => l.id) });
    const statements = v.bankStatements.filter((s) => !s.deletedAt && s.profileId === profileId);
    const froms = statements.map((s) => s.from).filter(Boolean).sort() as string[];
    const tos = statements.map((s) => s.to).filter(Boolean).sort() as string[];
    const unbanked = reconcileStats(lines, txs, froms[0], tos[tos.length - 1]).unbankedTransactions;
    if (unbanked.length) findings.push({ id: "bank-missing", level: "info", area: "bank", title: `${unbanked.length} ${unbanked.length === 1 ? "Buchung" : "Buchungen"} „per Bank“ ohne Kontobewegung`, detail: `Noch nicht am Konto, bar bezahlt oder der Kontoauszug fehlt: ${list(unbanked)}`, link: "/bank", ids: unbanked.map((t) => t.id) });
  }

  // 11) projects past their end
  const projects = (v.projects ?? []).filter((p: Project) => !p.deletedAt && p.profileId === profileId && p.status === "active" && p.endDate && p.endDate < today);
  if (projects.length) findings.push({ id: "projects-overdue", level: "info", area: "projekte", title: `${projects.length} ${projects.length === 1 ? "Projekt läuft" : "Projekte laufen"} über das Enddatum`, detail: projects.slice(0, 5).map((p) => `${p.name} (bis ${dmy(p.endDate!)})`).join(", "), link: "/projekte", ids: projects.map((p) => p.id) });

  // leave out what the caller may not see
  const allowed: Record<CheckFinding["area"], boolean> = { buchungen: see("bookings"), rechnungen: see("outgoing"), eingang: see("incoming"), bank: see("bank"), projekte: see("projects") };
  const visible = findings.filter((f) => allowed[f.area]);
  const order: Record<CheckLevel, number> = { error: 0, warning: 1, info: 2 };
  visible.sort((a, b) => order[a.level] - order[b.level]);
  return { at: new Date().toISOString(), findings: visible, errors: visible.filter((f) => f.level === "error").length, warnings: visible.filter((f) => f.level === "warning").length };
}
