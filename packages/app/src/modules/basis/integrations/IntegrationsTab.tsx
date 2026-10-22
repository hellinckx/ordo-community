import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Cable, ChevronDown, Eye, EyeOff, FlaskConical, KeyRound, Pencil, Play, Plus, RefreshCw, Server, Sparkles, Trash2, Vote, Webhook } from "lucide-react";
import {
  API_SCOPES,
  API_SCOPE_LABELS,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  type ApiScope,
  type Integration,
  type IntegrationKind,
  type PullTarget,
  type WebhookEvent,
} from "@ordo/core";
import { Badge, Button, Card, Checkbox, ConfirmDialog, CopyButton, EmptyState, Field, Input, Menu, Modal, Select, Switch } from "@/components/ui";
import { NoDataLine } from "@/components/OwnDatabase";
import { useVault, useSettingsMutator } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { toast } from "@/state/toasts";
import { cls, fmtDateTime } from "@/lib/format";
import { isTauri } from "@/platform";
import { useMe } from "@/modules/registry";
import { can } from "@ordo/core";
import { readiness, sendMessage } from "@/atlas/engine";
import { CATALOG, WAY_LABEL, type CatalogEntry } from "@/services/integrations/catalog";
import { KIND_LABEL, draftIntegration, removeIntegration, saveIntegration } from "@/services/integrations/registry";
import { randomSecret } from "@/services/integrations/http";
import { runIntegration, testIntegration, useIntegrationRuntime } from "@/services/integrations/runner";
import { MAPPING_FIELDS, MAPPING_LABEL, probeRest } from "@/services/integrations/restPull";
import { serviceLayerBase } from "@/services/integrations/sapB1";

const KIND_ICON: Record<IntegrationKind, React.ReactNode> = {
  api_key: <KeyRound className="h-4 w-4" />,
  webhook: <Webhook className="h-4 w-4" />,
  sap_b1: <Server className="h-4 w-4" />,
  rest_pull: <Cable className="h-4 w-4" />,
};

const EVERY: { v: number; label: string }[] = [
  { v: 0, label: "Nur von Hand" },
  { v: 15, label: "Alle 15 Minuten" },
  { v: 60, label: "Stündlich" },
  { v: 240, label: "Alle 4 Stunden" },
  { v: 1440, label: "Täglich" },
];

