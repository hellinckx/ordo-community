import { useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, Lock, Mail, MailCheck, Send, ShieldCheck, UserPlus } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { IconInput } from "@/components/AuthLayout";
import { toast } from "@/state/toasts";
import { RecoveryKeyNeededError, requestPasswordReset, resetPasswordWithCode } from "@/services/account";
import { MfaRequiredError } from "@/services/mfa";
import { AuthenticatorCodeField } from "@/components/TwoFactor";

/**
 * "Passwort vergessen?": a code per e-mail, then code + new password. The recovery key is asked for only
 * when the account has no deposited vault key (accounts from before e-mail reset existed).
 */
export function PasswordReset({ initialEmail, onBack, onRegister }: { initialEmail: string; onBack: () => void; /** shown as "no account yet?" on the sign-in screen */ onRegister?: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof RecoveryKeyNeededError) setNeedsKey(true);
      if (e instanceof MfaRequiredError) {
        setNeedsMfa(true);
        setError(null);
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const send = (e?: FormEvent) => {
    e?.preventDefault();
    void run(async () => {
      await requestPasswordReset(email);
      setSent(true);
      toast.success("Code verschickt", `Schau in dein Postfach (${email.trim()}).`);
    });
  };
  const reset = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await resetPasswordWithCode({ email, code, newPassword: password, recoveryKey: needsKey ? recoveryKey : undefined, mfaCode: needsMfa ? mfaCode : undefined });
      toast.success("Neues Passwort gesetzt", "Du bist angemeldet. Auf anderen Geräten meldest du dich ab jetzt mit dem neuen Passwort an.");
    });
  };

  const errorBox = error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200">{error}</div> : null;

  return (
    <div className="space-y-4 p-6">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-(--text-muted) hover:text-(--text)"><ArrowLeft className="h-4 w-4" /> Zurück zur Anmeldung</button>
      {!sent ? (
        <form onSubmit={send} className="space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound className="h-5 w-5 text-brand-600" /> Passwort vergessen?</h2>
            <p className="mt-1 text-sm text-(--text-muted)">Kein Problem. Wir schicken dir einen Code per E-Mail, damit setzt du ein neues Passwort.</p>
          </div>
          <Field label="E-Mail"><IconInput icon={<Mail />} autoFocus type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="du@beispiel.at" /></Field>
          {errorBox}
          <Button type="submit" className="w-full justify-center" loading={busy} disabled={!email.includes("@")}><Send className="h-4 w-4" /> Code senden</Button>
        </form>
      ) : (
        <form onSubmit={reset} className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-900/20 dark:text-sky-100">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <div>Falls es ein Konto mit <strong>{email.trim()}</strong> gibt, ist der Code unterwegs. Er gilt eine Stunde. Nichts bekommen? Spam-Ordner prüfen oder <button type="button" className="font-medium underline" onClick={() => send()} disabled={busy}>neu senden</button>.</div>
          </div>
          {onRegister ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
              <UserPlus className="mt-0.5 h-5 w-5 shrink-0" />
              <div>Noch nie ein Konto erstellt? Dann kommt auch keine E-Mail. <button type="button" className="font-semibold underline" onClick={onRegister}>Jetzt Konto erstellen</button></div>
            </div>
          ) : null}
          <Field label="Code aus der E-Mail"><IconInput icon={<MailCheck />} autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="12345678" className="font-mono tracking-widest" /></Field>
          <Field label="Neues Passwort" hint="Mindestens 8 Zeichen. Gilt danach für alle deine Geräte."><IconInput icon={<Lock />} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Neues Passwort wiederholen" error={confirm && confirm !== password ? "Passwörter stimmen nicht überein" : undefined}><IconInput icon={<Lock />} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          {needsKey ? (
            <Field label="Wiederherstellungsschlüssel" hint="32 Zeichen, z. B. ABCD-EFGH-… – Groß-/Kleinschreibung egal."><IconInput icon={<KeyRound />} value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" className="font-mono" autoComplete="off" /></Field>
          ) : null}
          {needsMfa ? <AuthenticatorCodeField value={mfaCode} onChange={setMfaCode} autoFocus /> : null}
          {errorBox}
          <Button type="submit" className="w-full justify-center" loading={busy} disabled={code.replace(/\s/g, "").length < 6 || password.length < 8 || password !== confirm || (needsKey && recoveryKey.replace(/[\s-]/g, "").length < 20) || (needsMfa && mfaCode.length !== 6)}><ShieldCheck className="h-4 w-4" /> Neues Passwort setzen</Button>
        </form>
      )}
    </div>
  );
}
