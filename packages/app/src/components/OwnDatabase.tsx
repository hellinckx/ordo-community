import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Copy, Database, Download, ExternalLink, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Button, CopyButton, Field, Input, Modal } from "@/components/ui";
import { openExternal } from "@/components/LegalLinks";
import { useSession } from "@/state/session";
import { toast } from "@/state/toasts";
import { cls, fmtBytes, fmtDateTime } from "@/lib/format";
import { isTauri } from "@/platform";
import { shellFetch, useSync } from "@/services/sync";
import {
  SUPABASE_FREE,
  connectionCode,
  dashboardUrl,
  keyProblem,
  normalizeServerUrl,
  parseConnectionCode,
  probeServer,
  serverLabel,
  usageMeters,
  type ProbeResult,
  type ServerTarget,
} from "@/services/server";
import { AdminFunctionStep } from "@/operator/AdminFunctionStep";
import { HAS_DEFAULT_SERVER } from "@/config";

const STEPS = ["Was das heißt", "Projekt anlegen", "Ordo einspielen", "Anmeldung", "Verbinden"] as const;

/** Desktop: a self-hosted Supabase on its own domain is outside the CSP – go through the shell. */
const fetcherFor = (url: string): typeof fetch => (isTauri && !/\.supabase\.co$/i.test(new URL(url).host) ? (shellFetch as typeof fetch) : fetch);

/**
 * "Kostenlos mit eigener Datenbank": the person creates a free Supabase project, runs the Ordo SQL in it and connects.
 * Ordo (the operator) is not involved at all – no address, key or data ever reaches us. The first step says plainly
 * who is responsible for what and when Supabase starts to cost money.
 */
