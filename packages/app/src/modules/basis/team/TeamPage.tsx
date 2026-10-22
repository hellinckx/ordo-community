import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Check, ChevronDown, Pencil, Plus, UserCheck, Users } from "lucide-react";
import { AREA_LABELS, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_MATRIX, can, ids, nowIso, type Access, type Area, type Member, type Role, type Vault } from "@ordo/core";
import { useList, useProfile, useVault } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { useInstalledModules, useMe } from "@/modules/registry";
import type { ModuleId } from "@/modules/types";
import { toast } from "@/state/toasts";
import { Badge, Button, ConfirmDialog, EmptyState, Field, FormSection, Input, Modal, MoneyInput, PageHeader, Select, Tabs, Textarea } from "@/components/ui";
import { cls, fmtMoney, fmtNumber } from "@/lib/format";
import { Avatar, AvatarPicker } from "@/components/AvatarPicker";
import { emailError, firstError, phoneError } from "@/lib/validate";
import { OWNER_PLACEHOLDER } from "./owner";

const ROLES: Role[] = ["owner", "admin", "manager", "member", "viewer"];
const COLORS = ["#0a5fe0", "#5856d6", "#0f9d8a", "#c2410c", "#be185d", "#4d7c0f", "#475569", "#a16207"];

/** Which module an area belongs to – areas of modules that are not installed are left out of the table. */
const AREA_MODULE: Record<Area, ModuleId> = {
  summa: "summa",
  projects: "projekte",
  time: "projekte",
  offers: "projekte",
  products: "produkte",
  production: "produktion",
  files: "basis",
  contacts: "basis",
  team: "basis",
  settings: "basis",
};
const AREA_ORDER: Area[] = ["contacts", "files", "summa", "projects", "time", "offers", "products", "production", "team", "settings"];

const ACCESS_LABELS: Record<Access, string> = { none: "–", read: "Ansehen", own: "Eigenes", write: "Bearbeiten", admin: "Alles" };
const ACCESS_HINTS: Record<Access, string> = {
  none: "sieht den Bereich nicht",
  read: "kann ansehen, aber nichts ändern",
  own: "ändert nur, was ihr oder ihm zugeteilt ist – eigene Zeiten, Aufgaben, Arbeitsschritte",
  write: "kann anlegen und ändern",
  admin: "kann zusätzlich löschen und einstellen",
};

/** Profile picture, or initials in the member's colour. */
export function MemberAvatar({ member, size = "md" }: { member: Pick<Member, "name" | "color"> & { avatarAttachmentId?: string }; size?: "sm" | "md" | "lg" }) {
  return <Avatar name={member.name} color={member.color} imageId={member.avatarAttachmentId} size={size} />;
}

/** Name for the first team member: the private profile's name, else the company owner, else a neutral word. */
function ownerName(vault: Vault, companyOwner?: string): string {
  const privateName = vault.profiles.find((p) => !p.deletedAt && p.mode === "employee")?.name.trim();
  return privateName || companyOwner?.trim() || vault.profiles.find((p) => !p.deletedAt && p.company.owner)?.company.owner?.trim() || OWNER_PLACEHOLDER;
}

const perHour = (c: number) => `${fmtMoney(c)}/h`;

