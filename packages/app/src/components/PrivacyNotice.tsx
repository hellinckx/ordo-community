import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { isTauri } from "@/platform";
import { Button } from "@/components/ui";
import { legalPage, openExternal } from "@/components/LegalLinks";
import { cls } from "@/lib/format";

// storage key kept from the Ordo days, so people who already saw the notice are not asked again
const KEY = "summa.privacyNoticeSeen";

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * One-time notice for the web version. Ordo sets no cookies and runs no tracking, so there is nothing to
 * consent to – this just says so and links the privacy policy. The desktop app never shows it.
 */
export function PrivacyNotice({ sidebar, noNav }: { /** leave room for the desktop sidebar */ sidebar?: boolean; /** screens without the mobile bottom navigation */ noNav?: boolean }) {
  const [open, setOpen] = useState(() => !isTauri && !seen());
  if (!open) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode – just hide for this session */
    }
    setOpen(false);
  };
  const privacy = legalPage("Datenschutz");
  return (
    <div role="region" aria-label="Datenschutz-Hinweis" className={cls("animate-slide-up fixed left-4 right-4 z-40 rounded-2xl border border-(--border) bg-(--surface) p-4 shadow-pop sm:right-auto sm:max-w-md", noNav ? "bottom-4" : "bottom-20 lg:bottom-4", sidebar && "lg:left-[18rem]")}>
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">Keine Cookies, kein Tracking – wir sammeln keine Daten.</div>
          <p className="mt-0.5 text-(--text-muted)">Ordo speichert nur technisch nötige Daten lokal in deinem Browser – verschlüsselt. Nichts verlässt dein Gerät, außer du schaltest Sync, eine eigene Datenbank, Schnittstellen, KI oder Atlas selbst ein. Bei uns kommt nur an, was du selbst abschickst.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={dismiss}>Verstanden</Button>
            {privacy ? <a href={privacy.href} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); openExternal(privacy.href); }} className="text-sm text-brand-700 hover:underline dark:text-brand-300">Datenschutzerklärung</a> : null}
          </div>
        </div>
        <button type="button" onClick={dismiss} className="rounded-md p-1 text-(--text-muted) hover:text-(--text)" aria-label="Schließen"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
