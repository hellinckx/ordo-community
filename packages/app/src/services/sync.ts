/**
 * Optional sync via Supabase (preconfigured Summa server or a self-hosted project). Only sealed vault bytes
 * and encrypted attachment blobs are uploaded and the server never gets the password. So that a forgotten
 * password can be reset by e-mail code, the vault key itself is kept in Supabase Vault for the signed-in
 * account (see ensureKeyEscrow) – the operator could therefore decrypt; the privacy policy says so.
 * Conflicts are merged entity-wise (newest updatedAt wins).
 */
import { create } from "zustand";
import type { RealtimeChannel, SupabaseClient, Session } from "@supabase/supabase-js";
import { readHeader, openVaultPayload, migrateVault, mergeVaults, mergeSettings, nowIso, type VaultStore } from "@ordo/core";
import { useSession } from "@/state/session";
import { toast } from "@/state/toasts";
import { SUMMA_SYNC_DEFAULT, SUMMA_WEB_URL } from "@/config";
import { getPlatform, isTauri } from "@/platform";
import { isOrdoServer, serverLabel, usagePeak, type ProjectUsage, type ServerTarget } from "./server";
import { OPERATOR } from "@/operator/config";
import { passSecondFactor, secondFactorMissing } from "./mfa";

export const BUCKET = "summa";
const REV_KEY = "summa.sync.revision";
/** The server state this device last saw or wrote ("revision:device"); anything else on the server is new. */
const SEEN_KEY = "summa.sync.seen";
const DEVICE_KEY = "summa.sync.device";

/** An id for this browser or installation. The vault's own sync.deviceId travels with the vault and is the same everywhere. */
export function localDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}
const mark = (revision: number, device: string | null | undefined) => `${revision}:${device ?? ""}`;
let metaRefreshedAt = 0;

