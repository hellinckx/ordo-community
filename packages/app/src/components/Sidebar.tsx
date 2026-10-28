import { useMemo, type ComponentType } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ChevronDown, LayoutGrid, Loader2, MessageCircleQuestion, Settings as SettingsIcon, ShieldCheck, Sparkles, X } from "lucide-react";
import { useAtlasActivity } from "@/atlas/AtlasActivity";
import { useProfile, useSettingsMutator, useVault } from "@/state/hooks";
import { useSync } from "@/services/sync";
import { cls } from "@/lib/format";
import { Logo } from "@/components/Logo";
import { WebsiteLink } from "@/components/LegalLinks";
import { PARTS } from "@/operator";
import { IntakeButton } from "@/components/Intake";
import { QuickCreate } from "@/components/QuickCreate";
import { useInstalledModules } from "@/modules/registry";
import type { OrdoModule } from "@/modules/types";

export interface NavItem {
  to: string;
  label: string;
  short?: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
  mobileRank?: number;
}

export interface NavSection {
  id: string;
  /** No title = top block. */
  title?: string;
  module?: OrdoModule;
  items: NavItem[];
}

/**
 * Builds the sidebar from the installed modules. With only Summa installed the layout stays the simple one
 * people know (flat list + "Mehr"); as soon as another module is installed, items are grouped per module.
 */
export function useNavModel() {
  const vault = useVault();
  const profile = useProfile();
  const modules = useInstalledModules();
  const isAdmin = useSync((s) => s.isAdmin);
  const location = useLocation();

  return useMemo(() => {
    const badges: Record<string, number> = {};
    for (const m of modules) Object.assign(badges, m.badges?.({ vault, profile }) ?? {});
    const visible = (m: OrdoModule) => !m.modes || m.modes.includes(profile.mode);
    const items = (m: OrdoModule) =>
      m.nav
        .filter((n) => !n.modes || n.modes.includes(profile.mode))
        .map((n) => ({ to: n.to, label: n.labelFor?.[profile.mode] ?? n.label, short: n.short, icon: n.icon, badge: badges[n.to], mobileRank: n.mobileRank, secondary: n.secondary, advanced: n.advanced }));
    const basis = modules.find((m) => m.id === "basis");
    const extras = modules.filter((m) => m.id !== "basis" && visible(m));
    const simple = extras.every((m) => m.id === "summa");
    const basisItems = basis ? items(basis) : [];
    const top = basisItems.filter((n) => n.to === "/" || n.to === "/atlas");
    const general = basisItems.filter((n) => n.to !== "/" && n.to !== "/atlas");

    let sections: NavSection[];
    if (simple) {
      const summa = extras.find((m) => m.id === "summa");
      const summaItems = summa ? items(summa) : [];
      sections = [
        { id: "top", items: [...top.slice(0, 1), ...summaItems.filter((n) => !n.secondary), ...top.slice(1)] },
        { id: "more", title: "Mehr", items: [...summaItems.filter((n) => n.secondary), ...general.filter((n) => !n.advanced)] },
      ];
    } else {
      sections = [
        { id: "top", items: top },
        ...extras.map((m) => ({ id: m.id, title: m.title, module: m, items: items(m) })),
        { id: "basis", title: "Allgemein", items: general },
      ];
    }
    sections = sections.filter((s) => s.items.length);

    const bottom: NavItem[] = [
      { to: "/module", label: "Module", icon: LayoutGrid },
      { to: "/einstellungen", label: "Einstellungen", icon: SettingsIcon },
      ...(isAdmin && PARTS.adminPath ? [{ to: PARTS.adminPath, label: "Admin", icon: ShieldCheck }] : []),
    ];

    const all = sections.flatMap((s) => s.items);
    const mobile = [...all].filter((n) => n.mobileRank !== undefined).sort((a, b) => (a.mobileRank ?? 9) - (b.mobileRank ?? 9)).slice(0, 5);

    // Outgoing invoices are reviewed on the incoming page (?richtung=ausgang) but belong to "Ausgehend".
    const outgoingView = location.pathname.startsWith("/belege") && new URLSearchParams(location.search).get("richtung") === "ausgang";
    const isActive = (to: string) => {
      if (to === "/") return location.pathname === "/";
      if (to === "/belege" && outgoingView) return false;
      if (to === "/rechnungen" && outgoingView) return true;
      return location.pathname === to || location.pathname.startsWith(`${to}/`);
    };
    return { simple, sections, bottom, mobile, isActive, hasSumma: modules.some((m) => m.id === "summa") };
  }, [modules, vault, profile, isAdmin, location.pathname, location.search]);
}

