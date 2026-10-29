/**
 * Ordo account = e-mail + ONE password. The password unlocks the local vault (Argon2id) and, derived a
 * second way (Argon2id with an e-mail-bound salt, see deriveAccountSecret), signs in to the sync server –
 * the server never sees the password and cannot open the vault. The derived secret is kept inside the encrypted vault so an
 * unlocked device can re-sign in on its own.
 */
import { VaultStore, deriveAccountSecret, generateRecoveryKey, unlockWithPassword, type Mode } from "@ordo/core";
import { getPlatform } from "@/platform";
import { forgetIdentity, requireStore, useSession } from "@/state/session";
import { forgetOnDevice } from "./deviceUnlock";
import { BUCKET, bootstrapFromRemote, downloadAccountData, fetchEscrowedKey, translateAuthError, useSync } from "./sync";
import { ORDO_SERVER, isOrdoServer, pendingTarget, setPendingTarget, type ServerTarget } from "./server";
import { passSecondFactor, secondFactorMissing } from "./mfa";

const EMAIL_KEY = "summa.account.email";

export function rememberedEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberEmail(email: string) {
  try {
    if (email) localStorage.setItem(EMAIL_KEY, email);
    else localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* private mode */
  }
}

const normEmail = (e: string) => e.trim().toLowerCase();

/**
 * Where the account lives: the vault's own choice once it is connected, else what was picked on the start screen
 * ("Eigene Datenbank"), else the Ordo server.
 */
export function activeTarget(): ServerTarget {
  const s = useSession.getState().vault?.settings.sync;
  if (s?.email && s.supabaseUrl && s.supabaseAnonKey) return { url: s.supabaseUrl, anonKey: s.supabaseAnonKey };
  return pendingTarget() ?? ORDO_SERVER;
}

async function readyClient() {
  const t = activeTarget();
  const st = useSync.getState();
  if (!st.client || st.serverUrl !== t.url) await st.init(t.url, t.anonKey);
  const client = useSync.getState().client;
  if (!client) throw new Error("Server nicht erreichbar.");
  return client;
}

function attachAccount(email: string, secret: string) {
  const t = activeTarget();
  const own = !isOrdoServer(t.url);
  requireStore().mutate((v) => {
    v.settings = { ...v.settings, sync: { ...v.settings.sync, enabled: true, email, authSecret: secret, supabaseUrl: own ? t.url : "", supabaseAnonKey: own ? t.anonKey : "", deviceId: v.settings.sync.deviceId || generateRecoveryKey().slice(0, 9) } };
  });
  rememberEmail(email);
  // the vault remembers the server from now on
  setPendingTarget(null);
}

/** New user on this device: creates the account and a fresh vault protected by the same password. */
export async function createAccount(input: { email: string; password: string; name: string; mode: Mode }): Promise<{ recoveryKey?: string; confirmed: boolean }> {
  const email = normEmail(input.email);
  const secret = await deriveAccountSecret(email, input.password);
  await readyClient();
  // account first: if the beta is full we must not leave a half-created vault behind
  const confirmed = await useSync.getState().signUp(email, secret);
  const recoveryKey = await useSession.getState().create({ password: input.password, profileName: input.name.trim(), mode: input.mode });
  attachAccount(email, secret);
  if (confirmed) void useSync.getState().sync({ silent: true });
  return { recoveryKey, confirmed };
}

/** Existing user on a new device: signs in, downloads the encrypted vault and opens it with the same password. */
export async function signIn(emailRaw: string, password: string, code?: string): Promise<void> {
  const email = normEmail(emailRaw);
  const secret = await deriveAccountSecret(email, password);
  const platform = await getPlatform();
  const target = activeTarget();
  await bootstrapFromRemote({ url: target.url, anonKey: target.anonKey, email, password: secret, code, storage: platform.storage }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Invalid login credentials/i.test(msg)) throw new Error("E-Mail oder Passwort stimmen nicht – oder es gibt mit dieser E-Mail noch kein Konto (dann „Konto erstellen“).");
    if (/Email not confirmed/i.test(msg)) throw new Error("Bitte zuerst den Link in der Bestätigungs-E-Mail öffnen.");
    if (/noch kein Tresor/i.test(msg)) throw new Error("Dieses Konto hat noch keine Daten. Melde dich am Gerät an, auf dem du es erstellt hast, und warte auf den ersten Abgleich.");
    throw e;
  });
  await useSession.getState().init();
  await useSession.getState().unlock(password);
  attachAccount(email, secret);
  requireStore().mutate((v) => {
    v.settings = { ...v.settings, onboardingDone: true };
  });
}

