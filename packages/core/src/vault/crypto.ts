/**
 * Summa vault cryptography.
 *
 * Design (see docs/SECURITY.md):
 *  - A random 256-bit master key encrypts the vault document and every attachment (AES-256-GCM, fresh IV per blob).
 *  - The master key is wrapped by a key-encryption-key derived from the password with Argon2id (64 MiB, 3 passes).
 *  - Optionally the master key is also wrapped by a recovery key (random, shown once) – the only "password reset".
 *  - Nothing is ever stored in plaintext; the header only holds salts, KDF parameters and wrapped keys.
 *  - Changing the password only re-wraps the master key; no re-encryption of data is needed.
 */
import { argon2id } from "hash-wasm";

const subtle = globalThis.crypto.subtle;

export const VAULT_MAGIC = new Uint8Array([0x53, 0x55, 0x4d, 0x4d, 0x41, 0x01]); // "SUMMA\x01"

export interface KdfParams {
  algorithm: "argon2id";
  salt: string; // base64
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

export interface WrappedKey {
  iv: string; // base64, 12 bytes
  ct: string; // base64, 32 bytes key + 16 bytes tag
}

export interface VaultHeader {
  format: "summa-vault";
  version: 1;
  createdAt: string;
  password: { kdf: KdfParams; wrapped: WrappedKey };
  recovery?: { kdf: KdfParams; wrapped: WrappedKey; createdAt: string };
  /** Optional, user-provided hint. Never the password itself. */
  hint?: string;
  compression: "gzip" | "none";
}

export const DEFAULT_KDF = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 } as const;

/* ------------------------------------------------------------------ */
/* Encoding helpers                                                    */
/* ------------------------------------------------------------------ */

export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

const te = new TextEncoder();
const td = new TextDecoder();

/**
 * One password for everything: the vault key comes from Argon2id over the password (random salt in the vault
 * header), the login secret for the sync server from a second Argon2id run with the same memory hardness over
 * password + a salt bound to the e-mail and a fixed context. The server only ever sees this derived secret,
 * never the password; guessing the password from a leaked login hash costs as much as attacking the vault.
 */
