import { useState } from "react";
import { FolderOpen, FolderPlus, Trash2 } from "lucide-react";
import { ids, type WatchFolder } from "@ordo/core";
import { useProfile, useSettingsMutator, useVault } from "@/state/hooks";
import { requirePlatform } from "@/state/session";
import { isTauri } from "@/platform";
import { toast } from "@/state/toasts";
import { cls } from "@/lib/format";
import { Button, Switch } from "@/components/ui";

const KIND_LABEL: Record<WatchFolder["kind"], string> = {
  receipts: "eingehende Rechnungen",
  outgoing: "ausgehende Rechnungen",
  bank: "Kontoauszüge",
};

/** Folders of the active profile for one purpose, with add / change / remove. */
export function useWatchFolders(kind: WatchFolder["kind"]) {
  const vault = useVault();
  const profile = useProfile();
  const mutate = useSettingsMutator();
  const folders = vault.settings.watchFolders.filter((f) => f.profileId === profile.id && f.kind === kind);
  const add = async () => {
    const path = await requirePlatform().pickFolder();
    if (!path) return;
    if (folders.some((f) => f.path === path)) {
      toast.info("Ordner ist schon verknüpft", path);
      return;
    }
    mutate((s) => ({ ...s, watchFolders: [...s.watchFolders, { id: ids.notification().replace("ntf_", "wf_"), profileId: profile.id, path, kind, active: true, recursive: true, moveProcessed: false }] }));
    toast.success("Ordner verknüpft", `${path} – inklusive Unterordner. Vorhandene Dateien werden jetzt eingelesen.`);
  };
  const update = (id: string, patch: Partial<WatchFolder>) => mutate((s) => ({ ...s, watchFolders: s.watchFolders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const remove = (id: string) => {
    mutate((s) => ({ ...s, watchFolders: s.watchFolders.filter((f) => f.id !== id) }));
    toast.info("Verknüpfung gelöst", "Bereits eingelesene Dateien bleiben in Ordo.");
  };
  return { folders, add, update, remove };
}

/**
 * "Ordner" button for a page header: shows which folders feed this page and lets you link more or unlink.
 * Watching folders needs the desktop app; in the browser it explains that.
 */
export function FolderLinks({ kind, className }: { kind: WatchFolder["kind"]; className?: string }) {
  const { folders, add, update, remove } = useWatchFolders(kind);
  const [open, setOpen] = useState(false);
  const active = folders.filter((f) => f.active).length;
  return (
    <div className={cls("relative", className)}>
      <Button variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={`Ordner für ${KIND_LABEL[kind]}`}>
        <FolderOpen className="h-4 w-4" />
        {folders.length ? `${active} ${active === 1 ? "Ordner" : "Ordner"} verknüpft` : "Ordner verknüpfen"}
      </Button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="glass-strong animate-pop-in absolute right-0 z-40 mt-2 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-[20px] p-4 shadow-pop">
            <div className="text-sm font-semibold">Ordner für {KIND_LABEL[kind]}</div>
            <p className="mt-0.5 text-xs text-(--text-muted)">Alles, was in diesen Ordnern landet (auch in Unterordnern), liest Ordo selbst ein.</p>
            {!isTauri ? (
              <div className="mt-3 rounded-xl bg-(--surface-2) px-3 py-2.5 text-sm">
                Ordner verknüpfen geht in der Desktop-App für Windows. Im Browser lädst du Dateien mit „Hochladen“ oder ziehst sie ins Fenster.
                <a href="../download/" target="_blank" rel="noreferrer" className="mt-1 block text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">Desktop-App laden</a>
              </div>
            ) : (
              <>
                {folders.length ? (
                  <ul className="mt-3 divide-y divide-(--glass-border)">
                    {folders.map((f) => (
                      <li key={f.id} className="py-2.5">
                        <div className="flex items-center gap-2">
                          <FolderOpen className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400" />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>{f.path}</span>
                          <button type="button" className="rounded-md p-1.5 text-(--text-muted) hover:text-red-600" onClick={() => remove(f.id)} aria-label="Verknüpfung lösen" title="Verknüpfung lösen"><Trash2 className="h-4 w-4" /></button>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-5 pl-6">
                          <Switch checked={f.recursive} onChange={(b) => update(f.id, { recursive: b })} label="Unterordner" />
                          <Switch checked={f.active} onChange={(b) => update(f.id, { active: b })} label="aktiv" />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-(--border) px-3 py-3 text-center text-sm text-(--text-muted)">Noch kein Ordner verknüpft.</div>
                )}
                <Button className="mt-3 w-full justify-center" onClick={() => void add()}><FolderPlus className="h-4 w-4" /> {folders.length ? "Weiteren Ordner verknüpfen" : "Ordner verknüpfen"}</Button>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Big call to action for empty pages: link a folder first (desktop) – the rest happens by itself. */
export function FolderLinkButton({ kind }: { kind: WatchFolder["kind"] }) {
  const { folders, add } = useWatchFolders(kind);
  if (!isTauri || folders.length) return null;
  return (
    <Button variant="outline" onClick={() => void add()}>
      <FolderPlus className="h-4 w-4" /> Ordner verknüpfen
    </Button>
  );
}
