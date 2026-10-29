import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Bell, Camera, Menu as MenuIcon, Sparkles, Upload, X, Megaphone } from "lucide-react";
import { useSession } from "@/state/session";
import { useProfile, useVault } from "@/state/hooks";
import { cls, fmtRelative } from "@/lib/format";
import { Badge, Button, ConfirmDialog } from "@/components/ui";
import { importFiles, useImporter } from "@/services/importer";
import { dismissNotification, markNotificationRead } from "@/services/housekeeping";
import { isMobile, isTauri } from "@/platform";
import { TransactionDialog } from "@/components/TransactionForm";
import { exitDemo } from "@/services/demo";
import { Tour, useAutoTour } from "@/components/Tour";
import { useSync } from "@/services/sync";
import { PrivacyNotice } from "@/components/PrivacyNotice";
import { MfaPrompt } from "@/components/TwoFactor";
import { AccountMenu } from "@/components/AccountMenu";
import { Logo } from "@/components/Logo";
import { WebsiteLink } from "@/components/LegalLinks";
import { AddProfileDialog } from "@/components/AddProfileDialog";
import { PARTS } from "@/operator";
import { useIntake } from "@/components/Intake";
import { Sidebar, useNavModel, type NavItem } from "@/components/Sidebar";
import { AtlasLauncher } from "@/atlas/AtlasLauncher";
import { AtlasConsentDialog } from "@/atlas/AtlasConsentDialog";
import { AtlasActivity } from "@/atlas/AtlasActivity";
import { AppVersion } from "@/components/AppUpdates";
import { checkForUpdates } from "@/services/updates";