export function OwnDatabaseDialog({ open, onClose, onConnected, join }: { open: boolean; onClose: () => void; onConnected: (t: ServerTarget) => void; /** Joining a project that already exists (second device, colleague): only the connect step. */ join?: boolean }) {
  const [joining, setJoining] = useState(!!join);
  const [step, setStep] = useState(join ? STEPS.length - 1 : 0);
  useEffect(() => {
    if (!open) return;
    setJoining(!!join);
    setStep(join ? STEPS.length - 1 : 0);
  }, [open, join]);
  const [accepted, setAccepted] = useState(false);
  const [sql, setSql] = useState<{ setup: string } | null>(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const platform = useSession((s) => s.platform);

  useEffect(() => {
    if (open && !sql) void import("@/services/ownDbSql").then((m) => setSql({ setup: m.SETUP_SQL }));
  }, [open, sql]);
  useEffect(() => setProbe(null), [url, key]);

  const normalized = normalizeServerUrl(url);
  const keyError = key.trim() ? keyProblem(key) : null;
  const pasteCode = (text: string) => {
    const t = parseConnectionCode(text);
    if (!t) return false;
    setUrl(t.url);
    setKey(t.anonKey);
    return true;
  };
  const check = async () => {
    if (!normalized || keyError) return;
    setBusy(true);
    try {
      setProbe(await probeServer({ url: normalized, anonKey: key.trim() }, fetcherFor(normalized)));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} kopiert`, "Jetzt im Supabase-Dashboard einfügen.");
    } catch {
      toast.error("Kopieren ging nicht", "Speichere die Datei stattdessen und öffne sie in einem Editor.");
    }
  };
  const save = async (name: string, text: string) => {
    if (!platform) return;
    await platform.saveFile(name, new TextEncoder().encode(text), "text/plain");
  };
  const close = () => onClose();

  const footer = (
    <>
      {step > 0 && !joining ? <Button variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" /> Zurück</Button> : <Button variant="ghost" onClick={close}>Abbrechen</Button>}
      <span className="flex-1" />
      {step < STEPS.length - 1 ? (
        <Button onClick={() => setStep(step + 1)} disabled={step === 0 && !accepted}>Weiter <ArrowRight className="h-4 w-4" /></Button>
      ) : (
        <Button onClick={() => { if (probe?.ok && normalized) { onConnected({ url: normalized, anonKey: key.trim() }); close(); } }} disabled={!probe?.ok}><CheckCircle2 className="h-4 w-4" /> Mit diesem Projekt verbinden</Button>
      )}
    </>
  );

  return (
    <Modal open={open} onClose={close} title={joining ? "Mit eigener Datenbank anmelden" : "Kostenlos mit eigener Datenbank"} size="lg" footer={footer}>
      {joining ? (
        <p className="mb-3 text-sm text-(--text-muted)">Deine Firma oder du selbst habt Ordo schon in einem eigenen Supabase-Projekt eingerichtet? Dann hier verbinden – am einfachsten mit dem Verbindungscode aus Einstellungen → Konto auf dem ersten Gerät. Noch kein Projekt? <button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => { setJoining(false); setStep(0); }}>Neu einrichten</button></p>
      ) : null}
      <ol className={cls("mb-4 flex flex-wrap gap-1.5 text-xs", joining && "hidden")}>
        {STEPS.map((s, i) => (
          <li key={s} className={cls("rounded-full px-2.5 py-1", i === step ? "bg-brand-600 text-white" : i < step ? "bg-(--surface-2) text-(--text)" : "bg-(--surface-2) text-(--text-muted)")}>{i + 1}. {s}</li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="space-y-3 text-sm">
          <p>Statt auf dem Ordo-Server liegen deine verschlüsselten Daten dann in deinem eigenen, kostenlosen Supabase-Projekt. Ordo bleibt gleich – nur der Speicherort gehört dir.</p>
          <ul className="list-disc space-y-1.5 pl-5 text-(--text-muted)">
            <li><strong className="text-(--text)">Wir sehen nichts.</strong> Ordo kennt weder die Adresse noch den Schlüssel deines Projekts. Es gibt keine Verbindung zu uns – auch keine Statistik.</li>
            <li><strong className="text-(--text)">Du bist der Betreiber.</strong> Supabase ist dann dein Anbieter. Für Sicherungen, Zugänge und Kosten bist du selbst verantwortlich. Wir können nichts wiederherstellen.</li>
            <li><strong className="text-(--text)">Gratis-Plan von Supabase</strong> (Stand Oktober 2026): 500 MB Datenbank, 1 GB Dateien, 5 GB Datenverkehr im Monat, bis zu 2 Projekte. Für eine kleine Firma reicht das meist lange.</li>
            <li><strong className="text-(--text)">Wird es mehr, kostet es Geld – bei Supabase.</strong> Der Pro-Plan liegt bei etwa {SUPABASE_FREE.proUsd} US-Dollar im Monat und wird direkt von Supabase verrechnet, nicht von uns.</li>
            <li><strong className="text-(--text)">Pause nach {SUPABASE_FREE.pauseDays} Tagen ohne Nutzung.</strong> Solange jemand Ordo geöffnet hat, bleibt das Projekt wach. Sonst im Supabase-Dashboard „Restore project“ drücken – es geht nichts verloren.</li>
            <li><strong className="text-(--text)">Ordo zeigt dir laufend den Stand</strong> – Speicher, Datenverkehr, Konten – und warnt alle, sobald etwas zu 80 % voll ist.</li>
          </ul>
          <p className="text-xs text-(--text-muted)">Region: Wähle beim Anlegen „Central EU (Frankfurt)“, dann bleiben die Daten in der EU. Die Daten sind dort verschlüsselt gespeichert; den Schlüssel für das Zurücksetzen per E-Mail hinterlegt Ordo in deinem eigenen Projekt (Supabase Vault).</p>
          <label className="flex items-start gap-2 rounded-xl bg-(--surface-2) p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>Ich habe verstanden, dass ich für mein Supabase-Projekt selbst verantwortlich bin und dass Supabase ab einer gewissen Größe Geld kostet.</span>
          </label>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-3 text-sm">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Auf <strong>supabase.com</strong> kostenlos registrieren (mit E-Mail oder GitHub).</li>
            <li><strong>New project</strong> wählen. Name zum Beispiel „ordo“.</li>
            <li>Ein <strong>Datenbank-Passwort</strong> erzeugen lassen und sicher aufheben – Ordo braucht es nicht, aber du für Notfälle.</li>
            <li>Region <strong>Central EU (Frankfurt)</strong> wählen und <strong>Create new project</strong> drücken.</li>
            <li>Etwa zwei Minuten warten, bis das Projekt bereit ist.</li>
          </ol>
          <Button variant="outline" onClick={() => openExternal("https://supabase.com/dashboard/projects")}><ExternalLink className="h-4 w-4" /> supabase.com öffnen</Button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3 text-sm">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Im Projekt links <strong>SQL Editor</strong> öffnen und eine neue Abfrage anlegen.</li>
            <li>Das Ordo-SQL komplett einfügen und <strong>Run</strong> drücken.</li>
            <li>Unten erscheint „Ordo ist eingerichtet – Schema-Version …“. Fertig.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => sql && void copy(sql.setup, "SQL")} disabled={!sql}><Copy className="h-4 w-4" /> SQL kopieren</Button>
            <Button variant="outline" onClick={() => sql && void save("ordo-einrichtung.sql", sql.setup)} disabled={!sql}><Download className="h-4 w-4" /> Als Datei speichern</Button>
            {sql ? <span className="self-center text-xs text-(--text-muted)">{Math.round(sql.setup.length / 1024)} KB</span> : null}
          </div>
          <p className="text-xs text-(--text-muted)">Das SQL legt nur Ordo-Tabellen mit Zugriffsschutz an (alle beginnen mit „summa_“) und einen privaten Speicherordner. Es liest nichts aus und schickt nichts an uns. Später einfach noch einmal ausführen, wenn Ordo eine neue Version braucht – deine Daten bleiben dabei unberührt.</p>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-3 text-sm">
          <p>Damit sich auch dein Team ohne Bestätigungsmail anmelden kann:</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Links <strong>Authentication</strong> → <strong>Sign In / Providers</strong> → <strong>Email</strong>.</li>
            <li><strong>Confirm email</strong> ausschalten und speichern.</li>
          </ol>
          <p className="text-xs text-(--text-muted)">Warum: Der eingebaute Mailversand von Supabase schickt nur wenige Mails pro Stunde und nur an Mitglieder deiner Supabase-Organisation. Für „Passwort vergessen“ per E-Mail-Code kannst du später unter Authentication → Emails einen eigenen Mailversand (SMTP, z. B. Brevo gratis) eintragen. Bis dahin: Lege unter Einstellungen → Sicherheit einen Wiederherstellungsschlüssel an.</p>
          <AdminFunctionStep copy={copy} save={save} />
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-3 text-sm">
          <p>Im Projekt links unten <strong>Project Settings</strong> → <strong>API Keys</strong> (oder oben auf <strong>Connect</strong>). Kopiere die <strong>Project URL</strong> und den <strong>Publishable key</strong>.</p>
          <Field label="Project URL" hint="z. B. https://abcdefghijklmnopqrst.supabase.co – ein eigener Supabase-Server mit https geht auch.">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} onPaste={(e) => { if (pasteCode(e.clipboardData.getData("text"))) e.preventDefault(); }} placeholder="https://….supabase.co" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Publishable key" error={keyError ?? undefined} hint="Beginnt mit sb_publishable_ (ältere Projekte: der „anon“-Schlüssel, beginnt mit eyJ). Nie den geheimen Schlüssel.">
            <Input value={key} onChange={(e) => setKey(e.target.value)} onPaste={(e) => { if (pasteCode(e.clipboardData.getData("text"))) e.preventDefault(); }} placeholder="sb_publishable_…" autoComplete="off" spellCheck={false} />
          </Field>
          <p className="text-xs text-(--text-muted)">Hast du einen Verbindungscode („ORDO-DB1:…“) von einem anderen Gerät oder aus deinem Team? Einfach in eines der Felder einfügen.</p>
          {url && !normalized ? <p className="text-xs text-red-600">Die Adresse muss mit https:// beginnen.</p> : null}
          <Button variant="outline" onClick={check} loading={busy} disabled={!normalized || !key.trim() || !!keyError}><RefreshCw className="h-4 w-4" /> Verbindung prüfen</Button>
          {probe ? (
            probe.ok ? (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div>Alles bereit: Ordo ist im Projekt eingerichtet (Version {probe.schemaVersion}).{probe.signupsOpen === false ? " Neue Konten sind dort gerade gesperrt – melde dich mit einem bestehenden Konto an." : " Im nächsten Schritt legst du dein Konto in deinem Projekt an – die erste Person wird automatisch Admin."}</div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>{probe.message}</div>
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

/** One line on the start screen and in Settings: which server, with a way to change it. */
export function ServerChip({ target, onChange, onReset }: { target: ServerTarget | null; onChange: () => void; onReset?: () => void }) {
  const own = !!target;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-(--surface-2) px-3 py-2 text-xs">
      <Database className="h-3.5 w-3.5 text-(--text-muted)" />
      <span className="text-(--text-muted)">Speicherort:</span>
      <span className="font-medium">{own ? `Eigene Datenbank · ${serverLabel(target.url)}` : serverLabel(null)}</span>
      <span className="flex-1" />
      <button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={onChange}>{own ? "Ändern" : "Eigene Datenbank"}</button>
      {own && onReset && HAS_DEFAULT_SERVER ? <button type="button" className="text-(--text-muted) hover:underline" onClick={onReset}>{serverLabel(null)}</button> : null}
    </div>
  );
}

function Meter({ label, used, limit, unit, hint }: { label: string; used: number; limit: number; unit: "bytes" | "count"; hint: string }) {
  const share = limit ? used / limit : 0;
  const tone = share >= 0.9 ? "bg-red-500" : share >= 0.7 ? "bg-amber-500" : "bg-brand-600";
  const fmt = (n: number) => (unit === "bytes" ? fmtBytes(n) : String(n));
  return (
    <div title={hint}>
      <div className="mb-1 flex justify-between gap-2 text-xs"><span className="text-(--text-muted)">{label}</span><span className="tabular">{fmt(used)} von {fmt(limit)} · {Math.round(share * 100)} %</span></div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-(--surface-2)"><div className={cls("h-full rounded-full transition-all", tone)} style={{ width: `${Math.max(1, Math.min(100, share * 100))}%` }} /></div>
    </div>
  );
}

/**
 * "Dein Speicher": usage of the own project (or, for admins, the Ordo server) against the Supabase free plan,
 * read with one SQL function that only returns numbers.
 */
export function ServerUsagePanel() {
  const { usage, ownServer, isAdmin, serverUrl, refreshUsage } = useSync();
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const load = () => {
    setState("loading");
    void refreshUsage().then((u) => setState(u ? "ready" : "missing"));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ownServer && !isAdmin) return null;
  const meters = usage ? usageMeters(usage) : [];
  const peak = meters.filter((m) => m.id !== "accounts").reduce((p, m) => Math.max(p, m.limit ? m.used / m.limit : 0), 0);
  return (
    <div className="space-y-3 rounded-xl border border-(--border) p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Database className="h-4 w-4 text-(--text-muted)" />
        <span className="font-medium">{ownServer ? "Deine Datenbank" : serverLabel(null)}</span>
        <Badge tone={ownServer ? "brand" : "neutral"}>{serverLabel(serverUrl)}</Badge>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={load} loading={state === "loading"} aria-label="Neu laden"><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {state === "missing" ? (
        <p className="text-xs text-(--text-muted)">Der Stand ist noch nicht abrufbar. {ownServer ? "Spiel das Ordo-SQL in deinem Projekt noch einmal ein (Einstellungen → Konto → Eigene Datenbank → Ordo einspielen)." : "Das Server-Schema ist älter – supabase/schema.sql einspielen."}</p>
      ) : usage ? (
        <>
          {meters.map((m) => <Meter key={m.id} {...m} />)}
          <p className="text-xs text-(--text-muted)">
            {usage.active_7d} aktiv in 7 Tagen{usage.last_activity ? ` · zuletzt ${fmtDateTime(usage.last_activity)}` : ""}. Grenzen: Supabase-Gratis-Plan, Stand Oktober 2026.
            {peak >= 0.8 ? (isAdmin ? " Bald voll – im Supabase-Dashboard auf Pro wechseln (kostet bei Supabase), alte Rechnungen auslagern oder weniger Konten zulassen." : " Bald voll – sag der Person Bescheid, die euren Speicher betreut.") : ""}
          </p>
          {ownServer ? <Button size="sm" variant="outline" onClick={() => openExternal(dashboardUrl(serverUrl))}><ExternalLink className="h-4 w-4" /> Supabase-Dashboard</Button> : null}
        </>
      ) : null}
    </div>
  );
}

/** Code for a second device or a colleague: address + public key, nothing secret. */
export function ConnectionCodeCard({ target }: { target: ServerTarget }) {
  const code = connectionCode(target);
  return (
    <div className="space-y-2 rounded-xl border border-(--border) p-3 text-sm">
      <div className="flex items-center gap-2 font-medium"><KeyRound className="h-4 w-4 text-(--text-muted)" /> Verbindungscode für weitere Geräte und dein Team</div>
      <p className="text-xs text-(--text-muted)">Auf dem anderen Gerät beim Anmelden „Eigene Datenbank“ wählen und den Code einfügen. Er enthält nur die Adresse und den öffentlichen Schlüssel – kein Passwort, keine Daten. Jede Person meldet sich mit eigener E-Mail und eigenem Passwort an.</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-(--surface-2) px-2 py-1.5 text-xs">{code}</code>
        <CopyButton text={code} label="Kopieren" />
      </div>
    </div>
  );
}

/** The honest one-liner we show wherever data could leave the device. */
export function NoDataLine({ className }: { className?: string }) {
  return (
    <p className={cls("flex items-start gap-1.5 text-xs text-(--text-muted)", className)}>
      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
      <span>Wir sammeln keine Nutzungsdaten: kein Tracking, keine Analyse, keine Werbung. Was du nicht selbst abschickst, kommt bei uns nie an.</span>
    </p>
  );
}