/** Connects the vault that is already on this device to an account (new or empty). */
export async function connectAccount(emailRaw: string, password: string, mode: "create" | "login"): Promise<{ confirmed: boolean }> {
  const store = requireStore();
  try {
    await unlockWithPassword(store.header, password);
  } catch {
    throw new Error("Das Passwort stimmt nicht mit dem Passwort dieses Tresors überein.");
  }
  const email = normEmail(emailRaw);
  const secret = await deriveAccountSecret(email, password);
  const client = await readyClient();
  if (mode === "create") {
    const confirmed = await useSync.getState().signUp(email, secret);
    attachAccount(email, secret);
    if (confirmed) void useSync.getState().sync();
    return { confirmed };
  }
  const { data, error } = await client.auth.signInWithPassword({ email, password: secret });
  if (error) throw new Error(/Invalid login/i.test(error.message) ? "E-Mail oder Passwort stimmen nicht." : error.message);
  // an account with two-factor sign-in was set up on a device with data – the server hides it until the code is in
  const { data: meta } = await client.from("summa_vault_meta").select("revision").eq("user_id", data.user.id).maybeSingle();
  if (meta || (await secondFactorMissing(client))) {
    await client.auth.signOut();
    throw new Error("Dieses Konto hat schon Daten von einem anderen Gerät. Melde dich ab und auf dem Startbildschirm mit dem Konto an, um sie zu übernehmen.");
  }
  attachAccount(email, secret);
  await useSync.getState().refreshMeta();
  void useSync.getState().sync();
  return { confirmed: true };
}

/** After the vault password changed: move the account login to the new password as well. */
export async function updateAccountPassword(newPassword: string): Promise<void> {
  const store = requireStore();
  const { email } = store.vault.settings.sync;
  const { client, session } = useSync.getState();
  if (!email || !client || !session) return;
  const secret = await deriveAccountSecret(email, newPassword);
  const { error } = await client.auth.updateUser({ password: secret });
  if (error) throw new Error(error.message);
  store.mutate((v) => {
    v.settings = { ...v.settings, sync: { ...v.settings.sync, authSecret: secret } };
  });
}

/**
 * Forgotten password, step 1: the server mails a one-time code. A code (not a link) works the same in the
 * browser and in the desktop app and needs no redirect.
 */
export async function requestPasswordReset(emailRaw: string): Promise<void> {
  const client = await readyClient();
  const { error } = await client.auth.resetPasswordForEmail(normEmail(emailRaw));
  if (error) throw new Error(translateAuthError(error.message));
}

/** The account has no deposited key yet (created before e-mail reset existed): the recovery key is needed. */
export class RecoveryKeyNeededError extends Error {
  constructor() {
    super("Für dieses Konto ist noch kein Schlüssel hinterlegt – bitte einmalig den Wiederherstellungsschlüssel eingeben.");
  }
}

/**
 * Forgotten password, step 2: the e-mail code signs in, the encrypted data comes down, the vault key that
 * the account deposited in Supabase Vault opens it, and the new password replaces the old one – locally
 * and for the account. Only accounts without a deposited key need the recovery key.
 */
export async function resetPasswordWithCode(input: { email: string; code: string; newPassword: string; recoveryKey?: string; mfaCode?: string }): Promise<void> {
  const email = normEmail(input.email);
  const client = await readyClient();
  // a failed later step must not burn the one-time code: reuse the session from a previous attempt
  let session = useSync.getState().session;
  if (!session || session.user.email?.toLowerCase() !== email) {
    const { data, error } = await client.auth.verifyOtp({ email, token: input.code.replace(/\s/g, ""), type: "recovery" });
    if (error || !data.session) throw new Error(translateAuthError(error?.message ?? "Code ungültig"));
    session = data.session;
    useSync.setState({ session });
  }
  // two-factor sign-in on: the e-mail code is only half of it
  await passSecondFactor(client, input.mfaCode);
  session = (await client.auth.getSession()).data.session ?? session;
  const platform = await getPlatform();
  await downloadAccountData(client, session, platform.storage).catch((e: unknown) => {
    throw new Error(/noch kein Tresor/i.test(String(e)) ? "Auf diesem Konto liegen noch keine Daten. Melde dich am Gerät an, auf dem du das Konto erstellt hast, und warte auf den ersten Abgleich." : e instanceof Error ? e.message : String(e));
  });
  await useSession.getState().init();
  const key = await fetchEscrowedKey(client);
  if (key) {
    try {
      useSession.getState().adopt(await VaultStore.openWithMasterKey(platform.storage, key));
    } finally {
      key.fill(0);
    }
  } else if (input.recoveryKey) {
    await useSession.getState().unlockWithRecovery(input.recoveryKey).catch(() => {
      throw new Error("Der Wiederherstellungsschlüssel passt nicht zu diesem Konto.");
    });
  } else {
    throw new RecoveryKeyNeededError();
  }
  await finishPasswordReset(email, input.newPassword);
}