export interface Announcement {
  id: string;
  title: string;
  body: string;
  level: "info" | "warning" | "critical";
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

export type PlanId = "free" | "pro" | "family";
export interface PlanDef {
  label: string;
  storage_mb: number;
  devices: number;
  price_eur: number;
}

export interface ServerSettings {
  min_app_version?: string;
  maintenance?: { active: boolean; message: string };
  signups_enabled?: boolean;
  max_vault_mb?: number;
  max_accounts?: number;
  feature_flags?: Record<string, boolean>;
  plans?: Partial<Record<PlanId, PlanDef>>;
  /** Ordo modules every account may install (per-account overrides in summa_users.modules). */
  module_access?: Record<string, boolean>;
}

/** Storage allowance in MB for a plan (mirrors summa_plan_limit_mb on the server). */
export function planLimitMb(plan: PlanId, settings: ServerSettings): number {
  return settings.plans?.[plan]?.storage_mb ?? settings.max_vault_mb ?? 50;
}

/** Thrown by signUp when the server refuses new accounts (cap reached or signups closed). */
export class SignupClosedError extends Error {
  constructor(public reason: "full" | "closed") {
    super(reason === "full" ? "Derzeit sind alle Plätze vergeben – trag dich in die Warteliste ein." : "Die Registrierung ist derzeit geschlossen.");
    this.name = "SignupClosedError";
  }
}

/** Server-side error codes → German messages. */
let escrowedFor: string | null = null;

/** Deposits the vault key for this account (once per session) so a password reset needs only the e-mail code. */
async function ensureKeyEscrow(client: SupabaseClient, uid: string, store: VaultStore): Promise<void> {
  if (escrowedFor === uid) return;
  const raw = store.exportMasterKeyRaw();
  try {
    const { error } = await client.rpc("summa_escrow_put", { p_key: bytesToBase64(raw) });
    if (!error) escrowedFor = uid;
  } catch {
    /* offline or server hiccup – the next sync tries again */
  } finally {
    raw.fill(0);
  }
}

/** The account's deposited vault key, or null when none was deposited yet. */
export async function fetchEscrowedKey(client: SupabaseClient): Promise<Uint8Array | null> {
  const { data, error } = await client.rpc("summa_escrow_get");
  if (error || typeof data !== "string" || !data) return null;
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function translateAuthError(message: string): string {
  if (/SUMMA_ACCOUNT_LIMIT|Database error saving new user/i.test(message)) return "Derzeit sind alle Plätze vergeben – trag dich in die Warteliste ein.";
  if (/SUMMA_SIGNUPS_CLOSED/i.test(message)) return "Die Registrierung ist derzeit geschlossen.";
  if (/row-level security|violates.*policy/i.test(message)) return "Speicherlimit erreicht – Belege auslagern oder Tarif erhöhen.";
  if (/Invalid login credentials/i.test(message)) return "E-Mail oder Passwort stimmen nicht.";
  if (/Email not confirmed/i.test(message)) return "Bitte zuerst den Link in der Bestätigungs-E-Mail öffnen.";
  if (/User already registered/i.test(message)) return "Für diese E-Mail gibt es schon ein Konto – bitte anmelden.";
  if (/rate limit|too many/i.test(message)) return "Zu viele Versuche – bitte in ein paar Minuten noch einmal.";
  const wait = /only request this after (\d+) seconds/i.exec(message);
  if (wait) return `Bitte warte noch ${wait[1]} Sekunden und versuch es dann noch einmal.`;
  if (/Error sending .*email/i.test(message)) return "Die E-Mail konnte gerade nicht verschickt werden. Bitte in ein paar Minuten noch einmal versuchen.";
  if (/Token has expired|otp.*(expired|invalid)|invalid.*otp/i.test(message)) return "Der Code ist falsch oder abgelaufen. Fordere einen neuen an.";
  return message;
}

function versionLess(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

interface SyncState {
  session: Session | null;
  client: SupabaseClient | null;
  status: "idle" | "syncing" | "error";
  lastError: string | null;
  lastSyncAt: string | null;
  remoteRevision: number | null;
  isAdmin: boolean;
  announcements: Announcement[];
  serverSettings: ServerSettings;
  /** Own plan and account state from summa_users. */
  plan: PlanId;
  disabled: boolean;
  /** This build is older than the server's min_app_version. */
  updateRequired: boolean;
  /** Modules the operator allows for this account (null = not known yet, everything allowed). */
  moduleAccess: Record<string, boolean> | null;
  /** Address of the project the client talks to; ownServer = the person's own Supabase project, not ours. */
  serverUrl: string;
  ownServer: boolean;
  /** Last usage of the project against the Supabase limits (own projects; admins on the Ordo server). */
  usage: ProjectUsage | null;
  /** Two-factor sign-in is on and this session still needs the code from the authenticator app. */
  mfaNeeded: boolean;
  init(url?: string, anonKey?: string): Promise<void>;
  refreshUsage(): Promise<ProjectUsage | null>;
  signInWithPassword(email: string, password: string): Promise<void>;
  /** Returns true when the account is usable right away (no e-mail confirmation pending). */
  signUp(email: string, password: string): Promise<boolean>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  refreshMeta(): Promise<void>;
  sync(opts?: { silent?: boolean }): Promise<void>;
}

/**
 * The desktop's content security policy allows https://*.supabase.co only. A self-hosted Supabase on its own domain
 * is reached through the desktop shell instead (platform.net), which has no such limit.
 */
export async function shellFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const platform = await getPlatform();
  const req = new Request(input, init);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(await req.arrayBuffer());
  const headers: [string, string][] = [];
  req.headers.forEach((v, k) => headers.push([k, v]));
  const r = await platform.net!.fetch({ method: req.method, url: req.url, headers, body: body?.length ? body : undefined, timeoutMs: 120_000 });
  const keep = r.headers.filter(([k]) => !/^(content-encoding|transfer-encoding|content-length)$/i.test(k));
  return new Response(r.status === 204 || r.status === 304 ? null : (r.body as BlobPart), { status: r.status, headers: keep });
}

export async function makeClient(url: string, anonKey: string): Promise<SupabaseClient> {
  const { createClient } = await import("@supabase/supabase-js");
  const needsShell = isTauri && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url.replace(/\/+$/, ""));
  return createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !isTauri, flowType: "pkce" }, ...(needsShell ? { global: { fetch: shellFetch } } : {}) });
}

let ordoClientPromise: Promise<SupabaseClient> | null = null;
/**
 * Always the Ordo server – for what people send us on purpose (feedback, waitlist, votes, interest), even when their
 * data lives in their own project. Signed in only when the main client is the Ordo server itself.
 */
