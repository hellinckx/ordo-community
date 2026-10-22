import { useState } from "react";
import { useNavigate } from "react-router";
import { Briefcase, Check, ChevronDown, CloudOff, Cloud, Globe, Lock, LogOut, MessageSquarePlus, Moon, Plus, Settings as SettingsIcon, Sun, User, UserRound, Vote } from "lucide-react";
import { useProfile, useVault } from "@/state/hooks";
import { useSession } from "@/state/session";
import { useSync } from "@/services/sync";
import { signOut } from "@/services/account";
import { Badge, Button, ConfirmDialog } from "@/components/ui";
import { cls } from "@/lib/format";
import { isTauri } from "@/platform";
import { MAX_PROFILES, SUMMA_SITE_URL } from "@/config";
import { openExternal } from "@/components/LegalLinks";
import { PARTS } from "@/operator";
import { Avatar } from "@/components/AvatarPicker";
import { useAddProfileDialog } from "@/components/AddProfileDialog";

function initials(s: string): string {
  const parts = s.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "S") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Avatar menu top right: who am I, which profile (private / company) is open, account, settings, lock and sign out. */
export function AccountMenu() {
  const vault = useVault();
  const profile = useProfile();
  const navigate = useNavigate();
  const session = useSync((s) => s.session);
  const plan = useSync((s) => s.plan);
  const syncStatus = useSync((s) => s.status);
  const [open, setOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const email = vault.settings.sync.email || session?.user.email || "";
  const profileName = (p: typeof profile) => p.company.name || p.name;
  // the avatar stands for the person, not the active company: name of the private profile, else the active one
  const personName = vault.profiles.find((p) => !p.deletedAt && p.mode === "employee")?.name || profileName(profile);
  const profiles = vault.profiles.filter((p) => !p.deletedAt);
  // the person's own profile picture (Team → Profilbild), if there is one
  const avatarId = vault.members.find((m) => m.id === vault.settings.meMemberId && !m.deletedAt)?.avatarAttachmentId;
  const dark = document.documentElement.dataset.theme === "dark";
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  const toggleTheme = () => useSession.getState().store?.mutate((v) => { v.settings = { ...v.settings, theme: dark ? "light" : "dark" }; });
  const item = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-(--surface-2)";
  const muted = "h-4 w-4 text-(--text-muted)";
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 transition-colors hover:bg-(--surface-2)" aria-label="Konto und Profile" aria-expanded={open}>
        {avatarId ? <Avatar name={personName} imageId={avatarId} size="sm" square className="h-8 w-8 rounded-lg" /> : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-xs font-semibold text-white">{initials(personName)}</span>}
        <span className="hidden max-w-48 truncate text-sm font-medium md:block">{profileName(profile)}</span>
        <ChevronDown className="hidden h-4 w-4 text-(--text-muted) sm:block" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="glass-strong animate-pop-in absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-[22px] shadow-pop">
            <div className="flex items-center gap-3 p-4">
              {avatarId ? <Avatar name={personName} imageId={avatarId} square className="h-11 w-11" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-sm font-semibold text-white">{initials(personName)}</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{personName}</div>
                <div className="truncate text-xs text-(--text-muted)">{email || "Nur auf diesem Gerät – kein Konto"}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {email ? (session ? <Badge tone="success"><Cloud className="mr-1 inline h-3 w-3" />{syncStatus === "syncing" ? "gleicht ab …" : "abgeglichen"}</Badge> : <Badge tone="warning"><CloudOff className="mr-1 inline h-3 w-3" />Bestätigung offen</Badge>) : null}
                  {email ? <Badge tone="neutral">{plan === "free" ? "Free" : plan === "pro" ? "Pro" : "Family"}</Badge> : null}
                </div>
              </div>
            </div>
            <div className="border-t border-(--glass-border) p-2">
              <div className="px-3 pt-1 pb-1.5 text-xs font-medium text-(--text-muted)">{profiles.length > 1 ? "Profil wechseln" : "Profil"}</div>
              {profiles.map((p) => (
                <button key={p.id} className={item} onClick={() => { useSession.getState().store?.setActiveProfile(p.id); setOpen(false); }}>
                  <span className={cls("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", p.id === profile.id ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "bg-(--surface-2) text-(--text-muted)")}>{p.mode === "business" ? <Briefcase className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{profileName(p)}</span>
                    <span className="block text-xs text-(--text-muted)">{p.mode === "business" ? "Firma" : "Privat"}</span>
                  </span>
                  {p.id === profile.id ? <Check className="h-4 w-4 text-brand-700 dark:text-brand-400" /> : null}
                </button>
              ))}
              {profiles.length < MAX_PROFILES ? <button className={cls(item, "text-(--text-muted)")} onClick={() => { setOpen(false); useAddProfileDialog.getState().show(); }}><span className="flex h-7 w-7 items-center justify-center"><Plus className="h-4 w-4" /></span>Profil hinzufügen</button> : null}
            </div>
            <div className="border-t border-(--glass-border) p-2">
              <button className={item} onClick={() => go("/einstellungen/konto")}><UserRound className={muted} />{email ? "Mein Konto" : "Konto erstellen"}</button>
              <button className={item} onClick={() => go("/einstellungen/profil")}><Briefcase className={muted} />{profile.mode === "business" ? "Firmendaten" : "Meine Daten"}</button>
              <button className={item} onClick={() => go("/einstellungen")}><SettingsIcon className={muted} />Einstellungen</button>
              <button className={item} onClick={toggleTheme}>{dark ? <Sun className={muted} /> : <Moon className={muted} />}{dark ? "Helles Design" : "Dunkles Design"}</button>
              {PARTS.FeedbackButton ? <button className={item} onClick={() => { setOpen(false); document.querySelector<HTMLButtonElement>("[aria-label='Feedback geben']")?.click(); }}><MessageSquarePlus className={muted} />Feedback senden</button> : null}
              {PARTS.plansPath ? <button className={item} onClick={() => go(PARTS.plansPath!)}><Vote className={muted} />Pläne &amp; Abstimmung</button> : null}
              {/* out of the app to the website: same tab in the browser, the system browser on the desktop */}
              <button className={item} onClick={() => { setOpen(false); if (isTauri) openExternal(SUMMA_SITE_URL); else location.href = SUMMA_SITE_URL; }}><Globe className={muted} />Zur Website</button>
            </div>
            <div className="border-t border-(--glass-border) p-2">
              <button className={item} onClick={() => { setOpen(false); void useSession.getState().lock(); }}><Lock className={muted} />Sperren <span className="ml-auto text-[11px] text-(--text-muted)">Strg+L</span></button>
              <button className={cls(item, "text-red-600 dark:text-red-400")} onClick={() => { setOpen(false); setConfirmOut(true); }}><LogOut className="h-4 w-4" />Abmelden</button>
            </div>
          </div>
        </>
      ) : null}
      <ConfirmDialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        title="Abmelden"
        body={email ? `Du wirst von ${email} abgemeldet.${isTauri ? "" : " Auf einem fremden oder geteilten Computer entferne die Daten von diesem Gerät – sie bleiben in deinem Konto."}` : "Ohne Konto heißt Abmelden: Ordo wird gesperrt. Deine Daten bleiben verschlüsselt auf diesem Gerät."}
        confirmLabel="Abmelden"
        onConfirm={() => void signOut({ removeFromDevice: false })}
        extra={email ? <Button variant="outline" className="text-red-600" onClick={() => { setConfirmOut(false); void signOut({ removeFromDevice: true }); }}>Abmelden &amp; vom Gerät entfernen</Button> : undefined}
      />
    </div>
  );
}
