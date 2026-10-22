import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { ArchiveRestore, ArrowLeft, ArrowRight, Bot, Briefcase, Building2, Check, Copy, Database, Download, FolderOpen, HardDrive, KeyRound, Lock, LogIn, Mail, MailCheck, ShieldCheck, Sparkles, User, UserPlus } from "lucide-react";
import type { Mode } from "@ordo/core";
import { useSession } from "@/state/session";
import { isTauri } from "@/platform";
import { AiProviderSetup } from "@/components/AiProviderSetup";
import { WatchFolderCards } from "@/components/WatchFolderCards";
import { legalPage, openExternal } from "@/components/LegalLinks";
import { AuthLayout, IconInput, OptionRow, RestoreBackupDialog, StayUnlockedCheckbox } from "@/components/AuthLayout";
import { PasswordReset } from "@/components/PasswordReset";
import { Button, Field, Input, Progress } from "@/components/ui";
import { toast } from "@/state/toasts";
import { startDemo } from "@/services/demo";
import { SignupClosedError, fetchCapacity } from "@/services/sync";
import { PARTS } from "@/operator";
import { createAccount, rememberedEmail, signIn } from "@/services/account";
import { MfaRequiredError } from "@/services/mfa";
import { AuthenticatorCodeField } from "@/components/TwoFactor";
import { NoDataLine, OwnDatabaseDialog, ServerChip } from "@/components/OwnDatabase";
import { pendingTarget, setPendingTarget, type ServerTarget } from "@/services/server";
import { useSync } from "@/services/sync";
import { cls } from "@/lib/format";
import { HAS_DEFAULT_SERVER } from "@/config";

function passwordStrength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score += 0.25;
  if (pw.length >= 12) score += 0.25;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 0.15;
  if (/\d/.test(pw)) score += 0.15;
  if (/[^A-Za-z0-9]/.test(pw)) score += 0.2;
  if (pw.length >= 20) score = Math.max(score, 0.9);
  const label = score < 0.4 ? "schwach" : score < 0.7 ? "okay" : score < 0.9 ? "stark" : "sehr stark";
  return { score: Math.min(1, score), label };
}

