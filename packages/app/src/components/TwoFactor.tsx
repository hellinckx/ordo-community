import { useEffect, useState } from "react";
import { ShieldCheck, Smartphone } from "lucide-react";
import { Button, Card, Field, Input, Modal } from "@/components/ui";
import { toast } from "@/state/toasts";
import { useSync } from "@/services/sync";
import { removeFactor, startSetup, totpFactor, verifyCode } from "@/services/mfa";

const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

/** The 6-digit code from the authenticator app. */
export function AuthenticatorCodeField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <Field label="Code aus der Authenticator-App" hint="6 Ziffern, z. B. aus Google Authenticator, Microsoft Authenticator oder 1Password.">
      <Input autoFocus={autoFocus} inputMode="numeric" autoComplete="one-time-code" value={value} onChange={(e) => onChange(digits(e.target.value))} placeholder="123456" className="w-40 font-mono text-lg tracking-[0.3em]" />
    </Field>
  );
}

/**
 * The account signed in again in the background (e.g. the server session ran out) and two-factor sign-in is on:
 * the encrypted data stays on the server until the code is in. Everything on this device keeps working meanwhile.
 */
export function MfaPrompt() {
  const { mfaNeeded, client } = useSync();
  const [open, setOpen] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (mfaNeeded) setOpen(true);
  }, [mfaNeeded]);
  if (!mfaNeeded || !client) return null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyCode(client, code);
      useSync.setState({ mfaNeeded: false });
      setCode("");
      toast.success("Bestätigt", "Der Abgleich läuft wieder.");
      void useSync.getState().sync();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      size="sm"
      title={<span className="inline-flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-brand-600" /> Kurz bestätigen</span>}
      footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Später</Button><Button onClick={() => void submit()} loading={busy} disabled={code.length !== 6}>Bestätigen</Button></>}
    >
      <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) void submit(); }}>
        <p className="text-(--text-muted)">Dein Konto ist mit einer Authenticator-App geschützt. Damit Ordo wieder mit deinen anderen Geräten abgleicht, gib bitte den aktuellen Code ein. Bis dahin arbeitest du hier ganz normal weiter.</p>
        <AuthenticatorCodeField value={code} onChange={setCode} autoFocus />
        {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-900/30 dark:text-red-200">{error}</div> : null}
      </form>
    </Modal>
  );
}

/** Settings → Sicherheit: turn two-factor sign-in on or off (accounts only – without an account there is no login). */
export function TwoFactorCard() {
  const { client, session, mfaNeeded } = useSync();
  const [factor, setFactor] = useState<{ id: string; createdAt: string } | null | undefined>(undefined);
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    if (!client || !session) return;
    let alive = true;
    void totpFactor(client).then((f) => { if (alive) setFactor(f); }).catch(() => { if (alive) setFactor(null); });
    return () => { alive = false; };
  }, [client, session]);

  if (!client || !session) {
    return (
      <Card title="Zwei-Faktor-Anmeldung">
        <p className="text-sm text-(--text-muted)">Gibt es für Konten: Beim Anmelden auf einem neuen Gerät fragt Ordo dann zusätzlich nach einem Code aus deiner Authenticator-App. Ohne Konto bleibt alles auf diesem Gerät, da braucht es keinen zweiten Schritt.</p>
      </Card>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const begin = () => run(async () => { setCode(""); setSetup(await startSetup(client)); });
  const finish = () => run(async () => {
    if (!setup) return;
    await verifyCode(client, code, setup.factorId);
    setFactor(await totpFactor(client));
    setSetup(null);
    setCode("");
    toast.success("Zwei-Faktor-Anmeldung ist an", "Neue Geräte brauchen ab jetzt zusätzlich den Code aus der App.");
  });
  const turnOff = () => run(async () => {
    if (!factor) return;
    if (code.length === 6) await verifyCode(client, code, factor.id);
    await removeFactor(client, factor.id);
    setFactor(null);
    setConfirmOff(false);
    setCode("");
    toast.success("Zwei-Faktor-Anmeldung ist aus");
  });
  const errorBox = error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200">{error}</div> : null;

  return (
    <Card title="Zwei-Faktor-Anmeldung">
      {factor === undefined ? <p className="text-sm text-(--text-muted)">Wird geprüft …</p> : factor && !setup ? (
        <div className="space-y-3 text-sm">
          <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span><strong>Ist an.</strong> Wer sich auf einem neuen Gerät anmeldet oder das Passwort per E-Mail zurücksetzt, braucht zusätzlich den Code aus deiner Authenticator-App. Ohne ihn gibt der Server deine verschlüsselten Daten nicht heraus.</span></p>
          {mfaNeeded ? <p className="text-amber-700 dark:text-amber-300">Dieses Gerät wartet gerade auf den Code – der Abgleich ist pausiert.</p> : null}
          {confirmOff ? (
            <div className="space-y-3 rounded-xl bg-(--surface-2) p-3">
              <p>Zum Ausschalten den aktuellen Code eingeben.</p>
              <AuthenticatorCodeField value={code} onChange={setCode} autoFocus />
              {errorBox}
              <div className="flex gap-2"><Button size="sm" variant="danger" onClick={() => void turnOff()} loading={busy} disabled={code.length !== 6}>Ausschalten</Button><Button size="sm" variant="ghost" onClick={() => { setConfirmOff(false); setError(null); }}>Abbrechen</Button></div>
            </div>
          ) : <Button size="sm" variant="outline" onClick={() => setConfirmOff(true)}>Ausschalten</Button>}
        </div>
      ) : setup ? (
        <div className="space-y-3 text-sm">
          <p>1. Öffne deine Authenticator-App und scanne den Code. Am Handy kannst du stattdessen den Schlüssel abtippen.</p>
          <div className="flex flex-wrap items-center gap-4">
            <img src={setup.qr} alt="QR-Code für die Authenticator-App" className="h-40 w-40 rounded-lg bg-white p-2" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-(--text-muted)">Schlüssel zum Abtippen</div>
              <code className="block font-mono text-sm break-all select-all">{setup.secret}</code>
            </div>
          </div>
          <p>2. Gib den 6-stelligen Code ein, den die App jetzt zeigt.</p>
          <AuthenticatorCodeField value={code} onChange={setCode} />
          {errorBox}
          <div className="flex gap-2"><Button size="sm" onClick={() => void finish()} loading={busy} disabled={code.length !== 6}><ShieldCheck className="h-4 w-4" /> Einschalten</Button><Button size="sm" variant="ghost" onClick={() => { setSetup(null); setError(null); }}>Abbrechen</Button></div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-(--text-muted)">Ein zweiter Schutz für dein Konto: Beim Anmelden auf einem neuen Gerät und beim Zurücksetzen des Passworts fragt Ordo zusätzlich nach einem Code aus einer Authenticator-App am Handy. Ein gestohlenes Passwort allein reicht dann nicht mehr. Auf diesem Gerät ändert sich im Alltag nichts.</p>
          {errorBox}
          <Button size="sm" onClick={() => void begin()} loading={busy}><Smartphone className="h-4 w-4" /> Mit Authenticator-App schützen</Button>
        </div>
      )}
    </Card>
  );
}