export function ordoClient(): Promise<SupabaseClient> {
  const st = useSync.getState();
  if (st.client && !st.ownServer) return Promise.resolve(st.client);
  ordoClientPromise ??= import("@supabase/supabase-js").then(({ createClient }) => createClient(SUMMA_SYNC_DEFAULT.url, SUMMA_SYNC_DEFAULT.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "ordo-public" } }));
  return ordoClientPromise;
}

/** Signed-in Ordo account, if any (null on own projects – votes there are made with an e-mail address). */
export function ordoSession(): Session | null {
  const st = useSync.getState();
  return st.ownServer ? null : st.session;
}

export const useSync = create<SyncState>((set, get) => ({
  session: null,
  client: null,
  status: "idle",
  lastError: null,
  lastSyncAt: null,
  remoteRevision: null,
  isAdmin: false,
  announcements: [],
  serverSettings: {},
  plan: "free",
  disabled: false,
  updateRequired: false,
  moduleAccess: null,
  serverUrl: SUMMA_SYNC_DEFAULT.url,
  ownServer: false,
  usage: null,
  mfaNeeded: false,

  async init(url = SUMMA_SYNC_DEFAULT.url, anonKey = SUMMA_SYNC_DEFAULT.anonKey) {
    if (!url || !anonKey) {
      set({ client: null, session: null, isAdmin: false });
      return;
    }
    // switching between the Ordo server and an own project starts from a clean slate
    if (get().serverUrl !== url) set({ session: null, usage: null, isAdmin: false, announcements: [], serverSettings: {}, moduleAccess: null });
    set({ serverUrl: url, ownServer: !isOrdoServer(url) });
    const client = await makeClient(url, anonKey);
    const { data } = await client.auth.getSession();
    client.auth.onAuthStateChange((_e, s) => {
      set({ session: s });
      if (s) void get().refreshMeta();
      else set({ isAdmin: false, announcements: [] });
    });
    set({ client, session: data.session ?? null });
    if (data.session) await get().refreshMeta();
  },

  async signInWithPassword(email, password) {
    const c = get().client;
    if (!c) throw new Error("Sync nicht konfiguriert.");
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(translateAuthError(error.message));
    await get().refreshMeta();
  },
  async signUp(email, password) {
    if (OPERATOR.privateInstance && !get().ownServer) throw new SignupClosedError("closed");
    const c = get().client;
    if (!c) throw new Error("Sync nicht konfiguriert.");
    // The server enforces the cap with a trigger; asking first gives a friendly answer instead of a 500.
    const { data: open } = await c.rpc("summa_signups_open");
    if (open && open.open === false) throw new SignupClosedError(open.reason === "closed" ? "closed" : "full");
    const { data, error } = await c.auth.signUp({ email, password, options: { emailRedirectTo: SUMMA_WEB_URL || undefined } });
    if (error) {
      if (/SUMMA_ACCOUNT_LIMIT|Database error saving new user/i.test(error.message)) throw new SignupClosedError("full");
      if (/SUMMA_SIGNUPS_CLOSED/i.test(error.message)) throw new SignupClosedError("closed");
      throw new Error(translateAuthError(error.message));
    }
    // Supabase answers an already registered address with an empty identities list instead of an error.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error("Für diese E-Mail gibt es schon ein Konto – bitte anmelden.");
    return !!data.session;
  },
  async signInWithGoogle() {
    const c = get().client;
    if (!c) throw new Error("Sync nicht konfiguriert.");
    const { error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + window.location.pathname } });
    if (error) throw new Error(error.message);
  },
  async signOut() {
    await get().client?.auth.signOut();
    set({ session: null, isAdmin: false, announcements: [], usage: null });
  },

  /** Project usage (numbers only). Null when the server does not offer it (old schema, not admin on the Ordo server). */
  async refreshUsage() {
    const { client, session, ownServer, isAdmin } = get();
    if (!client || !session || (!ownServer && !isAdmin)) return null;
    const { data, error } = await client.rpc("summa_project_usage");
    if (error || !data) return null;
    set({ usage: data as ProjectUsage });
    return data as ProjectUsage;
  },

  /** Role, announcements and server settings – cheap, runs after login and before every sync. */
  async refreshMeta() {
    const { client, session } = get();
    if (!client || !session) return;
    try {
      const [role, ann, settings, me] = await Promise.all([
        client.from("summa_roles").select("role").eq("user_id", session.user.id).maybeSingle(),
        // announcements come from the operator; the community edition has none
        OPERATOR.fetchAnnouncements ? OPERATOR.fetchAnnouncements(client) : Promise.resolve({ data: [] }),
        client.from("summa_settings").select("key,value"),
        client.from("summa_users").select("plan,disabled").eq("user_id", session.user.id).maybeSingle(),
      ]);
      const now = Date.now();
      const announcements = ((ann.data ?? []) as Announcement[]).filter((a) => new Date(a.starts_at).getTime() <= now && (!a.ends_at || new Date(a.ends_at).getTime() >= now));
      const serverSettings: ServerSettings = {};
      for (const row of (settings.data ?? []) as { key: string; value: unknown }[]) (serverSettings as Record<string, unknown>)[row.key] = row.value;
      const plan = ((me.data?.plan as PlanId | undefined) ?? "free") as PlanId;
      const disabled = !!me.data?.disabled;
      const updateRequired = !!serverSettings.min_app_version && versionLess(__APP_VERSION__, serverSettings.min_app_version);
      // module access: server default (summa_settings.module_access) overridden per account (summa_users.modules)
      const own = await client.from("summa_users").select("modules").eq("user_id", session.user.id).maybeSingle();
      const defaults = ((serverSettings as Record<string, unknown>).module_access ?? {}) as Record<string, boolean>;
      const overrides = ((own.data as { modules?: Record<string, boolean> } | null)?.modules ?? {}) as Record<string, boolean>;
      const moduleAccess = { ...defaults, ...overrides };
      set({ isAdmin: role.data?.role === "admin", announcements, serverSettings, plan, disabled, updateRequired, moduleAccess });
      if (disabled) {
        toast.error("Sync-Konto gesperrt", "Dieses Konto wurde vom Administrator gesperrt. Deine lokalen Daten bleiben erhalten.");
        await get().signOut();
        return;
      }
      // keep our profile row current (email, app version, platform)
      await client.from("summa_users").upsert({ user_id: session.user.id, email: session.user.email, app_version: __APP_VERSION__, platform: isTauri ? "desktop" : /Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "web" }, { onConflict: "user_id", ignoreDuplicates: false });
    } catch (e) {
      console.warn("sync meta", e);
    }
  },

  async sync(opts = {}) {
    const { client, session } = get();
    const store = useSession.getState().store;
    if (!client || !session || !store) return;
    // with 2FA on, the server hands out nothing until the code was entered (AppShell asks for it)
    if (await secondFactorMissing(client)) {
      set({ mfaNeeded: true });
      return;
    }
    if (get().mfaNeeded) set({ mfaNeeded: false });
    if (get().status === "syncing") return;
    set({ status: "syncing", lastError: null });
    const uid = session.user.id;
    const deviceId = localDeviceId();
    const logEntry = async (action: string, ok: boolean, message?: string, bytes?: number) => {
      try {
        await client.from("summa_sync_log").insert({ user_id: uid, device_id: deviceId, action, revision: store.vault.revision, bytes, ok, message });
      } catch {
        /* ignore */
      }
    };
    try {
      // plan, announcements and settings change rarely – not on every live sync
      if (!opts.silent || Date.now() - metaRefreshedAt > 5 * 60_000) {
        await get().refreshMeta();
        metaRefreshedAt = Date.now();
      }
      await ensureKeyEscrow(client, uid, store);
      const maint = get().serverSettings.maintenance;
      if (maint?.active) throw new Error(`Wartungsmodus: ${maint.message || "Sync vorübergehend deaktiviert."}`);
      await store.flush();
      const { data: meta } = await client.from("summa_vault_meta").select("revision, device_id").eq("user_id", uid).maybeSingle();
      const remoteRevision = (meta?.revision as number | undefined) ?? null;
      set({ remoteRevision });
      const localRevision = store.vault.revision;
      const lastSynced = Number(localStorage.getItem(REV_KEY) ?? 0);
      const seen = localStorage.getItem(SEEN_KEY);
      const remoteMark = meta ? mark(meta.revision as number, meta.device_id as string | null) : null;
      let localChanged = localRevision !== lastSynced;
      // something new on the server: a state this device has not seen (before this version: a higher revision)
      const remoteNew = remoteMark !== null && (seen ? remoteMark !== seen : remoteRevision! > lastSynced);
      let pulled = false;

      if (remoteNew) {
        const { data, error } = await client.storage.from(BUCKET).download(`${uid}/vault.summa`);
        if (error) throw new Error(error.message);
        const bytes = new Uint8Array(await data.arrayBuffer());
        const { header, payload } = readHeader(bytes);
        const json = await openVaultPayload(header, (store as unknown as { masterKey: CryptoKey }).masterKey, payload);
        const remote = migrateVault(JSON.parse(json));
        // Something may have changed here while the download ran (Atlas booking, an import) – then the remote state
        // must be merged in, never replace what was just written on this device.
        if (store.vault.revision !== localRevision) localChanged = true;
        // settings travel too (AI keys, Atlas, connections, theme …), area by area; folder paths stay on this device
        if (!localChanged) {
          store.mutate((v) => Object.assign(v, { ...remote, settings: mergeSettings(v.settings, remote.settings, "remote") }));
        } else {
          const { vault: merged, added, updated } = mergeVaults(store.vault, remote);
          store.mutate((v) => Object.assign(v, { ...merged, settings: mergeSettings(v.settings, remote.settings, "local") }));
          if (!opts.silent) toast.info("Sync: Änderungen zusammengeführt", `${added} neu, ${updated} aktualisiert`);
        }
        await logEntry("pull", true, undefined, bytes.byteLength);
        pulled = true;
      }

      if (!localChanged && store.vault.revision !== localRevision && !pulled) localChanged = true;
      if (!localChanged) {
        // nothing changed here: the server already has this state, only files that are new over there come down
        let downloaded = 0;
        if (pulled) downloaded = (await syncBlobs(client, uid, store, false)).downloaded;
        localStorage.setItem(REV_KEY, String(store.vault.revision));
        if (remoteMark) localStorage.setItem(SEEN_KEY, remoteMark);
        set({ status: "idle", lastSyncAt: nowIso() });
        if (!opts.silent) toast.success(pulled ? "Synchronisiert" : "Alles aktuell", pulled ? `Änderungen von deinem anderen Gerät übernommen${downloaded ? `, ${downloaded} Dateien geladen` : ""}.` : "Auf diesem Gerät und am Server ist derselbe Stand.");
        return;
      }

      // push – remember which state goes up: changes made while uploading are not on the server yet
      await store.flush();
      const pushedRev = store.vault.revision;
      const sealed = await store.exportSealed();
      const maxMb = planLimitMb(get().plan, get().serverSettings);
      const blobBytes = store.vault.attachments.filter((a) => !a.deletedAt).reduce((s, a) => s + a.size, 0);
      if (sealed.byteLength + blobBytes > maxMb * 1024 * 1024) throw new Error(`Speicherlimit (${maxMb} MB) erreicht – ${((sealed.byteLength + blobBytes) / 1048576).toFixed(0)} MB belegt. Alte Rechnungen als ZIP sichern und löschen oder den Tarif erhöhen.`);
      const up = await client.storage.from(BUCKET).upload(`${uid}/vault.summa`, new Blob([sealed as BlobPart]), { upsert: true, contentType: "application/octet-stream" });
      if (up.error) throw new Error(translateAuthError(up.error.message));

      const { uploaded, downloaded, downloadedBytes, remoteCount } = await syncBlobs(client, uid, store, true);
      const { error: metaErr } = await client.from("summa_vault_meta").upsert({ user_id: uid, revision: pushedRev, device_id: deviceId, vault_bytes: sealed.byteLength, blob_count: remoteCount + uploaded });
      if (metaErr) throw new Error(metaErr.message);
      localStorage.setItem(REV_KEY, String(pushedRev));
      // only when nothing else changed meanwhile, the own "last synced" stamp counts as synced too; otherwise the
      // newer changes stay marked as not uploaded and go up with the next sync
      const untouched = store.vault.revision === pushedRev;
      store.mutate((v) => {
        v.settings = { ...v.settings, sync: { ...v.settings.sync, lastSyncAt: nowIso() } };
      });
      const syncedRev = untouched ? store.vault.revision : pushedRev;
      localStorage.setItem(REV_KEY, String(syncedRev));
      if (untouched) await client.from("summa_vault_meta").update({ revision: syncedRev }).eq("user_id", uid);
      localStorage.setItem(SEEN_KEY, mark(syncedRev, deviceId));
      await logEntry("push", true, `${uploaded} hoch, ${downloaded} runter`, sealed.byteLength);
      // file downloads count as traffic on the Supabase plan – logged so the usage estimate can include them
      if (downloadedBytes) await logEntry("download", true, `${downloaded} Dateien`, downloadedBytes);
      set({ status: "idle", lastSyncAt: nowIso(), remoteRevision: store.vault.revision });
      if (!opts.silent) toast.success("Synchronisiert", `${(sealed.byteLength / 1024).toFixed(0)} KB · ${uploaded} Dateien hochgeladen, ${downloaded} geladen`);
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      if (get().ownServer && /fetch|network|Failed to|Verbindung/i.test(msg)) msg = `${serverLabel(get().serverUrl)} ist nicht erreichbar. Ist dein Supabase-Projekt pausiert? Im Supabase-Dashboard auf „Restore project“ drücken.`;
      set({ status: "error", lastError: msg });
      await logEntry("sync", false, msg);
      if (!opts.silent) toast.error("Sync fehlgeschlagen", msg);
    }
  },
}));

