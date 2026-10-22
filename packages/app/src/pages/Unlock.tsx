import { useEffect, useState, type FormEvent } from "react";
import { ArchiveRestore, ArrowLeft, Cloud, Fingerprint, HardDrive, KeyRound, Lock, LogIn, ShieldCheck, UserRoundX } from "lucide-react";
import { deviceIdentity, useSession } from "@/state/session";
import { initials } from "@/lib/format";
import { Button, ConfirmDialog, Field } from "@/components/ui";
import { AuthLayout, IconInput, RestoreBackupDialog, StayUnlockedCheckbox } from "@/components/AuthLayout";
import { PasswordReset } from "@/components/PasswordReset";
import { toast } from "@/state/toasts";
import { DEMO_HINT, DEMO_PASSWORD } from "@/services/demo";
import { passkeyRecord } from "@/services/webauthn";
import { rememberedEmail, removeLocalData, resetPasswordOnDevice } from "@/services/account";

/** Returning user on this device: one password field, like any other app login. */
export default function Unlock() {
  const { unlock, unlockWithRecovery, unlockWithPasskey, busy, error, header } = useSession();
  const passkey = passkeyRecord();
  const email = rememberedEmail();
  const isDemo = header?.hint === DEMO_HINT;
  const [password, setPassword] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [confirmOther, setConfirmOther] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  useEffect(() => {
    document.title = "Ordo – Anmelden";
  }, []);

  const fail = () => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!recoveryMode) {
      await unlock(password).catch(fail);
      return;
    }
    // forgotten password: the recovery key opens the vault, then the new password replaces the old one
    setRecoveryError(null);
    try {
      await unlockWithRecovery(recovery);
    } catch {
      setRecoveryError("Der Wiederherstellungsschlüssel stimmt nicht.");
      fail();
      return;
    }
    try {
      await resetPasswordOnDevice(newPassword);
      toast.success("Neues Passwort gesetzt", email ? "Gilt ab jetzt auch für die Anmeldung auf anderen Geräten." : undefined);
    } catch (err) {
      toast.error("Passwort nur auf diesem Gerät geändert", err instanceof Error ? err.message : String(err));
    }
  };

  const errorBox = (msg: string | null) => (msg ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200">{msg}</div> : null);

  return (
    <AuthLayout
      title={isDemo ? "Ordo Demo" : recoveryMode ? "Neues Passwort festlegen" : "Willkommen zurück"}
      subtitle={isDemo ? "Beispielkonto zum Ausprobieren" : recoveryMode ? (email ? "Mit einem Code per E-Mail" : "Mit deinem Wiederherstellungsschlüssel") : "Melde dich mit deinem Passwort an."}
      width="sm"
    >
      {recoveryMode && email ? (
        // with an account the e-mail code is enough; the recovery key is only for data kept on this device alone
        <div className="surface overflow-hidden"><PasswordReset initialEmail={email} onBack={() => setRecoveryMode(false)} /></div>
      ) : (
      <form onSubmit={submit} className={`surface space-y-4 p-6 ${shake ? "animate-[shake_0.4s]" : ""}`}>
        {email ? <input type="email" autoComplete="username" value={email} readOnly hidden /> : null}
        {!isDemo && !recoveryMode ? <IdentityCard email={email} /> : null}
        {recoveryMode ? (
          <>
            <Field label="Wiederherstellungsschlüssel" hint="Den hast du beim Anlegen bekommen – 32 Zeichen, Groß-/Kleinschreibung egal.">
              <IconInput icon={<KeyRound />} autoFocus value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" className="font-mono" autoComplete="off" />
            </Field>
            <Field label="Neues Passwort" hint="Mindestens 8 Zeichen.">
              <IconInput icon={<Lock />} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Neues Passwort wiederholen" error={confirm && confirm !== newPassword ? "Passwörter stimmen nicht überein" : undefined}>
              <IconInput icon={<Lock />} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
            {errorBox(recoveryError)}
            <Button type="submit" className="w-full justify-center" loading={busy} disabled={recovery.replace(/[\s-]/g, "").length < 20 || newPassword.length < 8 || newPassword !== confirm}>
              <ShieldCheck className="h-4 w-4" /> Passwort setzen und öffnen
            </Button>
          </>
        ) : (
          <>
            <div>
              <Field label="Passwort" hint={header?.hint && !isDemo ? `Hinweis: ${header.hint}` : undefined}>
                <IconInput icon={<Lock />} autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
              </Field>
              {!isDemo ? (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <StayUnlockedCheckbox />
                  <button type="button" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => setRecoveryMode(true)}>Passwort vergessen?</button>
                </div>
              ) : null}
            </div>
            {errorBox(error)}
            {isDemo ? (
              <Button type="button" className="w-full justify-center" loading={busy} onClick={() => void unlock(DEMO_PASSWORD).catch(() => {})}>
                Demo öffnen
              </Button>
            ) : (
              <Button type="submit" className="w-full justify-center" loading={busy} disabled={!password}>
                <LogIn className="h-4 w-4" /> Anmelden
              </Button>
            )}
            {passkey ? (
              <Button type="button" variant="outline" className="w-full justify-center" loading={busy} onClick={() => void unlockWithPasskey().catch(() => {})}>
                <Fingerprint className="h-4 w-4" /> Mit Windows Hello / Fingerabdruck
              </Button>
            ) : null}
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--border) pt-3 text-xs">
          {recoveryMode ? (
            <button type="button" className="inline-flex items-center gap-1 text-(--text-muted) hover:text-(--text)" onClick={() => { setRecoveryMode(false); setRecoveryError(null); }}>
              <ArrowLeft className="h-3.5 w-3.5" /> Mit Passwort anmelden
            </button>
          ) : (
            <button type="button" className="inline-flex items-center gap-1 text-(--text-muted) hover:text-(--text)" onClick={() => setRestoreOpen(true)}>
              <ArchiveRestore className="h-3.5 w-3.5" /> Sicherung wiederherstellen
            </button>
          )}
          <button type="button" className="inline-flex items-center gap-1 text-(--text-muted) hover:text-(--text)" onClick={() => setConfirmOther(true)}>
            <UserRoundX className="h-3.5 w-3.5" />
            {isDemo ? "Demo beenden" : "Anderes Konto"}
          </button>
        </div>
      </form>
      )}
      <RestoreBackupDialog open={restoreOpen} onClose={() => setRestoreOpen(false)} />
      <ConfirmDialog
        open={confirmOther}
        onClose={() => setConfirmOther(false)}
        danger
        title={isDemo ? "Demo beenden?" : "Mit anderem Konto anmelden?"}
        body={isDemo ? "Die Beispieldaten werden von diesem Gerät gelöscht. Danach kannst du dich anmelden oder ein Konto erstellen." : `Die verschlüsselten Daten${email ? ` von ${email}` : ""} werden von diesem Gerät entfernt. Hast du ein Konto mit Abgleich, bleiben sie dort gespeichert und kommen bei der nächsten Anmeldung zurück. Ohne Konto sind sie danach weg – vorher eine Sicherung exportieren.`}
        confirmLabel={isDemo ? "Demo beenden" : "Vom Gerät entfernen"}
        onConfirm={() => void removeLocalData()}
      />
      <style>{`@keyframes shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-6px)}40%,60%{transform:translateX(6px)}}`}</style>
    </AuthLayout>
  );
}

/** Whose data this device holds: person, e-mail and profiles, so nobody signs in to the wrong account. */
function IdentityCard({ email }: { email: string }) {
  const id = deviceIdentity();
  const name = id?.name || email || "Ordo auf diesem Gerät";
  const synced = id ? id.synced : !!email;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-(--border) bg-(--surface-2) p-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">{initials(name)}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{name}</div>
        {email ? <div className="truncate text-sm text-(--text-muted)">{email}</div> : null}
        <div className="mt-0.5 flex items-center gap-1 text-xs text-(--text-muted)">
          {synced ? <><Cloud className="h-3.5 w-3.5" /> Konto mit Abgleich</> : <><HardDrive className="h-3.5 w-3.5" /> Nur auf diesem Gerät</>}
          {id && id.profileCount > 1 ? <span> · {id.profileCount} Profile</span> : null}
        </div>
      </div>
    </div>
  );
}
