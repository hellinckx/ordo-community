import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, CheckCircle2, Download, Loader2, MoreVertical, Share, SquarePlus } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { isIos, useInstall } from "@/lib/install";

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white">{n}</span>
      <span className="pt-1 text-[16px] leading-snug">{children}</span>
    </li>
  );
}

const Key = ({ children }: { children: ReactNode }) => <span className="inline-flex items-center gap-1 rounded-lg bg-(--surface-2) px-2 py-0.5 font-semibold">{children}</span>;

/**
 * "Ordo aufs Handy holen" – a full screen, opened from the download page on a phone (see lib/install.ts).
 * Android: one button that brings up the browser's own install dialog. iPhone: two taps in Safari, with an arrow
 * to the Teilen button. There is no app store download: Ordo installs as a web app.
 */
export function InstallApp() {
  const { open, prompt, installed, setOpen, install } = useInstall();
  const ios = isIos();
  const safari = ios && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
  // Chrome may offer the install a moment after the page is up – wait briefly before showing the menu way
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!open || ios) return;
    const t = setTimeout(() => setWaited(true), 3500);
    return () => clearTimeout(t);
  }, [open, ios]);
  if (!open) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="install-title" className="fixed inset-0 z-[90] flex flex-col overflow-y-auto bg-(--bg) px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
        <div className="flex flex-col items-center text-center">
          <Logo className="h-16 w-16" />
          <h1 id="install-title" className="mt-5 text-[26px] leading-tight font-semibold tracking-tight">Ordo aufs Handy holen</h1>
          <p className="mt-2 text-[15px] text-(--text-muted)">Ohne App Store: Ordo landet als App auf deinem Home-Bildschirm, startet im Vollbild und läuft auch ohne Internet.</p>
        </div>

        <div className="mt-9 flex-1">
          {installed ? (
            <div className="flex flex-col items-center text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-600" />
              <p className="mt-3 text-[17px] font-semibold">Fertig.</p>
              <p className="mt-1 text-[15px] text-(--text-muted)">Ordo liegt jetzt auf deinem Home-Bildschirm. Du kannst dieses Fenster schließen.</p>
            </div>
          ) : prompt ? (
            <Button size="lg" className="h-14 w-full text-[17px]" onClick={() => void install()}>
              <Download className="h-5 w-5" /> Jetzt installieren
            </Button>
          ) : ios ? (
            <ol className="space-y-5">
              {safari ? (
                <Step n={1}>Tippe unten in der Leiste auf <Key>Teilen <Share className="h-4 w-4" /></Key></Step>
              ) : (
                <Step n={1}>Tippe auf <Key>Teilen <Share className="h-4 w-4" /></Key> – in Chrome oben rechts neben der Adresse. Klappt es nicht, öffne diese Seite in Safari.</Step>
              )}
              <Step n={2}>Wähle <Key>Zum Home-Bildschirm <SquarePlus className="h-4 w-4" /></Key> (eventuell etwas nach unten scrollen) und tippe auf <Key>Hinzufügen</Key>.</Step>
            </ol>
          ) : !waited ? (
            <div className="flex items-center justify-center gap-2 text-[15px] text-(--text-muted)"><Loader2 className="h-5 w-5 animate-spin" /> Einen Moment …</div>
          ) : (
            <ol className="space-y-5">
              <Step n={1}>Tippe oben rechts auf <Key><MoreVertical className="h-4 w-4" /></Key></Step>
              <Step n={2}>Wähle <Key>App installieren</Key> oder <Key>Zum Startbildschirm hinzufügen</Key> und bestätige.</Step>
            </ol>
          )}
        </div>

        <div className="mt-8 flex flex-col items-center gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>{installed ? "Schließen" : "Lieber im Browser weiter"}</Button>
        </div>
        {safari && !installed && !prompt ? (
          <div className="pointer-events-none mt-4 flex justify-center text-brand-700 dark:text-brand-400" aria-hidden>
            <ArrowDown className="h-9 w-9 animate-bounce" />
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