/**
 * Lock screen: the vault on this device was opened with the recovery key – set the new password and, if the
 * device belongs to an account, move the account login along (signing in with the old derived secret that
 * is stored inside the vault).
 */
export async function resetPasswordOnDevice(newPassword: string): Promise<void> {
  const { email, authSecret } = requireStore().vault.settings.sync;
  if (email && authSecret && !useSync.getState().session) {
    const client = await readyClient();
    const { data } = await client.auth.signInWithPassword({ email, password: authSecret });
    if (data.session) useSync.setState({ session: data.session });
  }
  await finishPasswordReset(email, newPassword);
}

async function finishPasswordReset(email: string, newPassword: string): Promise<void> {
  const store = requireStore();
  await store.resetPassword(newPassword);
  const { client, session } = useSync.getState();
  if (email && client && session) {
    const secret = await deriveAccountSecret(email, newPassword);
    const { error } = await client.auth.updateUser({ password: secret });
    if (error) throw new Error(translateAuthError(error.message));
    attachAccount(email, secret);
    store.mutate((v) => {
      v.settings = { ...v.settings, onboardingDone: true };
    });
    // upload the vault with the new password wrap so other devices can sign in with it
    await useSync.getState().sync({ silent: true });
  }
}

export async function resendConfirmation(): Promise<void> {
  const email = requireStore().vault.settings.sync.email;
  const client = await readyClient();
  const { error } = await client.auth.resend({ type: "signup", email });
  if (error) throw new Error(error.message);
}

/**
 * Sign out. With `removeFromDevice` the local copy is deleted too (it stays in the account if it was
 * synchronised) – the right choice on a shared or foreign computer.
 */
export async function signOut(opts: { removeFromDevice: boolean }): Promise<void> {
  const sync = useSync.getState();
  if (sync.session && useSession.getState().vault?.settings.sync.enabled) {
    await sync.sync({ silent: true }).catch(() => {});
  }
  await sync.signOut().catch(() => {});
  if (opts.removeFromDevice) {
    rememberEmail("");
    forgetIdentity();
    const { platform, lock } = useSession.getState();
    await lock();
    await platform?.wipe();
    location.reload();
    return;
  }
  await useSession.getState().lock();
}

/** Lock screen → "Anderes Konto": removes the local (encrypted) data so someone else can sign in. */
export async function removeLocalData(): Promise<void> {
  rememberEmail("");
  forgetIdentity();
  await forgetOnDevice();
  const platform = await getPlatform();
  await platform.wipe();
  location.reload();
}

/**
 * Deletes the signed-in sync account where no operator function does it (own databases, community edition):
 * first the account's own encrypted files – row-level security lets everyone remove their own – then the account
 * itself (supabase/schema.sql → summa_delete_self). The data on this device stays.
 */
export async function deleteOwnAccount(): Promise<void> {
  const { client, session } = useSync.getState();
  if (!client || !session) throw new Error("Nicht angemeldet.");
  const uid = session.user.id;
  const paths: string[] = [];
  const { data: blobs } = await client.storage.from(BUCKET).list(`${uid}/blobs`, { limit: 10000 });
  for (const f of blobs ?? []) paths.push(`${uid}/blobs/${f.name}`);
  const { data: top } = await client.storage.from(BUCKET).list(uid, { limit: 1000 });
  // folders come back without an id
  for (const f of top ?? []) if (f.id) paths.push(`${uid}/${f.name}`);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await client.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw new Error(`Dateien konnten nicht gelöscht werden: ${error.message}`);
  }
  const { error } = await client.rpc("summa_delete_self");
  if (error) {
    if (/summa_delete_self/i.test(error.message)) throw new Error("Auf diesem Server fehlt dafür noch das aktuelle Datenbank-Schema (supabase/schema.sql).");
    if (/LAST_ADMIN/.test(error.message)) throw new Error("Das letzte Admin-Konto kann sich nicht selbst löschen.");
    if (/MFA_REQUIRED/.test(error.message)) throw new Error("Bitte zuerst den Code aus deiner Authenticator-App eingeben.");
    throw new Error(error.message);
  }
}
