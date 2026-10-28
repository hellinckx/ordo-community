import { useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { Download, File, FileImage, FileSpreadsheet, FileText, FolderOpen, Trash2, Upload } from "lucide-react";
import { can, ids, nowIso, type FileEntry } from "@ordo/core";
import { Button, ConfirmDialog, EmptyState } from "@/components/ui";
import { useList, useProfile } from "@/state/hooks";
import { requirePlatform, requireStore } from "@/state/session";
import { toast } from "@/state/toasts";
import { cls, fmtBytes, fmtDate } from "@/lib/format";
import { useMe } from "@/modules/registry";
import type { DetailContext } from "../ProjectDetail";
import { FileDropHint } from "@/components/FileDropHint";

function FileIcon({ mime, name }: { mime: string; name: string }) {
  const cl = "h-5 w-5";
  if (mime.startsWith("image/")) return <FileImage className={cl} />;
  if (mime.includes("pdf") || mime.startsWith("text/") || /\.(docx?|odt|txt|md)$/i.test(name)) return <FileText className={cl} />;
  if (mime.includes("sheet") || mime.includes("excel") || /\.(xlsx?|csv|ods)$/i.test(name)) return <FileSpreadsheet className={cl} />;
  return <File className={cl} />;
}

/** Files linked to the project. Simple upload here; the full file manager lives under Dateien. */
export function FilesTab({ ctx }: { ctx: DetailContext }) {
  const { project } = ctx;
  const profile = useProfile();
  const files = useList("files");
  const folders = useList("folders");
  const { role } = useMe();
  const canUpload = can(role, "files", "write");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [confirm, setConfirm] = useState<FileEntry | null>(null);
  const navigate = useNavigate();
  const list = useMemo(() => files.filter((f) => f.links.some((l) => l.type === "project" && l.id === project.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [files, project.id]);

  const upload = async (picked: { name: string; mime: string; bytes: Uint8Array }[]) => {
    if (!picked.length) return;
    setBusy(true);
    try {
      const store = requireStore();
      const folder = folders.find((f) => f.owner?.type === "project" && f.owner.id === project.id);
      for (const p of picked) {
        const att = await store.putAttachment(profile.id, p.bytes, { name: p.name, mime: p.mime || "application/octet-stream" });
        const now = nowIso();
        const entry: FileEntry = {
          id: ids.file(),
          profileId: profile.id,
          folderId: folder?.id,
          attachmentId: att.id,
          name: p.name,
          mime: att.mime,
          size: att.size,
          tags: [],
          links: [{ type: "project", id: project.id }, ...(project.customerId ? [{ type: "contact" as const, id: project.customerId }] : [])],
          note: "",
          createdAt: now,
          updatedAt: now,
        };
        store.insert("files", entry, "file.upload");
      }
      toast.success(picked.length === 1 ? "Datei hinzugefügt" : `${picked.length} Dateien hinzugefügt`);
    } catch (e) {
      toast.error("Hochladen fehlgeschlagen", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    const picked = await requirePlatform().pickFiles({ multiple: true });
    await upload(picked);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    if (!canUpload) return;
    const items = await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
    await upload(items);
  };

  const download = async (f: FileEntry) => {
    try {
      const bytes = await requireStore().getAttachmentBytes(f.attachmentId);
      if (!bytes) return toast.error("Datei nicht gefunden", "Sie ist auf diesem Gerät noch nicht vorhanden.");
      await requirePlatform().saveFile(f.name, bytes, f.mime);
    } catch (e) {
      toast.error("Speichern fehlgeschlagen", e instanceof Error ? e.message : String(e));
    }
  };

  const remove = (f: FileEntry) => {
    const others = f.links.filter((l) => !(l.type === "project" && l.id === project.id) && l.type !== "contact");
    if (others.length) {
      // still used elsewhere: only take it off this project
      requireStore().update("files", f.id, { links: f.links.filter((l) => !(l.type === "project" && l.id === project.id)) }, "file.unlink");
      toast.success("Vom Projekt entfernt", "Die Datei bleibt in der Ablage.");
    } else {
      requireStore().softDelete("files", f.id, "file.delete");
      toast.success("Datei gelöscht");
    }
  };

  return (
    <div
      data-own-drop="project-files"
      className={cls("space-y-3 rounded-[22px]", over && "ring-2 ring-brand-500 ring-offset-4 ring-offset-(--bg)")}
      onDragOver={(e) => {
        if (!canUpload || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-(--text-muted)">{list.length ? `${list.length} Datei${list.length === 1 ? "" : "en"}` : ""}</p>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate("/dateien")}><FolderOpen className="h-4 w-4" /> Alle Dateien</Button>
          {canUpload ? <Button size="sm" loading={busy} onClick={() => void pick()}><Upload className="h-4 w-4" /> Hochladen</Button> : null}
        </div>
      </div>
      {canUpload ? <FileDropHint disabled={busy} onChoose={() => void pick()}>{over ? "Loslassen zum Hochladen" : "Projektdateien hierher ziehen oder auswählen"}</FileDropHint> : null}
      {!list.length ? (
        <EmptyState icon={<FolderOpen className="h-8 w-8" />} title="Noch keine Dateien" body="Pläne, Fotos, Verträge und Abnahmen – leg sie hier ab oder zieh sie einfach in diesen Bereich." action={canUpload ? <Button onClick={() => void pick()} loading={busy}><Upload className="h-4 w-4" /> Dateien wählen</Button> : undefined} />
      ) : (
        <ul className="surface divide-y divide-(--border) overflow-hidden">
          {list.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--surface-2) text-(--text-muted)"><FileIcon mime={f.mime} name={f.name} /></span>
              <button onClick={() => void download(f)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium hover:text-brand-700 dark:hover:text-brand-400">{f.name}</span>
                <span className="block text-xs text-(--text-muted)">{fmtBytes(f.size)} · {fmtDate(f.createdAt.slice(0, 10))}</span>
              </button>
              <Button size="icon" variant="ghost" onClick={() => void download(f)} aria-label="Herunterladen"><Download className="h-4 w-4" /></Button>
              {canUpload ? <Button size="icon" variant="ghost" onClick={() => setConfirm(f)} aria-label="Entfernen"><Trash2 className="h-4 w-4" /></Button> : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        danger
        title="Datei entfernen?"
        body={confirm ? `„${confirm.name}“ wird aus dem Projekt entfernt.` : undefined}
        confirmLabel="Entfernen"
        onConfirm={() => {
          if (confirm) remove(confirm);
        }}
      />
    </div>
  );
}