/** Attachments (encrypted files): uploads the ones the server lacks (when pushing) and downloads the ones this device lacks. */
async function syncBlobs(client: SupabaseClient, uid: string, store: VaultStore, upload: boolean): Promise<{ uploaded: number; downloaded: number; downloadedBytes: number; remoteCount: number }> {
  const { data: remoteList } = await client.storage.from(BUCKET).list(`${uid}/blobs`, { limit: 10000 });
  const remoteIds = new Set((remoteList ?? []).map((f) => f.name.replace(/\.bin$/, "")));
  const localIds = new Set(await store.storage.listBlobIds());
  let uploaded = 0;
  let downloaded = 0;
  let downloadedBytes = 0;
  for (const att of store.vault.attachments) {
    if (att.deletedAt) continue;
    if (upload && localIds.has(att.id) && !remoteIds.has(att.id)) {
      const enc = await store.storage.readBlob(att.id);
      if (enc) {
        const r = await client.storage.from(BUCKET).upload(`${uid}/blobs/${att.id}.bin`, new Blob([enc as BlobPart]), { upsert: true, contentType: "application/octet-stream" });
        if (!r.error) uploaded++;
      }
    } else if (!localIds.has(att.id) && remoteIds.has(att.id)) {
      const { data } = await client.storage.from(BUCKET).download(`${uid}/blobs/${att.id}.bin`);
      if (data) {
        const bytes = new Uint8Array(await data.arrayBuffer());
        await store.storage.writeBlob(att.id, bytes);
        downloaded++;
        downloadedBytes += bytes.byteLength;
      }
    }
  }
  // Files the vault no longer has (removed after the trash, replaced previews) go from the server too. Only when
  // pushing, never with an empty vault, and only files older than a few days – another device may just be
  // uploading files whose records it has not pushed yet.
  if (upload && store.vault.attachments.length) {
    const known = new Set(store.vault.attachments.map((a) => a.id));
    const cutoff = Date.now() - 3 * 86400_000;
    const stale = (remoteList ?? []).filter((f) => !known.has(f.name.replace(/\.bin$/, "")) && Date.parse(f.created_at ?? f.updated_at ?? "") < cutoff).map((f) => `${uid}/blobs/${f.name}`);
    for (let i = 0; i < stale.length; i += 100) await client.storage.from(BUCKET).remove(stale.slice(i, i + 100));
  }
  return { uploaded, downloaded, downloadedBytes, remoteCount: remoteIds.size };
}

