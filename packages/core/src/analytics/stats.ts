import type { Category, Contact, Invoice, Profile, SummaDocument, Transaction } from "../model/types";
import { todayIso } from "../model/types";
import type { Cents } from "../model/money";

export interface MonthPoint {
  month: string; // YYYY-MM
  label: string;
  incomeCents: Cents;
  expenseCents: Cents;
  netCents: Cents;
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  color: string;
  icon: string;
  amountCents: Cents;
  count: number;
  pct: number;
}

export interface ContactTotal {
  contactId: string | null;
  name: string;
  amountCents: Cents;
  count: number;
}

export interface Overview {
  year: number;
  incomeYtdCents: Cents;
  expenseYtdCents: Cents;
  netYtdCents: Cents;
  incomeMonthCents: Cents;
  expenseMonthCents: Cents;
  prevIncomeMonthCents: Cents;
  prevExpenseMonthCents: Cents;
  months: MonthPoint[];
  expenseByCategory: CategoryTotal[];
  incomeByCategory: CategoryTotal[];
  topVendors: ContactTotal[];
  inboxCount: number;
  reviewCount: number;
  unreviewedTxCount: number;
  openInvoicesCents: Cents;
  overdueInvoices: number;
  unpaidExpensesCents: Cents;
  transactionCount: number;
  avgMonthlyExpenseCents: Cents;
  savingsRate: number | null;
}

const MONTH_LABELS = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export function effectiveDate(tx: Transaction): string {
  return tx.paidDate ?? tx.date;
}

export function relevantTransactions(transactions: Transaction[], profileId: string): Transaction[] {
  return transactions.filter((t) => !t.deletedAt && t.profileId === profileId && t.kind !== "transfer");
}

export function monthlySeries(transactions: Transaction[], year: number): MonthPoint[] {
  const points: MonthPoint[] = Array.from({ length: 12 }, (_, i) => ({
    month: `${year}-${String(i + 1).padStart(2, "0")}`,
    label: MONTH_LABELS[i]!,
    incomeCents: 0,
    expenseCents: 0,
    netCents: 0,
  }));
  for (const t of transactions) {
    const d = effectiveDate(t);
    if (!d.startsWith(String(year))) continue;
    const p = points[Number(d.slice(5, 7)) - 1]!;
    if (t.kind === "income") p.incomeCents += t.grossCents;
    else if (t.kind === "expense" || t.kind === "private") p.expenseCents += t.grossCents;
    p.netCents = p.incomeCents - p.expenseCents;
  }
  return points;
}

export function byCategory(transactions: Transaction[], categories: Category[], kind: "income" | "expense", from?: string, to?: string): CategoryTotal[] {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const map = new Map<string | null, CategoryTotal>();
  let total = 0;
  for (const t of transactions) {
    if (kind === "expense" ? t.kind !== "expense" && t.kind !== "private" : t.kind !== "income") continue;
    const d = effectiveDate(t);
    if ((from && d < from) || (to && d > to)) continue;
    const c = t.categoryId ? cats.get(t.categoryId) : undefined;
    const key = c?.id ?? null;
    let row = map.get(key);
    if (!row) {
      row = { categoryId: key, name: c?.name ?? "Ohne Kategorie", color: c?.color ?? "#94a3b8", icon: c?.icon ?? "help-circle", amountCents: 0, count: 0, pct: 0 };
      map.set(key, row);
    }
    row.amountCents += t.grossCents;
    row.count++;
    total += t.grossCents;
  }
  const rows = [...map.values()].sort((a, b) => b.amountCents - a.amountCents);
  for (const r of rows) r.pct = total ? r.amountCents / total : 0;
  return rows;
}

export function byContact(transactions: Transaction[], contacts: Contact[], kind: "income" | "expense", from?: string, to?: string, limit = 8): ContactTotal[] {
  const names = new Map(contacts.map((c) => [c.id, c.name]));
  const map = new Map<string | null, ContactTotal>();
  for (const t of transactions) {
    if (kind === "expense" ? t.kind !== "expense" : t.kind !== "income") continue;
    const d = effectiveDate(t);
    if ((from && d < from) || (to && d > to)) continue;
    const key = t.contactId ?? null;
    let row = map.get(key);
    if (!row) {
      row = { contactId: key, name: key ? (names.get(key) ?? "Unbekannt") : "Ohne Kontakt", amountCents: 0, count: 0 };
      map.set(key, row);
    }
    row.amountCents += t.grossCents;
    row.count++;
  }
  return [...map.values()].sort((a, b) => b.amountCents - a.amountCents).slice(0, limit);
}

