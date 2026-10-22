import { useEffect, useState, type ComponentType } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Bell, Bot, Cable, Cloud, Factory, FolderKanban, FolderOpen, Gauge, HardDrive, Info, KeyRound, Landmark, Plus, RefreshCw, Settings as SettingsIcon, ShieldCheck, Sparkles, Trash2, Upload, User, CheckCircle2, ExternalLink, LogIn, LogOut, Tags, X, Database } from "lucide-react";
import { ids, nowIso, generateRecoveryKey, type Profile, type Category, type VatRate, type Mode, type Settings as SettingsT } from "@ordo/core";
import { useProfile, useVault, useSettingsMutator } from "@/state/hooks";
import { requirePlatform, requireStore, useSession } from "@/state/session";
import { Badge, Button, Card, ConfirmDialog, Field, Input, MoneyInput, PageHeader, Select, Switch, Tabs, Textarea } from "@/components/ui";
import { AiProviderSetup, ClaudeForInvoicesOffer } from "@/components/AiProviderSetup";
import { WatchFolderCards } from "@/components/WatchFolderCards";
import { LegalLinks, legalPage, openExternal } from "@/components/LegalLinks";
import { CategoryIcon } from "@/lib/icons";
import { SignupClosedError, translateAuthError, useSync } from "@/services/sync";
import { connectAccount, resendConfirmation, signOut, updateAccountPassword } from "@/services/account";
import { AccountPanel } from "@/components/AccountPanel";
import { ConnectionCodeCard, NoDataLine, OwnDatabaseDialog, ServerChip, ServerUsagePanel } from "@/components/OwnDatabase";
import { pendingTarget, setPendingTarget, type ServerTarget } from "@/services/server";
import { toast } from "@/state/toasts";
import { cls, fmtBytes, fmtDateTime } from "@/lib/format";
import { isTauri } from "@/platform";
import { exitDemo } from "@/services/demo";
import { HAS_DEFAULT_SERVER, MAX_PROFILES, SUMMA_SYNC_DEFAULT } from "@/config";
import { InvoiceModeChooser } from "@/components/InvoiceModeChooser";
import { invoiceModeOf } from "@/lib/invoiceMode";
import { useList } from "@/state/hooks";
import { useTour } from "@/components/Tour";
import { FileText, Compass } from "lucide-react";
import { enrollPasskey, passkeyRecord, platformAuthenticatorAvailable, removePasskey } from "@/services/webauthn";
import { Fingerprint } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useInstalledModules } from "@/modules/registry";
import type { OrdoModule } from "@/modules/types";
import { ModuleTile } from "@/components/Sidebar";
import { AiUsagePanel } from "@/components/AiUsagePanel";
import { useAddProfileDialog } from "@/components/AddProfileDialog";
import { TwoFactorCard } from "@/components/TwoFactor";
import { PARTS } from "@/operator";
import { OPERATOR } from "@/operator/config";

type Tab = "profil" | "konto" | "rechnungen" | "steuern" | "ki" | "kategorien" | "ordner" | "sicherheit" | "benachrichtigungen" | "sync" | "backup" | "ueber" | "profile" | "ki-verbrauch";

interface SettingsEntry {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  element: React.ReactNode;
}

interface SettingsGroup {
  id: string;
  title: string;
  /** Small coloured tile of the module the group belongs to (module settings). */
  module?: OrdoModule;
  items: SettingsEntry[];
}

/** Settings of every module tab, by id – basis tabs are placed into the app-wide groups below. */
const MODULE_TAB_ICONS: Record<string, ComponentType<{ className?: string }>> = { atlas: Sparkles, import: Upload, schnittstellen: Cable, projekte: FolderKanban, fertigung: Factory };

/**
 * Einstellungen: first what applies to all of Ordo (account, company, security, Atlas & AI, data & interfaces), then
 * one group per installed module (Summa, Projekte, Produktion). Side navigation on wide screens, a select on phones.
 */
