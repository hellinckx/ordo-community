import {
  VaultSchema,
  SettingsSchema,
  nowIso,
  type Vault,
  type EntityCollection,
  type EntityOf,
  type Attachment,
  type Profile,
  type Mode,
} from "../model/types";
import { ids } from "../model/ids";
import { DEFAULT_CATEGORIES } from "../model/defaults";
import type { StorageAdapter } from "./storage";
import {
  createVaultKeys,
  unlockWithPassword,
  unlockWithRecoveryKey,
  rewrapWithPassword,
  attachRecoveryKey,
  importMasterKey,
  readHeader,
  sealVault,
  openVaultPayload,
  encryptBytes,
  decryptBytes,
  sha256Hex,
  type VaultHeader,
} from "./crypto";

export type Listener = (vault: Vault) => void;

export interface CreateVaultOptions {
  password: string;
  hint?: string;
  profileName: string;
  mode: Mode;
  withRecoveryKey?: boolean;
}

export interface Unsubscribe {
  (): void;
}

/**
 * The VaultStore is the single in-memory source of truth. All mutations go through `mutate`,
 * which bumps the revision, marks the vault dirty and schedules an encrypted save.
 */
export class VaultStore {
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private dirty = false;
  private masterKey: CryptoKey | null;
  private masterKeyRaw: Uint8Array | null;
  public header: VaultHeader;
  public vault: Vault;
  public lastSavedAt: string | null = null;
  public lastError: string | null = null;
  public saveDelayMs = 400;

  private constructor(
    public readonly storage: StorageAdapter,
    header: VaultHeader,
    masterKey: CryptoKey,
    masterKeyRaw: Uint8Array,
    vault: Vault,
  ) {
    this.header = header;
    this.masterKey = masterKey;
    this.masterKeyRaw = masterKeyRaw;
    this.vault = vault;
    this.stampSettings(vault, {});
  }

  /** Last seen JSON per settings area, to tell which areas a mutation changed. */
  private settingsSnap = new Map<string, string>();

