/** Shared, persistent update state for the header and settings on desktop and web. */
import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "@/platform";
import { OPERATOR } from "@/operator/config";
import { useSession } from "@/state/session";
import { guardLeave } from "@/lib/leaveGuard";

export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "installed" | "error";
export interface UpdateState {
  currentVersion: string;
  availableVersion: string | null;
  phase: UpdatePhase;
  mode: "desktop" | "mac" | "web";
  notes: string;
  error: string | null;
  downloaded: number;
  total: number | null;
  lastChecked: number | null;
}
const isMac = () => typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);
export const useUpdates = create<UpdateState>(() => ({
  currentVersion: __APP_VERSION__, availableVersion: null, phase: "idle", mode: isTauri ? isMac() ? "mac" : "desktop" : "web",
  notes: "", error: null, downloaded: 0, total: null, lastChecked: null,
}));

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RESUME_CHECK_MS = 5 * 60 * 1000;
let pending: Update | null = null;
let downloadedUpdate: Update | null = null;
let checking: Promise<void> | null = null;
let registration: ServiceWorkerRegistration | undefined;
let refreshWeb: ((reload?: boolean) => Promise<void>) | undefined;
let macDownload: string | undefined;
let started = false;
let refreshing = false;
export const updatesEnabled = () => !isTauri || (OPERATOR.updates && !import.meta.env.DEV);
const busy = () => ["downloading", "installing", "installed"].includes(useUpdates.getState().phase);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function isNewerVersion(candidate: string, installed: string): boolean {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(v);
  const a = parse(candidate); const b = parse(installed);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  if (!a[4] || !b[4]) return !!b[4] && !a[4];
  const ap = a[4].split("."); const bp = b[4].split(".");
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === bp[i]) continue;
    if (ap[i] === undefined || bp[i] === undefined) return ap[i] !== undefined;
    const an = /^\d+$/.test(ap[i]!); const bn = /^\d+$/.test(bp[i]!);
    if (an !== bn) return !an;
    return an ? Number(ap[i]) > Number(bp[i]) : ap[i]! > bp[i]!;
  }
  return false;
}

async function loadCurrentVersion() {
  if (!isTauri) return;
  const { getVersion } = await import("@tauri-apps/api/app");
  useUpdates.setState({ currentVersion: await getVersion() });
}

async function checkDesktop() {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 30_000 });
  if (!update) return;
  if (pending?.version === update.version) await update.close();
  else {
    const previous = pending;
    pending = update; downloadedUpdate = null;
    if (previous) await previous.close().catch(() => {});
  }
  useUpdates.setState({ currentVersion: pending!.currentVersion, availableVersion: pending!.version, notes: pending!.body ?? "", phase: "available" });
}

