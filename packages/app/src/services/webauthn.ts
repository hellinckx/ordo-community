/**
 * Device-bound unlock with a passkey (Windows Hello, Touch ID / Face ID, Android fingerprint) using the
 * WebAuthn PRF extension: the authenticator derives a secret that only exists after biometric/PIN
 * verification; we use it to wrap the vault's master key. The password stays the master credential –
 * the passkey is a convenience that can be revoked any time.
 */
import { VaultStore, encryptBytes, decryptBytes, toBase64, fromBase64, randomBytes } from "@ordo/core";
import type { StorageAdapter } from "@ordo/core";

const LS_KEY = "summa.passkey.v1";

interface PasskeyRecord {
  credentialId: string; // base64
  salt: string; // base64 (32 bytes, PRF input)
  wrapped: string; // base64, AES-GCM(masterKeyRaw) with iv prefix
  createdAt: string;
  label: string;
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

export function passkeyRecord(): PasskeyRecord | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as PasskeyRecord) : null;
  } catch {
    return null;
  }
}

export function passkeySupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials && window.isSecureContext;
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!passkeySupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function kekFromPrf(secret: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("summa-passkey-wrap"), info: new TextEncoder().encode("master-key") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function rpId(): string {
  return location.hostname || "localhost";
}

/** Registers a passkey for this device and wraps the current master key with it. */
export async function enrollPasskey(store: VaultStore, label = "Dieses Gerät"): Promise<void> {
  if (!passkeySupported()) throw new Error("Passkeys werden in dieser Umgebung nicht unterstützt (kein sicherer Kontext).");
  const salt = randomBytes(32);
  const userId = randomBytes(16);
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "Ordo", id: rpId() },
      user: { id: userId as BufferSource, name: "summa-tresor", displayName: "Ordo" },
      challenge: randomBytes(32) as BufferSource,
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      timeout: 120_000,
      extensions: { prf: { eval: { first: salt as BufferSource } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey-Erstellung abgebrochen.");
  const ext = cred.getClientExtensionResults() as PrfResults;
  let secret = ext.prf?.results?.first;
  if (!secret) {
    // Many authenticators only return PRF output on get(); do one assertion right away.
    secret = await assertPrf(new Uint8Array(cred.rawId), salt);
  }
  if (!secret) throw new Error("Dieser Authenticator unterstützt die PRF-Erweiterung nicht (Windows Hello / aktuelle Android-Geräte funktionieren).");
  const kek = await kekFromPrf(secret);
  const raw = store.exportMasterKeyRaw();
  try {
    const wrapped = await encryptBytes(kek, raw, "summa-passkey");
    const rec: PasskeyRecord = { credentialId: toBase64(new Uint8Array(cred.rawId)), salt: toBase64(salt), wrapped: toBase64(wrapped), createdAt: new Date().toISOString(), label };
    localStorage.setItem(LS_KEY, JSON.stringify(rec));
  } finally {
    raw.fill(0);
  }
}

async function assertPrf(credentialId: Uint8Array, salt: Uint8Array): Promise<ArrayBuffer | undefined> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rpId: rpId(),
      allowCredentials: [{ type: "public-key", id: credentialId as BufferSource }],
      userVerification: "required",
      timeout: 120_000,
      extensions: { prf: { eval: { first: salt as BufferSource } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) return undefined;
  return (assertion.getClientExtensionResults() as PrfResults).prf?.results?.first;
}

/** Unlocks the vault via the enrolled passkey. */
export async function unlockWithPasskey(storage: StorageAdapter): Promise<VaultStore> {
  const rec = passkeyRecord();
  if (!rec) throw new Error("Kein Passkey eingerichtet.");
  const secret = await assertPrf(fromBase64(rec.credentialId), fromBase64(rec.salt));
  if (!secret) throw new Error("Biometrische Bestätigung fehlgeschlagen.");
  const kek = await kekFromPrf(secret);
  const raw = await decryptBytes(kek, fromBase64(rec.wrapped), "summa-passkey");
  try {
    return await VaultStore.openWithMasterKey(storage, raw);
  } finally {
    raw.fill(0);
  }
}

export function removePasskey(): void {
  localStorage.removeItem(LS_KEY);
}
