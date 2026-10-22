/**
 * The two editions of Ordo share all code except src/operator/: the hosted Ordo brings its operator's server,
 * legal pages, admin area and survey; the open-source community edition brings empty counterparts
 * (operator/*.community.ts[x], swapped in by scripts/export-community.mjs).
 */
import type { ComponentType, ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PickedFile } from "@/platform/types";
import type { AtlasTool } from "@/atlas/tools";

export interface OperatorConfig {
  /** "ordo": the hosted Ordo by its operator; "community": the open-source edition anyone can build and run. */
  edition: "ordo" | "community";
  /** Server every new account uses unless the person connects an own database; null = none preconfigured. */
  server: { url: string; anonKey: string; label: string } | null;
  /** Web app address – sign-up e-mails link here. Empty: the address the app runs at. */
  webUrl: string;
  /** Project website (also the link behind the logo). */
  website: string;
  /** Legal pages of the operator, shown on sign-in screens and in the settings. */
  legalPages: { label: string; href: string }[];
  /** Shown in Settings → Über Ordo. */
  provider: string | null;
  /** Desktop updates from the operator's signed releases. */
  updates: boolean;
  /** The operator's announcements to all accounts (a table only the operator's schema has); null = none. */
  fetchAnnouncements: ((client: SupabaseClient) => PromiseLike<{ data: unknown[] | null }>) | null;
}

/** Screens and buttons only the operator's edition has. */
export interface OperatorParts {
  routes: { path: string; element: ReactNode }[];
  /** Admin link in the sidebar for accounts with the admin role. */
  adminPath: string | null;
  /** The survey about planned offers ("Pläne & Abstimmung"). */
  plansPath: string | null;
  /** Extra tabs under Einstellungen (e.g. taking over data from an old system). */
  settingsTabs: { id: string; label: string; element: ReactNode }[];
  FeedbackButton: ComponentType | null;
  /** Upgrade button next to the plan in Settings → Konto. */
  PlanUpgrade: ComponentType | null;
  /** Puts an e-mail address on the operator's waitlist when the server takes no new accounts. */
  joinWaitlist: ((email: string) => Promise<void>) | null;
  /** Deletes the signed-in account on the server; null = the generic way (summa_delete_self). */
  deleteAccount: (() => Promise<void>) | null;
  /** Files Atlas understands only in this edition (e.g. the backup of the operator's old ERP) and the tools for them. */
  atlasFiles: {
    recognize(file: PickedFile): Promise<{ format: string; summary: string; data: unknown } | null>;
    tools: AtlasTool[];
  } | null;
}