/**
 * New device: downloads the sealed vault of an existing sync account into local storage.
 * Afterwards the user unlocks with the vault password (never transmitted).
 */
export async function bootstrapFromRemote(opts: { url?: string; anonKey?: string; email: string; password: string; code?: string; storage: { writeVault(bytes: Uint8Array): Promise<void>; writeBlob(id: string, bytes: Uint8Array): Promise<void> } }): Promise<{ bytes: number; blobs: number }> {
  const url = opts.url || SUMMA_SYNC_DEFAULT.url;
  const anonKey = opts.anonKey || SUMMA_SYNC_DEFAULT.anonKey;
  const client = await makeClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email: opts.email, password: opts.password });
  if (error) throw new Error(error.message);
  try {
    await passSecondFactor(client, opts.code);
  } catch (e) {
    // nothing stays signed in half-way; the next try starts with the password again
    await client.auth.signOut({ scope: "local" });
    throw e;
  }
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("Anmeldung fehlgeschlagen. Bitte noch einmal.");
  useSync.setState({ serverUrl: url, ownServer: !isOrdoServer(url) });
  const r = await downloadAccountData(client, data.session, opts.storage);
  localStorage.setItem("summa.sync.bootstrap", JSON.stringify({ url, anonKey }));
  return r;
}

