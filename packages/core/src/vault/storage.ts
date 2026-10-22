/**
 * Storage adapters only ever see encrypted bytes. The vault document is one blob,
 * every attachment (receipt image / PDF) is a separate encrypted blob keyed by attachment id.
 */
export interface StorageAdapter {
  readonly kind: "memory" | "indexeddb" | "tauri" | "custom";
  readVault(): Promise<Uint8Array | null>;
  writeVault(bytes: Uint8Array): Promise<void>;
  readBlob(id: string): Promise<Uint8Array | null>;
  writeBlob(id: string, bytes: Uint8Array): Promise<void>;
  deleteBlob(id: string): Promise<void>;
  listBlobIds(): Promise<string[]>;
  /** Human readable location for the settings page. */
  describe(): string;
  /** Approximate bytes used (optional). */
  usage?(): Promise<{ vaultBytes: number; blobBytes: number }>;
}

export class MemoryStorage implements StorageAdapter {
  readonly kind = "memory" as const;
  private vault: Uint8Array | null = null;
  private blobs = new Map<string, Uint8Array>();

  async readVault() {
    return this.vault ? new Uint8Array(this.vault) : null;
  }
  async writeVault(bytes: Uint8Array) {
    this.vault = new Uint8Array(bytes);
  }
  async readBlob(id: string) {
    const b = this.blobs.get(id);
    return b ? new Uint8Array(b) : null;
  }
  async writeBlob(id: string, bytes: Uint8Array) {
    this.blobs.set(id, new Uint8Array(bytes));
  }
  async deleteBlob(id: string) {
    this.blobs.delete(id);
  }
  async listBlobIds() {
    return [...this.blobs.keys()];
  }
  describe() {
    return "Nur im Arbeitsspeicher (Test)";
  }
  async usage() {
    let blobBytes = 0;
    for (const b of this.blobs.values()) blobBytes += b.byteLength;
    return { vaultBytes: this.vault?.byteLength ?? 0, blobBytes };
  }
}

/**
 * IndexedDB adapter for the browser / PWA. Uses two object stores: "vault" (single key) and "blobs".
 */
export class IndexedDbStorage implements StorageAdapter {
  readonly kind = "indexeddb" as const;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName = "summa") {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("vault")) db.createObjectStore("vault");
          if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  private async tx<T>(store: "vault" | "blobs", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async readVault() {
    const v = await this.tx<ArrayBuffer | Uint8Array | undefined>("vault", "readonly", (s) => s.get("vault") as IDBRequest<ArrayBuffer | Uint8Array | undefined>);
    if (!v) return null;
    return v instanceof Uint8Array ? v : new Uint8Array(v);
  }
  async writeVault(bytes: Uint8Array) {
    await this.tx("vault", "readwrite", (s) => s.put(bytes.slice().buffer, "vault"));
  }
  async readBlob(id: string) {
    const v = await this.tx<ArrayBuffer | Uint8Array | undefined>("blobs", "readonly", (s) => s.get(id) as IDBRequest<ArrayBuffer | Uint8Array | undefined>);
    if (!v) return null;
    return v instanceof Uint8Array ? v : new Uint8Array(v);
  }
  async writeBlob(id: string, bytes: Uint8Array) {
    await this.tx("blobs", "readwrite", (s) => s.put(bytes.slice().buffer, id));
  }
  async deleteBlob(id: string) {
    await this.tx("blobs", "readwrite", (s) => s.delete(id));
  }
  async listBlobIds() {
    const keys = await this.tx<IDBValidKey[]>("blobs", "readonly", (s) => s.getAllKeys());
    return keys.map(String);
  }
  describe() {
    return "Browser-Speicher (IndexedDB, verschlüsselt)";
  }
  async usage() {
    const vault = await this.readVault();
    const ids = await this.listBlobIds();
    let blobBytes = 0;
    for (const id of ids) blobBytes += (await this.readBlob(id))?.byteLength ?? 0;
    return { vaultBytes: vault?.byteLength ?? 0, blobBytes };
  }
}
