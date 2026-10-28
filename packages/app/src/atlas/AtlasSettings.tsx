import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, LogIn, LogOut, MonitorDown, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { ROLE_LABELS, can, type AtlasSettings as AtlasSettingsT, type CodexStatus } from "@ordo/core";
import { useSettingsMutator, useVault } from "@/state/hooks";
import { useSession } from "@/state/session";
import { useInstalledModules, useMe } from "@/modules/registry";
import { Badge, Button, Card, Field, Input, Select, Switch, Tabs, Textarea } from "@/components/ui";
import { cls } from "@/lib/format";
import { isTauri } from "@/platform";
import { openExternal } from "@/components/LegalLinks";
import { toast } from "@/state/toasts";
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, checkClaudeKey } from "./providers/claude";
import { checkOpenAiKey } from "./providers/openai";
import { AtlasMark } from "./Chat";
import { ATLAS_AREAS, areaSetting, roleLevel, type AtlasArea, type AtlasLevel } from "./areas";
import { ATLAS_SKILLS, skillOn } from "./skills";
import { TOOL_LABELS, buildToolset } from "./toolset";
import { requestAtlasConsent } from "./consent";

const CONSOLE_URL = "https://console.anthropic.com/settings/keys";

/** Einstellungen → Atlas: provider, model, permissions. */
export function AtlasSettings() {
  const vault = useVault();
  const mutate = useSettingsMutator();
  const { role } = useMe();
  const editable = can(role, "settings", "write");
  const atlas = vault.settings.atlas;
  const ai = vault.settings.ai;
  const setAtlas = (patch: Partial<AtlasSettingsT>) => mutate((s) => ({ ...s, atlas: { ...s.atlas, ...patch } }));
  const setKey = (anthropicApiKey: string) => mutate((s) => ({ ...s, ai: { ...s.ai, anthropicApiKey } }));

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-start gap-3 px-1">
        <AtlasMark />
        <div>
          <h2 className="text-[15px] font-semibold">Atlas – dein Assistent in Ordo</h2>
          <p className="text-sm text-(--text-muted)">Atlas beantwortet Fragen zu deinen Daten, zeichnet Diagramme und erledigt Dinge wie Zeiten erfassen oder Aufgaben anlegen. Öffnen mit <span className="font-medium">Strg+J</span> (Mac: ⌘J) oder über „Atlas“ im Menü.</p>
        </div>
      </div>
      {!editable ? <div className="rounded-xl border border-(--border) bg-(--surface-2) px-3 py-2 text-sm text-(--text-muted)">Diese Einstellungen ändern Inhaber:in oder Administration.</div> : null}

      <Card title="KI-Anbieter">
        <fieldset disabled={!editable} className="space-y-2">
          <ProviderOption active={atlas.provider === "claude"} onClick={() => setAtlas({ provider: "claude", model: atlas.provider === "claude" ? atlas.model : "auto" })} title="Claude (Anthropic)" badge={<Badge tone="brand">Empfohlen</Badge>}>
            Funktioniert in der Desktop-App und im Browser. Braucht einen API-Key von console.anthropic.com – ein Claude-Abo von claude.ai lässt sich in fremden Apps wie Ordo nicht verwenden.
          </ProviderOption>
          <ProviderOption active={atlas.provider === "openai"} onClick={() => setAtlas({ provider: "openai", model: "auto" })} title="OpenAI (API-Key)">
            Funktioniert in der Desktop-App und im Browser. Braucht einen API-Key von platform.openai.com, abgerechnet wird nach Nutzung über dein OpenAI-Konto.
          </ProviderOption>
          {isTauri ? (
            <ProviderOption active={atlas.provider === "codex"} onClick={() => setAtlas({ provider: "codex", model: "auto" })} title="ChatGPT über Codex">
              Nutzt dein eigenes ChatGPT-Abo (Plus oder Pro) über die Codex-App auf diesem Computer – kein API-Key nötig. Codex läuft im Hintergrund weiter, damit jede Antwort sofort startet.
            </ProviderOption>
          ) : (
            <div className="flex items-start gap-3 rounded-xl border border-dashed border-(--border) p-3 text-sm">
              <MonitorDown className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
              <span className="text-(--text-muted)"><span className="font-medium text-(--text)">ChatGPT über Codex</span> gibt es nur in der Desktop-App.</span>
            </div>
          )}
          <ProviderOption active={atlas.provider === "none"} onClick={() => setAtlas({ provider: "none" })} title="Aus">
            Atlas bleibt ausgeschaltet. Es werden keine Daten an einen KI-Anbieter gesendet.
          </ProviderOption>
        </fieldset>
      </Card>

      {atlas.provider === "claude" ? <ClaudeCard editable={editable} apiKey={ai.anthropicApiKey} setKey={setKey} model={atlas.model} setModel={(model) => setAtlas({ model })} /> : null}
      {atlas.provider === "openai" ? <OpenAiCard editable={editable} apiKey={ai.openaiApiKey} setKey={(openaiApiKey) => mutate((s) => ({ ...s, ai: { ...s.ai, openaiApiKey } }))} model={atlas.openaiModel} setModel={(openaiModel) => setAtlas({ openaiModel })} auto={atlas.model === "auto"} setAuto={(auto) => setAtlas({ model: auto ? "auto" : "fixed" })} /> : null}
      {atlas.provider === "codex" && isTauri ? <CodexCard editable={editable} model={atlas.codexModel} auto={atlas.model === "auto"} setModel={(codexModel) => setAtlas({ codexModel })} setAuto={(auto) => setAtlas({ model: auto ? "auto" : "fixed" })} /> : null}

      <Card title="Was Atlas darf">
        <fieldset disabled={!editable} className="space-y-2">
          {(
            [
              ["read", "Nur lesen", "Atlas schaut nach, rechnet und zeichnet – ändert aber nichts."],
              ["confirm", "Vor Änderungen fragen", "Jede Änderung erscheint im Gespräch als Karte mit „Ausführen“ und „Abbrechen“."],
              ["auto", "Darf selbst ändern", "Atlas führt Änderungen direkt aus und listet sie im Gespräch auf."],
            ] as const
          ).map(([id, label, hint]) => (
            <button key={id} type="button" onClick={() => setAtlas({ permission: id })} className={cls("flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors", atlas.permission === id ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20" : "border-(--border) hover:bg-(--surface-2)")}>
              <span className={cls("mt-1 h-4 w-4 shrink-0 rounded-full border-2", atlas.permission === id ? "border-brand-600 bg-brand-600" : "border-slate-300")} />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-sm text-(--text-muted)">{hint}</span>
              </span>
            </button>
          ))}
        </fieldset>
        <p className="mt-3 text-xs text-(--text-muted)">Atlas hat nie mehr Rechte als du: Deine Rolle ist {ROLE_LABELS[role]}. Was du in Ordo nicht sehen oder ändern darfst, kann auch Atlas nicht.</p>
      </Card>

      <AreaAccessCard editable={editable} areas={atlas.areas ?? {}} globalRead={atlas.permission === "read"} setAreas={(areas) => setAtlas({ areas })} />

      <SkillsCard editable={editable} skills={atlas.skills ?? {}} setSkills={(skills) => setAtlas({ skills })} />

      <Card title="Einwilligung & eigene Anweisungen">
        <div className="space-y-4">
          <Switch disabled={!editable || atlas.provider === "none"} checked={atlas.consent} onChange={(consent) => consent ? void requestAtlasConsent() : setAtlas({ consent: false })} label="Atlas darf die dafür nötigen Daten an den KI-Anbieter senden" hint={atlas.consent ? "Einwilligung erteilt. Hier jederzeit widerrufbar." : atlas.provider === "none" ? "Wähle zuerst oben einen KI-Anbieter. Danach kannst du die Datenübertragung prüfen und erlauben." : "Für Antworten von Atlas erforderlich. Beim Einschalten kannst du die Datenübertragung prüfen und ausdrücklich bestätigen – auch direkt im Atlas-Fenster."} />
          {!atlas.consent && atlas.provider !== "none" ? <Button disabled={!editable} onClick={() => void requestAtlasConsent()}>Einwilligung prüfen und zustimmen</Button> : null}
          <Field label="Eigene Anweisungen" hint="Gilt für jedes Gespräch, zusätzlich zu den Fähigkeiten oben – z. B. „Sprich mich mit Sie an“.">
            <Textarea disabled={!editable} value={atlas.instructions} onChange={(e) => setAtlas({ instructions: e.target.value })} placeholder="z. B. Nenne bei Projekten immer auch die offenen Stunden." maxLength={2000} rows={3} />
          </Field>
        </div>
      </Card>

      <Card title={<span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand-700" />Datenschutz</span>}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-(--text-muted)">
          <li>Gespräche liegen verschlüsselt in deinem Tresor und werden wie alles andere mit deinen Geräten synchronisiert.</li>
          <li>Zum KI-Anbieter geht nur, was Atlas für eine Antwort braucht: deine Frage, der bisherige Verlauf dieses Gesprächs und die Daten, die Atlas dafür nachschlägt – nicht dein ganzer Tresor.</li>
          <li>Passwörter, API-Keys, Sync- und KI-Einstellungen sendet Atlas nie mit und kann sie auch nicht ändern.</li>
          <li>Claude und OpenAI: Die Anfragen gehen direkt von dieser App an Anthropic bzw. OpenAI, mit deinem eigenen API-Key. ChatGPT über Codex: Die Codex-App auf diesem Computer sendet die Anfrage mit deinem ChatGPT-Konto an OpenAI.</li>
          <li>Es gelten die Datenschutzbedingungen des gewählten Anbieters.</li>
        </ul>
      </Card>
    </div>
  );
}

/** Fähigkeiten: how Atlas answers (switchable), and what it can do right now with the installed modules. */
function SkillsCard({ editable, skills, setSkills }: { editable: boolean; skills: Record<string, boolean>; setSkills: (s: Record<string, boolean>) => void }) {
  const modules = useInstalledModules();
  const { role } = useMe();
  const atlas = useVault().settings.atlas;
  const tools = useMemo(() => buildToolset({ modules, role, permission: atlas.permission, areas: atlas.areas }).tools, [modules, role, atlas.permission, atlas.areas]);
  const label = (name: string) => TOOL_LABELS[name] ?? name.replace(/_/g, " ");
  const reads = [...new Set(tools.filter((t) => t.kind === "read").map((t) => label(t.name)))];
  const writes = [...new Set(tools.filter((t) => t.kind === "write").map((t) => label(t.name)))];
  const chips = (list: string[]) => (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {list.map((l) => <span key={l} className="rounded-full border border-(--border) bg-(--surface) px-2.5 py-0.5 text-[12.5px]">{l}</span>)}
    </div>
  );
  return (
    <Card title="Fähigkeiten">
      <div className="space-y-3">
        <fieldset disabled={!editable} className="space-y-2">
          {ATLAS_SKILLS.map((s) => (
            <Switch key={s.id} checked={skillOn(skills, s)} onChange={(on) => setSkills({ ...skills, [s.id]: on })} label={s.label} hint={s.hint} />
          ))}
        </fieldset>
        <div className="border-t border-(--border) pt-3 text-sm">
          <div className="font-medium">Was Atlas gerade kann</div>
          <p className="text-[13px] text-(--text-muted)">Aus den installierten Modulen, deiner Rolle und den Zugriffen oben.</p>
          <div className="mt-2 text-[13px] text-(--text-muted)">Nachschauen</div>
          {chips(reads)}
          {writes.length ? (
            <>
              <div className="mt-2 text-[13px] text-(--text-muted)">Ändern{atlas.permission === "confirm" ? " (fragt vorher)" : ""}</div>
              {chips(writes)}
            </>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

const LEVEL_TABS: { id: AtlasLevel; label: string }[] = [
  { id: "none", label: "Kein Zugriff" },
  { id: "read", label: "Nur lesen" },
  { id: "write", label: "Lesen & ändern" },
];

/** "Worauf darf Atlas zugreifen?" – one row per area of the installed modules. */
function AreaAccessCard({ editable, areas, globalRead, setAreas }: { editable: boolean; areas: Record<string, AtlasLevel>; globalRead: boolean; setAreas: (a: Record<string, AtlasLevel>) => void }) {
  const modules = useInstalledModules();
  const { role } = useMe();
  const installed = new Set(modules.map((m) => m.id));
  const rows = ATLAS_AREAS.filter((a) => installed.has(a.module));
  const custom = rows.some((a) => areas[a.id] !== undefined && areas[a.id] !== a.default);
  const set = (id: AtlasArea, level: AtlasLevel) => {
    const next = { ...areas };
    if (level === ATLAS_AREAS.find((a) => a.id === id)?.default) delete next[id];
    else next[id] = level;
    setAreas(next);
  };
  return (
    <Card
      title="Worauf darf Atlas zugreifen?"
      action={
        <Button size="sm" variant="ghost" disabled={!editable || !custom} onClick={() => setAreas({})}>
          Alles auf Standard
        </Button>
      }
    >
      <p className="mb-3 text-sm text-(--text-muted)">
        Lege je Bereich fest, was Atlas darf. Ein Bereich ohne Zugriff existiert für Atlas nicht: Er taucht in keiner Suche, Liste oder Auswertung auf, und nichts daraus geht an den KI-Anbieter. Es gilt immer das Strengste aus deiner Rolle, der Einstellung oben und diesem Bereich.
      </p>
      {globalRead ? <div className="mb-3 rounded-xl border border-(--border) bg-(--surface-2) px-3 py-2 text-[13px] text-(--text-muted)">Oben ist „Nur lesen“ gewählt – „Lesen & ändern“ wirkt erst mit „Vor Änderungen fragen“ oder „Darf selbst ändern“.</div> : null}
      <fieldset disabled={!editable} className="divide-y divide-(--border)">
        {rows.map((a) => {
          const value = areaSetting(areas, a.id);
          const cap = roleLevel(role, a.role);
          const capped = cap === "none" ? "Deine Rolle sieht diesen Bereich nicht" : cap === "read" && value === "write" ? "Deine Rolle darf hier nur lesen" : "";
          return (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {a.label}
                  {value !== a.default ? <Badge>angepasst</Badge> : null}
                </div>
                <div className="text-[13px] text-(--text-muted)">{a.hint}</div>
                {capped ? <div className="text-xs text-(--text-muted)">{capped}</div> : null}
              </div>
              <Tabs tabs={LEVEL_TABS} value={value} onChange={(v) => set(a.id, v)} />
            </div>
          );
        })}
      </fieldset>
      <p className="mt-3 text-xs text-(--text-muted)">Standard: Atlas darf überall lesen und ändern – außer bei ausgehenden Rechnungen und im Team, dort nur lesen. Rechnungen an Kunden schreibt Atlas höchstens als Entwurf; versenden kannst nur du in Summa.</p>
    </Card>
  );
}

function ProviderOption({ active, onClick, title, badge, children }: { active: boolean; onClick: () => void; title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cls("flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors", active ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20" : "border-(--border) hover:bg-(--surface-2)")}>
      <span className={cls("mt-1 h-4 w-4 shrink-0 rounded-full border-2", active ? "border-brand-600 bg-brand-600" : "border-slate-300")} />
      <span className="flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {title}
          {badge}
        </span>
        <span className="block text-sm text-(--text-muted)">{children}</span>
      </span>
    </button>
  );
}

function ClaudeCard({ editable, apiKey, setKey, model, setModel }: { editable: boolean; apiKey: string; setKey: (k: string) => void; model: string; setModel: (m: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      setResult(await checkClaudeKey(apiKey.trim(), model === "auto" ? DEFAULT_CLAUDE_MODEL : model));
    } finally {
      setChecking(false);
    }
  };
  return (
    <Card title="Claude">
      <fieldset disabled={!editable} className="space-y-4">
        <Field label="Anthropic API-Key" hint="Wird verschlüsselt in deinem Tresor gespeichert. Summa nutzt denselben Schlüssel zum Lesen von Rechnungen.">
          <Input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => { setKey(e.target.value); setResult(null); }} placeholder="sk-ant-…" />
        </Field>
        <div className="rounded-xl bg-(--surface-2) px-3 py-2.5 text-[13px] text-(--text-muted)">
          So bekommst du einen Schlüssel: Auf console.anthropic.com anmelden, unter „API Keys“ einen neuen Schlüssel erstellen und hier einfügen. Abgerechnet wird nach Nutzung über dein Anthropic-Konto. Ein Claude-Abo (Pro oder Max) gilt dafür nicht – Anthropic erlaubt die Anmeldung mit dem Abo nicht in fremden Apps.
          <button type="button" onClick={() => openExternal(CONSOLE_URL)} className="mt-1.5 flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-400">
            console.anthropic.com öffnen <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
        <Field label="Modell" hint={model === "auto" ? "Atlas nimmt Opus 5.5 und entscheidet je Frage, wie gründlich es nachdenkt: kurz bei einfachen Fragen, gründlich bei Auswertungen und mehreren Änderungen." : undefined}>
          <Select value={model === "auto" || !model.startsWith("claude-") ? "auto" : model} onChange={(e) => setModel(e.target.value)}>
            <option value="auto">Automatisch (empfohlen)</option>
            {CLAUDE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} – {m.hint}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={check} loading={checking} disabled={!apiKey.trim()}>Schlüssel prüfen</Button>
          {result ? <span className={cls("inline-flex items-center gap-1.5 text-sm", result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600")}>{result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{result.message}</span> : null}
        </div>
      </fieldset>
    </Card>
  );
}

const OPENAI_KEYS_URL = "https://platform.openai.com/api-keys";

function OpenAiCard({ editable, apiKey, setKey, model, setModel, auto, setAuto }: { editable: boolean; apiKey: string; setKey: (k: string) => void; model: string; setModel: (m: string) => void; auto: boolean; setAuto: (a: boolean) => void }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; models: string[] } | null>(null);
  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      setResult(await checkOpenAiKey(apiKey.trim()));
    } finally {
      setChecking(false);
    }
  };
  const models = result?.models.length ? (result.models.includes(model) ? result.models : [model, ...result.models]) : null;
  return (
    <Card title="OpenAI">
      <fieldset disabled={!editable} className="space-y-4">
        <Field label="OpenAI API-Key" hint="Wird verschlüsselt in deinem Tresor gespeichert. Summa nutzt denselben Schlüssel, wenn du OpenAI zum Lesen von Rechnungen wählst.">
          <Input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => { setKey(e.target.value); setResult(null); }} placeholder="sk-…" />
        </Field>
        <div className="rounded-xl bg-(--surface-2) px-3 py-2.5 text-[13px] text-(--text-muted)">
          So bekommst du einen Schlüssel: Auf platform.openai.com anmelden, unter „API keys“ einen neuen Schlüssel erstellen und hier einfügen. Abgerechnet wird nach Nutzung über dein OpenAI-Konto – ein ChatGPT-Abo zählt dafür nicht. Wer ChatGPT Plus oder Pro hat, nimmt in der Desktop-App besser „ChatGPT über Codex“.
          <button type="button" onClick={() => openExternal(OPENAI_KEYS_URL)} className="mt-1.5 flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-400">
            platform.openai.com öffnen <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
        <Field label="Modell" hint={models ? undefined : "Mit „Schlüssel prüfen“ siehst du alle Modelle, die dein Schlüssel verwenden darf."}>
          {models ? (
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          ) : (
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-5.4" spellCheck={false} />
          )}
        </Field>
        <Switch checked={auto} onChange={setAuto} label="Gründlichkeit automatisch wählen" hint="Kurz bei einfachen Fragen, gründlich bei Auswertungen und mehreren Änderungen." />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={check} loading={checking} disabled={!apiKey.trim()}>Schlüssel prüfen</Button>
          {result ? <span className={cls("inline-flex items-center gap-1.5 text-sm", result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600")}>{result.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{result.message}</span> : null}
        </div>
      </fieldset>
    </Card>
  );
}

function CodexCard({ editable, model, auto, setModel, setAuto }: { editable: boolean; model: string; auto: boolean; setModel: (m: string) => void; setAuto: (a: boolean) => void }) {
  const platform = useSession((s) => s.platform);
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const refresh = async () => {
    if (!platform?.codex) return;
    try {
      setStatus(await platform.codex.status());
    } catch (e) {
      setStatus({ installed: false, loggedIn: false, error: String(e) });
    }
  };
  useEffect(() => {
    void refresh();
  }, [platform]); // eslint-disable-line react-hooks/exhaustive-deps
  const login = async () => {
    if (!platform?.codex) return;
    setLoggingIn(true);
    toast.info("Browser öffnet sich", "Melde dich mit deinem ChatGPT-Konto an und komm danach hierher zurück.");
    try {
      const r = await platform.codex.login();
      await refresh();
      if (r.ok) toast.success("Mit ChatGPT angemeldet");
      else toast.error("Anmeldung hat nicht geklappt", r.message);
    } finally {
      setLoggingIn(false);
    }
  };
  return (
    <Card title="ChatGPT über Codex">
      <fieldset disabled={!editable} className="space-y-4">
        <div className="rounded-xl border border-(--border) p-3 text-sm">
          <div className="flex items-center gap-2">
            {status?.installed ? status.loggedIn ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-amber-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
            <span className="font-medium">{!status ? "Status wird geprüft …" : !status.installed ? "Codex-App nicht gefunden" : status.loggedIn ? `Angemeldet (Codex ${status.version ?? ""})` : "Codex installiert, noch nicht angemeldet"}</span>
            <Button size="sm" variant="ghost" onClick={refresh} aria-label="Status aktualisieren"><RefreshCw className="h-4 w-4" /></Button>
          </div>
          {status && !status.installed ? <p className="mt-2 text-xs text-(--text-muted)">Installieren: Codex-App von OpenAI (chatgpt.com/codex) oder <code>npm install -g @openai/codex</code>. Danach hier anmelden.</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {status?.installed && !status.loggedIn ? <Button size="sm" onClick={login} loading={loggingIn}><LogIn className="h-4 w-4" /> Mit ChatGPT anmelden</Button> : null}
            {status?.loggedIn ? <Button size="sm" variant="outline" onClick={async () => { await platform!.codex!.logout(); await refresh(); }}><LogOut className="h-4 w-4" /> Abmelden</Button> : null}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Modell (leer = Codex-Standard)" hint={status?.defaultModel ? `Standard: ${status.defaultModel}` : undefined}>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={status?.defaultModel ?? "z. B. gpt-5"} />
          </Field>
          <Field label="Nachdenken" hint="Automatisch: kurz bei einfachen Fragen, gründlich bei Auswertungen.">
            <Select value={auto ? "auto" : "fixed"} onChange={(e) => setAuto(e.target.value === "auto")}>
              <option value="auto">Automatisch</option>
              <option value="fixed">Immer normal</option>
            </Select>
          </Field>
        </div>
      </fieldset>
    </Card>
  );
}