/** /team – members, roles and rights. */
export default function TeamPage() {
  const vault = useVault();
  const profile = useProfile();
  const members = useList("members");
  const { member: me, role } = useMe();
  const canWrite = can(role, "team", "write");
  const canSeeCosts = canWrite || can(role, "summa", "read");
  const [tab, setTab] = useState<"team" | "rollen">("team");
  const [editing, setEditing] = useState<Member | null>(null);
  const [creating, setCreating] = useState(false);
  const [switchTo, setSwitchTo] = useState<Member | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [params, setParams] = useSearchParams();

  // First visit: the person using Ordo becomes the owner of the team.
  useEffect(() => {
    const store = requireStore();
    if (store.vault.members.some((m) => !m.deletedAt)) return;
    const now = nowIso();
    const m: Member = {
      id: ids.member(),
      name: ownerName(store.vault, profile.company.owner),
      email: store.vault.settings.sync.email || profile.company.email || "",
      role: "owner",
      title: "",
      hourlyCostCents: 0,
      hourlyRateCents: store.vault.settings.projects.defaultHourlyRateCents,
      weeklyHours: 40,
      color: COLORS[0]!,
      active: true,
      phone: "",
      notes: "",
      createdAt: now,
      updatedAt: now,
    };
    store.mutate(
      (v) => {
        v.members = [...v.members, m];
        v.settings = { ...v.settings, meMemberId: m.id };
      },
      { audit: { action: "member.create", entity: "members", entityId: m.id } },
    );
  }, [profile.company.owner, profile.company.email]);

  // nobody marked as "me" yet but there is exactly one owner: that's most likely the person at the keyboard
  useEffect(() => {
    if (me || !members.length) return;
    const owners = members.filter((m) => m.role === "owner" && m.active);
    if (owners.length === 1 && vault.settings.meMemberId !== owners[0]!.id) requireStore().mutate((v) => { v.settings = { ...v.settings, meMemberId: owners[0]!.id }; });
  }, [me, members, vault.settings.meMemberId]);

  useEffect(() => {
    if (params.get("neu") !== "1") return;
    if (canWrite) setCreating(true);
    const next = new URLSearchParams(params);
    next.delete("neu");
    setParams(next, { replace: true });
  }, [params, setParams, canWrite]);

  const sorted = useMemo(() => [...members].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name, "de")), [members]);
  const active = sorted.filter((m) => m.active);
  const inactive = sorted.filter((m) => !m.active);
  const weekly = active.reduce((s, m) => s + m.weeklyHours, 0);

  // cards in columns: on a wide screen the team sits side by side instead of in rows stretched across the page
  const card = (m: Member) => {
    const isMe = m.id === me?.id;
    return (
      <li key={m.id} className={cls("surface flex flex-col gap-3 p-4", isMe && "ring-1 ring-brand-600/30")}>
        <div className="flex items-start gap-3">
          <MemberAvatar member={m} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-semibold">{m.name}</span>
              {isMe ? <Badge tone="brand">Du</Badge> : null}
              {!m.active ? <Badge>nicht mehr aktiv</Badge> : null}
            </div>
            <div className="truncate text-sm text-(--text-muted)">{[m.title, ROLE_LABELS[m.role]].filter(Boolean).join(" · ")}</div>
            {m.email ? <div className="truncate text-xs text-(--text-muted)">{m.email}</div> : null}
          </div>
          {canWrite ? (
            <Button variant="ghost" size="icon" onClick={() => setEditing(m)} aria-label={`${m.name} bearbeiten`}>
              <Pencil className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <dl className="grid grid-cols-3 gap-2 rounded-xl bg-(--surface-2) px-3 py-2 text-xs">
          <div><dt className="text-(--text-muted)">Woche</dt><dd className="tabular font-medium">{fmtNumber(m.weeklyHours, m.weeklyHours % 1 ? 1 : 0)} h</dd></div>
          <div><dt className="text-(--text-muted)">Satz</dt><dd className="tabular font-medium">{m.hourlyRateCents ? perHour(m.hourlyRateCents) : "–"}</dd></div>
          <div><dt className="text-(--text-muted)">Kosten</dt><dd className="tabular font-medium">{canSeeCosts && m.hourlyCostCents ? perHour(m.hourlyCostCents) : "–"}</dd></div>
        </dl>
        {!isMe && m.active ? (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setSwitchTo(m)} title="Ordo als diese Person benutzen">
            <UserCheck className="h-3.5 w-3.5" /> Das bin ich
          </Button>
        ) : null}
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team"
        subtitle="Wer bei dir mitarbeitet – mit Rolle, Stundensätzen und Wochenstunden. Eigene Zugänge für jede Person kommen später; heute verwaltest du hier Team, Rollen, Sätze und Zuständigkeiten."
        actions={canWrite ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Person</Button> : null}
      />

      <Tabs tabs={[{ id: "team", label: "Team" }, { id: "rollen", label: "Rollen & Rechte" }]} value={tab} onChange={setTab} className="w-fit" />

      {tab === "team" ? (
        <div className="space-y-4">
          {me && me.name === OWNER_PLACEHOLDER && canWrite ? (
            <div className="surface flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="flex-1">Wie heißt du? Mit deinem Namen begrüßt dich Ordo und weiß, wem Aufgaben gehören.</span>
              <Button size="sm" onClick={() => setEditing(me)}>Namen eintragen</Button>
            </div>
          ) : null}
          {active.length ? (
            <>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{active.map(card)}</ul>
              <p className="text-xs text-(--text-muted)">
                {active.length} {active.length === 1 ? "Person" : "Personen"} · zusammen {fmtNumber(weekly, weekly % 1 ? 1 : 0)} Stunden pro Woche. „Das bin ich“ legt fest, wer Ordo gerade benutzt – danach richten sich Rechte, „Meine Aufgaben“ und die Stoppuhr.
              </p>
            </>
          ) : (
            <EmptyState icon={<Users className="h-8 w-8" />} title="Noch niemand im Team" body="Leg die Personen an, die bei dir mitarbeiten – dann kannst du Aufgaben zuteilen und Zeiten mit den richtigen Sätzen rechnen." action={canWrite ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Person anlegen</Button> : undefined} />
          )}
          {inactive.length ? (
            <div>
              <button type="button" onClick={() => setShowInactive((s) => !s)} className="flex items-center gap-1 text-sm font-medium text-(--text-muted) hover:text-(--text)">
                <ChevronDown className={cls("h-4 w-4 transition-transform", !showInactive && "-rotate-90")} />
                Nicht mehr aktiv ({inactive.length})
              </button>
              {showInactive ? (
                <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{inactive.map(card)}</ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <RolesView myRole={role} members={active} />
      )}

      <MemberDialog open={creating || !!editing} member={editing ?? undefined} onClose={() => { setCreating(false); setEditing(null); }} />
      <ConfirmDialog
        open={!!switchTo}
        onClose={() => setSwitchTo(null)}
        title={switchTo ? `Du bist ${switchTo.name}?` : ""}
        body={switchTo ? `Ordo zeigt dir dann, was die Rolle „${ROLE_LABELS[switchTo.role]}“ darf, und „Meine Aufgaben“ und die Stoppuhr gehören zu ${switchTo.name.split(/\s+/)[0]}. Zurückwechseln kannst du hier jederzeit.` : ""}
        confirmLabel="Ja, das bin ich"
        onConfirm={() => {
          if (!switchTo) return;
          requireStore().mutate((v) => { v.settings = { ...v.settings, meMemberId: switchTo.id }; });
          toast.success(`Hallo ${switchTo.name.split(/\s+/)[0]}`);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roles & rights                                                      */
/* ------------------------------------------------------------------ */

function AccessCell({ access }: { access: Access }) {
  if (access === "none") return <span className="text-(--text-muted)">–</span>;
  return (
    <span className={cls("inline-flex items-center gap-1.5 whitespace-nowrap", access === "admin" ? "font-medium text-brand-700 dark:text-brand-400" : access === "write" ? "text-(--text)" : "text-(--text-muted)")}>
      <span className={cls("h-1.5 w-1.5 rounded-full", access === "admin" ? "bg-brand-600" : access === "write" ? "bg-brand-400" : access === "own" ? "bg-slate-400" : "border border-slate-400")} />
      {ACCESS_LABELS[access]}
    </span>
  );
}

function RolesView({ myRole, members }: { myRole: Role; members: Member[] }) {
  const installed = useInstalledModules();
  const areas = AREA_ORDER.filter((a) => installed.some((m) => m.id === AREA_MODULE[a]));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ROLES.map((r) => {
          const people = members.filter((m) => m.role === r);
          return (
            <div key={r} className={cls("surface p-4", r === myRole && "ring-1 ring-brand-600/40")}>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{ROLE_LABELS[r]}</span>
                {r === myRole ? <Badge tone="brand">deine Rolle</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-(--text-muted)">{ROLE_DESCRIPTIONS[r]}</p>
              <div className="mt-2 text-xs text-(--text-muted)">{people.length ? people.map((m) => m.name).join(", ") : "Niemand"}</div>
            </div>
          );
        })}
      </div>

      <section className="surface">
        <header className="border-b border-(--glass-border) px-5 py-3">
          <h3 className="text-[14px] font-semibold tracking-tight">Wer darf was</h3>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)">
              <tr>
                <th className="px-4 py-2">Bereich</th>
                {ROLES.map((r) => (
                  <th key={r} className={cls("px-3 py-2", r === myRole && "text-brand-700 dark:text-brand-400")}>{ROLE_LABELS[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-(--border)">
              {areas.map((a) => (
                <tr key={a}>
                  <td className="px-4 py-2 font-medium">{AREA_LABELS[a]}</td>
                  {ROLES.map((r) => (
                    <td key={r} className={cls("px-3 py-2", r === myRole && "bg-brand-50/50 dark:bg-brand-950/30")}>
                      <AccessCell access={ROLE_MATRIX[r][a]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="grid gap-1.5 border-t border-(--border) px-5 py-3 text-xs text-(--text-muted) sm:grid-cols-2">
          {(["read", "own", "write", "admin"] as Access[]).map((a) => (
            <li key={a} className="flex items-start gap-2">
              <span className="w-20 shrink-0"><AccessCell access={a} /></span>
              <span>{ACCESS_HINTS[a]}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-xs text-(--text-muted)">Atlas, der Assistent, hat nie mehr Rechte als die Person, die ihn gerade benutzt.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add / edit                                                          */
/* ------------------------------------------------------------------ */

function MemberDialog({ open, onClose, member }: { open: boolean; onClose: () => void; member?: Member }) {
  const vault = useVault();
  const members = useList("members");
  const { member: me, role: myRole } = useMe();
  const blank = (): Member => {
    const now = nowIso();
    const used = new Set(members.map((m) => m.color));
    return { id: ids.member(), name: "", email: "", role: "member", title: "", hourlyCostCents: 0, hourlyRateCents: vault.settings.projects.defaultHourlyRateCents, weeklyHours: 38.5, color: COLORS.find((c) => !used.has(c)) ?? COLORS[members.length % COLORS.length]!, active: true, phone: "", notes: "", createdAt: now, updatedAt: now };
  };
  const [v, setV] = useState<Member>(() => member ?? blank());
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  useEffect(() => {
    if (open) {
      setV(member ?? blank());
      setTried(false);
    }
  }, [open, member]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Member>) => setV((x) => ({ ...x, ...p }));

  const isSelf = !!member && member.id === me?.id;
  const otherActiveOwners = members.filter((m) => m.role === "owner" && m.active && m.id !== member?.id).length;
  const lastOwner = member?.role === "owner" && otherActiveOwners === 0;
  const mayGrantOwner = can(myRole, "team", "admin");
  const roleLocked = isSelf || lastOwner || (member?.role === "owner" && !mayGrantOwner);
  const roleOptions = ROLES.filter((r) => r !== "owner" || mayGrantOwner || member?.role === "owner");

  const [tried, setTried] = useState(false);
  const errors = { email: emailError(v.email), phone: phoneError(v.phone), hours: v.weeklyHours > 80 ? "Höchstens 80 Stunden." : undefined };
  const save = () => {
    setTried(true);
    if (!v.name.trim()) {
      toast.warning("Name fehlt.");
      return;
    }
    const problem = firstError(errors);
    if (problem) {
      toast.warning("Bitte prüfen", problem);
      return;
    }
    const store = requireStore();
    const clean = { ...v, name: v.name.trim(), title: v.title.trim(), email: v.email.trim() };
    if (member) store.update("members", member.id, clean, "member.update");
    else store.insert("members", clean, "member.create");
    onClose();
  };
  const setActive = (activeNow: boolean) => {
    if (!member) return;
    requireStore().update("members", member.id, { active: activeNow }, activeNow ? "member.activate" : "member.deactivate");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={member ? `${member.name} bearbeiten` : "Neue Person"}
      size="lg"
      footer={
        <>
          {member && !isSelf && !lastOwner ? (
            member.active ? (
              <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setConfirmDeactivate(true)}>Deaktivieren</Button>
            ) : (
              <Button variant="ghost" className="mr-auto" onClick={() => setActive(true)}>Wieder aktivieren</Button>
            )
          ) : null}
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button onClick={save}>Speichern</Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormSection title="Person">
          <div className="sm:col-span-2">
            <AvatarPicker name={v.name} color={v.color} imageId={v.avatarAttachmentId} onChange={(id) => set({ avatarAttachmentId: id })} label="Profilbild" />
          </div>
          <Field label="Name" required error={tried && !v.name.trim() ? "Bitte einen Namen eintragen." : undefined}>
            <Input autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="Vor- und Nachname" />
          </Field>
          <Field label="Funktion" hint="z. B. Projektleitung, Werkstatt, Büro">
            <Input value={v.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Rolle" hint={roleLocked ? (isSelf ? "Deine eigene Rolle ändert jemand anderes mit Rechten." : lastOwner ? "Es braucht immer mindestens eine Inhaberin oder einen Inhaber." : ROLE_DESCRIPTIONS[v.role]) : ROLE_DESCRIPTIONS[v.role]} className="sm:col-span-2">
            <Select value={v.role} disabled={roleLocked} onChange={(e) => set({ role: e.target.value as Role })}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
        </FormSection>
        <FormSection title="Erreichbar">
          <Field label="E-Mail" error={errors.email}>
            <Input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} placeholder="z. B. name@firma.at" />
          </Field>
          <Field label="Telefon" error={errors.phone}>
            <Input type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="z. B. +43 664 1234567" />
          </Field>
        </FormSection>
        <FormSection title="Zeit & Sätze" hint="Für Projektkosten, Marge und verrechnete Zeiten." cols={3}>
          <Field label="Stunden pro Woche" error={errors.hours}>
            <Input type="number" inputMode="decimal" min={0} max={80} step={0.5} value={String(v.weeklyHours)} onChange={(e) => set({ weeklyHours: Math.max(0, Number(e.target.value.replace(",", ".")) || 0) })} />
          </Field>
          <Field label="Interne Kosten pro Stunde" hint="Lohn samt Nebenkosten.">
            <MoneyInput value={v.hourlyCostCents} onChange={(c) => set({ hourlyCostCents: c ?? 0 })} />
          </Field>
          <Field label="Stundensatz für Kunden" hint="Netto, als Vorschlag.">
            <MoneyInput value={v.hourlyRateCents} onChange={(c) => set({ hourlyRateCents: c ?? 0 })} />
          </Field>
        </FormSection>
        <FormSection title="Darstellung & Notizen" cols={1}>
          <Field label="Farbe" hint="Für Zeitplan, Zuteilungen und das Bild ohne Foto.">
            <div className="flex flex-wrap items-center gap-1.5">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => set({ color: c })} className="flex h-7 w-7 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-(--surface) focus-visible:ring-2" style={{ background: c }} aria-label={`Farbe ${c}`} aria-pressed={v.color === c}>
                  {v.color === c ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Notizen">
            <Textarea rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </FormSection>
      </div>
      <ConfirmDialog
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        danger
        title={`${v.name} deaktivieren?`}
        body="Bleibt in bisherigen Projekten und Zeiten sichtbar, taucht aber bei neuen Zuteilungen nicht mehr auf. Du kannst die Person jederzeit wieder aktivieren."
        confirmLabel="Deaktivieren"
        onConfirm={() => setActive(false)}
      />
    </Modal>
  );
}
