import type { ReactNode } from "react";
import { SUMMA_SITE_URL } from "@/config";
import { OPERATOR } from "@/operator/config";
import { isTauri } from "@/platform";
import { useSession } from "@/state/session";
import { cls } from "@/lib/format";

/** The project website (landing page, documentation of the interfaces). */
export const SITE_URL = SUMMA_SITE_URL;

/** Legal pages of whoever runs this Ordo – none in the community edition, where nobody operates a service. */
export const LEGAL_PAGES = OPERATOR.legalPages;
export const legalPage = (label: "Impressum" | "Datenschutz" | "Nutzungsbedingungen") => LEGAL_PAGES.find((p) => p.label === label) ?? null;

export function openExternal(href: string) {
  const platform = useSession.getState().platform;
  if (platform) void platform.openUrl(href);
  else window.open(href, "_blank", "noopener,noreferrer");
}

/** The Ordo logo as a way back to the website: same tab in the browser, the default browser in the desktop app. */
export function WebsiteLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <a href={SITE_URL} className={className} title="Zur Ordo-Website" aria-label="Ordo – zur Website" onClick={isTauri ? (e) => { e.preventDefault(); openExternal(SITE_URL); } : undefined}>
      {children}
    </a>
  );
}

/** Impressum · Datenschutz · Nutzungsbedingungen – required on every screen of a public service. */
export function LegalLinks({ className, light }: { className?: string; light?: boolean }) {
  if (!LEGAL_PAGES.length) return null;
  return (
    <nav className={cls("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", light ? "text-white/50" : "text-(--text-muted)", className)} aria-label="Rechtliches">
      {LEGAL_PAGES.map((p) => (
        <a key={p.href} href={p.href} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); openExternal(p.href); }} className={cls("hover:underline", light ? "hover:text-white/80" : "hover:text-(--text)")}>
          {p.label}
        </a>
      ))}
    </nav>
  );
}