  /**
   * Stamps every settings area whose content changed with the vault's updatedAt, so sync can keep the newer area
   * from either device. Areas whose stamp the mutation set itself (sync merging) keep that stamp.
   */
  private stampSettings(next: Vault, prevStamps: Record<string, string>): void {
    const settings = next.settings as unknown as Record<string, unknown>;
    const given = next.settings.stamps ?? {};
    let stamps: Record<string, string> | null = null;
    for (const k of Object.keys(settings)) {
      if (k === "stamps") continue;
      const json = JSON.stringify(settings[k]) ?? "";
      const before = this.settingsSnap.get(k);
      this.settingsSnap.set(k, json);
      if (before === undefined || before === json || given[k] !== prevStamps[k]) continue;
      (stamps ??= { ...given })[k] = next.updatedAt;
    }
    if (stamps) next.settings = { ...next.settings, stamps };
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  static async exists(storage: StorageAdapter): Promise<boolean> {
    return (await storage.readVault()) !== null;
  }

  static async readHeader(storage: StorageAdapter): Promise<VaultHeader | null> {
    const bytes = await storage.readVault();
    if (!bytes) return null;
    return readHeader(bytes).header;
  }

  static async create(storage: StorageAdapter, opts: CreateVaultOptions): Promise<{ store: VaultStore; recoveryKey?: string }> {
    if (await VaultStore.exists(storage)) throw new Error("Es existiert bereits ein Tresor an diesem Speicherort.");
    let keys = await createVaultKeys(opts.password, opts.hint);
    let recoveryKey: string | undefined;
    if (opts.withRecoveryKey !== false) {
      const r = await attachRecoveryKey(keys.header, keys.masterKeyRaw);
      keys = { ...keys, header: r.header };
      recoveryKey = r.recoveryKey;
    }
    const now = nowIso();
    const profile: Profile = {
      id: ids.profile(),
      name: opts.profileName,
      mode: opts.mode,
      accountingMethod: "eur",
      vatRegime: opts.mode === "business" ? "regelbesteuerung" : "kleinunternehmer",
      uvaPeriod: opts.mode === "business" ? "quarterly" : "none",
      ustSystem: "netto",
      pauschalierung: "none",
      pauschalierungBranch: "regular",
      fiscalYearStartMonth: 1,
      company: { name: opts.profileName, legalForm: "", street: "", zip: "", city: "", country: "AT", uid: "", steuernummer: "", iban: "", bic: "", email: "", phone: "", website: "", invoiceFooter: "", invoiceNumberPattern: "RE-{YYYY}-{NNNN}", nextInvoiceNumber: 1 },
      color: opts.mode === "business" ? "#0f766e" : "#2563eb",
      createdAt: now,
      updatedAt: now,
    };
    const vault: Vault = VaultSchema.parse({
      createdAt: now,
      updatedAt: now,
      activeProfileId: profile.id,
      profiles: [profile],
      categories: DEFAULT_CATEGORIES,
      settings: SettingsSchema.parse({}),
    });
    const store = new VaultStore(storage, keys.header, keys.masterKey, keys.masterKeyRaw, vault);
    await store.saveNow();
    return { store, recoveryKey };
  }

  static async open(storage: StorageAdapter, credential: { password: string } | { recoveryKey: string }): Promise<VaultStore> {
    const bytes = await storage.readVault();
    if (!bytes) throw new Error("Kein Tresor gefunden.");
    const { header, payload } = readHeader(bytes);
    const keys =
      "password" in credential
        ? await unlockWithPassword(header, credential.password)
        : await unlockWithRecoveryKey(header, credential.recoveryKey);
    const json = await openVaultPayload(header, keys.masterKey, payload);
    const vault = migrateVault(JSON.parse(json));
    const store = new VaultStore(storage, header, keys.masterKey, keys.masterKeyRaw, vault);
    store.lastSavedAt = vault.updatedAt;
    return store;
  }

  /** Opens the vault with a raw master key (e.g. unwrapped via a passkey / Windows Hello). */
  static async openWithMasterKey(storage: StorageAdapter, masterKeyRaw: Uint8Array): Promise<VaultStore> {
    const bytes = await storage.readVault();
    if (!bytes) throw new Error("Kein Tresor gefunden.");
    const { header, payload } = readHeader(bytes);
    const masterKey = await importMasterKey(masterKeyRaw);
    const json = await openVaultPayload(header, masterKey, payload);
    const vault = migrateVault(JSON.parse(json));
    const store = new VaultStore(storage, header, masterKey, new Uint8Array(masterKeyRaw), vault);
    store.lastSavedAt = vault.updatedAt;
    return store;
  }

  /** Copy of the raw master key for device-bound wrapping (passkey). Caller must zero it after use. */
  exportMasterKeyRaw(): Uint8Array {
    if (!this.masterKeyRaw) throw new Error("Tresor ist gesperrt.");
    return new Uint8Array(this.masterKeyRaw);
  }

  /** Opens a vault from an in-memory file (backup import) and writes it to the given storage. */
  static async importFromBytes(storage: StorageAdapter, bytes: Uint8Array, credential: { password: string } | { recoveryKey: string }): Promise<VaultStore> {
    const { header, payload } = readHeader(bytes);
    const keys = "password" in credential ? await unlockWithPassword(header, credential.password) : await unlockWithRecoveryKey(header, credential.recoveryKey);
    const json = await openVaultPayload(header, keys.masterKey, payload);
    const vault = migrateVault(JSON.parse(json));
    await storage.writeVault(bytes);
    return new VaultStore(storage, header, keys.masterKey, keys.masterKeyRaw, vault);
  }

  get isLocked(): boolean {
    return this.masterKey === null;
  }

  /** Wipes keys from memory. The store must be re-opened afterwards. */
  async lock(): Promise<void> {
    await this.flush();
    this.masterKey = null;
    if (this.masterKeyRaw) this.masterKeyRaw.fill(0);
    this.masterKeyRaw = null;
    this.listeners.clear();
  }

  private requireKey(): CryptoKey {
    if (!this.masterKey) throw new Error("Tresor ist gesperrt.");
    return this.masterKey;
  }

  /* ---------------------------------------------------------------- */
  /* Subscriptions                                                     */
  /* ---------------------------------------------------------------- */

  subscribe(fn: Listener): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const l of this.listeners) l(this.vault);
  }

  /* ---------------------------------------------------------------- */
  /* Mutations                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Runs a mutation against the vault. The vault object is replaced by a shallow copy so that
   * React subscribers see a new reference.
   */
  mutate(fn: (vault: Vault) => void, opts: { audit?: { action: string; entity: string; entityId?: string; details?: string } } = {}): void {
    this.requireKey();
    const next: Vault = { ...this.vault };
    const prevStamps = { ...(this.vault.settings?.stamps ?? {}) };
    fn(next);
    next.revision = (next.revision ?? 0) + 1;
    next.updatedAt = nowIso();
    if (next.settings) this.stampSettings(next, prevStamps);
    if (opts.audit) {
      next.auditLog = [
        ...next.auditLog,
        { id: ids.audit(), at: next.updatedAt, action: opts.audit.action, entity: opts.audit.entity, entityId: opts.audit.entityId, details: opts.audit.details ?? "" },
      ].slice(-2000);
    }
    this.vault = next;
    this.dirty = true;
    this.scheduleSave();
    this.notify();
  }

  list<C extends EntityCollection>(collection: C, opts: { profileId?: string; includeDeleted?: boolean } = {}): EntityOf<C>[] {
    const all = this.vault[collection] as unknown as EntityOf<C>[];
    return all.filter((e) => {
      const any = e as unknown as { deletedAt?: string; profileId?: string };
      if (!opts.includeDeleted && any.deletedAt) return false;
      if (opts.profileId && "profileId" in any && any.profileId !== opts.profileId) return false;
      return true;
    });
  }

  byId<C extends EntityCollection>(collection: C, id: string | undefined): EntityOf<C> | undefined {
    if (!id) return undefined;
    return (this.vault[collection] as unknown as EntityOf<C>[]).find((e) => (e as { id: string }).id === id);
  }

  insert<C extends EntityCollection>(collection: C, entity: EntityOf<C>, audit?: string): EntityOf<C> {
    this.mutate(
      (v) => {
        (v[collection] as unknown as EntityOf<C>[]) = [...(v[collection] as unknown as EntityOf<C>[]), entity];
      },
      { audit: { action: audit ?? "insert", entity: collection, entityId: (entity as { id: string }).id } },
    );
    return entity;
  }

  update<C extends EntityCollection>(collection: C, id: string, patch: Partial<EntityOf<C>> | ((e: EntityOf<C>) => EntityOf<C>), audit?: string): EntityOf<C> | undefined {
    let result: EntityOf<C> | undefined;
    this.mutate(
      (v) => {
        (v[collection] as unknown as EntityOf<C>[]) = (v[collection] as unknown as EntityOf<C>[]).map((e) => {
          if ((e as { id: string }).id !== id) return e;
          const next = typeof patch === "function" ? patch(e) : ({ ...e, ...patch } as EntityOf<C>);
          if ("updatedAt" in (next as object)) (next as { updatedAt: string }).updatedAt = nowIso();
          result = next;
          return next;
        });
      },
      { audit: { action: audit ?? "update", entity: collection, entityId: id } },
    );
    return result;
  }

  softDelete<C extends EntityCollection>(collection: C, id: string, audit?: string): void {
    this.update(collection, id, ((e: EntityOf<C>) => ({ ...e, deletedAt: nowIso() })) as never, audit ?? "delete");
  }

  restore<C extends EntityCollection>(collection: C, id: string): void {
    this.update(collection, id, ((e: EntityOf<C>) => {
      const copy = { ...e } as EntityOf<C> & { deletedAt?: string };
      delete copy.deletedAt;
      return copy;
    }) as never, "restore");
  }

  /** Permanently removes soft-deleted entities older than `days`. */
  purgeDeleted(days = 30): number {
    const cutoff = Date.now() - days * 86400_000;
    let removed = 0;
    this.mutate((v) => {
      const collections: EntityCollection[] = ["contacts", "transactions", "documents", "recurringRules", "assets", "invoices", "journalEntries", "attachments", "notifications"];
      for (const c of collections) {
        const before = (v[c] as unknown[]).length;
        (v[c] as unknown[]) = (v[c] as { deletedAt?: string }[]).filter((e) => !e.deletedAt || new Date(e.deletedAt).getTime() > cutoff);
        removed += before - (v[c] as unknown[]).length;
      }
    });
    return removed;
  }

  get activeProfile(): Profile {
    const p = this.vault.profiles.find((x) => x.id === this.vault.activeProfileId && !x.deletedAt) ?? this.vault.profiles.find((x) => !x.deletedAt);
    if (!p) throw new Error("Kein Profil vorhanden.");
    return p;
  }

  setActiveProfile(id: string) {
    this.mutate((v) => {
      v.activeProfileId = id;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Attachments (encrypted blobs)                                     */
  /* ---------------------------------------------------------------- */

  async putAttachment(profileId: string, bytes: Uint8Array, meta: { name: string; mime: string; width?: number; height?: number; pages?: number }): Promise<Attachment> {
    const key = this.requireKey();
    const id = ids.attachment();
    const sha256 = await sha256Hex(bytes);
    const encrypted = await encryptBytes(key, bytes, `att:${id}`);
    await this.storage.writeBlob(id, encrypted);
    const now = nowIso();
    const attachment: Attachment = {
      id,
      profileId,
      name: meta.name,
      mime: meta.mime,
      size: bytes.byteLength,
      sha256,
      width: meta.width,
      height: meta.height,
      pages: meta.pages,
      createdAt: now,
      updatedAt: now,
    };
    this.insert("attachments", attachment, "attachment.add");
    return attachment;
  }

  async getAttachmentBytes(id: string): Promise<Uint8Array | null> {
    const key = this.requireKey();
    const enc = await this.storage.readBlob(id);
    if (!enc) return null;
    return decryptBytes(key, enc, `att:${id}`);
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.storage.deleteBlob(id);
    this.mutate((v) => {
      v.attachments = v.attachments.filter((a) => a.id !== id);
    }, { audit: { action: "attachment.delete", entity: "attachments", entityId: id } });
  }

  /* ---------------------------------------------------------------- */
  /* Persistence                                                       */
  /* ---------------------------------------------------------------- */

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, this.saveDelayMs);
  }

  async saveNow(): Promise<void> {
    if (this.saving) {
      await this.saving;
    }
    if (!this.masterKey) return;
    this.saving = (async () => {
      try {
        const json = JSON.stringify(this.vault);
        const bytes = await sealVault(this.header, this.masterKey!, json);
        await this.storage.writeVault(bytes);
        this.dirty = false;
        this.lastSavedAt = nowIso();
        this.lastError = null;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        throw e;
      } finally {
        this.saving = null;
      }
    })();
    await this.saving;
  }

  /** Waits for pending writes. Call on page unload / before lock. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty || this.saving) await this.saveNow();
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /** Returns the sealed vault bytes (for backups / "Tresor exportieren"). */
  async exportSealed(): Promise<Uint8Array> {
    await this.flush();
    const bytes = await this.storage.readVault();
    if (!bytes) throw new Error("Tresor konnte nicht gelesen werden.");
    return bytes;
  }

  /* ---------------------------------------------------------------- */
  /* Credentials                                                       */
  /* ---------------------------------------------------------------- */

  async changePassword(currentPassword: string, newPassword: string, hint?: string): Promise<void> {
    await unlockWithPassword(this.header, currentPassword); // throws on wrong password
    if (!this.masterKeyRaw) throw new Error("Tresor ist gesperrt.");
    this.header = await rewrapWithPassword(this.header, this.masterKeyRaw, newPassword, hint ?? "");
    this.dirty = true;
    await this.saveNow();
  }

  /** Sets a new password without knowing the old one – only after the vault was opened with the recovery key. */
  async resetPassword(newPassword: string, hint?: string): Promise<void> {
    if (!this.masterKeyRaw) throw new Error("Tresor ist gesperrt.");
    this.header = await rewrapWithPassword(this.header, this.masterKeyRaw, newPassword, hint ?? "");
    this.dirty = true;
    await this.saveNow();
  }

  async regenerateRecoveryKey(): Promise<string> {
    if (!this.masterKeyRaw) throw new Error("Tresor ist gesperrt.");
    const r = await attachRecoveryKey(this.header, this.masterKeyRaw);
    this.header = r.header;
    this.dirty = true;
    await this.saveNow();
    return r.recoveryKey;
  }

  get hasRecoveryKey(): boolean {
    return !!this.header.recovery;
  }
}

