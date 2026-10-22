import { useEffect, useState } from "react";
import { CheckCircle2, LogIn, LogOut, MonitorDown, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { CLAUDE_AUTO_MODEL, CLAUDE_EXTRACTION_MODELS, estimateReadCostCents, type AiProvider } from "@ordo/core";
import { useSettingsMutator, useVault } from "@/state/hooks";
import { useSession } from "@/state/session";
import { Badge, Button, Checkbox, Field, Input, Modal, Select, Switch } from "@/components/ui";
import { PROVIDER_LABELS, canOfferClaudeForInvoices, claudeForInvoicesPatch, createProvider } from "@/services/extraction";
import { toast } from "@/state/toasts";
import { cls } from "@/lib/format";
import { isTauri } from "@/platform";
import { SITE_URL, openExternal } from "@/components/LegalLinks";

/** Order in which the providers are offered: the ChatGPT login first on desktop, "none" last. */
const ORDER: AiProvider[] = ["codex", "openai", "anthropic", "ollama", "none"];

/**
 * Provider cards + credentials + consent + connection test. Used by Settings → KI-Erkennung and by the
 * onboarding step "KI verbinden". A cloud provider without consent is reported as not ready.
 */
export function AiProviderSetup({ onboarding, onReadyChange }: { onboarding?: boolean; onReadyChange?: (ready: boolean) => void }) {
  const vault = useVault();
  const mutate = useSettingsMutator();
  const ai = vault.settings.ai;
  const setAi = (patch: Partial<typeof ai>) => mutate((s) => ({ ...s, ai: { ...s.ai, ...patch } }));
  const platform = useSession((s) => s.platform);
  const [codex, setCodex] = useState<{ installed: boolean; loggedIn: boolean; version?: string; defaultModel?: string; error?: string } | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; reason?: string; detail?: string } | null>(null);
  const refreshCodex = async () => {
    if (!platform?.codex) return;
    try {
      setCodex(await platform.codex.status());
    } catch (e) {
      setCodex({ installed: false, loggedIn: false, error: String(e) });
    }
  };
  useEffect(() => {
    void refreshCodex();
  }, [platform]); // eslint-disable-line react-hooks/exhaustive-deps
  const cloud = PROVIDER_LABELS[ai.provider].cloud;
  const ready = ai.provider === "none" || (!cloud || ai.cloudConsent) && (ai.provider !== "codex" || !!codex?.loggedIn) && (ai.provider !== "openai" || !!ai.openaiApiKey) && (ai.provider !== "anthropic" || !!ai.anthropicApiKey);
  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async () => {
    if (!platform?.codex) return;
    setLoggingIn(true);
    toast.info("Browser öffnet sich", "Melde dich mit deinem ChatGPT-Konto an (Plus/Pro-Abo). Danach hierher zurückkehren.");
    try {
      const r = await platform.codex.login();
      await refreshCodex();
      if (r.ok) toast.success("Mit ChatGPT angemeldet", "Summa liest deine Rechnungen ab jetzt mit deinem ChatGPT-Konto.");
      else toast.error("Anmeldung fehlgeschlagen", r.message);
    } finally {
      setLoggingIn(false);
    }
  };
  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const p = createProvider(vault.settings, platform!);
      if (!p) {
        setTestResult({ ok: true, reason: "Lokale Erkennung aktiv – keine KI nötig." });
        return;
      }
      setTestResult(await p.available());
    } catch (e) {
      setTestResult({ ok: false, reason: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };
  const providers = ORDER.filter((k) => k in PROVIDER_LABELS && (!PROVIDER_LABELS[k].desktopOnly || isTauri));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {providers.map((k) => {
          const d = PROVIDER_LABELS[k];
          const active = ai.provider === k;
          const primary = onboarding && k === (isTauri ? "codex" : "openai");
          return (
            <button key={k} type="button" onClick={() => setAi(k === "anthropic" && (!ai.anthropicModel.trim() || ai.anthropicModel === "claude-sonnet-5-5") && ai.provider !== "anthropic" ? { provider: k, anthropicModel: CLAUDE_AUTO_MODEL } : { provider: k })} className={cls("flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors", active ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20" : "border-(--border) hover:bg-(--surface-2)", primary && !active && "border-brand-300")}>
              <span className={cls("mt-1 h-4 w-4 shrink-0 rounded-full border-2", active ? "border-brand-600 bg-brand-600" : "border-slate-300")} />
              <span className="flex-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {k === "codex" ? "Mit ChatGPT-Konto anmelden" : k === "none" ? "Ohne KI (nur lokale Erkennung)" : d.name}
                  {d.cloud ? <Badge tone="warning">Cloud</Badge> : <Badge tone="success">Offline</Badge>}
                  {primary ? <Badge tone="brand">Empfohlen</Badge> : null}
                </span>
                <span className="block text-sm text-(--text-muted)">{k === "codex" ? "Nutzt dein ChatGPT-Abo (Plus oder Pro) über die lokale Codex-App – kein API-Key nötig. Rechnungsbilder werden an OpenAI gesendet." : k === "none" ? "OCR + Regelparser. Funktioniert offline, Daten verlassen nie das Gerät. Rechnungen bleiben zur Prüfung liegen, statt automatisch gebucht zu werden." : d.desc}</span>
              </span>
            </button>
          );
        })}
        {!isTauri ? (
          // the ChatGPT login runs through the local Codex app, which a browser cannot start
          <div className="flex items-start gap-3 rounded-xl border border-dashed border-(--border) p-3 text-sm">
            <MonitorDown className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span className="text-(--text-muted)">
              <strong className="text-(--text)">Mit ChatGPT-Konto anmelden (Plus/Pro, ohne API-Key)</strong> geht in der <a href={`${SITE_URL}download/`} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); openExternal(`${SITE_URL}download/`); }} className="font-medium text-brand-700 underline dark:text-brand-300">Windows-App</a>. Im Browser bitte einen API-Key verwenden. Ein Claude-Abo (claude.ai) lässt Anthropic in fremden Apps nicht zu – Claude daher per API-Key.
            </span>
          </div>
        ) : null}
      </div>
      <div className="space-y-3">
        {ai.provider === "codex" ? (
          <div className="rounded-xl border border-(--border) p-3 text-sm">
            <div className="flex items-center gap-2">
              {codex?.installed ? (codex.loggedIn ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-amber-500" />) : <XCircle className="h-4 w-4 text-red-500" />}
              <span className="font-medium">{!codex ? "Status wird geprüft …" : !codex.installed ? "Codex-App nicht gefunden" : codex.loggedIn ? `Angemeldet (Codex ${codex.version ?? ""})` : "Codex installiert, noch nicht angemeldet"}</span>
              <Button size="sm" variant="ghost" onClick={refreshCodex} aria-label="Status aktualisieren"><RefreshCw className="h-4 w-4" /></Button>
            </div>
            {!codex?.installed ? <p className="mt-2 text-xs text-(--text-muted)">Installieren: Codex-Desktop-App von OpenAI (chatgpt.com/codex) oder <code>npm install -g @openai/codex</code>. Danach hier „Mit ChatGPT anmelden“.</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {codex?.installed && !codex.loggedIn ? <Button size="sm" onClick={login} loading={loggingIn}><LogIn className="h-4 w-4" /> Mit ChatGPT anmelden</Button> : null}
              {codex?.loggedIn ? <Button size="sm" variant="outline" onClick={async () => { await platform!.codex!.logout(); await refreshCodex(); }}><LogOut className="h-4 w-4" /> Abmelden</Button> : null}
            </div>
            {!onboarding ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Modell (leer = Codex-Standard)" hint={codex?.defaultModel ? `Standard: ${codex.defaultModel}` : undefined}><Input value={ai.codexModel} onChange={(e) => setAi({ codexModel: e.target.value })} placeholder={codex?.defaultModel ?? "z. B. gpt-5"} /></Field>
                <Field label="Reasoning-Aufwand" hint="Niedrig ist schnell und reicht für Rechnungen meist aus."><Select value={ai.codexReasoning} onChange={(e) => setAi({ codexReasoning: e.target.value as typeof ai.codexReasoning })}><option value="low">niedrig</option><option value="medium">mittel</option><option value="high">hoch</option><option value="xhigh">sehr hoch</option></Select></Field>
              </div>
            ) : null}
          </div>
        ) : null}
        {ai.provider === "openai" ? <div className="grid gap-3 sm:grid-cols-2"><Field label="OpenAI API-Key" hint="Wird verschlüsselt im Tresor gespeichert."><Input type="password" value={ai.openaiApiKey} onChange={(e) => setAi({ openaiApiKey: e.target.value })} placeholder="sk-…" /></Field><Field label="Modell"><Input value={ai.openaiModel} onChange={(e) => setAi({ openaiModel: e.target.value })} /></Field></div> : null}
        {ai.provider === "anthropic" ? <ClaudeFields apiKey={ai.anthropicApiKey} model={ai.anthropicModel} onKey={(anthropicApiKey) => setAi({ anthropicApiKey })} onModel={(anthropicModel) => setAi({ anthropicModel })} /> : null}
        {ai.provider === "ollama" ? <div className="grid gap-3 sm:grid-cols-2"><Field label="Ollama-URL"><Input value={ai.ollamaUrl} onChange={(e) => setAi({ ollamaUrl: e.target.value })} /></Field><Field label="Vision-Modell" hint="z. B. qwen3-vl:8b, llama3.2-vision, gemma3:12b"><Input value={ai.ollamaModel} onChange={(e) => setAi({ ollamaModel: e.target.value })} /></Field></div> : null}
        {cloud ? <Switch checked={ai.cloudConsent} onChange={(b) => setAi({ cloudConsent: b })} label="Rechnungen zum Lesen an den KI-Anbieter senden" hint="Erforderlich für Cloud-KI. Deine Buchhaltungsdaten bleiben lokal, nur das jeweilige Rechnungsbild bzw. -text und die Kategorienamen werden zur Erkennung übertragen. Jederzeit widerrufbar." /> : null}
        {ai.provider !== "none" ? <div className="flex items-center gap-3"><Button variant="outline" size="sm" onClick={test} loading={testing}>Verbindung testen</Button>{testResult ? <span className={cls("text-sm", testResult.ok ? "text-emerald-600" : "text-red-600")}>{testResult.ok ? `OK ${testResult.detail ?? ""}` : testResult.reason}</span> : null}</div> : null}
      </div>
    </div>
  );
}

const fmtCents = (usCents: number) => (usCents < 100 ? `${usCents.toLocaleString("de-AT", { maximumFractionDigits: usCents < 1 ? 1 : 0 })} Cent` : `${(usCents / 100).toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

/** Rough price per invoice for a model setting, e.g. "ca. 0,1–0,9 Cent pro Rechnung". */
export function perInvoicePrice(model: string): string {
  const e = estimateReadCostCents(1, model).perInvoice;
  return `ca. ${fmtCents(e.low)}–${fmtCents(e.high)} pro Rechnung`;
}

function ClaudeFields({ apiKey, model, onKey, onModel }: { apiKey: string; model: string; onKey: (v: string) => void; onModel: (v: string) => void }) {
  const current = model.trim() || CLAUDE_AUTO_MODEL;
  const known = CLAUDE_EXTRACTION_MODELS.find((m) => m.id === current);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Anthropic API-Key" hint="Wird verschlüsselt im Tresor gespeichert. Derselbe Key wie für Atlas."><Input type="password" value={apiKey} onChange={(e) => onKey(e.target.value)} placeholder="sk-ant-…" /></Field>
      <Field label="Modell" hint={`${known?.hint ?? "Eigenes Modell."} ${perInvoicePrice(current)}.`}>
        <Select value={current} onChange={(e) => onModel(e.target.value)}>
          {CLAUDE_EXTRACTION_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          {!known ? <option value={current}>{current} (eigenes)</option> : null}
        </Select>
      </Field>
    </div>
  );
}

/**
 * One click to let the Claude key that Atlas already uses read invoices too. Consent to send invoice images is
 * asked in the same dialog.
 */
export function EnableClaudeDialog({ open, onClose, onEnabled }: { open: boolean; onClose: () => void; onEnabled?: () => void }) {
  const mutate = useSettingsMutator();
  const [consent, setConsent] = useState(false);
  useEffect(() => {
    if (open) setConsent(false);
  }, [open]);
  const enable = () => {
    mutate((s) => ({ ...s, ai: { ...s.ai, ...claudeForInvoicesPatch(s.ai) } }));
    toast.success("Claude liest jetzt deine Rechnungen", "Automatisch mit dem günstigsten Modell, bei Unsicherheit mit Opus.");
    onClose();
    onEnabled?.();
  };
  return (
    <Modal open={open} onClose={onClose} title="Claude auch zum Lesen von Rechnungen verwenden" size="sm" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={enable} disabled={!consent}><Sparkles className="h-4 w-4" /> Claude verwenden</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-(--text-muted)">Dein Claude-API-Key ist schon für Atlas hinterlegt. Damit kann Claude auch das Bild deiner Rechnungen lesen – statt der lokalen Texterkennung.</p>
        <ul className="space-y-1.5 text-(--text-muted)">
          <li><strong className="font-medium text-(--text)">Automatisch günstig:</strong> Haiku 5.5 liest zuerst ({perInvoicePrice("claude-haiku-5-5")}). Nur wenn das Ergebnis unsicher ist, liest Opus 5.5 nach.</li>
          <li><strong className="font-medium text-(--text)">Abgerechnet</strong> wird über deinen Anthropic-Account (in US-Dollar).</li>
        </ul>
        <Checkbox checked={consent} onChange={setConsent} label="Rechnungen zum Lesen an Anthropic senden" hint="Nur das jeweilige Rechnungsbild und deine Kategorienamen werden übertragen, deine Buchhaltung bleibt lokal. Jederzeit unter Einstellungen → KI-Erkennung widerrufbar." />
      </div>
    </Modal>
  );
}

/** Banner for Settings → KI-Erkennung when Claude is connected for Atlas but does not read invoices yet. */
export function ClaudeForInvoicesOffer() {
  const vault = useVault();
  const [open, setOpen] = useState(false);
  if (!canOfferClaudeForInvoices(vault.settings)) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-300 bg-brand-50 p-3 text-sm dark:border-brand-800 dark:bg-brand-900/20">
      <Sparkles className="h-5 w-5 shrink-0 text-brand-700 dark:text-brand-300" />
      <span className="min-w-0 flex-1">Claude ist für Atlas verbunden, liest aber noch keine Rechnungen. Mit einem Klick liest Claude das Rechnungsbild selbst – meist sicherer als die lokale Erkennung.</span>
      <Button size="sm" onClick={() => setOpen(true)}>Claude auch zum Lesen verwenden</Button>
      <EnableClaudeDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
