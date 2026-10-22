/**
 * Public, build-time configuration. The anon/publishable key is safe to ship:
 * every table and the storage bucket are protected by row-level security, and the vault itself is
 * encrypted with the user's password before it reaches the server (the vault key is additionally deposited
 * in Supabase Vault so a forgotten password can be reset by e-mail – see services/sync.ts).
 *
 * Which server, website and legal pages come from src/operator/config.ts; VITE_* variables override them.
 */
import { OPERATOR } from "@/operator/config";

const env = (key: string) => (import.meta.env[key] as string | undefined) || "";

/** The preconfigured server (url "" = none: without account or with an own database only). */
export const SUMMA_SYNC_DEFAULT = {
  url: env("VITE_SUMMA_SYNC_URL") || OPERATOR.server?.url || "",
  anonKey: env("VITE_SUMMA_SYNC_ANON_KEY") || OPERATOR.server?.anonKey || "",
  label: OPERATOR.server?.label || "Server (vorkonfiguriert)",
};

export const HAS_DEFAULT_SERVER = !!(SUMMA_SYNC_DEFAULT.url && SUMMA_SYNC_DEFAULT.anonKey);

/**
 * Public web app. Auth emails (confirm sign-up) point here explicitly, so they never depend on the
 * project's Site URL (desktop origins are not web URLs). Must stay in the project's redirect allow list.
 * Empty: the project's Site URL decides.
 */
export const SUMMA_WEB_URL = env("VITE_SUMMA_WEB_URL") || OPERATOR.webUrl;

/** Project website (landing page, Schnittstellen) – also behind the logo. */
export const SUMMA_SITE_URL = OPERATOR.website;

/** Profiles per vault/account: one private plus a few businesses is plenty, and keeps sync small. */
export const MAX_PROFILES = 5;
