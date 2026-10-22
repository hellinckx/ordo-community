import { useEffect } from "react";
import { useSession } from "@/state/session";
import { importFiles } from "./importer";
import { toast } from "@/state/toasts";
import { mimeFor, type WatchFolder } from "@ordo/core";

/** path → recursive flag of the running watcher */
const active = new Map<string, boolean>();
const seen = new Map<string, number>();

type FolderFile = { path: string; name: string; size: number; modified: number };

/** Reads one file from a watched folder and hands it to the importer unless it is already known. */
async function importFolderFile(file: FolderFile, f: WatchFolder): Promise<boolean> {
  const { platform, store } = useSession.getState();
  if (!platform?.watch || !store) return false;
  const key = `${file.path}:${file.size}:${file.modified}`;
  if (seen.has(key)) return false;
  seen.set(key, Date.now());
  try {
    const bytes = await platform.watch.readFile(file.path);
    if (!bytes.length) return false;
    const knownPaths = new Set(store.list("documents").map((d) => d.originalPath).filter(Boolean));
    if (knownPaths.has(file.path)) return false;
    importFiles([{ name: file.name, mime: mimeFor(file.name), bytes, path: file.path }], f.kind === "bank" ? "bank" : "folder", f.kind === "outgoing" ? { direction: "outgoing" } : {});
    return true;
  } catch (e) {
    toast.error("Datei konnte nicht gelesen werden", `${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** Active folders of the active profile (desktop only). */
export function connectedFolders(): WatchFolder[] {
  const vault = useSession.getState().vault;
  return (vault?.settings.watchFolders ?? []).filter((f) => f.active && f.profileId === vault?.activeProfileId);
}

/** "Nach Neuem suchen": looks through every connected folder once and imports what Summa doesn't know yet. */
export async function scanFoldersNow(): Promise<number> {
  const { platform, store } = useSession.getState();
  if (!platform?.watch || !store) return 0;
  let count = 0;
  for (const f of connectedFolders()) {
    const files = await platform.watch.scan(f.path, { recursive: f.recursive });
    const known = new Set(store.list("documents").map((d) => d.originalPath).filter(Boolean));
    for (const file of files.filter((x) => !known.has(x.path))) if (await importFolderFile(file, f)) count++;
  }
  return count;
}

/**
 * Desktop: watches the configured folders of the active profile and imports new files automatically.
 * On start it scans the folder (and, if enabled, its sub folders) once and imports anything that isn't
 * known yet – dedupe happens by path first and by content hash in the importer. Nested watch roots fire
 * twice for the same file; `seen` plus the hash check make that harmless.
 */
export function useFolderWatch() {
  const status = useSession((s) => s.status);
  const folders = useSession((s) => s.vault?.settings.watchFolders);
  const activeProfileId = useSession((s) => s.vault?.activeProfileId);
  useEffect(() => {
    const { platform, store } = useSession.getState();
    if (status !== "unlocked" || !platform?.watch || !store) return;
    const watch = platform.watch;
    const wanted = (folders ?? []).filter((f) => f.active && f.profileId === activeProfileId);
    const wantedByPath = new Map(wanted.map((f) => [f.path, f.recursive]));
    for (const [p, rec] of [...active]) {
      // gone, or the "Unterordner" switch changed → restart with the new mode
      if (!wantedByPath.has(p) || wantedByPath.get(p) !== rec) {
        void watch.stop(p);
        active.delete(p);
      }
    }
    for (const f of wanted) {
      if (active.has(f.path)) continue;
      active.set(f.path, f.recursive);
      const handle = (file: FolderFile) => importFolderFile(file, f);
      void (async () => {
        try {
          const existing = await watch.scan(f.path, { recursive: f.recursive });
          const known = new Set(store.list("documents").map((d) => d.originalPath).filter(Boolean));
          const fresh = existing.filter((x) => !known.has(x.path));
          if (fresh.length) toast.info(`${fresh.length} neue Datei${fresh.length === 1 ? "" : "en"} gefunden`, `${f.path} – ${fresh.length === 1 ? "wird" : "werden"} jetzt eingelesen.`);
          for (const x of fresh) await handle(x);
          await watch.start(f.path, (file) => void handle(file), { recursive: f.recursive });
        } catch (e) {
          toast.error("Ordnerüberwachung fehlgeschlagen", `${f.path}: ${e instanceof Error ? e.message : String(e)}`);
          active.delete(f.path);
        }
      })();
    }
    if (status !== "unlocked") {
      for (const p of active.keys()) void watch.stop(p);
      active.clear();
    }
  }, [status, folders, activeProfileId]);
}