/** Writes the account's encrypted vault and attachments to this device (sign-in on a new device, password reset). */
export async function downloadAccountData(client: SupabaseClient, session: Session, storage: { writeVault(bytes: Uint8Array): Promise<void>; writeBlob(id: string, bytes: Uint8Array): Promise<void> }): Promise<{ bytes: number; blobs: number }> {
  const uid = session.user.id;
  const dl = await client.storage.from(BUCKET).download(`${uid}/vault.summa`);
  if (dl.error || !dl.data) throw new Error("Auf diesem Konto liegt noch kein Tresor. Zuerst am ersten Gerät „Jetzt synchronisieren“ ausführen.");
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  await storage.writeVault(bytes);
  const { data: list } = await client.storage.from(BUCKET).list(`${uid}/blobs`, { limit: 10000 });
  let blobs = 0;
  for (const f of list ?? []) {
    const b = await client.storage.from(BUCKET).download(`${uid}/blobs/${f.name}`);
    if (b.data) {
      await storage.writeBlob(f.name.replace(/\.bin$/, ""), new Uint8Array(await b.data.arrayBuffer()));
      blobs++;
    }
  }
  const { data: meta } = await client.from("summa_vault_meta").select("revision, device_id").eq("user_id", uid).maybeSingle();
  localStorage.setItem(REV_KEY, String(meta?.revision ?? 0));
  if (meta) localStorage.setItem(SEEN_KEY, mark(meta.revision as number, meta.device_id as string | null));
  useSync.setState({ client, session });
  return { bytes: bytes.byteLength, blobs };
}