export function overview(profile: Profile, transactions: Transaction[], categories: Category[], contacts: Contact[], documents: SummaDocument[], invoices: Invoice[], today = todayIso()): Overview {
  const year = Number(today.slice(0, 4));
  const month = today.slice(0, 7);
  const prevMonthDate = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1);
  const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const txs = relevantTransactions(transactions, profile.id);
  const months = monthlySeries(txs, year);
  let incomeYtd = 0;
  let expenseYtd = 0;
  let incomeMonth = 0;
  let expenseMonth = 0;
  let prevIncome = 0;
  let prevExpense = 0;
  let unpaidExpenses = 0;
  let unreviewed = 0;
  for (const t of txs) {
    const d = effectiveDate(t);
    if (!t.reviewed) unreviewed++;
    if (t.kind === "expense" && t.dueDate && !t.paidDate) unpaidExpenses += t.grossCents;
    if (!d.startsWith(String(year)) && !d.startsWith(prevMonth)) continue;
    const isExpense = t.kind === "expense" || t.kind === "private";
    if (d.startsWith(String(year))) {
      if (t.kind === "income") incomeYtd += t.grossCents;
      else if (isExpense) expenseYtd += t.grossCents;
    }
    if (d.startsWith(month)) {
      if (t.kind === "income") incomeMonth += t.grossCents;
      else if (isExpense) expenseMonth += t.grossCents;
    }
    if (d.startsWith(prevMonth)) {
      if (t.kind === "income") prevIncome += t.grossCents;
      else if (isExpense) prevExpense += t.grossCents;
    }
  }
  const docs = documents.filter((d) => !d.deletedAt && d.profileId === profile.id);
  const invs = invoices.filter((i) => !i.deletedAt && i.profileId === profile.id);
  const openInvoices = invs.filter((i) => i.status === "sent" || i.status === "overdue");
  const monthsElapsed = Math.max(1, Number(today.slice(5, 7)));
  return {
    year,
    incomeYtdCents: incomeYtd,
    expenseYtdCents: expenseYtd,
    netYtdCents: incomeYtd - expenseYtd,
    incomeMonthCents: incomeMonth,
    expenseMonthCents: expenseMonth,
    prevIncomeMonthCents: prevIncome,
    prevExpenseMonthCents: prevExpense,
    months,
    expenseByCategory: byCategory(txs, categories, "expense", `${year}-01-01`, `${year}-12-31`),
    incomeByCategory: byCategory(txs, categories, "income", `${year}-01-01`, `${year}-12-31`),
    topVendors: byContact(txs, contacts, "expense", `${year}-01-01`, `${year}-12-31`),
    inboxCount: docs.filter((d) => d.status === "inbox" || d.status === "processing").length,
    reviewCount: docs.filter((d) => d.status === "review").length,
    unreviewedTxCount: unreviewed,
    openInvoicesCents: openInvoices.reduce((s, i) => s + invoiceTotalCents(i) - i.paidCents, 0),
    overdueInvoices: openInvoices.filter((i) => i.dueDate < today).length,
    unpaidExpensesCents: unpaidExpenses,
    transactionCount: txs.length,
    avgMonthlyExpenseCents: Math.round(expenseYtd / monthsElapsed),
    savingsRate: incomeYtd > 0 ? (incomeYtd - expenseYtd) / incomeYtd : null,
  };
}

export function invoiceTotals(inv: Invoice): { netCents: Cents; vatCents: Cents; grossCents: Cents; byRate: { rate: number; netCents: Cents; vatCents: Cents }[] } {
  const byRate = new Map<number, { rate: number; netCents: Cents; vatCents: Cents }>();
  const taxable = inv.vatTreatment === "standard";
  for (const l of inv.lines) {
    const net = Math.round(l.quantity * l.unitNetCents * (1 - (l.discountPct || 0) / 100));
    const rate = taxable ? l.vatRate : 0;
    const vat = Math.round((net * rate) / 100);
    const row = byRate.get(rate) ?? { rate, netCents: 0, vatCents: 0 };
    row.netCents += net;
    row.vatCents += vat;
    byRate.set(rate, row);
  }
  const rows = [...byRate.values()].sort((a, b) => b.rate - a.rate);
  // discount on the whole invoice lowers net and VAT of every rate proportionally
  const discount = inv.discountPct ? inv.discountPct / 100 : 0;
  if (discount) {
    for (const r of rows) {
      r.netCents -= Math.round(r.netCents * discount);
      r.vatCents -= Math.round(r.vatCents * discount);
    }
  }
  const netCents = rows.reduce((s, r) => s + r.netCents, 0);
  const vatCents = rows.reduce((s, r) => s + r.vatCents, 0);
  return { netCents, vatCents, grossCents: netCents + vatCents, byRate: rows };
}

export function invoiceTotalCents(inv: Invoice): Cents {
  return invoiceTotals(inv).grossCents;
}
