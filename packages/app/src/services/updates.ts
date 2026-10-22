/**
 * Update delivery. Desktop: Tauri updater checks the signed latest.json of the newest release (endpoint in
 * tauri.conf.json → plugins.updater), installs on request and restarts. Web/PWA: a new service worker waits
 * until the user reloads. Both surface as a persistent toast with one action.
 */
import { isTauri } from "@/platform";
import { useToasts } from "@/state/toasts";
import { toast } from "@/state/toasts";
import { OPERATOR } from "@/operator/config";
import { useSession } from "@/state/session";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let offeredVersion: string | null = null;

async function checkDesktop() {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update || update.version === offeredVersion) return;
  offeredVersion = update.version;
  useToasts.getState().push({
    kind: "info",
    title: `Ordo ${update.version} ist verfügbar`,
    body: update.body || "Installieren dauert nur einen Moment, danach startet Ordo neu.",
    timeout: 0,
    action: {
      label: "Jetzt installieren",
      onClick: () => {
        const id = useToasts.getState().push({ kind: "info", title: "Update wird geladen…", timeout: 0 });
        update
          .downloadAndInstall()
          .then(async () => {
            const { relaunch } = await import("@tauri-apps/plugin-process");
            await relaunch();
          })
          .catch((e) => {
            useToasts.getState().dismiss(id);
            offeredVersion = null;
            toast.error("Update fehlgeschlagen", e instanceof Error ? e.message : String(e));
          });
      },
    },
  });
}

const newer = (a: string, b: string) => a.split(".").map(Number).reduce((r, n, i) => r || n - (b.split(".").map(Number)[i] ?? 0), 0) > 0;

/**
 * The Mac app is built on GitHub, without the signing key of the Windows updater – so it is not in latest.json.
 * It looks at the download page instead and offers the new .dmg (installed over the old app, data stays).
 */
async function checkMac() {
  const r = await fetch("https://ordo-app.at/download/version.json", { cache: "no-store" });
  if (!r.ok) return;
  const v = (await r.json()) as { mac?: { version?: string }; files?: { mac?: string } };
  const version = v.mac?.version;
  if (!version || !newer(version, __APP_VERSION__) || version === offeredVersion) return;
  offeredVersion = version;
  useToasts.getState().push({
    kind: "info",
    title: `Ordo ${version} ist verfügbar`,
    body: "Neue Version laden, öffnen und Ordo in den Programme-Ordner ziehen. Deine Daten bleiben erhalten.",
    timeout: 0,
    action: {
      label: "Herunterladen",
      onClick: () => void useSession.getState().platform?.openUrl(v.files?.mac || "https://ordo-app.at/download/#mac"),
    },
  });
}

function startWeb() {
  if (!("serviceWorker" in navigator)) return;
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          useToasts.getState().push({
            kind: "info",
            title: "Neue Version von Ordo",
            body: "Neu laden, um sie zu verwenden. Deine Daten bleiben erhalten.",
            timeout: 0,
            action: { label: "Neu laden", onClick: () => void updateSW(true) },
          });
        },
        onRegisteredSW(_url: string, reg: ServiceWorkerRegistration | undefined) {
          if (reg) setInterval(() => void reg.update(), CHECK_INTERVAL_MS);
        },
      });
    })
    .catch(() => {});
}

export function startUpdateChecks() {
  if (!isTauri) {
    startWeb();
    return;
  }
  // the community edition is built by whoever runs it – the operator's signed releases are not for it
  if (import.meta.env.DEV || !OPERATOR.updates) return;
  const mac = /Macintosh|Mac OS X/.test(navigator.userAgent);
  const run = () => void (mac ? checkMac() : checkDesktop()).catch((e) => console.warn("update check failed", e));
  setTimeout(run, 5000);
  setInterval(run, CHECK_INTERVAL_MS);
}