/** Downloads a single missing attachment on demand (e.g. opened on a second device before full sync). */
export async function ensureBlob(id: string, storage: { readBlob(id: string): Promise<Uint8Array | null>; writeBlob(id: string, bytes: Uint8Array): Promise<void> }): Promise<boolean> {
  const { client, session } = useSync.getState();
  if (!client || !session) return false;
  const r = await client.storage.from(BUCKET).download(`${session.user.id}/blobs/${id}.bin`);
  if (r.error || !r.data) return false;
  await storage.writeBlob(id, new Uint8Array(await r.data.arrayBuffer()));
  return true;
}


/** Free beta places (anonymous numbers only). Null when offline. */
export async function fetchCapacity(target?: ServerTarget | null): Promise<{ max: number; used: number; free: number; open: boolean } | null> {
  if (OPERATOR.privateInstance && isOrdoServer(target?.url)) return null;
  const { url, anonKey } = target ?? { url: SUMMA_SYNC_DEFAULT.url, anonKey: SUMMA_SYNC_DEFAULT.anonKey };
  if (!url || !anonKey) return null;
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/summa_public_capacity`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: "{}" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.private === true ? null : data;
  } catch {
    return null;
  }
}

/** Keeps the sync client in step with the settings and syncs periodically. */
export function startSyncLoop(store: VaultStore) {
  const s = store.vault.settings.sync;
  if (!s.enabled) return () => {};
  const url = s.supabaseUrl || SUMMA_SYNC_DEFAULT.url;
  const key = s.supabaseAnonKey || SUMMA_SYNC_DEFAULT.anonKey;
  // The account login secret lives in the vault, so an unlocked vault can always (re)sign in silently –
  // e.g. right after the e-mail was confirmed or when the server session expired.
  const ensureSession = async () => {
    const st = useSync.getState();
    const { email, authSecret } = store.vault.settings.sync;
    if (!st.session && st.client && email && authSecret) {
      const { error } = await st.client.auth.signInWithPassword({ email, password: authSecret });
      if (!error) await st.refreshMeta();
    }
  };
  // One sync at a time; whatever asks for one meanwhile gets a single follow-up run.
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const dirty = () => store.vault.revision !== Number(localStorage.getItem(REV_KEY) ?? 0);
  const run = async () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await ensureSession();
      listen();
      await useSync.getState().sync({ silent: true });
    } finally {
      running = false;
      // offline, an error, no session or a missing 2FA code: no quick retries, the timer tries again later
      const st = useSync.getState();
      const stuck = !st.session || st.status === "error" || st.mfaNeeded;
      if (!stuck && (again || dirty())) soon(dirty() ? 3000 : 500);
      again = false;
    }
  };
  const soon = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), ms);
  };

  // Live: the server tells this device when another one saved (Supabase Realtime on summa_vault_meta, under the
  // same row-level security as everything else). Without Realtime the timer below still catches up.
  let channel: RealtimeChannel | null = null;
  let channelUser = "";
  const listen = () => {
    const { client, session } = useSync.getState();
    if (!client || !session || channelUser === session.user.id) return;
    if (channel) void client.removeChannel(channel);
    channelUser = session.user.id;
    const me = localDeviceId();
    channel = client
      .channel(`vault-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "summa_vault_meta", filter: `user_id=eq.${session.user.id}` }, (payload) => {
        const row = payload.new as { device_id?: string } | undefined;
        if (row?.device_id && row.device_id !== me) soon(700);
      })
      .subscribe();
  };

  // Own changes go up a few seconds after the last edit (not while a sync is writing its own changes).
  const unsubscribe = store.subscribe(() => {
    if (!running && dirty()) soon(3000);
  });
  // Back at the window: look for news from the other devices.
  let lastFocus = 0;
  const onFocus = () => {
    if (document.visibilityState !== "visible" || Date.now() - lastFocus < 20_000) return;
    lastFocus = Date.now();
    soon(300);
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);

  void useSync.getState().init(url, key).then(run).then(() => setTimeout(() => void warnIfTight(), 20_000));
  // Fallback when Realtime is not available (an own Supabase project without it, a blocked connection)
  const t = setInterval(() => void run(), 2 * 60_000);
  const u = setInterval(() => void warnIfTight(), 6 * 3600_000);
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(t);
    clearInterval(u);
    unsubscribe();
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onFocus);
    const { client } = useSync.getState();
    if (channel && client) void client.removeChannel(channel);
  };
}

