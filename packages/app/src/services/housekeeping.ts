import { computeNotifications, dueRecurring, invoiceTotalCents, todayIso, type VaultStore } from "@ordo/core";
import type { Platform } from "@/platform";
import { toast } from "@/state/toasts";
import { requireStore } from "@/state/session";

/**
 * Runs after unlock and once per hour: materializes recurring transactions, marks overdue invoices,
 * computes notifications and pushes new ones to the OS.
 */
export async function runHousekeeping(store: VaultStore, platform: Platform, opts: { notifyOs?: boolean } = {}) {
  const today = todayIso();
  const profile = store.activeProfile;

  // 1) Recurring
  const due = dueRecurring(store.list("recurringRules", { profileId: profile.id }), today);
  if (due.length) {
    let count = 0;
    store.mutate((v) => {
      for (const { rule, transactions } of due) {
        v.transactions = [...v.transactions, ...transactions];
        v.recurringRules = v.recurringRules.map((r) => (r.id === rule.id ? { ...r, lastMaterializedDate: transactions[transactions.length - 1]!.date, updatedAt: new Date().toISOString() } : r));
        count += transactions.length;
      }
    }, { audit: { action: "recurring.materialize", entity: "transactions", details: `${count} Buchungen` } });
    toast.info(`${count} wiederkehrende Buchung${count === 1 ? "" : "en"} angelegt`, "Automatisch aus deinen Daueraufträgen erzeugt.");
  }

  // 2) Overdue invoices
  const overdue = store.list("invoices", { profileId: profile.id }).filter((i) => i.status === "sent" && i.dueDate < today && i.paidCents < invoiceTotalCents(i));
  if (overdue.length) {
    store.mutate((v) => {
      v.invoices = v.invoices.map((i) => (overdue.some((o) => o.id === i.id) ? { ...i, status: "overdue" } : i));
    });
  }

  // 3) Notifications
  const fresh = computeNotifications({
    profile,
    settings: store.vault.settings,
    documents: store.vault.documents,
    invoices: store.vault.invoices,
    recurringRules: store.vault.recurringRules,
    existing: store.vault.notifications,
    today,
  });
  if (fresh.length) {
    store.mutate((v) => {
      v.notifications = [...v.notifications, ...fresh].slice(-300);
    });
    if (opts.notifyOs !== false) {
      for (const n of fresh) void platform.notify(n.title, n.body);
    }
  }

  // 4) Purge soft-deleted entities older than 60 days
  store.purgeDeleted(60);
}

export function markNotificationRead(id: string) {
  const store = requireStore();
  store.mutate((v) => {
    v.notifications = v.notifications.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n));
  });
}

export function dismissNotification(id: string) {
  const store = requireStore();
  store.mutate((v) => {
    v.notifications = v.notifications.map((n) => (n.id === id ? { ...n, dismissedAt: new Date().toISOString() } : n));
  });
}