/** `solid`: on the phone the sidebar lies over the page – no see-through glass there. */
export function Sidebar({ solid }: { solid?: boolean } = {}) {
  const atlasActivity = useAtlasActivity();
  const nav = useNavModel();
  const vault = useVault();
  const mutate = useSettingsMutator();
  const navigate = useNavigate();
  const collapsed = vault.settings.ui.collapsedNav;
  const toggle = (id: string) => mutate((s) => ({ ...s, ui: { ...s.ui, collapsedNav: collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id] } }));

  const link = (n: NavItem) => {
    const active = nav.isActive(n.to);
    const Icon = n.icon;
    const activityHere = atlasActivity.filter(({ run }) => n.to === "/atlas" || run.workArea?.path === n.to || run.workArea?.path.startsWith(n.to + "/"));
    return (
      <Link
        key={n.to}
        to={n.to}
        aria-current={active ? "page" : undefined}
        className={cls(
          "group flex h-8.5 items-center gap-2.5 rounded-[10px] px-2.5 text-[13.5px] transition-colors",
          active ? "bg-(--sidebar-active) font-medium text-(--text) shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "text-(--text-muted) hover:bg-(--sidebar-hover) hover:text-(--text)",
        )}
      >
        <Icon className={cls("h-[17px] w-[17px] shrink-0 transition-colors", active ? "text-brand-700 dark:text-brand-400" : "text-(--text-muted) group-hover:text-(--text)")} />
        <span className="min-w-0 flex-1 truncate">{n.label}</span>
        {activityHere.some(({ run }) => run.status === "running") ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-700 motion-reduce:animate-none dark:text-brand-300" aria-label="Atlas arbeitet hier" /> : activityHere.length ? <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 text-brand-700 dark:text-brand-300" aria-label="Atlas wartet hier auf dich" /> : null}
        {n.badge ? <span className="min-w-5 rounded-full bg-brand-700 px-1.5 text-center text-[11px] leading-5 font-semibold text-white tabular" title={`${n.badge} zum Prüfen`}>{n.badge}</span> : null}
      </Link>
    );
  };

  return (
    <aside className={cls("flex h-full w-[272px] shrink-0 flex-col overflow-hidden border-r border-(--glass-border)", solid ? "bg-(--bg) shadow-pop" : "glass bg-(--sidebar)")}>
      <div className="flex h-14 items-center px-3" data-tauri-drag-region>
        <WebsiteLink className="flex items-center gap-2.5 rounded-xl px-2 py-1 transition-colors hover:bg-(--surface-2)">
          <Logo className="h-7 w-7" />
          <span className="text-[17px] font-semibold tracking-[-0.02em]">Ordo</span>
        </WebsiteLink>
      </div>
      <div className="flex gap-2 px-3 pt-1 pb-3">
        {nav.hasSumma ? <IntakeButton className="min-w-0 flex-1" /> : null}
        {!nav.simple || !nav.hasSumma ? <QuickCreate wide={!nav.hasSumma} /> : null}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Hauptnavigation">
        {nav.sections.map((s) => {
          const isCollapsed = !!s.title && collapsed.includes(s.id);
          return (
            <div key={s.id} className={s.title ? "mt-5" : undefined}>
              {s.title ? (
                <button type="button" onClick={() => toggle(s.id)} className="group mb-1.5 flex w-full items-center gap-2.5 px-2 text-left text-[12.5px] font-semibold text-(--text-muted) hover:text-(--text)">
                  {s.module && s.module.id !== "basis" ? <ModuleTile module={s.module} size="sm" /> : null}
                  <span className="flex-1">{s.title}</span>
                  <ChevronDown className={cls("h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100", isCollapsed && "-rotate-90 opacity-100")} />
                </button>
              ) : null}
              {!isCollapsed ? <div className="space-y-0.5">{s.items.map(link)}</div> : null}
            </div>
          );
        })}
        {nav.simple && !vault.settings.ui.hideUpgrade ? (
          <div className="mt-6 mb-2 rounded-2xl border border-(--glass-border) bg-(--surface) p-4 shadow-card">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />
              <div className="min-w-0 flex-1 text-[13px]">
                <div className="font-medium">Ordo kann mehr</div>
                <p className="mt-0.5 text-xs text-(--text-muted)">Projekte, Zeiterfassung, Lager und Produktion – wenn du sie brauchst.</p>
                <button type="button" onClick={() => navigate("/module")} className="mt-2 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">Module ansehen</button>
              </div>
              <button type="button" aria-label="Ausblenden" title="Ausblenden (wieder unter Module)" onClick={() => mutate((s) => ({ ...s, ui: { ...s.ui, hideUpgrade: true } }))} className="rounded-md p-0.5 text-(--text-muted) hover:bg-(--surface-2)"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ) : null}
      </nav>
      <div className="space-y-0.5 border-t border-(--glass-border) p-3">{nav.bottom.map(link)}</div>
    </aside>
  );
}

/** iOS-style coloured tile with the module icon. */
export function ModuleTile({ module, size = "md" }: { module: OrdoModule; size?: "xs" | "sm" | "md" | "lg" }) {
  const Icon = module.icon;
  const box = { xs: "h-4 w-4 rounded-[5px]", sm: "h-6 w-6 rounded-[7px]", md: "h-10 w-10 rounded-xl", lg: "h-14 w-14 rounded-2xl" }[size];
  const ico = { xs: "h-2.5 w-2.5", sm: "h-3.5 w-3.5", md: "h-5 w-5", lg: "h-7 w-7" }[size];
  if (module.id === "basis") return <Logo className={box} />;
  return (
    <span className={cls("inline-flex shrink-0 items-center justify-center text-white", box)} style={{ background: module.tint }}>
      <Icon className={ico} />
    </span>
  );
}
