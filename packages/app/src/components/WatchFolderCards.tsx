import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { ids, type WatchFolder } from "@ordo/core";
import { useProfile, useSettingsMutator, useVault } from "@/state/hooks";
import { requirePlatform } from "@/state/session";
import { Button, Card, Switch } from "@/components/ui";
import { toast } from "@/state/toasts";

/**
 * Folder cards (Eingang / Ausgang / Kontoauszüge) used by Settings → Ordner and the onboarding.
 * Each purpose can have several folders; each folder optionally includes its sub folders (e.g. one per year).
 */
export function WatchFolderCards({ compact }: { compact?: boolean }) {
  const vault = useVault();
  const profile = useProfile();
  const mutate = useSettingsMutator();
  const isBusiness = profile.mode === "business";
  const folders = vault.settings.watchFolders.filter((f) => f.profileId === profile.id);
  const add = async (kind: WatchFolder["kind"]) => {
    const path = await requirePlatform().pickFolder();
    if (!path) return;
    if (folders.some((f) => f.path === path && f.kind === kind)) {
      toast.info("Ordner ist schon verknüpft", path);
      return;
    }
    mutate((s) => ({ ...s, watchFolders: [...s.watchFolders, { id: ids.notification().replace("ntf_", "wf_"), profileId: profile.id, path, kind, active: true, recursive: true, moveProcessed: false }] }));
    toast.success("Ordner wird überwacht", `${path} – inklusive Unterordner. Vorhandene Dateien werden jetzt eingelesen.`);
  };
  const update = (id: string, patch: Partial<WatchFolder>) => mutate((s) => ({ ...s, watchFolders: s.watchFolders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const remove = (id: string) => mutate((s) => ({ ...s, watchFolders: s.watchFolders.filter((f) => f.id !== id) }));

  const FolderList = ({ kind, title, body }: { kind: WatchFolder["kind"]; title: string; body: string }) => {
    const rows = folders.filter((f) => f.kind === kind);
    return (
      <Card title={title} action={<Button size="sm" variant="outline" onClick={() => add(kind)}><Plus className="h-4 w-4" /> Ordner wählen</Button>}>
        {!compact ? <p className="mb-3 text-sm text-(--text-muted)">{body}</p> : null}
        {!rows.length ? <div className="rounded-xl border border-dashed border-(--border) p-4 text-center text-sm text-(--text-muted)">Noch kein Ordner – „Ordner wählen“ reicht, Unterordner werden mitgelesen.</div> : null}
        <ul className="divide-y divide-(--border)">
          {rows.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <FolderOpen className="h-4 w-4 text-brand-600" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>{f.path}</span>
              <Switch checked={f.recursive} onChange={(b) => update(f.id, { recursive: b })} label="Unterordner" />
              <Switch checked={f.active} onChange={(b) => update(f.id, { active: b })} label="aktiv" />
              <button className="rounded-md p-1.5 text-(--text-muted) hover:text-red-600" onClick={() => remove(f.id)} aria-label="Ordner entfernen"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      </Card>
    );
  };

  return (
    <div className={compact ? "grid gap-3" : "grid gap-4 lg:grid-cols-2"}>
      <FolderList kind="receipts" title={isBusiness ? "Eingehende Rechnungen" : "Rechnungen & Bons"} body={isBusiness ? "Rechnungen und Kassenbons, die du bezahlst. Alles, was hier landet (PDF, Foto, Scan, Excel), liest Ordo ein und bucht es, wenn es eindeutig ist. Gut geeignet: Scanner-Ordner oder ein OneDrive-/Dropbox-Ordner, in den du vom Handy fotografierst." : "Alle Rechnungen und Bons, die du sammelst – Ordo liest sie ein und ordnet sie zu. Ein Überordner reicht, auch wenn du nach Jahren oder Themen sortierst."} />
      {isBusiness ? <FolderList kind="outgoing" title="Ausgehende Rechnungen" body="Deine Rechnungen an Kunden, wenn du sie mit einem anderen Programm schreibst. Ordo bucht sie als Einnahme, bis das Geld eingegangen ist." /> : null}
      <FolderList kind="bank" title="Kontoauszüge" body="Kontoauszüge (PDF, CSV oder CAMT) liest Ordo ein und vergleicht sie mit deinen Buchungen." />
      {!compact ? (
        <Card title="Gut zu wissen" className="lg:col-span-2">
          <ul className="list-disc space-y-1 pl-5 text-sm text-(--text-muted)">
            <li><strong>Überordner reicht:</strong> Unterordner – z. B. „2025“, „2026“ oder „Versicherung“ – werden mitgelesen („Unterordner“ an). Versteckte Ordner und „Verarbeitet“ werden übersprungen.</li>
            <li>Mehrere Ordner je Zweck sind möglich, etwa Scanner-Ordner plus Downloads.</li>
            <li>Gelesen werden PDF, JPG/PNG/HEIC/WebP, TIFF, Excel/CSV und E-Mail-Dateien (.eml).</li>
            <li>Bereits importierte Dateien werden anhand ihres Inhalts erkannt und nie doppelt verarbeitet. Die Originaldatei bleibt im Ordner; Ordo speichert eine verschlüsselte Kopie im Tresor.</li>
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
