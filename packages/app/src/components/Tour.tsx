import { useEffect, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { create } from "zustand";
import { ArrowLeft, ArrowRight, Blocks, Boxes, Camera, CheckCircle2, Cloud, Factory, FileSearch, FileText, Fingerprint, FolderKanban, FolderOpen, KeyRound, LayoutGrid, MessageCircle, Scale, ShieldCheck, Sparkles, SquarePen, Upload, X } from "lucide-react";
import { useSession } from "@/state/session";
import { useProfile } from "@/state/hooks";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui";
import { cls } from "@/lib/format";
import { isMobile, isTauri } from "@/platform";

interface TourState {
  open: boolean;
  step: number;
  start(): void;
  close(): void;
  go(step: number): void;
}

export const useTour = create<TourState>((set) => ({
  open: false,
  step: 0,
  start: () => set({ open: true, step: 0 }),
  close: () => set({ open: false }),
  go: (step) => set({ step }),
}));

interface Step {
  id: string;
  icon: ReactNode;
  eyebrow: string;
  title: string;
  body: ReactNode;
  points?: { icon: ReactNode; text: ReactNode }[];
  cta?: { label: string; to: string };
}

/** Bump when the tour changes so that everybody sees the new one once (2 = Ordo intro). */
export const TOUR_VERSION = 2;

function markDone() {
  const store = useSession.getState().store;
  const s = store?.vault.settings;
  if (store && s && (!s.tourDone || s.tourVersion < TOUR_VERSION)) store.mutate((v) => { v.settings = { ...v.settings, tourDone: true, tourVersion: TOUR_VERSION }; });
}

/** Opens the tour automatically once after the first unlock. */
export function useAutoTour() {
  const status = useSession((s) => s.status);
  const tourDone = useSession((s) => !!s.vault?.settings.tourDone && (s.vault?.settings.tourVersion ?? 0) >= TOUR_VERSION);
  const onboardingDone = useSession((s) => s.vault?.settings.onboardingDone);
  useEffect(() => {
    if (status === "unlocked" && onboardingDone && tourDone === false && !useTour.getState().open) {
      const t = setTimeout(() => useTour.getState().start(), 600);
      return () => clearTimeout(t);
    }
  }, [status, tourDone, onboardingDone]);
}

/** The Ordo mark drawn in white only (ring with a planet on its orbit), for the solid blue tour header. */
function OrdoMarkWhite({ className }: { className?: string }) {
  return (
    <svg viewBox="14 14 36 36" aria-hidden="true" className={className}>
      <path d="M45.7 27.26A14.5 14.5 0 1 1 36.74 18.3" fill="none" stroke="#fff" strokeWidth="5.5" />
      <circle cx="42.25" cy="21.75" r="4.25" fill="#fff" />
    </svg>
  );
}

const pt = (icon: ReactNode, text: ReactNode) => ({ icon, text });

/**
 * Welcome tour: Willkommen → Rechnungen (Ordo) → Atlas → Add-ons → Sicherheit → Fertig.
 * One accent colour throughout; module tints stay on the module tiles elsewhere in the app.
 */
export function Tour() {
  const atlasReady = useSession((st) => !!st.vault && st.vault.settings.atlas.provider !== "none" && st.vault.settings.atlas.consent);
  const { open, step, close, go } = useTour();
  const profile = useProfile();
  const navigate = useNavigate();
  const isBusiness = profile.mode === "business";

  const steps: Step[] = useMemo(
    () => [
      {
        id: "welcome",
        icon: <OrdoMarkWhite className="h-10 w-10" />,
        eyebrow: "Willkommen",
        title: "Willkommen bei Ordo",
        body: (
          <>
            {isBusiness
              ? "Ordo hält deine Firma an einem Ort zusammen: Rechnungen, Buchhaltung und, wenn du willst, Projekte und Lager."
              : "Ordo sammelt deine Rechnungen und bereitet deine Arbeitnehmerveranlagung vor."}{" "}
            In zwei Minuten siehst du, wie es geht. Du kannst jederzeit überspringen und die Tour später unter Einstellungen → Über wieder starten.
          </>
        ),
        points: [
          pt(<LayoutGrid className="h-4 w-4" />, "Die Übersicht zeigt dir, was ansteht – aus allen Bereichen."),
          pt(<Sparkles className="h-4 w-4" />, "Atlas beantwortet Fragen und erledigt Arbeit für dich."),
          pt(<ShieldCheck className="h-4 w-4" />, "Alles bleibt verschlüsselt auf deinem Gerät."),
        ],
      },
      {
        id: "summa",
        icon: <Logo className="h-14 w-14" />,
        eyebrow: "Ordo · Buchhaltung",
        title: "Rechnungen rein, Steuern raus",
        body: isBusiness
          ? "Ordo liest Rechnungen und Kassenbons, bucht Eindeutiges von selbst und rechnet Umsatzsteuer-Voranmeldung und Gewinn laufend mit."
          : "Ordo liest Rechnungen und Kassenbons, bucht Eindeutiges von selbst und sammelt alles, was du bei der Arbeitnehmerveranlagung absetzen kannst.",
        points: [
          pt(<Upload className="h-4 w-4" />, "Datei ins Fenster ziehen – PDF, Foto, Scan oder Excel."),
          isTauri
            ? pt(<FolderOpen className="h-4 w-4" />, "Oder einen Ordner verbinden, etwa OneDrive oder den Scanner-Ordner. Neue Dateien holt Ordo dann selbst.")
            : pt(<Camera className="h-4 w-4" />, isMobile ? "Kassenbons fotografierst du direkt mit der Kamera." : "Am Handy fotografierst du Kassenbons direkt mit der Kamera."),
          isBusiness
            ? pt(<FileText className="h-4 w-4" />, "Rechnungen an Kunden schreibst du in Ordo oder holst sie aus deinem bisherigen Programm.")
            : pt(<FileSearch className="h-4 w-4" />, "Nur wenn Ordo unsicher ist, legt es dir die Rechnung zum Prüfen vor."),
          pt(
            <Scale className="h-4 w-4" />,
            isBusiness ? "UVA und E 1a sind laufend fertig – jeder Wert mit Kopierknopf für FinanzOnline." : "Werbungskosten und Sonderausgaben landen bei den richtigen Kennzahlen für die L 1.",
          ),
        ],
        cta: { label: "Zu den Rechnungen", to: "/belege" },
      },
      {
        id: "atlas",
        icon: <Sparkles className="h-10 w-10" />,
        eyebrow: "Atlas · Assistent",
        title: "Frag Atlas",
        body: "Atlas kennt deine Daten in Ordo. Frag in deinen eigenen Worten oder gib ihm einen Auftrag.",
        points: [
          pt(<MessageCircle className="h-4 w-4" />, "„Was ist diese Woche noch offen?“ – Atlas antwortet mit deinen Zahlen."),
          pt(<SquarePen className="h-4 w-4" />, "Er legt Einträge an und ändert sie für dich. Vorher fragt er nach, und er hat nie mehr Rechte als du."),
          pt(
            <KeyRound className="h-4 w-4" />,
            <>Du wählst den Anbieter: Claude mit eigenem API-Key{isTauri ? " oder ChatGPT über Codex" : ""}. Erst mit deiner Zustimmung gehen Daten an ihn.</>,
          ),
        ],
        cta: atlasReady ? { label: "Atlas öffnen", to: "/atlas" } : { label: "Jetzt KI verbinden", to: "/einstellungen/atlas" },
      },
      {
        id: "modules",
        icon: <Blocks className="h-10 w-10" />,
        eyebrow: "Add-ons",
        title: isBusiness ? "Nimm dazu, was du brauchst" : "Mehr, wenn du es brauchst",
        body: isBusiness ? (
          <>Die Buchhaltung ist immer dabei. Optionale Add-ons fügst du unter <strong className="text-(--text)">Add-ons</strong> mit einem Klick hinzu und entfernst sie genauso wieder – deine Daten bleiben erhalten.</>
        ) : (
          <>Für ein Firmen-Profil gibt es weitere Add-ons. Du findest sie unter <strong className="text-(--text)">Add-ons</strong>, sobald du ein Firmen-Profil anlegst.</>
        ),
        points: [
          pt(<FolderKanban className="h-4 w-4" />, <><strong>Projekte &amp; Zeiterfassung</strong> – Aufgaben, Meilensteine, Stoppuhr und Angebote.</>),
          pt(<Boxes className="h-4 w-4" />, <><strong>Produkte &amp; Lager</strong> – Artikel, Preise, Bestand und Inventur.</>),
          pt(<Factory className="h-4 w-4" />, <><strong>Produktion</strong> – Stücklisten und Fertigungsaufträge. Braucht Produkte &amp; Lager.</>),
        ],
        cta: { label: "Add-ons ansehen", to: "/module" },
      },
      {
        id: "security",
        icon: <ShieldCheck className="h-10 w-10" />,
        eyebrow: "Sicherheit",
        title: "Deine Daten gehören dir",
        body: "Alles liegt in einem Tresor, verschlüsselt mit deinem Passwort. Mit Konto setzt du ein vergessenes Passwort per E-Mail-Code zurück; ohne Konto bleibt alles nur auf diesem Gerät.",
        points: [
          pt(<Fingerprint className="h-4 w-4" />, "Entsperren mit Windows Hello oder Fingerabdruck: Einstellungen → Sicherheit."),
          pt(<Cloud className="h-4 w-4" />, "Mit Konto bleiben Computer, Browser und Handy verschlüsselt auf demselben Stand."),
        ],
        cta: { label: "Sicherheit einstellen", to: "/einstellungen/sicherheit" },
      },
      {
        id: "done",
        icon: <CheckCircle2 className="h-10 w-10" />,
        eyebrow: "Fertig",
        title: "Das war's schon",
        body: "Am schnellsten geht es mit deiner ersten Rechnung.",
      },
    ],
    [isBusiness, atlasReady],
  );

  const finish = () => {
    markDone();
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") go(Math.min(steps.length - 1, step + 1));
      if (e.key === "ArrowLeft") go(Math.max(0, step - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const s = steps[Math.min(step, steps.length - 1)]!;
  const last = step >= steps.length - 1;
  const pickFiles = async () => {
    finish();
    const platform = useSession.getState().platform!;
    const files = await platform.pickFiles({ multiple: true });
    if (files.length) {
      const { importFiles } = await import("@/services/importer");
      importFiles(files, "upload");
      navigate("/belege");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal aria-label="Einführung">
      <div key={s.id} className="animate-pop-in flex max-h-[96vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-(--surface) shadow-pop sm:rounded-3xl">
        <div className="flex items-end gap-4 bg-brand-700 px-6 pt-6 pb-5 text-white">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">{s.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-white/80">{s.eyebrow}</div>
            <h2 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">{s.title}</h2>
          </div>
          <button onClick={finish} className="self-start rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white" aria-label="Tour schließen"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <p className="text-[15px] leading-relaxed text-(--text-muted)">{s.body}</p>
          {s.points?.length ? (
            <ul className="mt-4 space-y-2.5">
              {s.points.map((p, i) => (
                <li key={i} className="flex gap-3 text-sm"><span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">{p.icon}</span><span className="pt-1">{p.text}</span></li>
              ))}
            </ul>
          ) : null}
          {last ? (
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Button onClick={() => void pickFiles()} className="justify-center"><Upload className="h-4 w-4" /> Erste Rechnung hinzufügen</Button>
              {isTauri ? <Button variant="outline" className="justify-center" onClick={() => { finish(); navigate("/einstellungen/ordner"); }}><FolderOpen className="h-4 w-4" /> Ordner einrichten</Button> : <Button variant="outline" className="justify-center" onClick={() => { finish(); navigate("/einstellungen/profil"); }}>{isBusiness ? "Firmendaten ergänzen" : "Profil ergänzen"}</Button>}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3 border-t border-(--border) px-6 py-3">
          <div className="flex flex-1 items-center gap-1.5" aria-label={`Schritt ${step + 1} von ${steps.length}`}>
            {steps.map((st, i) => (
              <button key={st.id} onClick={() => go(i)} className={cls("h-1.5 rounded-full transition-all", i === step ? "w-6 bg-brand-600" : i < step ? "w-1.5 bg-brand-300" : "w-1.5 bg-(--border)")} aria-label={`Zu Schritt ${i + 1}`} />
            ))}
            <span className="ml-2 text-xs text-(--text-muted) tabular">{step + 1}/{steps.length}</span>
          </div>
          {!last ? <button onClick={finish} className="text-sm text-(--text-muted) hover:text-(--text)">Überspringen</button> : null}
          {s.cta && !last ? <Button variant="ghost" size="sm" onClick={() => { finish(); navigate(s.cta!.to); }}>{s.cta.label}</Button> : null}
          {step > 0 ? <Button variant="outline" size="sm" onClick={() => go(step - 1)} aria-label="Zurück"><ArrowLeft className="h-4 w-4" /></Button> : null}
          {!last ? <Button size="sm" onClick={() => go(step + 1)}>Weiter <ArrowRight className="h-4 w-4" /></Button> : <Button size="sm" onClick={finish}>Los geht's</Button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