const WARNED_KEY = "summa.usage.warned";

/**
 * Tells people early when the project gets full – once a day per limit, from 80 %. Everyone on an own project sees it
 * (so the team knows), admins get the way out (Supabase Pro, files out, fewer accounts).
 */
async function warnIfTight(): Promise<void> {
  const usage = await useSync.getState().refreshUsage().catch(() => null);
  if (!usage) return;
  const { share, meter } = usagePeak(usage);
  if (share < 0.8) return;
  const day = new Date().toISOString().slice(0, 10);
  const key = `${WARNED_KEY}.${meter.id}`;
  try {
    if (localStorage.getItem(key) === day) return;
    localStorage.setItem(key, day);
  } catch {
    /* private mode: warn every time */
  }
  const pct = Math.round(share * 100);
  const admin = useSync.getState().isAdmin;
  const title = share >= 1 ? `${meter.label}: Grenze erreicht` : `${meter.label}: ${pct} % belegt`;
  const body = admin
    ? "Mehr Platz: im Supabase-Dashboard auf Pro wechseln (kostet bei Supabase), alte Rechnungen als ZIP auslagern oder weniger Konten zulassen. Details unter Einstellungen → Konto."
    : "Sag der Person Bescheid, die euren Ordo-Speicher betreut. Deine Daten auf diesem Gerät bleiben sicher.";
  if (share >= 1) toast.error(title, body);
  else toast.warning(title, body);
  try {
    const platform = await getPlatform();
    await platform.notify(`Ordo – ${title}`, body);
  } catch {
    /* notifications are optional */
  }
}
