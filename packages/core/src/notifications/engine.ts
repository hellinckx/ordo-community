import type { Invoice, Profile, RecurringRule, Settings, SummaDocument, SummaNotification } from "../model/types";
import { nowIso, todayIso } from "../model/types";
import { ids } from "../model/ids";
import { daysUntil, upcomingUvaDeadlines } from "../tax/at/deadlines";
import { nextOccurrence } from "../recurring/recurring";
import { formatCents } from "../model/money";
import { invoiceTotalCents } from "../analytics/stats";

export interface NotificationInput {
  profile: Profile;
  settings: Settings;
  documents: SummaDocument[];
  invoices: Invoice[];
  recurringRules: RecurringRule[];
  existing: SummaNotification[];
  today?: string;
}

/**
 * Computes notifications that should exist right now. Deduplicated via dedupeKey against existing ones.
 * The app shows them in-app and (desktop/PWA) as system notifications.
 */
export function computeNotifications(input: NotificationInput): SummaNotification[] {
  const today = input.today ?? todayIso();
  const prefs = input.settings.notifications;
  const out: SummaNotification[] = [];
  const have = new Set(input.existing.filter((n) => !n.dismissedAt).map((n) => n.dedupeKey));
  const push = (n: Omit<SummaNotification, "id" | "createdAt">) => {
    if (n.dedupeKey && have.has(n.dedupeKey)) return;
    out.push({ ...n, id: ids.notification(), createdAt: nowIso() });
  };
  if (!prefs.enabled) return out;

  if (prefs.uvaDeadline) {
    for (const p of upcomingUvaDeadlines(input.profile, today)) {
      const days = daysUntil(p.dueDate, today);
      if (days <= prefs.uvaDaysBefore && days >= -30 && p.to < today) {
        push({
          profileId: input.profile.id,
          kind: "uva_deadline",
          title: days < 0 ? `UVA ${p.label} überfällig` : days === 0 ? `UVA ${p.label} heute fällig` : `UVA ${p.label} in ${days} Tagen fällig`,
          body: `Frist: ${p.dueDate.split("-").reverse().join(".")} – Kennzahlen in Ordo prüfen und in FinanzOnline übertragen.`,
          dueDate: p.dueDate,
          link: `/steuern/uva?year=${p.ref.year}&index=${p.ref.index}`,
          dedupeKey: `uva:${p.ref.year}-${p.ref.kind}-${p.ref.index}`,
        });
      }
    }
  }

  if (prefs.inboxReminder) {
    const review = input.documents.filter((d) => !d.deletedAt && d.profileId === input.profile.id && (d.status === "review" || d.status === "inbox")).length;
    if (review >= 5) {
      push({ profileId: input.profile.id, kind: "inbox", title: `${review} ${review === 1 ? "Rechnung wartet" : "Rechnungen warten"} auf einen Blick`, body: "Ordo war sich bei ein paar Angaben nicht sicher – kurz prüfen, dann ist alles gebucht.", link: "/belege", dedupeKey: `inbox:${today.slice(0, 7)}:${Math.floor(review / 5)}` });
    }
  }

  if (prefs.invoiceOverdue) {
    for (const inv of input.invoices) {
      if (inv.deletedAt || inv.profileId !== input.profile.id) continue;
      if ((inv.status === "sent" || inv.status === "overdue") && inv.dueDate < today) {
        push({
          profileId: input.profile.id,
          kind: "invoice_overdue",
          title: `Rechnung ${inv.number} überfällig`,
          body: `${inv.customerSnapshot.name || "Kunde"} · ${formatCents(invoiceTotalCents(inv) - inv.paidCents)} offen seit ${inv.dueDate.split("-").reverse().join(".")}`,
          dueDate: inv.dueDate,
          link: `/rechnungen/${inv.id}`,
          dedupeKey: `invoice:${inv.id}:overdue`,
        });
      }
    }
  }

  if (prefs.recurringDue) {
    for (const r of input.recurringRules) {
      if (r.deletedAt || !r.active || r.profileId !== input.profile.id || r.autoBook) continue;
      const next = nextOccurrence(r, today);
      if (next && daysUntil(next, today) <= 3) {
        push({ profileId: input.profile.id, kind: "recurring", title: `Wiederkehrend: ${r.name}`, body: `Fällig am ${next.split("-").reverse().join(".")} – ${formatCents(r.template.grossCents)}`, dueDate: next, link: "/buchungen?tab=recurring", dedupeKey: `recurring:${r.id}:${next}` });
      }
    }
  }
  return out;
}