/* ------------------------------------------------------------------ */
/* Migrations                                                          */
/* ------------------------------------------------------------------ */

export function migrateVault(raw: unknown): Vault {
  const obj = (raw ?? {}) as Record<string, unknown>;
  // Future: switch on obj.version and transform. v1 is the first version.
  const parsed = VaultSchema.parse(obj);
  // 0.97 was the unreachable default before auto-booking existed (no UI to change it) – move those vaults
  // to the new default once; anything else is a deliberate setting.
  if (parsed.settings.ai.minAutoApproveConfidence === 0.97) parsed.settings.ai.minAutoApproveConfidence = 0.9;
  // Ensure system categories exist and keep their tax mappings/keywords current
  // (user-editable fields like name, colour and icon are preserved).
  const existing = new Map(parsed.categories.map((c) => [c.id, c]));
  for (const c of DEFAULT_CATEGORIES) {
    const cur = existing.get(c.id);
    if (!cur) parsed.categories.push(c);
    else if (cur.isSystem) {
      cur.keywords = c.keywords;
      cur.ekrAccount = c.ekrAccount;
      cur.e1aKz = c.e1aKz;
      cur.l1Kz = c.l1Kz;
      cur.defaultVatRate = c.defaultVatRate;
      cur.defaultDeductiblePct = c.defaultDeductiblePct;
      cur.deductibleIncomePct = c.deductibleIncomePct;
      cur.mode = c.mode;
      cur.kind = c.kind;
    }
  }
  return parsed;
}
