/**
 * Two-factor sign-in with an authenticator app (Supabase MFA, TOTP). Only the account login gets a second step;
 * the vault password and its encryption stay exactly as they are. The server refuses the encrypted data to a
 * session without the code once 2FA is on (supabase/schema.sql → summa_mfa_ok).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export class MfaRequiredError extends Error {
  constructor() {
    super("Bitte den 6-stelligen Code aus deiner Authenticator-App eingeben.");
    this.name = "MfaRequiredError";
  }
}

/** True when this session still has to pass the code (2FA is on, the session has only the password step). */
export async function secondFactorMissing(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.currentLevel === "aal1" && data.nextLevel === "aal2";
}

/** The verified authenticator of this account, if there is one. */
export async function totpFactor(client: SupabaseClient): Promise<{ id: string; createdAt: string } | null> {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  const f = data.totp.find((x) => x.status === "verified");
  return f ? { id: f.id, createdAt: f.created_at } : null;
}

/** Checks a code against the account's authenticator and lifts the session to the second step. */
export async function verifyCode(client: SupabaseClient, code: string, factorId?: string): Promise<void> {
  const id = factorId ?? (await totpFactor(client))?.id;
  if (!id) throw new Error("Für dieses Konto ist keine Authenticator-App eingerichtet.");
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId: id, code: code.replace(/\s+/g, "") });
  if (error) throw new Error(/invalid|code/i.test(error.message) ? "Der Code stimmt nicht. Bitte den aktuellen Code aus der App nehmen." : error.message);
}

/** Starts the setup: QR code and secret for the app. Half-finished setups from before are removed first. */
export async function startSetup(client: SupabaseClient): Promise<{ factorId: string; qr: string; secret: string }> {
  const { data: list } = await client.auth.mfa.listFactors();
  for (const f of list?.all ?? []) if (f.factor_type === "totp" && f.status !== "verified") await client.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `Ordo ${new Date().toISOString().slice(0, 10)}`, issuer: "Ordo" });
  if (error) throw new Error(error.message);
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Turns 2FA off again (needs a session that passed the code). */
export async function removeFactor(client: SupabaseClient, factorId: string): Promise<void> {
  const { error } = await client.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(/aal2|assurance/i.test(error.message) ? "Bitte zuerst den Code aus deiner Authenticator-App eingeben." : error.message);
}

/** After the password step of a sign-in: passes the code when one is needed, or asks for it. */
export async function passSecondFactor(client: SupabaseClient, code?: string): Promise<void> {
  if (!(await secondFactorMissing(client))) return;
  if (!code) throw new MfaRequiredError();
  await verifyCode(client, code);
}