export async function deriveAccountSecret(email: string, password: string): Promise<string> {
  const salt = new Uint8Array(await subtle.digest("SHA-256", te.encode(`summa-account-v2:${email.trim().toLowerCase()}`) as BufferSource)).slice(0, 16);
  const raw = await argon2id({
    password: password.normalize("NFKC"),
    salt,
    parallelism: DEFAULT_KDF.parallelism,
    iterations: DEFAULT_KDF.iterations,
    memorySize: DEFAULT_KDF.memoryKiB,
    hashLength: 32,
    outputType: "binary",
  });
  return toBase64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? te.encode(data) : data;
  const digest = await subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* Recovery key: 128 bit entropy, Crockford base32 in groups of 4      */
/* ------------------------------------------------------------------ */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateRecoveryKey(): string {
  const bytes = randomBytes(20); // 160 bit -> 32 chars
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += CROCKFORD[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out.match(/.{1,4}/g)!.join("-");
}

export function normalizeRecoveryKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/* ------------------------------------------------------------------ */
/* Key derivation & wrapping                                           */
/* ------------------------------------------------------------------ */

async function deriveKek(secret: string, kdf: KdfParams): Promise<CryptoKey> {
  const raw = await argon2id({
    password: secret.normalize("NFKC"),
    salt: fromBase64(kdf.salt),
    parallelism: kdf.parallelism,
    iterations: kdf.iterations,
    memorySize: kdf.memoryKiB,
    hashLength: 32,
    outputType: "binary",
  });
  return subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function newKdfParams(): KdfParams {
  return {
    algorithm: "argon2id",
    salt: toBase64(randomBytes(16)),
    memoryKiB: DEFAULT_KDF.memoryKiB,
    iterations: DEFAULT_KDF.iterations,
    parallelism: DEFAULT_KDF.parallelism,
  };
}

async function wrapMasterKey(masterKeyRaw: Uint8Array, kek: CryptoKey): Promise<WrappedKey> {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, kek, masterKeyRaw as BufferSource);
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

async function unwrapMasterKey(wrapped: WrappedKey, kek: CryptoKey): Promise<Uint8Array> {
  const raw = await subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(wrapped.iv) as BufferSource },
    kek,
    fromBase64(wrapped.ct) as BufferSource,
  );
  return new Uint8Array(raw);
}

export async function importMasterKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export class WrongPasswordError extends Error {
  constructor() {
    super("Falsches Passwort oder beschädigter Tresor.");
    this.name = "WrongPasswordError";
  }
}

export interface UnlockedKeys {
  header: VaultHeader;
  masterKey: CryptoKey;
  /** Only present right after creation / unlock so the password can be changed; wiped by callers. */
  masterKeyRaw: Uint8Array;
}

export async function createVaultKeys(password: string, hint?: string): Promise<UnlockedKeys> {
  const masterKeyRaw = randomBytes(32);
  const kdf = newKdfParams();
  const kek = await deriveKek(password, kdf);
  const wrapped = await wrapMasterKey(masterKeyRaw, kek);
  const header: VaultHeader = {
    format: "summa-vault",
    version: 1,
    createdAt: new Date().toISOString(),
    password: { kdf, wrapped },
    compression: "gzip",
  };
  if (hint) header.hint = hint;
  return { header, masterKey: await importMasterKey(masterKeyRaw), masterKeyRaw };
}

export async function unlockWithPassword(header: VaultHeader, password: string): Promise<UnlockedKeys> {
  const kek = await deriveKek(password, header.password.kdf);
  try {
    const raw = await unwrapMasterKey(header.password.wrapped, kek);
    return { header, masterKey: await importMasterKey(raw), masterKeyRaw: raw };
  } catch {
    throw new WrongPasswordError();
  }
}

export async function unlockWithRecoveryKey(header: VaultHeader, recoveryKey: string): Promise<UnlockedKeys> {
  if (!header.recovery) throw new Error("Für diesen Tresor wurde kein Wiederherstellungsschlüssel eingerichtet.");
  const kek = await deriveKek(normalizeRecoveryKey(recoveryKey), header.recovery.kdf);
  try {
    const raw = await unwrapMasterKey(header.recovery.wrapped, kek);
    return { header, masterKey: await importMasterKey(raw), masterKeyRaw: raw };
  } catch {
    throw new WrongPasswordError();
  }
}

export async function rewrapWithPassword(header: VaultHeader, masterKeyRaw: Uint8Array, newPassword: string, hint?: string): Promise<VaultHeader> {
  const kdf = newKdfParams();
  const kek = await deriveKek(newPassword, kdf);
  const wrapped = await wrapMasterKey(masterKeyRaw, kek);
  const next: VaultHeader = { ...header, password: { kdf, wrapped } };
  if (hint !== undefined) {
    if (hint) next.hint = hint;
    else delete next.hint;
  }
  return next;
}

export async function attachRecoveryKey(header: VaultHeader, masterKeyRaw: Uint8Array): Promise<{ header: VaultHeader; recoveryKey: string }> {
  const recoveryKey = generateRecoveryKey();
  const kdf = newKdfParams();
  const kek = await deriveKek(normalizeRecoveryKey(recoveryKey), kdf);
  const wrapped = await wrapMasterKey(masterKeyRaw, kek);
  return {
    header: { ...header, recovery: { kdf, wrapped, createdAt: new Date().toISOString() } },
    recoveryKey,
  };
}

/* ------------------------------------------------------------------ */
/* Data encryption                                                     */
/* ------------------------------------------------------------------ */

export async function encryptBytes(masterKey: CryptoKey, plain: Uint8Array, aad?: string): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const params: AesGcmParams = { name: "AES-GCM", iv: iv as BufferSource };
  if (aad) params.additionalData = te.encode(aad);
  const ct = new Uint8Array(await subtle.encrypt(params, masterKey, plain as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(masterKey: CryptoKey, data: Uint8Array, aad?: string): Promise<Uint8Array> {
  if (data.length < 13) throw new Error("Verschlüsselte Daten sind zu kurz.");
  const params: AesGcmParams = { name: "AES-GCM", iv: data.subarray(0, 12) as BufferSource };
  if (aad) params.additionalData = te.encode(aad);
  const plain = await subtle.decrypt(params, masterKey, data.subarray(12) as BufferSource);
  return new Uint8Array(plain);
}

/* ------------------------------------------------------------------ */
/* Compression (gzip via CompressionStream, falls back to none)        */
/* ------------------------------------------------------------------ */

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return data;
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("Dekomprimierung wird in dieser Umgebung nicht unterstützt.");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ------------------------------------------------------------------ */
/* Vault file format                                                   */
/* ------------------------------------------------------------------ */

export function isVaultFile(bytes: Uint8Array): boolean {
  if (bytes.length < VAULT_MAGIC.length + 4) return false;
  for (let i = 0; i < VAULT_MAGIC.length; i++) if (bytes[i] !== VAULT_MAGIC[i]) return false;
  return true;
}

export function readHeader(bytes: Uint8Array): { header: VaultHeader; payload: Uint8Array } {
  if (!isVaultFile(bytes)) throw new Error("Das ist keine Summa-Tresordatei.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint32(VAULT_MAGIC.length, true);
  const start = VAULT_MAGIC.length + 4;
  const headerJson = td.decode(bytes.subarray(start, start + headerLen));
  const header = JSON.parse(headerJson) as VaultHeader;
  if (header.format !== "summa-vault") throw new Error("Unbekanntes Tresorformat.");
  return { header, payload: bytes.subarray(start + headerLen) };
}

export async function sealVault(header: VaultHeader, masterKey: CryptoKey, json: string): Promise<Uint8Array> {
  const useGzip = typeof CompressionStream !== "undefined";
  const h: VaultHeader = { ...header, compression: useGzip ? "gzip" : "none" };
  let plain: Uint8Array = te.encode(json);
  if (useGzip) plain = await gzip(plain);
  const ct = await encryptBytes(masterKey, plain, "summa-vault-v1");
  const headerBytes = te.encode(JSON.stringify(h));
  const out = new Uint8Array(VAULT_MAGIC.length + 4 + headerBytes.length + ct.length);
  out.set(VAULT_MAGIC, 0);
  new DataView(out.buffer).setUint32(VAULT_MAGIC.length, headerBytes.length, true);
  out.set(headerBytes, VAULT_MAGIC.length + 4);
  out.set(ct, VAULT_MAGIC.length + 4 + headerBytes.length);
  return out;
}

export async function openVaultPayload(header: VaultHeader, masterKey: CryptoKey, payload: Uint8Array): Promise<string> {
  let plain: Uint8Array;
  try {
    plain = await decryptBytes(masterKey, payload, "summa-vault-v1");
  } catch {
    throw new WrongPasswordError();
  }
  if (header.compression === "gzip") plain = await gunzip(plain);
  return td.decode(plain);
}
