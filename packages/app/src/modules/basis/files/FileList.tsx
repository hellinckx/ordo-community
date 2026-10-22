import { useMemo, useState, type DragEvent } from "react";
import { Download, FolderOpen, Upload } from "lucide-react";
import { Link } from "react-router";
import { can, type EntityLink } from "@ordo/core";
import { useList, useProfile, useVault } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { useMe } from "@/modules/registry";
import { toast } from "@/state/toasts";
import { Button, Card } from "@/components/ui";
import { cls, fmtBytes, fmtDate } from "@/lib/format";
import { ensureFolderFor, filesFromDrop, findOwnerFolder, folderAndDescendants, downloadAttachment, pickFiles, sameLink, uploadFiles, type IncomingFile } from "./fileStore";
import { FileTile } from "./parts";
import { FileDetail } from "./FileDetail";

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

/**
 * Files of one record (customer, project, offer, invoice, product, work order …): upload by button or drag & drop,
 * list, preview. New files land in the record's folder (e.g. Kunden/Alpenblick Hotel · K-0001) and are linked to it.
 * For customers and projects, files someone put into their folder by hand show up here too.
 *
 *   <FileList link={{ type: "project", id: project.id }} />
 */
export function FileList({ link, title = "Dateien", className, emptyText }: { link: EntityLink; title?: string; className?: string; emptyText?: string }) {
  const profile = useProfile();
  const vault = useVault();
  const files = useList("files");
  const folders = useList("folders");
  const { role } = useMe();
  const canRead = can(role, "files", "read");
  const canWrite = can(role, "files", "write");
  const [openId, setOpenId] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const own = link.type === "contact" || link.type === "project" ? findOwnerFolder(vault, profile.id, link) : undefined;
  const list = useMemo(() => {
    const scope = own ? folderAndDescendants(folders, own.id) : null;
    return files
      .filter((f) => f.links.some((l) => sameLink(l, link)) || (scope && f.folderId && scope.has(f.folderId)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [files, folders, own, link]);

  if (!canRead) return null;

  const add = async (incoming: IncomingFile[]) => {
    if (!incoming.length) return;
    setBusy(true);
    try {
      const folderId = ensureFolderFor(requireStore(), profile.id, link);
      await uploadFiles(profile.id, incoming, { folderId, links: [link] });
    } catch (e) {
      toast.error("Hochladen fehlgeschlagen", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dropProps = canWrite
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
        },
        onDragLeave: (e: DragEvent) => {
          e.stopPropagation();
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        },
        onDrop: async (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          void add(await filesFromDrop(e.dataTransfer));
        },
      }
    : {};

  return (
    <div {...dropProps} className={className}>
      <Card
        title={
          <span>
            {title}
            {list.length ? <span className="ml-1.5 font-normal text-(--text-muted)">{list.length}</span> : null}
          </span>
        }
        action={
          <span className="flex items-center gap-1">
            {own ? (
              <Link to={`/dateien?ordner=${own.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text)" title="Ordner in der Dateiablage öffnen">
                <FolderOpen className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Ordner</span>
              </Link>
            ) : null}
            {canWrite ? (
              <Button variant="ghost" size="sm" loading={busy} onClick={async () => void add(await pickFiles())}>
                <Upload className="h-3.5 w-3.5" /> Hochladen
              </Button>
            ) : null}
          </span>
        }
        padded={false}
        className={cls("transition-shadow", over && "ring-2 ring-brand-600")}
      >
        {list.length ? (
          <ul className="divide-y divide-(--border)">
            {list.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-(--surface-2)">
                <button type="button" onClick={() => setOpenId(f.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <FileTile mime={f.mime} name={f.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{f.name}</span>
                    <span className="block truncate text-xs text-(--text-muted)">
                      {fmtDate(f.createdAt)} · {fmtBytes(f.size)}
                      {f.tags.length ? ` · ${f.tags.join(", ")}` : ""}
                    </span>
                  </span>
                </button>
                <button type="button" onClick={() => void downloadAttachment(f.attachmentId, f.name, f.mime)} className="rounded-lg p-1.5 text-(--text-muted) hover:bg-(--surface) hover:text-(--text)" title="Herunterladen" aria-label={`${f.name} herunterladen`}>
                  <Download className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className={cls("m-4 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-(--text-muted)", over ? "border-brand-600 bg-brand-50/50 dark:bg-brand-950/30" : "border-(--border)")}>
            {canWrite ? emptyText ?? "Noch keine Dateien. Zieh Pläne, Verträge oder Fotos hierher oder lade sie hoch." : "Noch keine Dateien."}
          </div>
        )}
        {over && list.length ? <div className="border-t border-(--border) px-5 py-2 text-center text-xs font-medium text-brand-700 dark:text-brand-400">Loslassen zum Hochladen</div> : null}
      </Card>
      <FileDetail fileId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