export default function Onboarding() {
  const { create, busy, platform } = useSession();
  const alreadyUnlocked = useSession((s) => s.status === "unlocked");
  const [step, setStep] = useState(alreadyUnlocked ? 3 : 0);
  // First screen for new visitors: start fresh, sign in from another device, or try the demo
  const [welcome, setWelcome] = useState(!alreadyUnlocked);
  const [mode, setMode] = useState<Mode>("employee");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [hint, setHint] = useState("");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [demoStatus, setDemoStatus] = useState<string | null>(null);
  // Start screen: "login" (default, like every app), "register" or "forgot"; "Ohne Konto" opens the wizard
  const [entry, setEntry] = useState<"login" | "register" | "forgot">("login");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [email, setEmail] = useState(() => rememberedEmail());
  const [accepted, setAccepted] = useState(false);
  // the operator's terms – the community edition has none to accept
  const terms = legalPage("Nutzungsbedingungen");
  const privacy = legalPage("Datenschutz");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // two-factor sign-in: after the password the account asks for the code from the authenticator app
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [waitlist, setWaitlist] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);
  // Ordo server (null) or the person's own Supabase project – chosen here, remembered in the vault once connected
  const [target, setTarget] = useState<ServerTarget | null>(() => pendingTarget());
  const [ownDb, setOwnDb] = useState<"setup" | "join" | null>(null);
  // no preconfigured server (community edition): signing in needs an own database first
  const needsServer = !HAS_DEFAULT_SERVER && !target;
  const chooseTarget = (t: ServerTarget | null) => {
    setPendingTarget(t);
    setTarget(t);
    setWaitlist(false);
    setAuthError(null);
    // a client of the old server must not answer for the new one
    useSync.setState({ client: null, session: null });
  };
  const doLogin = async (e?: FormEvent) => {
    e?.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signIn(email, password, mfaStep ? mfaCode : undefined);
      toast.success("Angemeldet", "Deine Daten sind auf diesem Gerät.");
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        setMfaStep(true);
        return;
      }
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthBusy(false);
    }
  };
  const doRegister = async (e?: FormEvent) => {
    e?.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const r = await createAccount({ email, password, name, mode });
      // with an account a forgotten password is reset by e-mail code – no recovery key to write down
      setPendingConfirm(!r.confirmed);
      setAccountCreated(true);
      setStep(4);
    } catch (err) {
      if (err instanceof SignupClosedError) setWaitlist(true);
      else setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthBusy(false);
    }
  };
  const strength = useMemo(() => passwordStrength(password), [password]);
  const runDemo = async () => {
    setDemoStatus("Demo wird vorbereitet …");
    try {
      await startDemo(setDemoStatus);
      toast.success("Demo gestartet", "Alles Beispieldaten. Zwischen Firma und Privat wechselst du im Menü rechts oben.");
    } catch (e) {
      toast.error("Demo konnte nicht gestartet werden", e instanceof Error ? e.message : String(e));
      setDemoStatus(null);
    }
  };

  useEffect(() => {
    document.title = "Ordo – Einrichtung";
  }, []);

  const canCreate = name.trim().length > 0 && password.length >= 8 && password === confirm;

  const doCreate = async () => {
    try {
      const key = await create({ password, hint: hint.trim() || undefined, profileName: name.trim(), mode });
      setRecoveryKey(key ?? null);
      setStep(3);
    } catch (e) {
      toast.error("Tresor konnte nicht erstellt werden", e instanceof Error ? e.message : String(e));
    }
  };

  // Back/forward in the browser (or the mouse's back button) moves between these views; once the vault exists there is no way back
  useViewHistory(welcome ? entry : step <= 2 ? `step${step}` : null, (view) => {
    setAuthError(null);
    setWaitlist(false);
    if (view.startsWith("step")) {
      setWelcome(false);
      setStep(Number(view.slice(4)));
    } else {
      setWelcome(true);
      setEntry(view as typeof entry);
    }
  });

  const steps = ["Modus", "Profil", "Passwort", "Schlüssel", "KI", ...(isTauri ? ["Ordner"] : [])];
  const [aiReady, setAiReady] = useState(true);
  const finish = () => {
    useSession.getState().store?.mutate((v) => { v.settings = { ...v.settings, onboardingDone: true }; });
  };

  const tabs = (
    <div className="grid grid-cols-2 border-b border-(--border)">
      {(["login", "register"] as const).map((t) => (
        <button key={t} type="button" onClick={() => { setEntry(t); setAuthError(null); setWaitlist(false); }} className={cls("inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors", entry === t ? "border-b-2 border-brand-600 text-brand-700 dark:text-brand-300" : "text-(--text-muted) hover:text-(--text)")}>
          {t === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          {t === "login" ? "Anmelden" : "Konto erstellen"}
        </button>
      ))}
    </div>
  );

  if (welcome) {
    return (
      <AuthLayout title={entry === "register" ? "Konto erstellen" : "Willkommen bei Ordo"} subtitle="Buchhaltung, Projekte und Lager an einem Ort – lokal und verschlüsselt.">
        <div className="surface animate-fade-in overflow-hidden">
          {needsServer ? (
            <div className="space-y-4 p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"><HardDrive className="h-[18px] w-[18px]" /></span>
                <div>
                  <h2 className="font-semibold">Ordo läuft bei dir</h2>
                  <p className="mt-0.5 text-sm text-(--text-muted)">Ohne Konto bleibt alles verschlüsselt auf diesem Gerät. Für mehrere Geräte oder ein Team verbindest du deine eigene Datenbank – ein kostenloses Supabase-Projekt, das dir gehört.</p>
                </div>
              </div>
              <Button className="w-full justify-center" onClick={() => setWelcome(false)}><HardDrive className="h-4 w-4" /> Ohne Konto starten</Button>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" className="justify-center" onClick={() => setOwnDb("setup")}><Database className="h-4 w-4" /> Datenbank einrichten</Button>
                <Button variant="outline" className="justify-center" onClick={() => setOwnDb("join")}><LogIn className="h-4 w-4" /> Mit Datenbank anmelden</Button>
              </div>
            </div>
          ) : <>
          {entry !== "forgot" ? tabs : null}
          {entry === "forgot" ? (
            <PasswordReset initialEmail={email} onBack={() => setEntry("login")} onRegister={() => { setEntry("register"); setAuthError(null); }} />
          ) : entry === "login" ? (
            <form onSubmit={doLogin} className="space-y-4 p-6">
              <ServerChip target={target} onChange={() => setOwnDb("join")} onReset={() => chooseTarget(null)} />
              <Field label="E-Mail"><IconInput icon={<Mail />} autoFocus type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="du@beispiel.at" /></Field>
              <div>
                <Field label="Passwort"><IconInput icon={<Lock />} type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setMfaStep(false); }} placeholder="••••••••" /></Field>
                <div className="mt-2 flex items-center justify-between gap-2"><StayUnlockedCheckbox /><button type="button" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => { setEntry("forgot"); setAuthError(null); }}>Passwort vergessen?</button></div>
              </div>
              {mfaStep ? <div className="rounded-xl bg-(--surface-2) p-3"><p className="mb-2 text-sm">Dein Konto ist mit einer Authenticator-App geschützt.</p><AuthenticatorCodeField value={mfaCode} onChange={setMfaCode} autoFocus /></div> : null}
              {authError ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200">{authError}</div> : null}
              <Button type="submit" className="w-full justify-center" loading={authBusy} disabled={!email.includes("@") || !password || (mfaStep && mfaCode.length !== 6)}><LogIn className="h-4 w-4" /> Anmelden</Button>
              <p className="text-center text-xs text-(--text-muted)">Noch kein Konto? <button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => { setEntry("register"); setAuthError(null); }}>Jetzt kostenlos erstellen</button></p>
            </form>
          ) : (
            <form onSubmit={doRegister} className="space-y-4 p-6">
              <ServerChip target={target} onChange={() => setOwnDb("setup")} onReset={() => chooseTarget(null)} />
              <CapacityLine target={target} />
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-(--surface-2) p-1">
                {(["employee", "business"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} className={cls("flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors", mode === m ? "bg-(--surface) shadow-sm" : "text-(--text-muted) hover:text-(--text)")}>
                    {m === "employee" ? <User className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
                    {m === "employee" ? "Privat" : "Firma"}
                  </button>
                ))}
              </div>
              <p className="-mt-2 text-xs text-(--text-muted)">{mode === "business" ? "Summa für die Buchhaltung ist gleich dabei. Projekte, Lager und Produktion fügst du jederzeit unter „Module“ hinzu." : "Privat und Firma? Ein Konto reicht – das zweite Profil legst du danach im Menü rechts oben an."}</p>
              <Field label={mode === "business" ? "Firmenname" : "Dein Name"}><IconInput icon={mode === "business" ? <Building2 /> : <User />} value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === "business" ? "z. B. Muster Design e.U." : "z. B. Max Muster"} /></Field>
              <Field label="E-Mail"><IconInput icon={<Mail />} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="du@beispiel.at" /></Field>
              <Field label="Passwort festlegen" hint="Ein Passwort für alles: Anmelden auf allen Geräten und Verschlüsseln deiner Daten. Es verlässt dein Gerät nie.">
                <IconInput icon={<Lock />} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {password ? <div><Progress value={strength.score} /><div className="mt-1 text-xs text-(--text-muted)">Stärke: {strength.label}</div></div> : null}
              <Field label="Passwort wiederholen" error={confirm && confirm !== password ? "Passwörter stimmen nicht überein" : undefined}><IconInput icon={<Lock />} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
              {terms && privacy ? (
                <label className="flex items-start gap-2 text-xs text-(--text-muted)">
                  <input type="checkbox" className="mt-0.5" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                  <span>Ich akzeptiere die <a className="text-brand-700 underline dark:text-brand-300" href={terms.href} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); openExternal(terms.href); }}>Nutzungsbedingungen</a> und habe die <a className="text-brand-700 underline dark:text-brand-300" href={privacy.href} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); openExternal(privacy.href); }}>Datenschutzerklärung</a> gelesen.</span>
                </label>
              ) : null}
              {authError ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200">{authError}</div> : null}
              {waitlist ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
                  <div className="font-medium">Gerade sind alle Plätze vergeben.</div>
                  <p className="mt-1 text-xs">Ordo ist eine private Beta. Trag dich ein, wir melden uns – oder nutze Ordo sofort kostenlos mit deiner eigenen Datenbank, oder ohne Konto nur auf diesem Gerät.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PARTS.joinWaitlist ? <Button type="button" size="sm" onClick={() => void PARTS.joinWaitlist!(email).then(() => { toast.success("Du bist auf der Warteliste"); setWaitlist(false); }).catch((err: unknown) => toast.error("Fehler", String(err)))} disabled={!email.includes("@")}>Auf die Warteliste</Button> : null}
                    <Button type="button" size="sm" variant="outline" onClick={() => setOwnDb("setup")}><Database className="h-4 w-4" /> Eigene Datenbank</Button>
                  </div>
                </div>
              ) : null}
              <Button type="submit" className="w-full justify-center" loading={authBusy || busy} disabled={!name.trim() || !email.includes("@") || password.length < 8 || password !== confirm || (!!terms && !accepted)}>
                <ShieldCheck className="h-4 w-4" /> Konto erstellen
              </Button>
              <p className="text-center text-xs text-(--text-muted)">Schon ein Konto? <button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => { setEntry("login"); setAuthError(null); }}>Anmelden</button></p>
            </form>
          )}
          </>}
        </div>
        <div className="mt-6 mb-2 text-center text-xs font-medium tracking-wider text-(--text-muted) uppercase">Oder</div>
        <div className="surface divide-y divide-(--border) overflow-hidden">
          <OptionRow icon={<Sparkles />} title={demoStatus ?? "Demo ansehen"} body="Beispielfirma mit einem Jahr Daten zum Durchklicken." onClick={() => void runDemo()} disabled={!!demoStatus} />
          {needsServer ? null : <>
            <OptionRow icon={<Database />} title="Kostenlos mit eigener Datenbank" body="Deine verschlüsselten Daten in deinem eigenen Supabase-Projekt – bei uns liegt dann gar nichts." onClick={() => setOwnDb("setup")} />
            <OptionRow icon={<HardDrive />} title="Ohne Konto nutzen" body="Alles bleibt nur auf diesem Gerät, kein Abgleich." onClick={() => setWelcome(false)} />
          </>}
          <OptionRow icon={<ArchiveRestore />} title="Sicherung wiederherstellen" body="Aus einer .ordo-Datei, die du unter Export & Sicherung gespeichert hast." onClick={() => setRestoreOpen(true)} />
        </div>
        <NoDataLine className="mx-auto mt-4 max-w-md justify-center text-center" />
        <RestoreBackupDialog open={restoreOpen} onClose={() => setRestoreOpen(false)} />
        <OwnDatabaseDialog open={!!ownDb} join={ownDb === "join"} onClose={() => setOwnDb(null)} onConnected={(t) => { chooseTarget(t); if (ownDb === "setup") setEntry("register"); toast.success("Eigene Datenbank gewählt", ownDb === "setup" ? "Leg jetzt dein Konto an – es entsteht in deinem Projekt, die erste Person wird Admin." : "Melde dich jetzt mit deiner E-Mail und deinem Passwort an."); }} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Ordo einrichten" subtitle="Ein paar Schritte, dann kann es losgehen." width="lg">
      <div className="surface overflow-hidden">
        <div className="flex border-b border-(--border)">
          {steps.map((s, i) => (
            <div key={s} className={cls("flex-1 px-4 py-2 text-center text-xs font-medium", i === step ? "border-b-2 border-brand-600 text-brand-700" : i < step ? "text-emerald-600" : "text-(--text-muted)")}>
              {i < step ? <Check className="mr-1 inline h-3 w-3" /> : null}
              {s}
            </div>
          ))}
        </div>
        <div className="p-6">
          {step === 0 ? (
            <div className="animate-fade-in">
              <h2 className="text-lg font-semibold">Wofür verwendest du Ordo?</h2>
              <p className="mb-5 text-sm text-(--text-muted)">Du kannst später jederzeit weitere Profile anlegen – z. B. privat und Firma getrennt.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <ModeCard active={mode === "employee"} onClick={() => setMode("employee")} icon={<User className="h-6 w-6" />} title="Privat / angestellt" body="Rechnungen sammeln, Werbungskosten und außergewöhnliche Belastungen finden – fertig für die Arbeitnehmerveranlagung." />
                <ModeCard active={mode === "business"} onClick={() => setMode("business")} icon={<Briefcase className="h-6 w-6" />} title="Firma / selbstständig" body="Rechnungen rein, Umsatzsteuer-Voranmeldung und Gewinn raus – inklusive Rechnungen an Kunden." />
              </div>
              <p className="mt-4 text-xs text-(--text-muted)">Summa für die Buchhaltung ist gleich dabei. Für Firmen gibt es dazu Projekte &amp; Zeiterfassung, Produkte &amp; Lager und Produktion – die fügst du jederzeit unter „Module“ hinzu.</p>
              <div className="mt-6 flex justify-between">
                <Button variant="ghost" onClick={() => setWelcome(true)}>
                  <ArrowLeft className="h-4 w-4" /> Zurück
                </Button>
                <Button onClick={() => setStep(1)}>
                  Weiter <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
          {step === 1 ? (
            <div className="animate-fade-in space-y-4">
              <h2 className="text-lg font-semibold">{mode === "business" ? "Wie heißt dein Unternehmen?" : "Wie sollen wir dich nennen?"}</h2>
              <Field label={mode === "business" ? "Firmenname / Name" : "Name"} required>
                <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === "business" ? "z. B. Max Mustermann e.U." : "z. B. Max"} />
              </Field>
              <p className="text-sm text-(--text-muted)">UID, Steuernummer, Bankverbindung und Steuereinstellungen trägst du danach in den Einstellungen ein.</p>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  <ArrowLeft className="h-4 w-4" /> Zurück
                </Button>
                <Button onClick={() => setStep(2)} disabled={!name.trim()}>
                  Weiter <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="animate-fade-in space-y-4">
              <h2 className="text-lg font-semibold">Passwort für deinen Tresor</h2>
              <p className="text-sm text-(--text-muted)">Damit werden alle Daten verschlüsselt (Argon2id + AES-256-GCM). Es wird nirgends gespeichert oder übertragen. Ein langer Satz ist besser als ein kurzes Sonderzeichen-Chaos.</p>
              <Field label="Passwort" required>
                <Input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </Field>
              {password ? (
                <div>
                  <Progress value={strength.score} />
                  <div className="mt-1 text-xs text-(--text-muted)">Stärke: {strength.label}</div>
                </div>
              ) : null}
              <Field label="Passwort wiederholen" required error={confirm && confirm !== password ? "Passwörter stimmen nicht überein" : undefined}>
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Hinweis (optional)" hint="Wird auf dem Sperrbildschirm angezeigt – nie das Passwort selbst.">
                <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="z. B. Lieblingszitat + Jahr" />
              </Field>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  <ArrowLeft className="h-4 w-4" /> Zurück
                </Button>
                <Button onClick={doCreate} disabled={!canCreate} loading={busy}>
                  <ShieldCheck className="h-4 w-4" /> Tresor erstellen
                </Button>
              </div>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="animate-fade-in space-y-4">
              <h2 className="text-lg font-semibold">Dein Wiederherstellungsschlüssel</h2>
              <p className="text-sm text-(--text-muted)">Dein Passwort kennt nur du – auch wir können es nicht zurücksetzen. Falls du es vergisst, ist dieser Schlüssel der <strong>einzige</strong> Weg zurück zu deinen Daten. Bewahre ihn sicher auf (Passwortmanager oder ausgedruckt).</p>
              {recoveryKey ? <div className="rounded-xl border-2 border-dashed border-brand-400 bg-brand-50 p-4 text-center font-mono text-lg tracking-wider text-brand-900 dark:bg-brand-900/20 dark:text-brand-100">{recoveryKey}</div> : <div className="rounded-xl bg-(--surface-2) p-4 text-sm text-(--text-muted)">Der Schlüssel wurde bereits angezeigt. Unter Einstellungen → Sicherheit kannst du jederzeit einen neuen erzeugen.</div>}
              <div className={cls("flex flex-wrap gap-2", !recoveryKey && "hidden")}>
                <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(recoveryKey ?? ""); toast.success("Kopiert"); }}>
                  <Copy className="h-4 w-4" /> Kopieren
                </Button>
                <Button variant="outline" onClick={() => { const b = new TextEncoder().encode(`Ordo – Wiederherstellungsschlüssel für Profil „${name}“\n\n${recoveryKey}\n\nErstellt am ${new Date().toLocaleString("de-AT")}\nBewahre diese Datei sicher auf.`); void platform!.saveFile("Ordo-Wiederherstellungsschluessel.txt", b, "text/plain"); }}>
                  <Download className="h-4 w-4" /> Als Datei speichern
                </Button>
              </div>
              <label className={cls("flex items-center gap-2 text-sm", !recoveryKey && "hidden")}>
                <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> Ich habe den Schlüssel sicher gespeichert.
              </label>
              <div className="flex justify-end">
                <Button disabled={!!recoveryKey && !saved} onClick={() => setStep(4)}>
                  <KeyRound className="h-4 w-4" /> Weiter <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
          {step === 4 ? (
            <div className="animate-fade-in space-y-4">
              {pendingConfirm ? <div className="flex items-start gap-3 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100"><MailCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>Konto erstellt. Bitte öffne noch den Link in der E-Mail an <strong>{email}</strong> – danach gleicht Ordo deine Daten automatisch ab. Bis dahin funktioniert alles ganz normal.</span></div> : null}
              <h2 className="text-lg font-semibold"><Bot className="mr-1 inline h-5 w-5 text-brand-600" /> Rechnungen automatisch lesen</h2>
              <p className="text-sm text-(--text-muted)">Mit einer KI liest Summa auch Fotos, Fremdsprachen und komplizierte Layouts zuverlässig – und bucht eindeutige Rechnungen ganz von allein. {isTauri ? "Am einfachsten mit deinem ChatGPT-Konto (Plus oder Pro); " : "Mit einem OpenAI- oder Claude-API-Key; "}ohne KI arbeitet Summa rein lokal und du bestätigst jede Rechnung selbst. Alles später änderbar unter Einstellungen → KI-Erkennung.</p>
              <AiProviderSetup onboarding onReadyChange={setAiReady} />
              <div className="flex flex-wrap justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep(3)} className={cls(accountCreated && "invisible")}>
                  <ArrowLeft className="h-4 w-4" /> Zurück
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { useSession.getState().store?.mutate((v) => { v.settings = { ...v.settings, ai: { ...v.settings.ai, provider: "none" } }; }); if (isTauri) setStep(5); else finish(); }}>Später, ohne KI</Button>
                  <Button onClick={() => (isTauri ? setStep(5) : finish())} disabled={!aiReady} title={aiReady ? undefined : "Anmeldung, API-Key bzw. Zustimmung fehlt noch"}>
                    Weiter <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          {step === 5 ? (
            <div className="animate-fade-in space-y-4">
              <h2 className="text-lg font-semibold"><FolderOpen className="mr-1 inline h-5 w-5 text-brand-600" /> Ordner verbinden</h2>
              <p className="text-sm text-(--text-muted)">Wähle die Ordner, in denen deine Rechnungen landen – ein Überordner reicht, Unterordner (z. B. pro Jahr) liest Summa mit. Danach genügt ein Klick auf „Nach Neuem suchen“, und Summa erledigt den Rest.</p>
              <WatchFolderCards compact />
              <div className="flex flex-wrap justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep(4)}>
                  <ArrowLeft className="h-4 w-4" /> Zurück
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={finish}>Später einrichten</Button>
                  <Button onClick={finish}>
                    <Check className="h-4 w-4" /> Fertig – los geht's
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AuthLayout>
  );
}

/**
 * Gives every start-screen view its own browser history entry (same address, view kept in the history state),
 * so Back returns to the previous view instead of leaving Ordo. `view` null = not tracked (after the vault exists).
 */
function useViewHistory(view: string | null, show: (view: string) => void) {
  const navigate = useNavigate();
  const location = useLocation();
  const inHistory = (location.state as { startView?: string } | null)?.startView;
  const mounted = useRef(false);
  useEffect(() => {
    if (view === null) return;
    // the first view replaces the current entry – a view left in the history from before a reload is not restored
    if (!mounted.current) navigate(location, { replace: true, state: { startView: view } });
    else if (inHistory !== view) navigate(location, { state: { startView: view } });
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mounted.current && view !== null && inHistory && inHistory !== view) show(inHistory);
    mounted.current = true;
  }, [inHistory]); // eslint-disable-line react-hooks/exhaustive-deps
}

function ModeCard({ active, onClick, icon, title, body }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; body: string }) {
  return (
    <button onClick={onClick} className={cls("rounded-2xl border-2 p-4 text-left transition-all hover:shadow-card", active ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20" : "border-(--border)")}>
      <div className={cls("mb-2 inline-flex rounded-xl p-2", active ? "bg-brand-600 text-white" : "bg-(--surface-2) text-(--text-muted)")}>{icon}</div>
      <div className="font-semibold">{title}</div>
      <div className="mt-1 text-sm text-(--text-muted)">{body}</div>
    </button>
  );
}

/** "Noch 19 von 20 kostenlosen Plätzen frei" – live from the server, hidden when offline. */
function CapacityLine({ target }: { target: ServerTarget | null }) {
  const [cap, setCap] = useState<{ max: number; free: number; open: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    setCap(null);
    const load = () => void fetchCapacity(target).then((c) => { if (alive) setCap(c); });
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [target]);
  if (!cap) return null;
  if (target) {
    return <div className="rounded-xl bg-(--surface-2) px-3 py-2 text-sm">{cap.open ? <>In deiner Datenbank sind noch <strong className="tabular">{cap.free} von {cap.max}</strong> Konten frei.</> : <>In dieser Datenbank sind gerade keine neuen Konten möglich – der Admin kann das unter Server-Einstellungen ändern.</>}</div>;
  }
  return (
    <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900 dark:bg-brand-950/60 dark:text-brand-100">
      {cap.open ? <><strong className="tabular">Noch {cap.free} von {cap.max}</strong> kostenlosen Plätzen in der Beta frei.</> : <>Gerade sind alle {cap.max} Beta-Plätze vergeben – du kannst dich auf die Warteliste setzen.</>}
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-brand-100 dark:bg-brand-900"><div className="h-full rounded-full bg-brand-700" style={{ width: `${Math.min(100, ((cap.max - cap.free) / Math.max(1, cap.max)) * 100)}%` }} /></div>
    </div>
  );
}
