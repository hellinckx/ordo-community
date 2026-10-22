import { Download, MoreVertical, Share, SquarePlus } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Modal } from "@/components/ui";
import { isIos, useInstall } from "@/lib/install";

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{n}</span>
      <span className="pt-0.5 text-sm">{children}</span>
    </li>
  );
}

/** "Ordo als App installieren" – opened from the download page on a phone (see lib/install.ts). */
export function InstallApp() {
  const { open, prompt, setOpen, install } = useInstall();
  const ios = isIos();
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Ordo als App aufs Handy holen"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>Im Browser weiter</Button>
          {prompt ? <Button onClick={() => void install()}><Download className="h-4 w-4" /> Installieren</Button> : null}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-(--text-muted)">Als App startet Ordo vom Home-Bildschirm, im Vollbild und auch ohne Internet. Kassabons fotografierst du direkt mit der Kamera.</p>
        {prompt ? (
          <p className="text-sm">Tippe auf <span className="font-medium">Installieren</span>, und Ordo liegt in ein paar Sekunden auf deinem Home-Bildschirm.</p>
        ) : ios ? (
          <ol className="space-y-3">
            <Step n={1}>Tippe in Safari unten auf <span className="inline-flex items-center gap-1 font-medium">Teilen <Share className="h-4 w-4" /></span>.</Step>
            <Step n={2}>Wähle <span className="inline-flex items-center gap-1 font-medium">Zum Home-Bildschirm <SquarePlus className="h-4 w-4" /></span>.</Step>
            <Step n={3}>Tippe rechts oben auf <span className="font-medium">Hinzufügen</span>.</Step>
          </ol>
        ) : (
          <ol className="space-y-3">
            <Step n={1}>Öffne das Menü deines Browsers <MoreVertical className="inline h-4 w-4" />.</Step>
            <Step n={2}>Wähle <span className="font-medium">App installieren</span> oder <span className="font-medium">Zum Startbildschirm hinzufügen</span>.</Step>
          </ol>
        )}
      </div>
    </Modal>
  );
}