export function AppShell({ children }: { children: ReactNode }) {
  const profile = useProfile();
  const vault = useVault();
  const nav = useNavModel();
  const navigate = useNavigate();
  const location = useLocation();
  const intake = useIntake();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmExitDemo, setConfirmExitDemo] = useState(false);
  useAutoTour();
  const unread = vault.notifications.filter((n) => !n.readAt && !n.dismissedAt && (!n.profileId || n.profileId === profile.id)).length;
  const jobs = useImporter((s) => s.jobs);
  const isAdmin = useSync((s) => s.isAdmin);
  const announcements = useSync((s) => s.announcements);
  const updateRequired = useSync((s) => s.updateRequired);
  const [hiddenAnnouncements, setHiddenAnnouncements] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("summa.ann.hidden") ?? "[]"); } catch { return []; } });
  const visibleAnnouncements = announcements.filter((a) => !hiddenAnnouncements.includes(a.id));
  const activeJobs = jobs.filter((j) => j.status !== "done" && j.status !== "duplicate" && j.status !== "error").length;

  useEffect(() => setMobileOpen(false), [location.pathname]);
  // pages whose list/chat scrolls inside the page instead of the whole page
  const fullHeight = /^\/(belege|atlas)(\/|$)/.test(location.pathname);

  // Global drag & drop import: files dropped anywhere become invoices – except over areas that take files themselves
  // (data-own-drop, e.g. the Atlas chat), which show their own hint.
  useEffect(() => {
    let depth = 0;
    const own = (e: DragEvent) => !!(e.target instanceof Element && e.target.closest("[data-own-drop]"));
    const onEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        depth++;
        setDragging(!own(e));
      }
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes("Files")) setDragging(!own(e));
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (own(e)) return;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      const picked = await Promise.all(files.map(async (f) => ({ name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
      importFiles(picked, "upload");
      navigate("/belege");
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [navigate]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        void useSession.getState().lock();
      }
      if (e.key === "n" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setQuickAdd(true);
      }
      if (e.key === "u" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void pickAndImport();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickAndImport = (capture = false) => intake.upload(capture);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="hidden lg:block"><Sidebar /></div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="animate-fade-in"><Sidebar solid /></div>
          <div className="flex-1 bg-slate-950/40" onClick={() => setMobileOpen(false)} />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-(--border) px-3 sm:px-5" data-tauri-drag-region>
          <button className="rounded-lg p-2 hover:bg-(--surface-2) lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Menü">
            <MenuIcon className="h-5 w-5" />
          </button>
          <WebsiteLink className="flex items-center gap-2 lg:hidden"><Logo className="h-6 w-6" /><span className="text-[15px] font-semibold">Ordo</span></WebsiteLink>
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
            <button type="button" onClick={() => void pickAndImport()} className="hidden items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text) focus-visible:focus-ring lg:inline-flex" title="Rechnungsdateien auswählen oder per Drag & Drop ins Fenster ziehen">
              <Upload className="h-4 w-4 shrink-0" aria-hidden="true" /><span>Rechnungen ins Fenster ziehen oder auswählen</span>
            </button>
            {activeJobs ? <Badge tone="info" className="animate-fade-in">{activeJobs} {activeJobs === 1 ? "Datei wird" : "Dateien werden"} gelesen …</Badge> : null}
          </div>
          {isMobile ? (
            <Button variant="ghost" size="icon" onClick={() => void pickAndImport(true)} title="Rechnung fotografieren">
              <Camera className="h-4 w-4" />
            </Button>
          ) : null}
          <AppVersion />
          <Button variant="outline" size="sm" className="h-9 rounded-full px-3.5 max-lg:hidden" onClick={() => window.dispatchEvent(new Event("ordo:atlas-open"))} title="Atlas fragen (Strg+J)">
            <Sparkles className="h-4 w-4 text-brand-700 dark:text-brand-400" /> Atlas fragen
          </Button>
          {PARTS.FeedbackButton ? <PARTS.FeedbackButton /> : null}
          <NotificationBell count={unread} />
          <AccountMenu />
        </header>
        <AtlasActivity />
        {updateRequired ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
            <Megaphone className="h-3.5 w-3.5" />
            <span className="font-semibold">Update nötig</span>
            <span className="flex-1">Diese Ordo-Version ist zu alt für den Sync-Server. Prüfe das Update und aktualisiere über den Hinweis oben.</span>
            <Button size="sm" variant="outline" onClick={() => void checkForUpdates()}>Nach Updates suchen</Button>
          </div>
        ) : null}
        {visibleAnnouncements.map((a) => (
          <div key={a.id} className={cls("flex flex-wrap items-center gap-2 border-b px-4 py-1.5 text-xs", a.level === "critical" ? "border-red-300 bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-100" : a.level === "warning" ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100" : "border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-900 dark:bg-brand-950/60 dark:text-brand-100")}>
            <Megaphone className="h-3.5 w-3.5" />
            <span className="font-semibold">{a.title}</span>
            <span className="flex-1">{a.body}</span>
            <button className="underline hover:no-underline" onClick={() => { const next = [...hiddenAnnouncements, a.id]; setHiddenAnnouncements(next); try { localStorage.setItem("summa.ann.hidden", JSON.stringify(next)); } catch { /* ignore */ } }}>Ausblenden</button>
          </div>
        ))}
        {vault.settings.demoMode ? (
          <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
            <span className="font-semibold">Demo</span>
            <span className="hidden flex-1 md:inline">Alles Beispieldaten. Zwischen Firma und Privat wechselst du im Menü rechts oben. Passwort: demo.</span>
            <span className="flex-1 md:hidden">Beispieldaten</span>
            <button className="shrink-0 font-medium underline hover:no-underline" onClick={() => setConfirmExitDemo(true)}><span className="hidden md:inline">Demo beenden &amp; selbst starten</span><span className="md:hidden">Demo beenden</span></button>
          </div>
        ) : null}
        {/* Padding lives on the scroll container so pages can use h-full (Rechnungen: list + review pane fill the
            viewport and scroll internally) while taller pages still scroll with the bottom padding intact. */}
        {/* On the web the free Netlify plan pins its badge into the bottom-right corner – full-height pages end
            above it there, so action bars at the bottom (e.g. "Passt – buchen") stay clickable. */}
        <main className={cls("min-h-0 flex-1 overflow-y-auto px-4 pt-6 sm:px-8", fullHeight && (isTauri ? "pb-24 lg:pb-6" : "pb-24 lg:pb-16"))}>
          {/* Full-height pages fill the viewport exactly; all others grow and keep their bottom space inside the
              wrapper – padding on the scroll container itself is lost when content overflows a fixed-height child. */}
          <div className={fullHeight ? "h-full w-full" : "min-h-full w-full pb-24 lg:pb-14"}>{children}</div>
        </main>
        <PrivacyNotice sidebar />
        <MfaPrompt />
        <AddProfileDialog />
        <MobileNav items={nav.mobile} isActive={nav.isActive} />
      </div>
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-brand-900/70 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-white/80 px-10 py-8 text-center text-white">
            <Upload className="mx-auto mb-2 h-10 w-10" />
            <div className="text-lg font-semibold">Hier loslassen</div>
            <div className="text-sm opacity-90">Rechnungen, Kassenbons, Kontoauszüge – Ordo erkennt alles selbst</div>
          </div>
        </div>
      ) : null}
      <TransactionDialog open={quickAdd} onClose={() => setQuickAdd(false)} />
      <Tour />
      <AtlasLauncher />
      <AtlasConsentDialog />
      <ConfirmDialog open={confirmExitDemo} onClose={() => setConfirmExitDemo(false)} danger title="Demo beenden?" body="Die Beispieldaten werden gelöscht und du richtest Ordo für dich ein." confirmLabel="Demo beenden" onConfirm={exitDemo} />
    </div>
  );
}

function NotificationBell({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  const vault = useVault();
  const profile = useProfile();
  const navigate = useNavigate();
  const items = vault.notifications.filter((n) => !n.dismissedAt && (!n.profileId || n.profileId === profile.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  return (
    <div className="relative">
      <Button variant="ghost" size="icon" onClick={() => setOpen((o) => !o)} title="Benachrichtigungen">
        <Bell className="h-4 w-4" />
        {count ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{count}</span> : null}
      </Button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="glass-strong animate-pop-in absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-[22px] shadow-pop sm:w-96">
            <div className="flex items-center justify-between border-b border-(--border) px-4 py-2">
              <span className="text-sm font-semibold">Benachrichtigungen</span>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-(--surface-2)"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? <div className="px-4 py-8 text-center text-sm text-(--text-muted)">Alles erledigt – keine offenen Hinweise.</div> : null}
              {items.map((n) => (
                <div key={n.id} className={cls("flex gap-3 border-b border-(--border) px-4 py-3 last:border-0", !n.readAt && "bg-brand-50/60 dark:bg-brand-900/20")}>
                  <div className="min-w-0 flex-1">
                    <button className="block w-full text-left" onClick={() => { markNotificationRead(n.id); if (n.link) { navigate(n.link.replace(/^\//, "/")); setOpen(false); } }}>
                      <div className="text-sm font-medium">{n.title}</div>
                      <div className="text-xs text-(--text-muted)">{n.body}</div>
                      <div className="mt-1 text-[11px] text-(--text-muted)">{fmtRelative(n.createdAt)}</div>
                    </button>
                  </div>
                  <button onClick={() => dismissNotification(n.id)} className="self-start rounded-md p-1 text-(--text-muted) hover:bg-(--surface-2)" title="Ausblenden"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MobileNav({ items, isActive }: { items: NavItem[]; isActive: (to: string) => boolean }) {
  return (
    <nav className="glass safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-(--glass-border) lg:hidden" aria-label="Navigation">
      {items.map((n) => {
        const active = isActive(n.to);
        const Icon = n.icon;
        return (
          <Link key={n.to} to={n.to} aria-current={active ? "page" : undefined} className={cls("relative flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-2 text-[11px] font-medium", active ? "text-brand-700 dark:text-brand-400" : "text-(--text-muted)")}>
            <Icon className="h-[21px] w-[21px]" />
            <span className="max-w-full truncate">{n.short ?? n.label}</span>
            {n.badge ? <span className="absolute right-1/4 top-1 rounded-md bg-brand-700 px-1 text-[9px] font-bold text-white">{n.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
