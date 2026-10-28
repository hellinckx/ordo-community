import { Download, RefreshCw, RotateCw } from "lucide-react";
import { Link } from "react-router";
import { Button } from "./ui";
import { checkForUpdates, installAvailableUpdate, updatesEnabled, useUpdates } from "@/services/updates";
import { cls, fmtBytes } from "@/lib/format";

export function AppVersion() {
  const version = useUpdates((s) => s.currentVersion);
  return <Link to="/einstellungen/ueber" title={`Installierte Ordo-Version ${version} · Updates prüfen`} aria-label={`Ordo Version ${version}, Updates und Informationen`} className="shrink-0 rounded-lg px-2 py-1 text-xs tabular text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text) focus-visible:focus-ring">v{version}</Link>;
}

export function UpdateBanner() {
  const state = useUpdates();
  if (!["available", "downloading", "ready", "installing", "installed"].includes(state.phase) && !(state.phase === "error" && state.availableVersion)) return null;
  const downloading = state.phase === "downloading";
  const installing = state.phase === "installing";
  const percent = state.total ? Math.min(100, Math.round(state.downloaded / state.total * 100)) : null;
  const label = downloading ? `Wird geladen${percent === null ? " …" : ` · ${percent} %`}` : installing ? "Wird aktualisiert …" : state.phase === "installed" ? "Neu starten" : state.mode === "mac" ? "Update herunterladen" : state.mode === "web" ? "Jetzt aktualisieren" : state.phase === "ready" ? "Installieren und neu starten" : state.phase === "error" ? "Erneut versuchen" : "Jetzt aktualisieren";
  return <section aria-label="Ordo-Update" className="shrink-0 border-b border-brand-200 bg-brand-50 px-4 py-2 dark:border-brand-900 dark:bg-brand-950/50 sm:px-5">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Download className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm" role="status">
        <span className="font-medium">{state.phase === "installed" ? "Update installiert" : "Update verfügbar"}{state.availableVersion ? ` · Ordo ${state.availableVersion}` : ""}</span>
        <span className="ml-2 inline-block text-xs text-(--text-muted)">Installiert: {state.currentVersion}</span>
        <p className="text-xs text-(--text-muted)">{state.error || (downloading ? `${fmtBytes(state.downloaded)}${state.total ? ` von ${fmtBytes(state.total)}` : ""} geladen` : state.mode === "mac" ? "Neue Version laden und im Programme-Ordner ersetzen." : state.mode === "web" ? "Die neue Version ist bereit. Deine gespeicherten Daten bleiben erhalten." : "Ordo startet nach der Installation neu. Deine gespeicherten Daten bleiben erhalten.")}</p>
      </div>
      <Button size="sm" loading={downloading || installing} disabled={downloading || installing} onClick={() => void installAvailableUpdate()}>{!downloading && !installing ? <RotateCw className="h-4 w-4" aria-hidden="true" /> : null}{label}</Button>
    </div>
    {downloading ? <div role="progressbar" aria-label="Update herunterladen" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-1 overflow-hidden rounded-full bg-brand-200 dark:bg-brand-900"><div className={cls("h-full bg-brand-600", percent === null && "w-1/3 animate-pulse")} style={percent === null ? undefined : { width: `${percent}%` }} /></div> : null}
  </section>;
}

export function UpdateSettings() {
  const state = useUpdates();
  const busy = ["checking", "downloading", "installing", "installed"].includes(state.phase);
  return <div className="space-y-2 text-sm">
    <p className="font-medium">Installierte Version: {state.currentVersion}</p>
    <p className="text-xs text-(--text-muted)">{state.availableVersion ? `Ordo ${state.availableVersion} ist verfügbar.` : state.lastChecked && !state.error ? "Keine neuere Version gefunden." : "Ordo prüft beim Start und regelmäßig nach Updates."}{state.lastChecked ? ` Zuletzt geprüft: ${new Date(state.lastChecked).toLocaleString("de-AT")}.` : ""}</p>
    {state.error ? <p role="alert" className="text-xs text-red-700 dark:text-red-300">Update-Prüfung oder Installation fehlgeschlagen: {state.error}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" loading={state.phase === "checking"} disabled={busy || !updatesEnabled()} onClick={() => void checkForUpdates()}><RefreshCw className="h-4 w-4" /> Nach Updates suchen</Button>
      {state.availableVersion || state.phase === "available" ? <Button size="sm" disabled={busy} onClick={() => void installAvailableUpdate()}>{state.mode === "mac" ? "Neue Version herunterladen" : "Jetzt aktualisieren"}</Button> : null}
    </div>
  </div>;
}
