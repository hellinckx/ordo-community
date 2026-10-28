import { create } from "zustand";
import { VaultStore, type Mode, type Vault, type VaultHeader } from "@ordo/core";
import { getPlatform } from "@/platform";
import { forgetOnDevice, recallFromDevice, rememberOnDevice } from "@/services/deviceUnlock";
import type { Platform } from "@/platform";
import { clearDrafts } from "@/atlas/drafts";

export type SessionStatus = "loading" | "no-vault" | "locked" | "unlocked" | "error";

interface SessionState {
  status: SessionStatus;
  platform: Platform | null;
  store: VaultStore | null;
  vault: Vault | null;
  header: VaultHeader | null;
  error: string | null;
  busy: boolean;
  lastActivity: number;
  init(): Promise<void>;
  create(opts: { password: string; hint?: string; profileName: string; mode: Mode }): Promise<string | undefined>;
  unlock(password: string): Promise<void>;
  unlockWithRecovery(key: string): Promise<void>;
  lock(): Promise<void>;
  touch(): void;
  importBackup(bytes: Uint8Array, password: string): Promise<void>;
  /** Takes over an already opened store (demo mode). */
  adopt(store: VaultStore): void;
  unlockWithPasskey(): Promise<void>;
}

let unsubscribe: (() => void) | null = null;

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  platform: null,
  store: null,
  vault: null,
  header: null,
  error: null,
  busy: false,
  lastActivity: Date.now(),

  async init() {
    try {
      const platform = await getPlatform();
      const header = await VaultStore.readHeader(platform.storage);
      // "Angemeldet bleiben": open straight away with the key this device kept
      const key = header ? await recallFromDevice() : null;
      if (key) {
        try {
          const store = await VaultStore.openWithMasterKey(platform.storage, key);
          attach(store, set);
          set({ platform, store, vault: store.vault, header: store.header, status: "unlocked", error: null, lastActivity: Date.now() });
          return;
        } catch {
          await forgetOnDevice();
        } finally {
          key.fill(0);
        }
      }
      set({ platform, header, status: header ? "locked" : "no-vault", error: null });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  async create(opts) {
    const platform = get().platform ?? (await getPlatform());
    set({ busy: true, error: null });
    try {
      const { store, recoveryKey } = await VaultStore.create(platform.storage, { ...opts, withRecoveryKey: true });
      attach(store, set);
      set({ platform, store, vault: store.vault, header: store.header, status: "unlocked", busy: false, lastActivity: Date.now() });
      return recoveryKey;
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  async unlock(password) {
    const platform = get().platform ?? (await getPlatform());
    set({ busy: true, error: null });
    try {
      const store = await VaultStore.open(platform.storage, { password });
      attach(store, set);
      set({ platform, store, vault: store.vault, header: store.header, status: "unlocked", busy: false, lastActivity: Date.now() });
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  async unlockWithRecovery(recoveryKey) {
    const platform = get().platform ?? (await getPlatform());
    set({ busy: true, error: null });
    try {
      const store = await VaultStore.open(platform.storage, { recoveryKey });
      attach(store, set);
      set({ platform, store, vault: store.vault, header: store.header, status: "unlocked", busy: false, lastActivity: Date.now() });
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  async lock() {
    const { store } = get();
    clearDrafts();
    await forgetOnDevice();
    unsubscribe?.();
    unsubscribe = null;
    if (store) await store.lock();
    set({ store: null, vault: null, status: "locked", error: null });
  },

  touch() {
    set({ lastActivity: Date.now() });
  },

  adopt(store) {
    attach(store, set);
    set({ store, vault: store.vault, header: store.header, status: "unlocked", busy: false, error: null, lastActivity: Date.now() });
  },

  async unlockWithPasskey() {
    const platform = get().platform ?? (await getPlatform());
    set({ busy: true, error: null });
    try {
      const { unlockWithPasskey } = await import("@/services/webauthn");
      const store = await unlockWithPasskey(platform.storage);
      attach(store, set);
      set({ platform, store, vault: store.vault, header: store.header, status: "unlocked", busy: false, lastActivity: Date.now() });
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  async importBackup(bytes, password) {
    const platform = get().platform ?? (await getPlatform());
    set({ busy: true, error: null });
    try {
      const { store } = get();
      if (store) {
        unsubscribe?.();
        await store.lock();
      }
      const next = await VaultStore.importFromBytes(platform.storage, bytes, { password });
      attach(next, set);
      set({ store: next, vault: next.vault, header: next.header, status: "unlocked", busy: false });
    } catch (e) {
      set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },
}));

function attach(store: VaultStore, set: (s: Partial<SessionState>) => void) {
  unsubscribe?.();
  unsubscribe = store.subscribe((vault) => {
    set({ vault });
    rememberIdentity(vault);
  });
  void rememberOnDevice(store.exportMasterKeyRaw());
  rememberIdentity(store.vault);
}

const IDENTITY_KEY = "summa.account.identity";

/** Who this device belongs to, shown on the lock screen before the vault is open (no bookkeeping data). */
export interface DeviceIdentity {
  name: string;
  profileCount: number;
  synced: boolean;
}

function rememberIdentity(vault: Vault) {
  try {
    const profiles = vault.profiles.filter((p) => !p.deletedAt);
    const person = profiles.find((p) => p.mode === "employee")?.name || profiles[0]?.company.name || profiles[0]?.name || "";
    // only what the lock screen shows (the person's name), never company names or other vault data
    const identity: DeviceIdentity = { name: person, profileCount: profiles.length, synced: !!vault.settings.sync.email };
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    /* private mode */
  }
}

export function deviceIdentity(): DeviceIdentity | null {
  try {
    return JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? "null") as DeviceIdentity | null;
  } catch {
    return null;
  }
}

export function forgetIdentity() {
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* ignore */
  }
}

/** Convenience: the unlocked store (throws when locked). */
export function requireStore(): VaultStore {
  const s = useSession.getState().store;
  if (!s) throw new Error("Tresor ist gesperrt.");
  return s;
}

export function requirePlatform(): Platform {
  const p = useSession.getState().platform;
  if (!p) throw new Error("Plattform nicht initialisiert.");
  return p;
}

// Dev-only debug hook (always points at the live module instance, survives HMR).
if (import.meta.env.DEV && typeof window !== "undefined") {
  const w = window as unknown as { __summa?: Record<string, unknown> };
  w.__summa = { ...(w.__summa ?? {}), useSession, requireStore };
}