export default function Settings() {
  const isBusiness = useProfile().mode === "business";
  const { tab } = useParams();
  const navigate = useNavigate();
  const raw = (tab as Tab) ?? "profil";
  const current = raw === "profile" ? "profil" : raw === "sync" ? "konto" : raw;
  const modules = useInstalledModules();
  const hasSumma = modules.some((m) => m.id === "summa");
  const basisTabs = new Map((modules.find((m) => m.id === "basis")?.settingsTabs ?? []).map((t) => [t.id, t]));
  // tabs of the operator's edition (e.g. taking over data from an old system) sit next to the basis tabs
  for (const t of PARTS.settingsTabs) basisTabs.set(t.id, t);
  const fromModule = (id: string): SettingsEntry[] => {
    const t = basisTabs.get(id);
    return t ? [{ id: t.id, label: t.label, icon: MODULE_TAB_ICONS[t.id] ?? SettingsIcon, element: t.element }] : [];
  };
  const groups: SettingsGroup[] = [
    {
      id: "allgemein",
      title: "Allgemein",
      items: [
        { id: "konto", label: "Konto & Speicherort", icon: Cloud, element: <AccountTab /> },
        { id: "profil", label: "Profil & Firma", icon: User, element: <ProfileTab /> },
        { id: "sicherheit", label: "Sicherheit", icon: ShieldCheck, element: <SecurityTab /> },
        { id: "benachrichtigungen", label: "Hinweise", icon: Bell, element: <NotificationsTab /> },
        ...(isTauri ? [{ id: "backup", label: "Backups", icon: HardDrive, element: <BackupTab /> }] : []),
        { id: "ueber", label: "Über Ordo", icon: Info, element: <AboutTab /> },
      ],
    },
    {
      id: "ki",
      title: "Atlas & KI",
      items: [...fromModule("atlas"), { id: "ki-verbrauch", label: "KI-Verbrauch", icon: Gauge, element: <AiUsagePanel /> }],
    },
    { id: "daten", title: "Daten & Schnittstellen", items: [...fromModule("schnittstellen"), ...fromModule("import")] },
    ...(hasSumma
      ? [
          {
            id: "summa",
            title: "Summa – Buchhaltung",
            module: modules.find((m) => m.id === "summa"),
            items: [
              ...(isBusiness ? [{ id: "rechnungen", label: "Rechnungen schreiben", icon: FileText, element: <InvoiceSettingsTab /> }] : []),
              { id: "ki", label: "Rechnungen lesen (KI)", icon: Bot, element: <AiTab /> },
              ...(isTauri ? [{ id: "ordner", label: "Überwachte Ordner", icon: FolderOpen, element: <WatchFolderCards /> }] : []),
              { id: "kategorien", label: "Kategorien", icon: Tags, element: <CategoriesTab /> },
              { id: "steuern", label: "Steuern", icon: Landmark, element: <TaxTab /> },
            ],
          },
        ]
      : []),
    ...modules
      .filter((m) => m.id !== "basis" && m.id !== "summa" && m.settingsTabs?.length)
      .map((m) => ({ id: m.id, title: m.title.startsWith(m.name) ? m.title : `${m.name} – ${m.title}`, module: m, items: m.settingsTabs!.map((t) => ({ id: t.id, label: t.label, icon: MODULE_TAB_ICONS[t.id] ?? SettingsIcon, element: t.element })) })),
  ].filter((g) => g.items.length);
  const all = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g })));
  const active = all.find((i) => i.id === current) ?? all.find((i) => i.id === "profil")!;
  const go = (id: string) => navigate(`/einstellungen/${id}`);

  return (
    <div className="space-y-4">
      <PageHeader title="Einstellungen" subtitle={active.group.module ? `${active.group.title} · nur für dieses Modul` : `${active.group.title} · gilt für ganz Ordo`} />
      <div className="grid gap-5 xl:grid-cols-[232px_minmax(0,1fr)]">
        <nav aria-label="Einstellungen" className="xl:sticky xl:top-0 xl:self-start">
          <Select value={active.id} onChange={(e) => go(e.target.value)} className="xl:hidden" aria-label="Bereich wählen">
            {groups.map((g) => (
              <optgroup key={g.id} label={g.title}>
                {g.items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </optgroup>
            ))}
          </Select>
          <div className="surface hidden space-y-4 p-2.5 xl:block">
            {groups.map((g) => (
              <div key={g.id}>
                <div className="mb-1 flex items-center gap-2 px-2 pt-1 text-[11.5px] font-semibold tracking-wide text-(--text-muted) uppercase">
                  {g.module ? <ModuleTile module={g.module} size="sm" /> : null}
                  <span className="truncate">{g.title}</span>
                </div>
                <div className="space-y-0.5">
                  {g.items.map((i) => {
                    const on = i.id === active.id;
                    const Icon = i.icon;
                    return (
                      <button key={i.id} type="button" onClick={() => go(i.id)} aria-current={on ? "page" : undefined} className={cls("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[13.5px] transition-colors", on ? "bg-brand-50 font-medium text-brand-800 dark:bg-brand-950/70 dark:text-brand-200" : "text-(--text) hover:bg-(--surface-2)")}>
                        <Icon className={cls("h-4 w-4 shrink-0", on ? "text-brand-700 dark:text-brand-300" : "text-(--text-muted)")} />
                        <span className="truncate">{i.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0 max-w-[1400px]">{active.element}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ProfileTab() {
  const profile = useProfile();
  const vault = useVault();
  const [p, setP] = useState<Profile>(profile);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setP(profile), [profile]);
  const c = p.company;
  const setC = (patch: Partial<Profile["company"]>) => setP({ ...p, company: { ...c, ...patch } });
  const save = () => {
    requireStore().update("profiles", p.id, { ...p, updatedAt: nowIso() }, "profile.update");
    toast.success("Profil gespeichert");
  };
  const uploadLogo = async () => {
    const files = await requirePlatform().pickFiles({ multiple: false, accept: ["image/png", "image/jpeg"] });
    const f = files[0];
    if (!f) return;
    const att = await requireStore().putAttachment(p.id, f.bytes, { name: f.name, mime: f.mime });
    setC({ logoAttachmentId: att.id });
  };
  const activeProfiles = vault.profiles.filter((x) => !x.deletedAt);
  const addProfile = (mode: Mode) => useAddProfileDialog.getState().show(mode);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title="Profil">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Profilname"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
            <Field label="Modus"><Select value={p.mode} onChange={(e) => setP({ ...p, mode: e.target.value as Mode })}><option value="employee">Privat / angestellt</option><option value="business">Firma / selbstständig</option></Select></Field>
          </div>
        </Card>
        <Card title={p.mode === "business" ? "Firmendaten" : "Persönliche Daten"}>
          {p.mode === "business" ? <p className="mb-4 text-sm text-(--text-muted)">Werden für Berichte, die Erkennung deiner eigenen Rechnungen und – falls Summa deine Rechnungen schreibt – den Rechnungskopf verwendet. Nummernkreis, Logo und Fußzeile findest du unter <strong>Rechnungen</strong>.</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={p.mode === "business" ? "Firmenname" : "Name"} className="sm:col-span-2"><Input value={c.name} onChange={(e) => setC({ name: e.target.value })} /></Field>
            {p.mode === "business" ? <Field label="Rechtsform / Zusatz"><Input value={c.legalForm} onChange={(e) => setC({ legalForm: e.target.value })} placeholder="e.U., GmbH, Freiberufler …" /></Field> : null}
            <Field label="Straße"><Input value={c.street} onChange={(e) => setC({ street: e.target.value })} /></Field>
            <Field label="PLZ"><Input value={c.zip} onChange={(e) => setC({ zip: e.target.value })} /></Field>
            <Field label="Ort"><Input value={c.city} onChange={(e) => setC({ city: e.target.value })} /></Field>
            {p.mode === "business" ? <Field label="UID-Nummer"><Input value={c.uid} onChange={(e) => setC({ uid: e.target.value.toUpperCase() })} placeholder="ATU12345678" /></Field> : null}
            <Field label="Steuernummer"><Input value={c.steuernummer} onChange={(e) => setC({ steuernummer: e.target.value })} placeholder="12-345/6789" /></Field>
            <Field label="IBAN"><Input value={c.iban} onChange={(e) => setC({ iban: e.target.value.toUpperCase() })} /></Field>
            <Field label="BIC"><Input value={c.bic} onChange={(e) => setC({ bic: e.target.value.toUpperCase() })} /></Field>
            <Field label="E-Mail"><Input value={c.email} onChange={(e) => setC({ email: e.target.value })} /></Field>
            <Field label="Telefon"><Input value={c.phone} onChange={(e) => setC({ phone: e.target.value })} /></Field>
            {p.mode === "business" ? <Field label="Website"><Input value={c.website} onChange={(e) => setC({ website: e.target.value })} /></Field> : null}
          </div>
          <div className="mt-4 flex justify-end"><Button onClick={save}>Speichern</Button></div>
        </Card>
      </div>
      <div className="space-y-4">
        <Card title="Profile">
          <ul className="mb-3 divide-y divide-(--border) text-sm">{vault.profiles.filter((x) => !x.deletedAt).map((x) => <li key={x.id} className="flex items-center justify-between py-1.5"><span>{x.company.name || x.name}{x.id === profile.id ? <Badge tone="brand" className="ml-2">offen</Badge> : null}</span><span className="text-xs text-(--text-muted)">{x.mode === "business" ? "Firma" : "Privat"}</span></li>)}</ul>
          {activeProfiles.length < MAX_PROFILES ? (
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => addProfile("business")}><Plus className="h-4 w-4" /> Firma</Button><Button size="sm" variant="outline" onClick={() => addProfile("employee")}><Plus className="h-4 w-4" /> Privat</Button></div>
          ) : <p className="text-xs text-(--text-muted)">Maximal {MAX_PROFILES} Profile pro Konto – lösche eines, um ein neues anzulegen.</p>}
          <p className="mt-2 text-xs text-(--text-muted)">Firma und Privat getrennt, alles in einem Konto. Wechseln im Menü rechts oben.</p>
          {vault.profiles.filter((x) => !x.deletedAt).length > 1 ? <button className="mt-3 text-xs text-red-600 hover:underline" onClick={() => setConfirmDelete(true)}>Aktives Profil löschen</button> : null}
        </Card>
      </div>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title={`Profil „${profile.company.name || profile.name}“ löschen?`} body="Alle Buchungen und Rechnungen dieses Profils werden in den Papierkorb verschoben." confirmLabel="Löschen" onConfirm={() => { const store = requireStore(); const other = vault.profiles.find((x) => x.id !== profile.id && !x.deletedAt)!; store.softDelete("profiles", profile.id); store.setActiveProfile(other.id); }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TaxTab() {
  const profile = useProfile();
  const vault = useVault();
  const mutate = useSettingsMutator();
  const [p, setP] = useState<Profile>(profile);
  useEffect(() => setP(profile), [profile]);
  const emp = vault.settings.employee[profile.id] ?? { monthlyGrossCents: 0, monthlyNetCents: 0, employerName: "", pendlerpauschaleCents: 0, pendlereuroCents: 0, homeofficeDays: 0 };
  const setEmp = (patch: Partial<typeof emp>) => mutate((s) => ({ ...s, employee: { ...s.employee, [profile.id]: { ...emp, ...patch } } }));
  const save = () => {
    requireStore().update("profiles", p.id, { ...p, updatedAt: nowIso() }, "profile.tax");
    toast.success("Steuereinstellungen gespeichert");
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {p.mode === "business" ? (
        <Card title="Unternehmen">
          <div className="space-y-3">
            <Field label="Gewinnermittlung" hint="EÜR = Einnahmen-Ausgaben-Rechnung (§ 4 Abs. 3); Doppik = doppelte Buchführung (GmbH, Bilanzierer)."><Select value={p.accountingMethod} onChange={(e) => setP({ ...p, accountingMethod: e.target.value as Profile["accountingMethod"] })}><option value="eur">Einnahmen-Ausgaben-Rechnung (Istbesteuerung)</option><option value="doppik">Doppelte Buchführung (Sollbesteuerung)</option></Select></Field>
            <Field label="Umsatzsteuer" hint="Kleinunternehmer: bis 55.000 € Jahresumsatz steuerfrei, kein Vorsteuerabzug (§ 6 Abs. 1 Z 27)."><Select value={p.vatRegime} onChange={(e) => setP({ ...p, vatRegime: e.target.value as Profile["vatRegime"], uvaPeriod: e.target.value === "kleinunternehmer" ? "none" : p.uvaPeriod === "none" ? "quarterly" : p.uvaPeriod })}><option value="regelbesteuerung">Regelbesteuerung (mit USt & Vorsteuer)</option><option value="kleinunternehmer">Kleinunternehmer (steuerfrei)</option></Select></Field>
            <Field label="UVA-Zeitraum" hint="Monatlich ab 100.000 € Vorjahresumsatz, sonst vierteljährlich."><Select value={p.uvaPeriod} onChange={(e) => setP({ ...p, uvaPeriod: e.target.value as Profile["uvaPeriod"] })}><option value="quarterly">Vierteljährlich</option><option value="monthly">Monatlich</option><option value="none">Keine UVA</option></Select></Field>
            <Field label="USt-System in der EÜR" hint="Netto ist Standard bei Regelbesteuerung; Brutto weist vereinnahmte/verausgabte USt in KZ 9093/9233 aus."><Select value={p.ustSystem} onChange={(e) => setP({ ...p, ustSystem: e.target.value as Profile["ustSystem"] })}><option value="netto">Nettosystem</option><option value="brutto">Bruttosystem</option></Select></Field>
            <Field label="Pauschalierung (§ 17 EStG)" hint="Basispauschalierung: 15 % (6 % bei bestimmten Dienstleistungen) der Umsätze pauschal als Betriebsausgabe; Kleinunternehmerpauschalierung: 45 % / 20 % bis 55.000 € Umsatz."><Select value={p.pauschalierung} onChange={(e) => setP({ ...p, pauschalierung: e.target.value as Profile["pauschalierung"] })}><option value="none">Keine – tatsächliche Ausgaben</option><option value="basis">Basispauschalierung</option><option value="kleinunternehmer">Kleinunternehmerpauschalierung</option></Select></Field>
            {p.pauschalierung !== "none" ? <Field label="Branche"><Select value={p.pauschalierungBranch} onChange={(e) => setP({ ...p, pauschalierungBranch: e.target.value as Profile["pauschalierungBranch"] })}><option value="regular">Regulär (15 % / 45 %)</option><option value="service">Dienstleistung lt. Verordnung (6 % / 20 %) – z. B. Beratung, IT-Dienste, Vortragende</option></Select></Field> : null}
            <div className="flex justify-end"><Button onClick={save}>Speichern</Button></div>
          </div>
        </Card>
      ) : (
        <Card title="Angestellt – Angaben für die Schätzung">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Arbeitgeber"><Input value={emp.employerName} onChange={(e) => setEmp({ employerName: e.target.value })} /></Field>
            <Field label="Bruttogehalt monatlich"><MoneyInput value={emp.monthlyGrossCents || null} onChange={(c) => setEmp({ monthlyGrossCents: c ?? 0 })} /></Field>
            <Field label="Nettogehalt monatlich"><MoneyInput value={emp.monthlyNetCents || null} onChange={(c) => setEmp({ monthlyNetCents: c ?? 0 })} /></Field>
            <Field label="Homeoffice-Tage pro Jahr"><Input type="number" value={emp.homeofficeDays} onChange={(e) => setEmp({ homeofficeDays: Number(e.target.value) || 0 })} /></Field>
            <Field label="Pendlerpauschale pro Jahr (KZ 718)" hint="Laut Pendlerrechner (bmf.gv.at/pendlerrechner); nur wenn nicht vom Arbeitgeber berücksichtigt."><MoneyInput value={emp.pendlerpauschaleCents || null} onChange={(c) => setEmp({ pendlerpauschaleCents: c ?? 0 })} /></Field>
            <Field label="Pendlereuro pro Jahr (KZ 916)"><MoneyInput value={emp.pendlereuroCents || null} onChange={(c) => setEmp({ pendlereuroCents: c ?? 0 })} /></Field>
          </div>
          <p className="mt-3 text-xs text-(--text-muted)">Diese Angaben dienen nur der Schätzung von Selbstbehalt und Steuerersparnis. Sie werden lokal verschlüsselt gespeichert.</p>
        </Card>
      )}
      <Card title="Hinweise">
        <ul className="list-disc space-y-1 pl-5 text-sm text-(--text-muted)">
          <li>Kennzahlen basieren auf den amtlichen Formularen U 30 (2026), E 1a (2025) und L 1 (2025) des BMF.</li>
          <li>Summa ersetzt keine Steuerberatung. Bei Sonderfällen (Reverse Charge, Pauschalierung, Bilanzierung) lohnt ein kurzer Check mit dem Steuerberater – der Steuerberater-Export liefert alles Nötige.</li>
          <li>Rechnungen müssen 7 Jahre aufbewahrt werden (§ 132 BAO). Summa speichert alle Originale verschlüsselt.</li>
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AiTab() {
  const STRATEGIES: { id: SettingsT["ai"]["strategy"]; label: string; desc: string }[] = [
    { id: "local_first", label: "Lokal zuerst, KI nur bei Unsicherheit", desc: "Summa liest Text und QR-Codes selbst. Nur wenn etwas fehlt oder unsicher ist, liest die KI das Bild. Günstig und meist genug." },
    { id: "always", label: "Immer mit KI", desc: "Die KI liest jede Rechnung vom Bild, die lokale Erkennung prüft gegen. Am sichersten, kostet bei Cloud-KI pro Rechnung ein wenig." },
    { id: "local_only", label: "Nur lokal (nie KI)", desc: "Nichts verlässt dein Gerät. Unsichere Rechnungen warten dann unter „Zu prüfen“ auf dich." },
  ];
  const vault = useVault();
  const mutate = useSettingsMutator();
  const ai = vault.settings.ai;
  const setAi = (patch: Partial<typeof ai>) => mutate((s) => ({ ...s, ai: { ...s.ai, ...patch } }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title="Wie Rechnungen gelesen werden">
          <div className="space-y-2">
            {STRATEGIES.map((o) => {
              const active = ai.strategy === o.id;
              return (
                <button key={o.id} type="button" onClick={() => setAi({ strategy: o.id })} className={cls("flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors", active ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20" : "border-(--border) hover:bg-(--surface-2)")}>
                  <span className={cls("mt-1 h-4 w-4 shrink-0 rounded-full border-2", active ? "border-brand-600 bg-brand-600" : "border-slate-300")} />
                  <span className="flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">{o.label}{o.id === "local_first" ? <Badge tone="brand">Empfohlen</Badge> : null}</span>
                    <span className="block text-sm text-(--text-muted)">{o.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {ai.provider === "none" && ai.strategy !== "local_only" ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Noch ist keine KI ausgewählt – bis dahin liest Summa nur lokal. Wähle unten einen Anbieter.</p> : null}
          {ai.strategy === "local_first" ? (
            <div className="mt-3 max-w-sm">
              <Field label={`KI fragen unter ${Math.round(ai.aiThreshold * 100)} % Sicherheit`} hint="Liegt die lokale Sicherheit darunter oder fehlt Betrag, Datum oder Lieferant, liest die KI die Rechnung."><input type="range" min={50} max={100} step={1} value={Math.round(ai.aiThreshold * 100)} onChange={(e) => setAi({ aiThreshold: Number(e.target.value) / 100 })} className="w-full accent-brand-600" /></Field>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-(--text-muted)">In jedem Fall zuerst: E-Rechnung im PDF (ZUGFeRD/Factur-X/UBL) und der QR-Code am Kassenbon. Diese Werte sind eindeutig und gewinnen immer, auch gegen die KI. Einzelne Rechnungen kannst du jederzeit unter Eingehende Rechnungen mit „Mit KI lesen“ neu lesen lassen.</p>
        </Card>
        <Card title="KI-Anbieter">
          <div className="space-y-3">
            <ClaudeForInvoicesOffer />
            <AiProviderSetup />
          </div>
        </Card>
        <Card title="Automatisch buchen">
          <p className="mb-3 text-sm text-(--text-muted)">Ist eine Rechnung eindeutig gelesen – von der KI, einer E-Rechnung oder dem Kassenbon-QR – bucht Summa sie sofort. Du findest sie unter Eingehende Rechnungen → Gebucht mit dem Hinweis „automatisch“ und kannst ihn jederzeit korrigieren. Unsichere Rechnungen warten weiterhin unter „Zu prüfen“.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Automatisch buchen"><Select value={ai.autoBook} onChange={(e) => setAi({ autoBook: e.target.value as typeof ai.autoBook })}><option value="confident">Bei sicherer Erkennung (empfohlen)</option><option value="off">Nie – alles selbst bestätigen</option></Select></Field>
            <Field label={`Mindest-Sicherheit: ${Math.round(ai.minAutoApproveConfidence * 100)} %`} hint="Betrag, Datum, Lieferant und Kategorie müssen zusätzlich einzeln sicher sein; Anlagen und Sonderfälle werden nie automatisch gebucht."><input type="range" min={80} max={100} step={1} value={Math.round(ai.minAutoApproveConfidence * 100)} onChange={(e) => setAi({ minAutoApproveConfidence: Number(e.target.value) / 100 })} className="w-full accent-brand-600" disabled={ai.autoBook === "off"} /></Field>
          </div>
        </Card>
        <Card title="Verhalten">
          <div className="space-y-2">
            <Switch checked={ai.autoExtract} onChange={(b) => setAi({ autoExtract: b })} label="Rechnungen sofort lesen" hint="Gleich beim Hochladen oder sobald sie im Ordner landen." />
            <Switch checked={ai.includeOcrText} onChange={(b) => setAi({ includeOcrText: b })} label="Lokalen OCR-Text an die KI mitgeben" hint="Verbessert die Genauigkeit, besonders bei kleinen Zahlen." />
          </div>
        </Card>
      </div>
      <Card title="Was geht ohne KI?">
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> PDF-Rechnungen mit Textebene: Betrag, Datum, UID, IBAN, Steuersätze, Rechnungsnummer – sehr zuverlässig.</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Fotos & Scans: lokale OCR (Tesseract, Deutsch/Englisch) + Regelparser – gut bei sauberen Bons, schwächer bei Knicken/Schatten.</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Excel/CSV-Rechnungen und Kontoauszüge (CSV/CAMT): vollständig lokal.</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Kategorisierung per Stichwort & Kontakt-Gedächtnis, Steuern, Berichte, Exporte: immer lokal.</li>
          <li className="flex gap-2"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> KI hilft bei: handschriftlichen Rechnungen, Fremdsprachen, komplexen Layouts, gescannten Kontoauszügen, Positionslisten.</li>
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */

function SecurityTab() {
  const vault = useVault();
  const mutate = useSettingsMutator();
  const store = useSession((s) => s.store)!;
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [hint, setHint] = useState(store.header.hint ?? "");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const change = async () => {
    if (next.length < 8 || next !== confirm) {
      toast.warning("Neues Passwort: mindestens 8 Zeichen, zweimal gleich.");
      return;
    }
    setBusy(true);
    try {
      await store.changePassword(cur, next, hint);
      // one password for everything: the account login follows the vault password
      await updateAccountPassword(next).catch((e) => toast.warning("Konto-Login nicht aktualisiert", e instanceof Error ? e.message : String(e)));
      toast.success("Passwort geändert");
      setCur("");
      setNext("");
      setConfirm("");
    } catch (e) {
      toast.error("Fehlgeschlagen", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const regen = async () => {
    setBusy(true);
    try {
      setNewKey(await store.regenerateRecoveryKey());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Passwort ändern">
        <div className="space-y-3">
          <Field label="Aktuelles Passwort"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="Neues Passwort"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Wiederholen"><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Hinweis (optional)"><Input value={hint} onChange={(e) => setHint(e.target.value)} /></Field>
          <div className="flex justify-end"><Button onClick={change} loading={busy} disabled={!cur || !next}>Passwort ändern</Button></div>
        </div>
      </Card>
      <div className="space-y-4">
        <Card title="Wiederherstellungsschlüssel">
          <p className="text-sm text-(--text-muted)">{store.hasRecoveryKey ? "Ein Wiederherstellungsschlüssel ist eingerichtet. Du kannst einen neuen erzeugen – der alte wird dadurch ungültig." : "Kein Wiederherstellungsschlüssel vorhanden. Ohne ihn gibt es bei vergessenem Passwort keinen Zugang."}</p>
          {newKey ? <div className="my-3 rounded-xl border-2 border-dashed border-brand-400 bg-brand-50 p-3 text-center font-mono text-base tracking-wider dark:bg-brand-900/20">{newKey}</div> : null}
          <div className="mt-3 flex gap-2"><Button variant="outline" size="sm" onClick={regen} loading={busy}><KeyRound className="h-4 w-4" /> Neuen Schlüssel erzeugen</Button>{newKey ? <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(newKey)}>Kopieren</Button> : null}</div>
        </Card>
        <PasskeyCard />
        <TwoFactorCard />
        <Card title="Automatisch sperren">
          <Field label="Nach Inaktivität (Minuten, 0 = nie)"><Input type="number" min={0} value={vault.settings.autoLockMinutes} onChange={(e) => mutate((s) => ({ ...s, autoLockMinutes: Math.max(0, Number(e.target.value) || 0) }))} className="w-32" /></Field>
          <p className="mt-2 text-xs text-(--text-muted)">Strg+L sperrt sofort. Beim Sperren werden die Schlüssel aus dem Speicher gelöscht.</p>
        </Card>
        <Card title="Gefahrenzone">
          {vault.settings.demoMode ? <div className="mb-3"><Button variant="outline" size="sm" onClick={() => void exitDemo()}>Demo beenden &amp; eigenen Tresor anlegen</Button></div> : null}
          <p className="mb-2 text-sm text-(--text-muted)">Löscht den gesamten Tresor auf diesem Gerät (alle Profile, Buchungen, Rechnungen). Vorher eine Sicherung exportieren!</p>
          <Button variant="danger" size="sm" onClick={() => setConfirmWipe(true)}><Trash2 className="h-4 w-4" /> Tresor auf diesem Gerät löschen</Button>
        </Card>
      </div>
      <ConfirmDialog open={confirmWipe} onClose={() => setConfirmWipe(false)} danger title="Wirklich ALLES löschen?" body="Dieser Schritt kann nicht rückgängig gemacht werden. Nur Sicherungsdateien (.ordo), die du gespeichert hast, bleiben erhalten." confirmLabel="Endgültig löschen" onConfirm={async () => { const { platform } = useSession.getState(); await useSession.getState().lock(); await platform!.wipe(); location.reload(); }} />
    </div>
  );
}

function PasskeyCard() {
  const store = useSession((s) => s.store)!;
  const [rec, setRec] = useState(passkeyRecord());
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void platformAuthenticatorAvailable().then(setAvailable);
  }, []);
  const enroll = async () => {
    setBusy(true);
    try {
      await enrollPasskey(store);
      setRec(passkeyRecord());
      toast.success("Biometrisches Entsperren aktiv", "Beim nächsten Start reicht Windows Hello / Fingerabdruck. Das Passwort bleibt gültig.");
    } catch (e) {
      toast.error("Einrichtung fehlgeschlagen", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Windows Hello / Fingerabdruck / Face ID">
      <p className="text-sm text-(--text-muted)">Entsperrt den Tresor auf diesem Gerät per Biometrie oder Geräte-PIN (Passkey mit PRF-Erweiterung). Der Tresorschlüssel wird dabei an den Sicherheitschip dieses Geräts gebunden – ohne Biometrie keine Entschlüsselung. Das Passwort funktioniert weiterhin und ist der Master-Zugang.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {rec ? (
          <>
            <Badge tone="success">Aktiv seit {fmtDateTime(rec.createdAt)}</Badge>
            <Button size="sm" variant="outline" onClick={() => { removePasskey(); setRec(null); toast.info("Biometrisches Entsperren deaktiviert"); }}>Deaktivieren</Button>
          </>
        ) : (
          <Button size="sm" onClick={enroll} loading={busy} disabled={available === false}><Fingerprint className="h-4 w-4" /> Jetzt einrichten</Button>
        )}
        {available === false ? <span className="text-xs text-(--text-muted)">Auf diesem Gerät/Browser nicht verfügbar (braucht Windows Hello, Touch ID oder Android-Biometrie und einen sicheren Kontext).</span> : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function NotificationsTab() {
  const vault = useVault();
  const mutate = useSettingsMutator();
  const n = vault.settings.notifications;
  const set = (patch: Partial<typeof n>) => mutate((s) => ({ ...s, notifications: { ...s.notifications, ...patch } }));
  const platform = useSession((s) => s.platform);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Benachrichtigungen">
        <div className="space-y-2">
          <Switch checked={n.enabled} onChange={(b) => set({ enabled: b })} label="Hinweise aktivieren" />
          <Switch checked={n.uvaDeadline} onChange={(b) => set({ uvaDeadline: b })} label="UVA-Fristen" hint="Erinnerung vor dem 15. des zweitfolgenden Monats" />
          <Field label="Tage vorher"><Input type="number" min={1} max={60} value={n.uvaDaysBefore} onChange={(e) => set({ uvaDaysBefore: Number(e.target.value) || 7 })} className="w-24" /></Field>
          <Switch checked={n.inboxReminder} onChange={(b) => set({ inboxReminder: b })} label="Rechnungen warten auf einen Blick" />
          <Switch checked={n.recurringDue} onChange={(b) => set({ recurringDue: b })} label="Daueraufträge mit manueller Bestätigung" />
          <Switch checked={n.invoiceOverdue} onChange={(b) => set({ invoiceOverdue: b })} label="Überfällige Rechnungen" />
          <Button variant="outline" size="sm" onClick={async () => { const ok = await platform!.requestNotificationPermission(); if (ok) { await platform!.notify("Ordo", "Benachrichtigungen funktionieren."); toast.success("Systembenachrichtigungen erlaubt"); } else toast.warning("Keine Berechtigung erteilt"); }}><Bell className="h-4 w-4" /> Systembenachrichtigung testen</Button>
        </div>
      </Card>
      <Card title="Darstellung">
        <Field label="Design"><Select value={vault.settings.theme} onChange={(e) => mutate((s) => ({ ...s, theme: e.target.value as SettingsT["theme"] }))}><option value="system">System</option><option value="light">Hell</option><option value="dark">Dunkel</option></Select></Field>
        <Field label="OCR-Sprachen (kommagetrennt, Tesseract-Codes)" className="mt-3"><Input value={vault.settings.ocrLanguages.join(", ")} onChange={(e) => mutate((s) => ({ ...s, ocrLanguages: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))} /></Field>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AccountTab() {
  const vault = useVault();
  const mutate = useSettingsMutator();
  const s = vault.settings.sync;
  const set = (patch: Partial<typeof s>) => mutate((st) => ({ ...st, sync: { ...st.sync, ...patch } }));
  const sync = useSync();
  const [email, setEmail] = useState(s.email);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [waitlist, setWaitlist] = useState<"full" | "closed" | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);
  // where a new connection goes: the Ordo server (null) or the person's own Supabase project
  const [target, setTarget] = useState<ServerTarget | null>(() => pendingTarget());
  const [ownDbOpen, setOwnDbOpen] = useState(false);
  const chooseTarget = (t: ServerTarget | null) => {
    setPendingTarget(t);
    setTarget(t);
    setWaitlist(null);
    void sync.init(t?.url ?? SUMMA_SYNC_DEFAULT.url, t?.anonKey ?? SUMMA_SYNC_DEFAULT.anonKey);
  };
  useEffect(() => {
    try {
      const boot = JSON.parse(localStorage.getItem("summa.sync.bootstrap") ?? "null") as { url: string; anonKey: string } | null;
      if (boot?.url) {
        set({ enabled: true, supabaseUrl: boot.url === SUMMA_SYNC_DEFAULT.url ? "" : boot.url, supabaseAnonKey: boot.url === SUMMA_SYNC_DEFAULT.url ? "" : boot.anonKey, deviceId: s.deviceId || generateRecoveryKey().slice(0, 9) });
        localStorage.removeItem("summa.sync.bootstrap");
      }
    } catch {
      /* ignore */
    }
    if (!sync.client) {
      const pending = !s.email ? pendingTarget() : null;
      void sync.init(s.supabaseUrl || pending?.url || SUMMA_SYNC_DEFAULT.url, s.supabaseAnonKey || pending?.anonKey || SUMMA_SYNC_DEFAULT.anonKey);
    }
  }, [s.enabled, s.supabaseUrl, s.supabaseAnonKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof SignupClosedError) setWaitlist(e.reason);
      else toast.error("Fehler", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const connected = !!sync.session;
  const pending = !connected && !!s.email;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Dein Konto">
        {connected ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Angemeldet als <strong>{sync.session!.user.email}</strong>{sync.isAdmin ? <Badge tone="brand">Admin</Badge> : null}</div>
            <div className="text-xs text-(--text-muted)">Letzter Abgleich: {s.lastSyncAt ? fmtDateTime(s.lastSyncAt) : "–"}{sync.status === "syncing" ? " · gleicht ab …" : ""}{sync.lastError ? ` · ${sync.lastError}` : ""}</div>
            <Switch checked={s.enabled} onChange={(b) => set({ enabled: b })} label="Geräte automatisch abgleichen" hint="Desktop, Browser und Handy bleiben auf demselben Stand – verschlüsselt übertragen und gespeichert." />
            <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => run(() => sync.sync())} loading={busy || sync.status === "syncing"}><RefreshCw className="h-4 w-4" /> Jetzt abgleichen</Button><Button size="sm" variant="outline" onClick={() => setConfirmOut(true)}><LogOut className="h-4 w-4" /> Abmelden</Button></div>
            <ServerUsagePanel />
            {sync.ownServer && s.supabaseUrl ? <ConnectionCodeCard target={{ url: s.supabaseUrl, anonKey: s.supabaseAnonKey }} /> : null}
            <AccountPanel />
          </div>
        ) : pending ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100">Fast fertig: Öffne den Link in der E-Mail an <strong>{s.email}</strong>. Danach meldet Summa dich automatisch an und gleicht ab.</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => run(async () => { const { error } = await sync.client!.auth.signInWithPassword({ email: s.email, password: s.authSecret }); if (error) throw new Error(translateAuthError(error.message)); await sync.refreshMeta(); await sync.sync(); toast.success("Angemeldet"); })} loading={busy}><CheckCircle2 className="h-4 w-4" /> Ich habe bestätigt</Button>
              <Button size="sm" variant="outline" onClick={() => run(async () => { await resendConfirmation(); toast.success("E-Mail erneut gesendet"); })} loading={busy}>E-Mail erneut senden</Button>
              <Button size="sm" variant="ghost" onClick={() => set({ email: "", authSecret: "", enabled: false })}>Andere E-Mail</Button>
            </div>
          </div>
        ) : !HAS_DEFAULT_SERVER && !target ? (
          <div className="space-y-3">
            <p className="text-sm text-(--text-muted)">Ohne Konto bleibt alles verschlüsselt auf diesem Gerät. Für Desktop, Browser, Handy oder ein Team verbindest du deine eigene Datenbank – ein kostenloses Supabase-Projekt, das dir gehört. Danach legst du hier dein Konto an.</p>
            <Button size="sm" onClick={() => setOwnDbOpen(true)}><Database className="h-4 w-4" /> Eigene Datenbank verbinden</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-(--text-muted)">Mit einem kostenlosen Konto hast du deine Daten auf Desktop, Browser und Handy – verschlüsselt, mit demselben Passwort wie hier. Ohne Konto bleibt alles nur auf diesem Gerät.</p>
            <ServerChip target={target} onChange={() => setOwnDbOpen(true)} onReset={() => chooseTarget(null)} />
            <Field label="E-Mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="du@beispiel.at" /></Field>
            <Field label="Dein Ordo-Passwort" hint="Das Passwort, mit dem du Ordo auf diesem Gerät entsperrst."><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => run(async () => { const r = await connectAccount(email, pw, "create"); setPw(""); toast.success("Konto erstellt", r.confirmed ? "Deine Daten werden jetzt abgeglichen." : "Bitte den Link in der Bestätigungs-E-Mail öffnen."); })} loading={busy} disabled={!email.includes("@") || !pw}><ShieldCheck className="h-4 w-4" /> Konto erstellen</Button>
              <Button size="sm" variant="outline" onClick={() => run(async () => { await connectAccount(email, pw, "login"); setPw(""); toast.success("Mit Konto verbunden"); })} loading={busy} disabled={!email.includes("@") || !pw}><LogIn className="h-4 w-4" /> Mit bestehendem Konto verbinden</Button>
            </div>
            {waitlist ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
                <div className="font-medium">{waitlist === "full" ? "Derzeit sind alle Plätze vergeben." : "Die Registrierung ist derzeit geschlossen."}</div>
                <p className="mt-1 text-xs">{PARTS.joinWaitlist ? "Ordo ist eine private Beta mit begrenzten Konten. Trag dich ein – wir melden uns, sobald ein Platz frei ist. Oder nutze Ordo sofort kostenlos mit deiner eigenen Datenbank." : "Auf diesem Server sind gerade keine neuen Konten möglich – frag die Person, die ihn betreut, oder verbinde eine andere Datenbank."} Auf diesem Gerät kannst du Ordo uneingeschränkt weiter nutzen.</p>
                <div className="mt-2 flex flex-wrap gap-2">{PARTS.joinWaitlist ? <Button size="sm" onClick={() => run(async () => { await PARTS.joinWaitlist!(email); toast.success("Auf der Warteliste", "Wir melden uns per E-Mail."); setWaitlist(null); })} disabled={!email}>Auf die Warteliste</Button> : null}<Button size="sm" variant="outline" onClick={() => setOwnDbOpen(true)}>Eigene Datenbank</Button><Button size="sm" variant="ghost" onClick={() => setWaitlist(null)}>Schließen</Button></div>
              </div>
            ) : null}
          </div>
        )}
      </Card>
      <Card title="So funktioniert dein Konto">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-(--text-muted)">
          <li><strong>Ein Passwort für alles.</strong> Es verschlüsselt deine Daten; dein Passwort selbst verlässt das Gerät nie.</li>
          <li><strong>Neues Gerät:</strong> Ordo öffnen, „Anmelden“, E-Mail und Passwort – fertig, alles ist da.</li>
          <li><strong>Passwort vergessen?</strong> Beim Anmelden auf „Passwort vergessen?“ – ein Code per E-Mail genügt. Dafür ist der Schlüssel deines Tresors verschlüsselt auf dem Server hinterlegt{legalPage("Datenschutz") ? " (siehe Datenschutzerklärung)" : ""}.</li>
          <li><strong>Fremder Computer?</strong> Beim Abmelden „vom Gerät entfernen“ wählen.</li>
          <li><strong>Eigene Datenbank:</strong> Kostenlos mit deinem eigenen Supabase-Projekt{HAS_DEFAULT_SERVER ? " – dann liegt nichts bei uns" : ""}. Wechseln: abmelden (die Daten bleiben auf dem Gerät), „Eigene Datenbank“ wählen und neu verbinden.</li>
          {PARTS.plansPath ? <li><strong>Was als Nächstes kommt:</strong> <Link to={PARTS.plansPath} className="text-brand-700 hover:underline dark:text-brand-300">Pläne ansehen und abstimmen</Link>.</li> : null}
        </ul>
        <NoDataLine className="mt-3" />
      </Card>
      <OwnDatabaseDialog open={ownDbOpen} onClose={() => setOwnDbOpen(false)} onConnected={(t) => { chooseTarget(t); toast.success("Eigene Datenbank gewählt", "Leg jetzt dein Konto an – es entsteht in deinem Projekt."); }} />
      <ConfirmDialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        title="Abmelden"
        body={`Du wirst von ${sync.session?.user.email ?? s.email} abgemeldet und Ordo wird gesperrt. Auf einem fremden Computer entferne die Daten von diesem Gerät – sie bleiben in deinem Konto.`}
        confirmLabel="Abmelden"
        onConfirm={() => void signOut({ removeFromDevice: false })}
        extra={<Button variant="outline" className="text-red-600" onClick={() => { setConfirmOut(false); void signOut({ removeFromDevice: true }); }}>Abmelden &amp; vom Gerät entfernen</Button>}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BackupTab() {
  const platform = useSession((s) => s.platform)!;
  const [list, setList] = useState<{ name: string; path: string; bytes: number; modified: number }[]>([]);
  const [restore, setRestore] = useState<string | null>(null);
  const load = async () => setList((await platform.backups?.list()) ?? []);
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title="Automatische Backups (letzte 10 Versionen)">
      <p className="mb-3 text-sm text-(--text-muted)">Vor jedem Speichern legt Ordo eine Kopie der vorherigen Tresor-Version ab. Wiederherstellen ersetzt den aktuellen Stand – danach neu entsperren.</p>
      <ul className="divide-y divide-(--border) text-sm">{list.map((b) => <li key={b.path} className="flex items-center gap-3 py-2"><HardDrive className="h-4 w-4 text-(--text-muted)" /><span className="flex-1 font-mono text-xs">{b.name}</span><span className="text-xs text-(--text-muted)">{fmtDateTime(new Date(b.modified * 1000).toISOString())} · {fmtBytes(b.bytes)}</span><Button size="sm" variant="outline" onClick={() => setRestore(b.path)}>Wiederherstellen</Button></li>)}{!list.length ? <li className="py-4 text-center text-(--text-muted)">Noch keine Backups.</li> : null}</ul>
      <div className="mt-3"><Button size="sm" variant="ghost" onClick={() => platform.revealDataDir?.()}><ExternalLink className="h-4 w-4" /> Datenordner öffnen</Button></div>
      <ConfirmDialog open={!!restore} onClose={() => setRestore(null)} danger title="Backup wiederherstellen?" body="Der aktuelle Tresor wird durch diese Version ersetzt (der aktuelle Stand wird vorher ebenfalls als Backup gesichert)." confirmLabel="Wiederherstellen" onConfirm={async () => { await useSession.getState().lock(); await platform.backups!.restore(restore!); location.reload(); }} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */

function CategoriesTab() {
  const vault = useVault();
  const profile = useProfile();
  const store = requireStore();
  const [showArchived, setShowArchived] = useState(false);
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<{ name: string; kind: "income" | "expense"; vat: VatRate } | null>(null);
  const [kwInput, setKwInput] = useState<Record<string, string>>({});
  const cats = vault.categories
    .filter((c) => !c.deletedAt && (c.mode === "both" || c.mode === profile.mode) && (showArchived || !c.isArchived))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "de"));
  const update = (id: string, patch: Partial<Category>) => store.update("categories", id, { ...patch, updatedAt: nowIso() }, "category.update");
  const addKeyword = (c: Category) => {
    const kw = (kwInput[c.id] ?? "").trim().toLowerCase();
    if (!kw || [...c.keywords, ...c.userKeywords].includes(kw)) return;
    // system keywords are re-seeded on every open – user additions live in userKeywords
    update(c.id, c.isSystem ? { userKeywords: [...c.userKeywords, kw] } : { keywords: [...c.keywords, kw] });
    setKwInput({ ...kwInput, [c.id]: "" });
  };
  const removeKeyword = (c: Category, kw: string) => {
    if (c.userKeywords.includes(kw)) update(c.id, { userKeywords: c.userKeywords.filter((k) => k !== kw) });
    else if (!c.isSystem) update(c.id, { keywords: c.keywords.filter((k) => k !== kw) });
  };
  const create = () => {
    if (!draft?.name.trim()) return;
    const now = nowIso();
    store.insert("categories", { id: ids.category(), name: draft.name.trim(), kind: draft.kind, mode: profile.mode, icon: "tag", color: "#0d9488", defaultVatRate: draft.vat, defaultDeductiblePct: 100, deductibleIncomePct: 100, keywords: [], userKeywords: [], isSystem: false, isArchived: false, sortOrder: 500, createdAt: now, updatedAt: now }, "category.create");
    setDraft(null);
    toast.success("Kategorie angelegt", "Stichwörter (Händler, Produkte) helfen bei der automatischen Zuordnung.");
  };
  const q = query.trim().toLocaleLowerCase("de");
  const matches = (c: Category) => !q || c.name.toLocaleLowerCase("de").includes(q) || [...c.keywords, ...c.userKeywords].some((k) => k.includes(q));
  const counts = { expense: cats.filter((c) => c.kind === "expense").length, income: cats.filter((c) => c.kind === "income").length };
  const rows = cats.filter((c) => c.kind === kind && matches(c));
  // compact tiles in columns: a long list of categories fits on one or two screens instead of a page-long scroll
  const tiles = (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
      {rows.map((c) => {
        const editable = (kw: string) => c.userKeywords.includes(kw) || !c.isSystem;
        return (
          <div key={c.id} className={cls("surface flex flex-col gap-2 p-3", c.isArchived && "opacity-60")}>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white" style={{ background: c.color }}><CategoryIcon name={c.icon} className="h-4 w-4" /></span>
              {c.isSystem ? <span className="min-w-0 flex-1 truncate text-sm font-medium" title={c.name}>{c.name}</span> : <Input value={c.name} onChange={(e) => update(c.id, { name: e.target.value })} className="h-8 min-w-0 flex-1 text-sm font-medium" aria-label="Name der Kategorie" />}
              <Switch checked={!c.isArchived} onChange={(b) => update(c.id, { isArchived: !b })} />
              {!c.isSystem ? <button className="rounded-md p-1 text-(--text-muted) hover:text-red-600" onClick={() => store.softDelete("categories", c.id, "category.delete")} aria-label="Kategorie löschen"><Trash2 className="h-4 w-4" /></button> : null}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {c.e1aKz || c.l1Kz ? <Badge tone="neutral">KZ {c.e1aKz ?? c.l1Kz}</Badge> : null}
              {!c.isSystem ? <Badge tone="brand">eigene</Badge> : null}
              {[...c.keywords, ...c.userKeywords].map((kw) => (
                <span key={kw} className={cls("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", editable(kw) ? "bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-100" : "bg-(--surface-2) text-(--text-muted)")}>
                  {kw}
                  {editable(kw) ? <button type="button" onClick={() => removeKeyword(c, kw)} className="hover:text-red-600" aria-label={`Stichwort ${kw} entfernen`}><X className="h-3 w-3" /></button> : null}
                </span>
              ))}
              <input value={kwInput[c.id] ?? ""} onChange={(e) => setKwInput({ ...kwInput, [c.id]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(c); } }} onBlur={() => addKeyword(c)} placeholder="+ Stichwort" aria-label={`Stichwort zu ${c.name} hinzufügen`} className="h-6 w-28 rounded-full border border-dashed border-(--border) bg-transparent px-2 text-[11px] outline-none focus:border-brand-500" />
            </div>
          </div>
        );
      })}
      {!rows.length ? <p className="col-span-full py-6 text-sm text-(--text-muted)">Keine Kategorie passt{q ? ` zu „${query}“` : ""}.</p> : null}
    </div>
  );
  return (
    <div className="space-y-4">
      <Card title="Kategorien" action={<div className="flex flex-wrap items-center gap-3"><Switch checked={showArchived} onChange={setShowArchived} label="Archivierte zeigen" /><Button size="sm" onClick={() => setDraft({ name: "", kind: "expense", vat: 20 })}><Plus className="h-4 w-4" /> Neue Kategorie</Button></div>}>
        <p className="text-sm text-(--text-muted)">Rechnungen werden automatisch zugeordnet: über das Kontakt-Gedächtnis (Lieferant → zuletzt gebuchte Kategorie), über Stichwörter wie Händler- oder Produktnamen und – wenn verbunden – über die KI, die deine Kategorien samt Stichwörtern kennt. Korrigierst du eine Zuordnung, lernt die Kategorie den Händler als Stichwort dazu. Archivierte Kategorien bleiben in alten Buchungen erhalten, werden aber nicht mehr vorgeschlagen.</p>
        {draft ? (
          <div className="mt-3 grid gap-3 rounded-xl border border-(--border) p-3 sm:grid-cols-[1fr_170px_130px_auto] sm:items-end">
            <Field label="Name" required><Input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="z. B. Haustier, Garten, Fortbildung" onKeyDown={(e) => { if (e.key === "Enter") create(); }} /></Field>
            <Field label="Art"><Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "income" | "expense" })}><option value="expense">Ausgabe</option><option value="income">Einnahme</option></Select></Field>
            <Field label="Steuersatz"><Select value={draft.vat} onChange={(e) => setDraft({ ...draft, vat: Number(e.target.value) as VatRate })}><option value={20}>20 %</option><option value={10}>10 %</option><option value={13}>13 %</option><option value={0}>0 %</option></Select></Field>
            <div className="flex gap-2"><Button size="sm" onClick={create} disabled={!draft.name.trim()}>Anlegen</Button><Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Abbrechen</Button></div>
          </div>
        ) : null}
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={kind} onChange={setKind} tabs={[{ id: "expense", label: `Ausgaben (${counts.expense})` }, { id: "income", label: `Einnahmen (${counts.income})` }]} />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Kategorie oder Stichwort suchen" className="h-9 w-full sm:w-72" aria-label="Kategorien durchsuchen" />
      </div>
      {tiles}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AboutTab() {
  const platform = useSession((s) => s.platform)!;
  const startTour = useTour((s) => s.start);
  const [info, setInfo] = useState<{ version: string; dataDir?: string; vaultPath?: string } | null>(null);
  const [usage, setUsage] = useState<{ vaultBytes: number; blobBytes: number } | null>(null);
  useEffect(() => {
    void platform.appInfo().then(setInfo);
    void platform.storage.usage?.().then(setUsage);
  }, [platform]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Ordo">
        <div className="flex items-start gap-4">
          <Logo className="h-14 w-14" />
          <div className="text-sm">
            <div className="text-lg font-semibold">Ordo {info?.version ?? ""}</div>
            <p className="text-(--text-muted)">Ordnung für deinen Betrieb – mit Summa für die Buchhaltung (benannt nach Luca Paciolis „Summa de arithmetica“, 1494) und Modulen für Projekte, Lager und Produktion.</p>
            <p className="mt-2 text-(--text-muted)">Lokal · verschlüsselt (Argon2id + AES-256-GCM) · keine Werbung, keine Analyse-Tools, keine Nutzungsdaten. Ein Server sieht nur, was du selbst einschaltest (Sync, eigene Datenbank, Schnittstellen, Cloud-KI) – mit eigener Datenbank liegt bei uns gar nichts.</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-[140px_1fr] gap-y-1 text-xs">
          <dt className="text-(--text-muted)">Einführung</dt><dd><button className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-300" onClick={startTour}><Compass className="h-3.5 w-3.5" /> Tour erneut starten</button></dd>
          <dt className="text-(--text-muted)">Speicher</dt><dd>{platform.storage.describe()}</dd>
          {info?.vaultPath ? <><dt className="text-(--text-muted)">Tresordatei</dt><dd className="truncate font-mono" title={info.vaultPath}>{info.vaultPath}</dd></> : null}
          {usage ? <><dt className="text-(--text-muted)">Größe</dt><dd>Daten {fmtBytes(usage.vaultBytes)} · Dateien {fmtBytes(usage.blobBytes)}</dd></> : null}
        </dl>
      </Card>
      <Card title="Quellen & Rechtliches">
        <ul className="list-disc space-y-1 pl-5 text-sm text-(--text-muted)">
          <li>Kennzahlen: BMF-Formulare U 30 (2026), E 1a / E 2 (2025), L 1 / L 1ab / L 1d (2025).</li>
          <li>Tarif & Grenzen: § 33 EStG (2025/2026), § 6 Abs. 1 Z 27 UStG, § 17 EStG, § 13 EStG, § 10 EStG.</li>
          <li>Kontenrahmen: Österreichischer Einheitskontenrahmen (KFS/BW 6).</li>
          <li>Ordo ist ein Werkzeug zur Vorbereitung – keine Steuerberatung und kein Ersatz für die Prüfung durch Fachleute.</li>
          <li>OCR: Tesseract.js · PDF: pdf.js · Verschlüsselung: Web Crypto API + hash-wasm (Argon2id).</li>
        </ul>
        <div className="mt-4 border-t border-(--border) pt-3">
          <div className="mb-1 text-xs font-medium text-(--text-muted)">{OPERATOR.provider ? `Anbieter: ${OPERATOR.provider}` : <>Ordo Community Edition · freie Software unter der GNU AGPL-3.0 · <a href={OPERATOR.website} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); openExternal(OPERATOR.website); }} className="hover:underline">ordo-app.at</a></>}</div>
          <LegalLinks />
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function InvoiceSettingsTab() {
  const profile = useProfile();
  const invoices = useList("invoices");
  const vault = useVault();
  const navigate = useNavigate();
  const mode = invoiceModeOf(profile, invoices.length);
  const [c, setC] = useState(profile.company);
  useEffect(() => setC(profile.company), [profile.company]);
  const dirty = JSON.stringify(c) !== JSON.stringify(profile.company);
  const save = () => {
    requireStore().update("profiles", profile.id, (p) => ({ ...p, company: { ...p.company, invoiceNumberPattern: c.invoiceNumberPattern, nextInvoiceNumber: c.nextInvoiceNumber, invoiceFooter: c.invoiceFooter, logoAttachmentId: c.logoAttachmentId }, updatedAt: nowIso() }), "profile.invoiceSettings");
    toast.success("Rechnungseinstellungen gespeichert");
  };
  const uploadLogo = async () => {
    const files = await requirePlatform().pickFiles({ multiple: false, accept: ["image/png", "image/jpeg"] });
    const f = files[0];
    if (!f) return;
    const att = await requireStore().putAttachment(profile.id, f.bytes, { name: f.name, mime: f.mime });
    setC({ ...c, logoAttachmentId: att.id });
  };
  const year = new Date().getFullYear();
  const preview = c.invoiceNumberPattern.replace("{YYYY}", String(year)).replace("{YY}", String(year).slice(2)).replace("{MM}", String(new Date().getMonth() + 1).padStart(2, "0")).replace(/\{N+\}/, (m) => String(c.nextInvoiceNumber).padStart(m.length - 2, "0"));
  const outgoingFolders = vault.settings.watchFolders.filter((f) => f.profileId === profile.id && f.kind === "outgoing");
  return (
    <div className="space-y-4">
      <Card title="Wie entstehen deine Ausgangsrechnungen?">
        <p className="mb-4 text-sm text-(--text-muted)">Wähle, was zu deinem Ablauf passt. Du kannst jederzeit wechseln – bestehende Daten bleiben erhalten.</p>
        <InvoiceModeChooser profile={profile} value={mode} />
      </Card>
      {mode === "summa" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Nummernkreis">
            <div className="space-y-3">
              <Field label="Muster" hint="Platzhalter: {YYYY} Jahr · {YY} Jahr kurz · {MM} Monat · {NNNN} laufende Nummer (Anzahl N = Stellen)"><Input value={c.invoiceNumberPattern} onChange={(e) => setC({ ...c, invoiceNumberPattern: e.target.value })} /></Field>
              <Field label="Nächste laufende Nummer" hint="Rechnungsnummern müssen fortlaufend und eindeutig sein (§ 11 UStG). Nur ändern, wenn du von einem anderen Programm umsteigst."><Input type="number" min={1} value={c.nextInvoiceNumber} onChange={(e) => setC({ ...c, nextInvoiceNumber: Math.max(1, Number(e.target.value) || 1) })} className="w-40" /></Field>
              <div className="rounded-xl bg-(--surface-2) px-3 py-2 text-sm">Nächste Rechnung: <strong className="font-mono">{preview}</strong></div>
            </div>
          </Card>
          <Card title="Layout">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" onClick={uploadLogo}>Logo hochladen (PNG/JPG)</Button>{c.logoAttachmentId ? <Badge tone="success">Logo gesetzt</Badge> : <span className="text-xs text-(--text-muted)">ohne Logo</span>}{c.logoAttachmentId ? <button className="text-xs text-red-600" onClick={() => setC({ ...c, logoAttachmentId: undefined })}>entfernen</button> : null}</div>
              <Field label="Fußzeile" hint="Erscheint klein am Seitenende, z. B. Firmenbuch, Gerichtsstand, Kammer."><Textarea value={c.invoiceFooter} onChange={(e) => setC({ ...c, invoiceFooter: e.target.value })} placeholder="z. B. Firmenbuch FN 123456a · Gerichtsstand Wien" /></Field>
              <p className="text-xs text-(--text-muted)">Name, Adresse, UID, Steuernummer und Bankverbindung kommen aus <button className="text-brand-700 hover:underline dark:text-brand-300" onClick={() => navigate("/einstellungen/profil")}>Profil & Firma</button>.</p>
            </div>
          </Card>
          <div className="flex justify-end gap-2 lg:col-span-2"><Button variant="ghost" onClick={() => navigate("/rechnungen")}>Zu den Rechnungen</Button><Button onClick={save} disabled={!dirty}>Speichern</Button></div>
        </div>
      ) : mode === "external" ? (
        <Card title="Import deiner Rechnungen">
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Keine Nummernkreise oder Vorlagen nötig – die Rechnungsnummer kommt aus deinem Programm.</li>
            <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Summa liest Kunde, Nummer, Datum, Netto/USt/Brutto (bei E-Rechnungen und Zahlungs-QR exakt) und bucht die Einnahme als offen.</li>
            <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> Sobald der Zahlungseingang am Kontoauszug auftaucht, wird die Rechnung automatisch als bezahlt zugeordnet.</li>
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {isTauri ? <Button variant="outline" onClick={() => navigate("/einstellungen/ordner")}><FolderOpen className="h-4 w-4" /> {outgoingFolders.length ? `Ordner verwalten (${outgoingFolders.length})` : "Ordner für Ausgangsrechnungen einrichten"}</Button> : null}
            <Button variant="ghost" onClick={() => navigate("/rechnungen")}>Importierte Rechnungen ansehen</Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
