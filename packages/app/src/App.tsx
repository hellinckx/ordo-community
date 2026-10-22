import { Component, useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useSession } from "@/state/session";
import { Toaster, Spinner, Button } from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import Onboarding from "@/pages/Onboarding";
import Unlock from "@/pages/Unlock";
import Settings from "@/pages/Settings";
import { PARTS } from "@/operator";
import Modules from "@/pages/Modules";
import { ALL_MODULES, useInstalledModules } from "@/modules/registry";
import { runHousekeeping } from "@/services/housekeeping";
import { useFolderWatch } from "@/services/folderWatch";
import { startSyncLoop, useSync } from "@/services/sync";
import { startIntegrations } from "@/services/integrations/runner";
import { AlertTriangle } from "lucide-react";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="surface max-w-lg p-6">
            <div className="mb-2 flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              <h1 className="text-lg font-semibold">Da ist etwas schiefgelaufen</h1>
            </div>
            <pre className="mb-4 max-h-60 overflow-auto rounded-lg bg-(--surface-2) p-3 text-xs">{this.state.error.message}</pre>
            <Button onClick={() => location.reload()}>Neu laden</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function useAutoLock() {
  const status = useSession((s) => s.status);
  const vault = useSession((s) => s.vault);
  const minutes = vault?.settings.autoLockMinutes ?? 0;
  useEffect(() => {
    if (status !== "unlocked" || !minutes) return;
    const touch = () => useSession.getState().touch();
    const events = ["mousemove", "keydown", "pointerdown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      const { lastActivity, lock } = useSession.getState();
      if (Date.now() - lastActivity > minutes * 60_000) void lock();
    }, 10_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(timer);
    };
  }, [status, minutes]);
}

function useTheme() {
  const theme = useSession((s) => s.vault?.settings.theme ?? "system");
  useEffect(() => {
    const apply = () => {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const dark = theme === "dark" || (theme === "system" && prefersDark);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      try {
        localStorage.setItem("summa.theme", theme === "system" ? (dark ? "dark" : "light") : theme);
      } catch {
        /* ignore */
      }
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

function useHousekeeping() {
  const status = useSession((s) => s.status);
  useEffect(() => {
    if (status !== "unlocked") return;
    const run = () => {
      const { store, platform } = useSession.getState();
      if (store && platform) void runHousekeeping(store, platform).catch(console.error);
    };
    const t = setTimeout(run, 800);
    const interval = setInterval(run, 60 * 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
  }, [status]);
}

function useSyncLoop() {
  const status = useSession((s) => s.status);
  const enabled = useSession((s) => s.vault?.settings.sync.enabled);
  const url = useSession((s) => s.vault?.settings.sync.supabaseUrl);
  useEffect(() => {
    if (status !== "unlocked") return;
    const store = useSession.getState().store;
    if (!store) return;
    if (!enabled) {
      // still initialise the client (restores an existing login for the admin area / announcements)
      void useSync.getState().init();
      return;
    }
    return startSyncLoop(store);
  }, [status, enabled, url]);
}

/** Connections to other programs (local API, webhooks, timed pulls) run while the vault is unlocked. */
function useIntegrations() {
  const status = useSession((s) => s.status);
  const store = useSession((s) => s.store);
  useEffect(() => {
    if (status !== "unlocked" || !store) return;
    return startIntegrations(store);
  }, [status, store]);
}

function useFlushOnUnload() {
  useEffect(() => {
    const handler = () => {
      const { store } = useSession.getState();
      if (store) void store.flush();
    };
    window.addEventListener("beforeunload", handler);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") handler();
    });
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
}

/** Routes of the installed modules; pages of modules that are not installed lead to the module overview. */
function ModuleRoutes() {
  const location = useLocation();
  const modules = useInstalledModules();
  const installed = new Set(modules.map((m) => m.id));
  const notInstalled = ALL_MODULES.filter((m) => !installed.has(m.id));
  return (
    <Routes location={location}>
      {modules.flatMap((m) => m.routes.map((r) => <Route key={`${m.id}:${r.path}`} path={r.path} element={r.element} />))}
      {notInstalled.flatMap((m) => m.routes.map((r) => <Route key={`${m.id}:${r.path}`} path={r.path} element={<Navigate to={`/module/${m.id}`} replace />} />))}
      <Route path="/module" element={<Modules />} />
      <Route path="/module/:id" element={<Modules />} />
      {PARTS.routes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
      <Route path="/einstellungen" element={<Settings />} />
      <Route path="/einstellungen/:tab" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const status = useSession((s) => s.status);
  const vault = useSession((s) => s.vault);
  const error = useSession((s) => s.error);
  const init = useSession((s) => s.init);
  const location = useLocation();
  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => {
    if (status === "unlocked") document.title = "Ordo";
  }, [status]);
  useAutoLock();
  useTheme();
  useHousekeeping();
  useFlushOnUnload();
  useFolderWatch();
  useSyncLoop();
  useIntegrations();

  let content: ReactNode;
  if (status === "loading") {
    content = (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  } else if (status === "error") {
    content = (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="surface max-w-md p-6 text-sm">
          <h1 className="mb-2 text-lg font-semibold text-red-600">Speicher nicht verfügbar</h1>
          <p className="text-(--text-muted)">{error}</p>
        </div>
      </div>
    );
  } else if (status === "no-vault" || (status === "unlocked" && vault && !vault.settings.onboardingDone)) {
    content = <Onboarding />;
  } else if (status === "locked") {
    content = <Unlock />;
  } else {
    content = (
      <AppShell>
        <ModuleRoutes />
      </AppShell>
    );
  }
  return (
    <ErrorBoundary>
      {content}
      <Toaster />
    </ErrorBoundary>
  );
}