/** Einstellungen → Schnittstellen: connections to other programs, all running on this device. */
export function IntegrationsTab() {
  const vault = useVault();
  const { role } = useMe();
  const list = vault.settings.integrations ?? [];
  const [editing, setEditing] = useState<Integration | null>(null);
  const [removing, setRemoving] = useState<Integration | null>(null);
  const navigate = useNavigate();
  if (!can(role, "settings", "admin")) return <EmptyState icon={<Cable className="h-8 w-8" />} title="Nur für Inhaber und Admins" body="Verbindungen zu anderen Programmen richten Personen mit Admin-Rechten ein." />;

  const add = (kind: IntegrationKind, name?: string) => setEditing(draftIntegration(kind, { name: name ?? KIND_LABEL[kind], deviceId: requireStore().vault.settings.sync.deviceId }));
  const askAtlas = async (text: string) => {
    if (!readiness().ok) {
      toast.info("Atlas ist noch aus", "Unter Einstellungen → Atlas einrichten, dann hilft er beim Verbinden.");
      navigate("/einstellungen/atlas");
      return;
    }
    const id = await sendMessage(undefined, text);
    navigate(`/atlas/${id}`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-[1_1_28rem] space-y-2 text-sm">
            <div className="text-base font-semibold">Schnittstellen zu anderen Programmen</div>
            <p className="text-(--text-muted)">Verbinde Ordo mit deinem ERP, deiner Kanzlei oder Automatisierungen – als Datei, live oder über die lokale Schnittstelle. Die Daten gehen direkt zwischen diesem Gerät und dem anderen Programm. Ordo als Firma sieht davon nichts. Du entscheidest, was hinein- und hinausgeht, und bist dafür verantwortlich.</p>
            <NoDataLine />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void askAtlas("Ich möchte Ordo mit einem anderen Programm verbinden. Frag mich, welches Programm es ist, und richte dann mit mir die passende Schnittstelle ein.")}><Sparkles className="h-4 w-4" /> Mit Atlas verbinden</Button>
            <Menu
              trigger={<Button><Plus className="h-4 w-4" /> Neue Verbindung <ChevronDown className="h-4 w-4" /></Button>}
              items={[
                { label: "API-Schlüssel (lokale Schnittstelle)", icon: <KeyRound className="h-4 w-4" />, onClick: () => add("api_key", "Mein Programm") },
                { label: "Webhook (Änderungen senden)", icon: <Webhook className="h-4 w-4" />, onClick: () => add("webhook") },
                { label: "SAP Business One", icon: <Server className="h-4 w-4" />, onClick: () => add("sap_b1") },
                { label: "REST-Abruf (andere API)", icon: <Cable className="h-4 w-4" />, onClick: () => add("rest_pull") },
              ]}
            />
          </div>
        </div>
      </Card>

      <LocalApiCard />

      <Card title="Deine Verbindungen">
        {list.length ? (
          <ul className="divide-y divide-(--border)">
            {list.map((i) => <IntegrationRow key={i.id} i={i} onEdit={() => setEditing(i)} onRemove={() => setRemoving(i)} />)}
          </ul>
        ) : (
          <EmptyState bare icon={<Cable className="h-8 w-8" />} title="Noch keine Verbindung" body="Wähle unten dein Programm oder lege oben eine neue Verbindung an." />
        )}
      </Card>

      <Card title="Fertige Wege für verbreitete Programme">
        <div className="grid gap-3 md:grid-cols-2">
          {CATALOG.map((c) => <CatalogCard key={c.id} c={c} onSetup={(k) => add(k, c.setup === "api_key" || c.setup === "rest_pull" ? c.name : undefined)} onAtlas={() => void askAtlas(`Hilf mir, Ordo mit ${c.name} zu verbinden. Erklär mir kurz den besten Weg und richte die Verbindung mit mir ein.`)} onVote={() => navigate("/plaene")} />)}
        </div>
      </Card>

      {editing ? <IntegrationEditor key={editing.id} initial={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} danger title={`„${removing?.name}“ entfernen?`} body="Die Verbindung und ihr Schlüssel werden gelöscht. Daten, die schon in Ordo sind, bleiben." confirmLabel="Entfernen" onConfirm={() => { if (removing) removeIntegration(removing.id); setRemoving(null); }} />
    </div>
  );
}

function LocalApiCard() {
  const vault = useVault();
  const mutate = useSettingsMutator();
  const rt = useIntegrationRuntime();
  const s = vault.settings.localApi;
  const set = (patch: Partial<typeof s>) => mutate((st) => ({ ...st, localApi: { ...st.localApi, ...patch } }));
  const [port, setPort] = useState(String(s.port));
  const base = `http://127.0.0.1:${s.port}`;
  return (
    <Card title={<span className="inline-flex items-center gap-2"><KeyRound className="h-4 w-4" /> Lokale Schnittstelle</span>}>
      {isTauri ? (
        <div className="space-y-3 text-sm">
          <Switch checked={s.enabled} onChange={(b) => set({ enabled: b })} label="Für Programme auf diesem Computer öffnen" hint="Nur von diesem Computer aus erreichbar (127.0.0.1), nur mit API-Schlüssel und nur solange Ordo offen und entsperrt ist." />
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Port" className="w-32"><Input inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} onBlur={() => { const n = Number(port); if (n >= 1024 && n <= 65535) set({ port: n }); else setPort(String(s.port)); }} /></Field>
            <div className="pb-2 text-xs">{rt.apiRunning ? <Badge tone="success">Läuft auf {base}</Badge> : rt.apiError ? <span className="text-red-600">{rt.apiError}</span> : <Badge>Aus</Badge>}</div>
          </div>
          <details className="rounded-xl bg-(--surface-2) p-3 text-xs">
            <summary className="cursor-pointer font-medium">Beispiel für Programmierer</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{`curl ${base}/v1/status -H "Authorization: Bearer <API-Schlüssel>"\n\ncurl ${base}/v1/transactions -H "Authorization: Bearer <API-Schlüssel>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"kind":"expense","date":"2026-10-22","amount":119.90,"vatRate":20,"description":"Druckerpapier","contactName":"Muster GmbH","externalId":"ER-4711"}'`}</pre>
            <p className="mt-2">Alle Pfade (Kontakte, Buchungen, Rechnungen, E-Rechnung, Lager, Zeiten, BMD-Export): ordo-app.at/schnittstellen/</p>
          </details>
        </div>
      ) : (
        <p className="text-sm text-(--text-muted)">Die lokale Schnittstelle gibt es in der Desktop-App: Andere Programme auf deinem Computer (ERP-Anbindung, Skript, n8n, Power Automate) legen dann direkt Kontakte, Buchungen, Rechnungen oder Zeiten in Ordo an. Webhooks, SAP und REST-Abrufe kannst du hier im Browser einrichten; automatisch laufen sie am besten in der Desktop-App.</p>
      )}
    </Card>
  );
}

function IntegrationRow({ i, onEdit, onRemove }: { i: Integration; onEdit: () => void; onRemove: () => void }) {
  const busy = useIntegrationRuntime((s) => !!s.busy[i.id]);
  const run = async (fn: () => Promise<string>, title: string) => {
    try {
      toast.success(title, await fn());
    } catch (e) {
      toast.error(`${title} fehlgeschlagen`, e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 py-3 text-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--surface-2) text-(--text-muted)">{KIND_ICON[i.kind]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{i.name}</span><Badge>{KIND_LABEL[i.kind]}</Badge>{!i.enabled ? <Badge tone="warning">Aus</Badge> : null}{i.createdBy === "atlas" ? <Badge tone="brand">von Atlas vorbereitet</Badge> : null}</div>
        <div className={cls("truncate text-xs", i.lastOk === false ? "text-red-600" : "text-(--text-muted)")}>{i.lastRunAt ? `${fmtDateTime(i.lastRunAt)} · ${i.lastMessage ?? ""}` : i.kind === "api_key" ? `${i.scopes.length} Rechte` : "Noch nie gelaufen"}</div>
      </div>
      <div className="flex flex-wrap gap-1">
        {i.kind !== "api_key" ? <Button size="sm" variant="ghost" onClick={() => void run(() => testIntegration(i.id), "Test")} disabled={busy}><FlaskConical className="h-4 w-4" /> Testen</Button> : null}
        {i.kind !== "api_key" ? <Button size="sm" variant="outline" onClick={() => void run(() => runIntegration(requireStore(), i.id), i.kind === "webhook" ? "Senden" : "Abgleich")} loading={busy}><Play className="h-4 w-4" /> {i.kind === "webhook" ? "Jetzt senden" : "Jetzt abgleichen"}</Button> : null}
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Bearbeiten"><Pencil className="h-4 w-4" /></Button>
        <Button size="sm" variant="ghost" className="text-red-600" onClick={onRemove} aria-label="Entfernen"><Trash2 className="h-4 w-4" /></Button>
      </div>
    </li>
  );
}

function CatalogCard({ c, onSetup, onAtlas, onVote }: { c: CatalogEntry; onSetup: (k: IntegrationKind) => void; onAtlas: () => void; onVote: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-(--border) p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{c.name}</span>
        {c.ways.map((w) => <Badge key={w} tone={w === "live" ? "brand" : "neutral"}>{WAY_LABEL[w]}</Badge>)}
      </div>
      <div className="mt-0.5 text-xs text-(--text-muted)">{c.who}</div>
      {open ? <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-(--text-muted)">{c.steps.map((s) => <li key={s}>{s}</li>)}</ol> : null}
      <div className="mt-2 flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Weniger" : "So geht's"}</Button>
        {c.setup ? <Button size="sm" variant="outline" onClick={() => onSetup(c.setup!)}><Plus className="h-4 w-4" /> Einrichten</Button> : null}
        <Button size="sm" variant="ghost" onClick={onAtlas}><Sparkles className="h-4 w-4" /> Atlas</Button>
        {c.pollId ? <Button size="sm" variant="ghost" onClick={onVote}><Vote className="h-4 w-4" /> Abstimmen</Button> : null}
      </div>
    </div>
  );
}

function SecretField({ label, value, hint, onRegenerate }: { label: string; value: string; hint: string; onRegenerate?: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-(--surface-2) px-2 py-2 text-xs">{show ? value : "•".repeat(Math.min(32, value.length))}</code>
        <Button size="sm" variant="ghost" onClick={() => setShow(!show)} aria-label={show ? "Verbergen" : "Anzeigen"}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
        <CopyButton text={value} label="Kopieren" />
        {onRegenerate ? <Button size="sm" variant="ghost" onClick={onRegenerate} title="Neuen Schlüssel erzeugen – der alte gilt dann nicht mehr"><RefreshCw className="h-4 w-4" /></Button> : null}
      </div>
    </Field>
  );
}

function IntegrationEditor({ initial, onClose }: { initial: Integration; onClose: () => void }) {
  const vault = useVault();
  const profiles = vault.profiles.filter((p) => !p.deletedAt);
  const [v, setV] = useState<Integration>(initial);
  const [password, setPassword] = useState("");
  const [probe, setProbe] = useState<{ count: number; itemsPath: string; fields: { path: string; type: string; example: string }[] } | null>(null);
  const [probing, setProbing] = useState(false);
  const set = (p: Partial<Integration>) => setV((x) => ({ ...x, ...p }));
  const isNew = !vault.settings.integrations?.some((i) => i.id === initial.id);
  const device = vault.settings.sync.deviceId;
  const target: PullTarget = v.targets[0] ?? "contacts";
  const mapFields = target === "contacts" ? MAPPING_FIELDS.contacts : MAPPING_FIELDS.transactions;

  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const problems = useMemo(() => {
    const out: string[] = [];
    if (!v.name.trim()) out.push("Name fehlt");
    if (v.kind === "webhook" && !/^https?:\/\//.test(v.url)) out.push("Ziel-Adresse muss mit https:// beginnen");
    if (v.kind === "webhook" && !v.events.length) out.push("Mindestens eine Art von Änderung wählen");
    if (v.kind === "api_key" && !v.scopes.length) out.push("Mindestens ein Recht wählen");
    if ((v.kind === "sap_b1" || v.kind === "rest_pull") && !/^https?:\/\//.test(v.baseUrl)) out.push("Adresse muss mit https:// beginnen");
    if (v.kind === "sap_b1" && (!v.companyDb || !v.user)) out.push("Firmendatenbank und Benutzer fehlen");
    if (v.kind === "sap_b1" && !v.targets.length) out.push("Wählen, was nach Ordo kommt");
    return out;
  }, [v]);

  const withSecret = (): Integration => (password ? { ...v, secret: password } : v);
  const save = () => {
    const next = v.kind === "sap_b1" ? { ...withSecret(), baseUrl: serviceLayerBase(v.baseUrl) } : withSecret();
    saveIntegration({ ...next, name: next.name.trim() });
    toast.success(isNew ? "Verbindung angelegt" : "Gespeichert", v.kind === "api_key" ? "Den Schlüssel im anderen Programm eintragen." : undefined);
    onClose();
  };
  const readFields = async () => {
    setProbing(true);
    try {
      const r = await probeRest(withSecret());
      setProbe(r);
      if (!v.itemsPath && r.itemsPath) set({ itemsPath: r.itemsPath });
    } catch (e) {
      toast.error("Felder nicht lesbar", e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={`${KIND_LABEL[v.kind]}${isNew ? " anlegen" : ` – ${initial.name}`}`} footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><span className="flex-1 text-xs text-red-600">{problems[0] ?? ""}</span><Button onClick={save} disabled={problems.length > 0}>Speichern</Button></>}>
      <div className="space-y-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="z. B. SAP Firma" /></Field>
          <Field label="Profil" hint="Mit welchem Profil die Verbindung arbeitet."><Select value={v.profileId} onChange={(e) => set({ profileId: e.target.value })}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        </div>
        <Switch checked={v.enabled} onChange={(b) => set({ enabled: b })} label="Eingeschaltet" />

        {v.kind === "api_key" ? (
          <>
            <SecretField label="API-Schlüssel" value={v.secret} hint="Im anderen Programm als „Authorization: Bearer …“ eintragen. Wer den Schlüssel hat, darf, was unten angehakt ist." onRegenerate={() => set({ secret: randomSecret("ordo_") })} />
            <div>
              <div className="mb-1 text-xs font-medium text-(--text-muted)">Was darf dieses Programm?</div>
              <div className="grid gap-1 sm:grid-cols-2">{API_SCOPES.map((sc) => <Checkbox key={sc} label={API_SCOPE_LABELS[sc]} checked={v.scopes.includes(sc)} onChange={() => set({ scopes: toggle<ApiScope>(v.scopes, sc) })} />)}</div>
            </div>
            {!isTauri ? <p className="text-xs text-amber-700 dark:text-amber-300">Der Schlüssel funktioniert in der Desktop-App (Einstellungen → Schnittstellen → Lokale Schnittstelle einschalten).</p> : null}
          </>
        ) : null}

        {v.kind === "webhook" ? (
          <>
            <Field label="Ziel-Adresse" hint="z. B. die Webhook-Adresse aus n8n, Make, Power Automate oder deinem ERP."><Input value={v.url} onChange={(e) => set({ url: e.target.value.trim() })} placeholder="https://…" /></Field>
            <div>
              <div className="mb-1 text-xs font-medium text-(--text-muted)">Welche Änderungen senden?</div>
              <div className="grid gap-1 sm:grid-cols-2">{WEBHOOK_EVENTS.map((ev) => <Checkbox key={ev} label={WEBHOOK_EVENT_LABELS[ev]} checked={v.events.includes(ev)} onChange={() => set({ events: toggle<WebhookEvent>(v.events, ev) })} />)}</div>
            </div>
            <SecretField label="Signatur-Schlüssel" value={v.secret} hint="Jede Nachricht trägt X-Ordo-Signature: sha256=HMAC(Schlüssel, Inhalt) – so prüft der Empfänger, dass sie von dir kommt." onRegenerate={() => set({ secret: randomSecret("whsec_") })} />
            <Field label="Senden ab" hint="Änderungen nach diesem Zeitpunkt gehen raus. Früher setzen, um Bisheriges nachzuschicken."><Input type="datetime-local" value={(v.cursor ?? v.createdAt).slice(0, 16)} onChange={(e) => e.target.value && set({ cursor: new Date(e.target.value).toISOString() })} /></Field>
          </>
        ) : null}

        {v.kind === "sap_b1" ? (
          <>
            <Field label="Service-Layer-Adresse" hint="z. B. https://sap-server:50000/b1s/v2 – frag deine SAP-Betreuung. Im Firmennetz am besten die Desktop-App verwenden."><Input value={v.baseUrl} onChange={(e) => set({ baseUrl: e.target.value.trim() })} placeholder="https://sap-server:50000/b1s/v2" /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Firmendatenbank"><Input value={v.companyDb} onChange={(e) => set({ companyDb: e.target.value.trim() })} placeholder="SBO_MUSTER" /></Field>
              <Field label="SAP-Benutzer" hint="Am besten nur mit Leserechten."><Input value={v.user} onChange={(e) => set({ user: e.target.value.trim() })} autoComplete="off" /></Field>
              <Field label="Passwort" hint={v.secret ? "Gespeichert – leer lassen, um es zu behalten." : "Liegt nur verschlüsselt in deinem Tresor."}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-(--text-muted)">Was kommt aus SAP nach Ordo?</div>
              <div className="grid gap-1 sm:grid-cols-3">
                <Checkbox label="Geschäftspartner → Kontakte" checked={v.targets.includes("contacts")} onChange={() => set({ targets: toggle<PullTarget>(v.targets, "contacts") })} />
                <Checkbox label="Ausgangsrechnungen → Einnahmen" checked={v.targets.includes("outgoing")} onChange={() => set({ targets: toggle<PullTarget>(v.targets, "outgoing") })} />
                <Checkbox label="Eingangsrechnungen → Ausgaben" checked={v.targets.includes("incoming")} onChange={() => set({ targets: toggle<PullTarget>(v.targets, "incoming") })} />
              </div>
              <p className="mt-1 text-xs text-(--text-muted)">Rechnungen kommen als offene Posten; die Zahlung ordnet der Kontoabgleich mit dem echten Zahlungsdatum zu. Ordo schreibt nie etwas in SAP.</p>
            </div>
          </>
        ) : null}

        {v.kind === "rest_pull" ? (
          <>
            <Field label="Adresse der Liste" hint="Die URL, die eine JSON-Liste liefert (gern mit Filter- oder Limit-Parametern)."><Input value={v.baseUrl} onChange={(e) => set({ baseUrl: e.target.value.trim() })} placeholder="https://api.beispiel.at/v1/kunden?limit=500" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Header für den Schlüssel" hint="z. B. Authorization oder X-Api-Key"><Input value={v.authHeader} onChange={(e) => set({ authHeader: e.target.value.trim() })} /></Field>
              <Field label="Schlüssel / Token" hint={v.secret ? "Gespeichert – leer lassen, um ihn zu behalten." : "z. B. „Bearer abc…“ oder nur der Schlüssel"}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Was ist das?"><Select value={target} onChange={(e) => set({ targets: [e.target.value as PullTarget] })}><option value="contacts">Kunden & Lieferanten → Kontakte</option><option value="outgoing">Ausgangsrechnungen → Einnahmen</option><option value="incoming">Eingangsrechnungen → Ausgaben</option></Select></Field>
              <Field label="Pfad zur Liste" hint="z. B. data oder value – leer lassen, Ordo sucht selbst."><Input value={v.itemsPath} onChange={(e) => set({ itemsPath: e.target.value.trim() })} placeholder="value" /></Field>
            </div>
            <div className="rounded-xl border border-(--border) p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-(--text-muted)">Feldzuordnung: Ordo-Feld ← Feld im anderen Programm</span><span className="flex-1" /><Button size="sm" variant="outline" onClick={() => void readFields()} loading={probing} disabled={!v.baseUrl}><RefreshCw className="h-4 w-4" /> Felder lesen</Button></div>
              {probe ? <p className="mb-2 text-xs text-(--text-muted)">{probe.count} Datensätze gefunden. Felder unten auswählen.</p> : null}
              <datalist id="probe-fields">{probe?.fields.map((f) => <option key={f.path} value={f.path.replace(/^\d+\./, "")}>{f.example}</option>)}</datalist>
              <div className="grid gap-2 sm:grid-cols-2">
                {[...mapFields.required, ...mapFields.optional].map((f) => (
                  <Field key={f} label={`${MAPPING_LABEL[f] ?? f}${(mapFields.required as readonly string[]).includes(f) ? " *" : ""}`}>
                    <Input list="probe-fields" value={v.mapping[f] ?? ""} onChange={(e) => set({ mapping: { ...v.mapping, [f]: e.target.value.trim() } })} placeholder="Feldname" />
                  </Field>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {v.kind === "sap_b1" || v.kind === "rest_pull" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ab Datum" hint="Ältere Rechnungen bleiben draußen."><Input type="date" value={v.since} onChange={(e) => set({ since: e.target.value })} /></Field>
            <Field label="Automatisch abgleichen"><Select value={String(v.everyMinutes)} onChange={(e) => set({ everyMinutes: Number(e.target.value) })}>{EVERY.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</Select></Field>
          </div>
        ) : null}

        {v.kind !== "api_key" ? (
          <Checkbox label="Automatisch nur auf diesem Gerät" hint="So senden oder holen zwei offene Geräte nichts doppelt. „Jetzt abgleichen“ geht überall." checked={!!v.deviceId && v.deviceId === device} onChange={(b) => set({ deviceId: b ? device : "" })} disabled={!device} />
        ) : null}

        {initial.log.length ? (
          <details className="rounded-xl bg-(--surface-2) p-3 text-xs">
            <summary className="cursor-pointer font-medium">Protokoll ({initial.log.length})</summary>
            <ul className="mt-2 space-y-1">{initial.log.slice(0, 20).map((l, n) => <li key={n} className={l.ok ? "" : "text-red-600"}>{fmtDateTime(l.at)} · {l.message}</li>)}</ul>
          </details>
        ) : null}
      </div>
    </Modal>
  );
}