async function checkMac() {
  if (!OPERATOR.updateDownloadBase) return;
  const response = await fetch(new URL("download/version.json", OPERATOR.website), { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("Der Update-Server antwortet mit " + response.status + ".");
  const metadata = await response.json() as { mac?: { version?: string } };
  const version = metadata.mac?.version;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !isNewerVersion(version, useUpdates.getState().currentVersion)) return;
  macDownload = OPERATOR.updateDownloadBase + "v" + version + "/Ordo-macOS.dmg";
  useUpdates.setState({ availableVersion: version, phase: "available", notes: "Neue Version laden, öffnen und Ordo in den Programme-Ordner ziehen. Deine Daten bleiben erhalten." });
}

async function offerWebUpdate() {
  useUpdates.setState({ phase: "available", error: null });
  try {
    const response = await fetch(import.meta.env.BASE_URL + "version.json", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return;
    const metadata = await response.json() as { version?: string };
    if (metadata.version && isNewerVersion(metadata.version, useUpdates.getState().currentVersion)) useUpdates.setState({ availableVersion: metadata.version });
  } catch { /* A waiting service worker remains usable without version metadata. */ }
}

/** Coalesces checks; keeps an already offered update available after transient errors. */
export function checkForUpdates(): Promise<void> {
  if (checking) return checking;
  if (!updatesEnabled() || busy() || useUpdates.getState().phase === "ready") return Promise.resolve();
  useUpdates.setState({ phase: useUpdates.getState().phase === "available" ? "available" : "checking", error: null });
  checking = (async () => {
    await Promise.resolve(); // Assign the in-flight promise before any synchronous failure can clear it.
    try {
      if (isTauri) {
        await loadCurrentVersion();
        await (isMac() ? checkMac() : checkDesktop());
      } else if (registration) {
        await registration.update();
        if (registration.waiting) await offerWebUpdate();
      } else if (useUpdates.getState().phase !== "available") {
        throw new Error("Die Update-Prüfung ist in diesem Browser noch nicht bereit. Bitte später erneut versuchen.");
      }
      useUpdates.setState((s) => ({ lastChecked: Date.now(), phase: s.phase === "checking" ? "idle" : s.phase }));
    } catch (error) {
      useUpdates.setState((s) => ({ phase: pending || s.phase === "available" ? "available" : "error", error: message(error) }));
    } finally { checking = null; }
  })();
  return checking;
}

async function restart() {
  try {
    await useSession.getState().store?.flush();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (error) { useUpdates.setState({ phase: "installed", error: "Update installiert. Bitte Ordo neu starten. " + message(error) }); }
}

async function finishInstall(update: Update) {
  if (busy() || pending !== update) return;
  useUpdates.setState({ phase: "installing", error: null });
  try {
    // Save edits made during the download before the Windows installer exits the app.
    await useSession.getState().store?.flush();
    await update.install({ restartAfterInstall: true });
    pending = null; downloadedUpdate = null;
    useUpdates.setState({ phase: "installed" });
    await restart();
  } catch (error) { useUpdates.setState({ phase: "error", error: message(error) }); }
}

/** Installation and reload respect running imports; cancelling the guard keeps the update ready. */
export async function installAvailableUpdate(): Promise<void> {
  const state = useUpdates.getState();
  if (busy() && state.phase !== "installed") return;
  if (state.phase === "installed") { guardLeave(() => void restart()); return; }
  if (state.mode === "web") {
    if (!refreshWeb || refreshing) return;
    guardLeave(() => {
      refreshing = true;
      useUpdates.setState({ phase: "installing", error: null });
      void (async () => {
        try { await useSession.getState().store?.flush(); await refreshWeb!(true); }
        catch (error) { useUpdates.setState({ phase: "available", error: message(error) }); }
        finally { refreshing = false; }
      })();
    });
    return;
  }
  if (state.mode === "mac") {
    try { if (macDownload) await useSession.getState().platform?.openUrl(macDownload); }
    catch (error) { useUpdates.setState({ error: message(error) }); }
    return;
  }
  const update = pending;
  if (!update) { await checkForUpdates(); return; }
  if (downloadedUpdate !== update) {
    useUpdates.setState({ phase: "downloading", downloaded: 0, total: null, error: null });
    try {
      await update.download((event) => {
        if (event.event === "Started") useUpdates.setState({ total: event.data.contentLength ?? null, downloaded: 0 });
        if (event.event === "Progress") useUpdates.setState((s) => ({ downloaded: s.downloaded + event.data.chunkLength }));
      }, { timeout: 120_000 });
      downloadedUpdate = update;
      useUpdates.setState({ phase: "ready" });
    } catch (error) { useUpdates.setState({ phase: "error", error: message(error) }); return; }
  }
  guardLeave(() => void finishInstall(update));
}

function startWeb() {
  if (!("serviceWorker" in navigator)) return;
  void import("virtual:pwa-register").then(({ registerSW }) => {
    refreshWeb = registerSW({ immediate: true, onNeedRefresh: () => void offerWebUpdate(),
      onRegisteredSW(_url, reg) { registration = reg; },
      onRegisterError(error) { useUpdates.setState({ error: message(error) }); },
    });
  }).catch((error) => useUpdates.setState({ error: message(error) }));
}

/** Checks on startup, hourly, and on returning online/to the app. Idempotent with explicit cleanup. */
export function startUpdateChecks(): () => void {
  if (started) return () => {};
  started = true;
  if (isTauri) void loadCurrentVersion().catch(() => {});
  else startWeb();
  if (!updatesEnabled()) return () => { started = false; };
  const run = () => void checkForUpdates();
  const resume = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const checked = useUpdates.getState().lastChecked;
    if (!checked || Date.now() - checked >= RESUME_CHECK_MS) run();
  };
  const initial = setTimeout(run, 5000);
  const interval = setInterval(run, CHECK_INTERVAL_MS);
  window.addEventListener("online", run); window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    clearTimeout(initial); clearInterval(interval);
    window.removeEventListener("online", run); window.removeEventListener("focus", resume);
    document.removeEventListener("visibilitychange", resume); started = false;
  };
}
