/**
 * Der Alles-Check in der App: first brings everything up to date (connected folders, sync, bank matching), then
 * runs the rules of core/checks/allCheck. Runs when asked ("Jetzt prüfen", Atlas) and – while someone works in
 * Ordo – about once a day or once a week, as set under Einstellungen → Hinweise. Never in the background.
 */
import { create } from "zustand";
import { can, ids, nowIso, runAllCheck, todayIso, type CheckResult, type CheckScope, type Role, type Vault } from "@ordo/core";
import { useSession } from "@/state/session";
import { useSync } from "@/services/sync";
import { scanFoldersNow } from "@/services/folderWatch";
import { runReconcile } from "@/services/bankImport";

interface AllCheckState {
  running: boolean;
  /** What is being done right now ("Ordner werden gelesen" …). */
  step?: string;
  result: CheckResult | null;
}

export const useAllCheck = create<AllCheckState>(() => ({ running: false, result: null }));

/** What a role may see of the check (team members without bank or contacts rights get those parts left out). */
export function checkScopeFor(role: Role): CheckScope {
  const r = (a: Parameters<typeof can>[1]) => can(role, a, "read");
  return { bookings: r("summa"), outgoing: r("summa"), incoming: r("summa"), bank: r("summa"), projects: r("projects"), contacts: r("contacts") };
}

/** Role of the person on this device (owner when there is no team). */
export function roleOnDevice(v: Vault): Role {
  return v.members.find((m) => m.id === v.settings.meMemberId && !m.deletedAt)?.role ?? "owner";
}

const INTERVAL_MS = { daily: 20 * 3600_000, weekly: 6.5 * 86400_000 } as const;

/** Is the automatic check due (set interval, last run on this device's vault)? */
export function allCheckDue(): boolean {
  const s = useSession.getState().store?.vault.settings.allCheck;
  if (!s || s.interval === "off") return false;
  return !s.lastRunAt || Date.now() - Date.parse(s.lastRunAt) > INTERVAL_MS[s.interval];
}

export async function runFullCheck(opts: { auto?: boolean } = {}): Promise<CheckResult | null> {
  const { store } = useSession.getState();
  if (!store || useAllCheck.getState().running) return null;
  useAllCheck.setState({ running: true });
  try {
    // 1) what is new in the connected folders (desktop app)
    useAllCheck.setState({ step: "Verbundene Ordner werden gelesen" });
    await scanFoldersNow().catch(() => 0);
    // 2) the other devices' state
    const sync = useSync.getState();
    if (sync.session && sync.status !== "syncing") {
      useAllCheck.setState({ step: "Wird abgeglichen" });
      await sync.sync({ silent: true }).catch(() => {});
    }
    // 3) bank lines against bookings
    useAllCheck.setState({ step: "Kontoauszüge werden verglichen" });
    try {
      runReconcile();
    } catch {
      /* no bank statements */
    }
    // 4) the rules
    useAllCheck.setState({ step: "Alles wird nachgerechnet" });
    const live = useSession.getState().store;
    if (!live) return null;
    const profile = live.activeProfile;
    const result = runAllCheck(live.vault, profile.id, todayIso(), checkScopeFor(roleOnDevice(live.vault)));
    live.mutate((v) => {
      v.settings = { ...v.settings, allCheck: { ...v.settings.allCheck, lastRunAt: result.at, lastErrors: result.errors, lastWarnings: result.warnings } };
      // the automatic run says so in the bell when something is wrong (once a day at most)
      if (opts.auto && (result.errors || result.warnings)) {
        const key = `allcheck:${todayIso()}`;
        if (!v.notifications.some((n) => n.dedupeKey === key))
          v.notifications = [...v.notifications, { id: ids.notification(), profileId: profile.id, kind: (result.errors ? "warning" : "info") as "warning" | "info", title: result.errors ? `Alles-Check: ${result.errors} ${result.errors === 1 ? "Fehler" : "Fehler"}` : `Alles-Check: ${result.warnings} ${result.warnings === 1 ? "Hinweis" : "Hinweise"}`, body: result.findings.slice(0, 3).map((f) => f.title).join(" · "), link: "/pruefung", createdAt: nowIso(), dedupeKey: key }].slice(-300);
      }
    });
    useAllCheck.setState({ result });
    return result;
  } finally {
    useAllCheck.setState({ running: false, step: undefined });
  }
}
