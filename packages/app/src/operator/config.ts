/**
 * Ordo Community Edition: no preconfigured server and no operator. Ordo runs without an account (everything stays
 * on the device) or with your own Supabase project (see SELFHOST.md). To build in a server for everyone using
 * your build, set VITE_ORDO_SYNC_URL and VITE_ORDO_SYNC_ANON_KEY.
 */
import type { OperatorConfig } from "@/edition";

export const OPERATOR: OperatorConfig = {
  edition: "community",
  server: null,
  webUrl: "",
  website: "https://ordo-app.at/",
  legalPages: [],
  provider: null,
  updates: false,
  fetchAnnouncements: null,
};
