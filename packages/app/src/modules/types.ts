import type { ComponentType, ReactNode } from "react";
import type { Mode, Profile, Vault, VaultStore } from "@ordo/core";
import type { AtlasTool } from "@/atlas/tools";

/** Everything Ordo can install. "basis" is always there and cannot be removed. */
export type ModuleId = "basis" | "summa" | "projekte" | "produkte" | "produktion" | "post";

export interface NavItemDef {
  to: string;
  label: string;
  /** Different label per profile mode, e.g. "Rechnungen & Bons" for private profiles. */
  labelFor?: Partial<Record<Mode, string>>;
  /** Short label for the mobile tab bar. */
  short?: string;
  icon: ComponentType<{ className?: string }>;
  /** Only shown for these profile modes (default: all). */
  modes?: Mode[];
  /** Also active on these path prefixes. */
  alsoActive?: string[];
  /** Mobile tab bar candidate, lower = earlier. */
  mobileRank?: number;
  /** In the simple layout (only Summa installed): shown under "Mehr" instead of on top. */
  secondary?: boolean;
  /** Hidden in the simple layout, appears once more modules are installed. */
  advanced?: boolean;
}

/** Entry in the "+ Neu" menu. The target page opens its create dialog for "?neu=1". */
export interface QuickAction {
  label: string;
  icon: ComponentType<{ className?: string }>;
  to: string;
  modes?: Mode[];
}

export interface RouteDef {
  path: string;
  element: ReactNode;
}

export interface OrdoModule {
  id: ModuleId;
  /** Product name, e.g. "Summa". */
  name: string;
  /** What it is, e.g. "Buchhaltung". */
  title: string;
  /** One line for lists. */
  tagline: string;
  /** A few sentences for the module page. */
  description: string;
  features: string[];
  /** Icon on the coloured tile (iOS-style). */
  icon: ComponentType<{ className?: string }>;
  /** Tile colour. */
  tint: string;
  /** Installed for new workspaces. */
  defaultInstalled: boolean;
  /** Cannot be uninstalled. */
  required?: boolean;
  requires?: ModuleId[];
  /** Profile modes in which the module makes sense (default: all). */
  modes?: Mode[];
  /** Works on the phone (PWA). */
  mobile: boolean;
  nav: NavItemDef[];
  routes: RouteDef[];
  quickActions?: QuickAction[];
  /** Cards on the Übersicht. "wide" spans two columns. */
  dashboardWidgets?: { id: string; element: ReactNode; wide?: boolean; modes?: Mode[] }[];
  /** Extra tabs under Einstellungen. */
  settingsTabs?: { id: string; label: string; element: ReactNode }[];
  /** Badge counts per nav path ("needs you"). Pure – runs on every vault change. */
  badges?: (ctx: { vault: Vault; profile: Profile }) => Record<string, number>;
  /** Tools Atlas may use when the module is installed. */
  atlasTools?: AtlasTool[];
  /** Short description of the module's data for Atlas' system prompt. */
  atlasContext?: string;
  /** Sample content for the demo workspace. */
  seedDemo?: (store: VaultStore, profileId: string) => void;
}
