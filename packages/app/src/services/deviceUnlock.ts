/**
 * "Angemeldet bleiben": keeps this device unlocked across reloads and restarts. The vault's master key is
 * wrapped with a device key that is generated in the browser as NON-extractable (WebCrypto) and kept in
 * IndexedDB – script on this origin can use it but never read it out, and it does not leave the device.
 * Anyone who can use this browser profile can open Ordo, like any app that keeps you signed in; "Sperren",
 * "Abmelden" and the idle auto-lock remove the wrapped key again.
 */
const DB = "summa-device";
const STORE = "kv";
const PREF = "summa.stayUnlocked";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function op<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    d.close();
  }
}

/** On unless the user unticked "Angemeldet bleiben". */
export function stayUnlockedWanted(): boolean {
  try {
    return localStorage.getItem(PREF) !== "0";
  } catch {
    return false;
  }
}

export function setStayUnlocked(on: boolean): void {
  try {
    localStorage.setItem(PREF, on ? "1" : "0");
  } catch {
    /* private mode: nothing is kept anyway */
  }
}

async function deviceKey(): Promise<CryptoKey> {
  const existing = await op<CryptoKey | undefined>("readonly", (s) => s.get("deviceKey") as IDBRequest<CryptoKey | undefined>);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await op("readwrite", (s) => s.put(key, "deviceKey"));
  return key;
}

/** Stores the master key wrapped with the device key. Failures only mean the next reload asks again. */
export async function rememberOnDevice(masterKeyRaw: Uint8Array): Promise<void> {
  try {
    if (!stayUnlockedWanted() || typeof indexedDB === "undefined") return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deviceKey(), masterKeyRaw as BufferSource));
    await op("readwrite", (s) => s.put({ iv, wrapped }, "masterKey"));
  } catch {
    /* ignore */
  } finally {
    masterKeyRaw.fill(0);
  }
}

/** The remembered master key, or null. Caller must zero it after use. */
export async function recallFromDevice(): Promise<Uint8Array | null> {
  try {
    if (!stayUnlockedWanted() || typeof indexedDB === "undefined") return null;
    const rec = await op<{ iv: Uint8Array; wrapped: Uint8Array } | undefined>("readonly", (s) => s.get("masterKey") as IDBRequest<{ iv: Uint8Array; wrapped: Uint8Array } | undefined>);
    if (!rec) return null;
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv as BufferSource }, await deviceKey(), rec.wrapped as BufferSource));
  } catch {
    await forgetOnDevice();
    return null;
  }
}

export async function forgetOnDevice(): Promise<void> {
  try {
    if (typeof indexedDB === "undefined") return;
    await op("readwrite", (s) => s.delete("masterKey"));
  } catch {
    /* ignore */
  }
}
