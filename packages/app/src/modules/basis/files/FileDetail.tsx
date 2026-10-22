import { useEffect, useState } from "react";
import { Download, Link2, Plus, Trash2, X } from "lucide-react";
import { can, type EntityLink, type FileEntry } from "@ordo/core";
import { useList, useVault } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { useMe } from "@/modules/registry";
import { Button, ConfirmDialog, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { fmtBytes, fmtDateTime } from "@/lib/format";
import { deleteFileEntry, downloadAttachment, flattenFolders, normalizeTag, sameLink } from "./fileStore";
import { FilePreview, LinkChip } from "./parts";
import { LinkPicker } from "./LinkPicker";

/** Preview and details of one file: rename, folder, tags, links, note, download, delete. */
export function FileDetail({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  const vault = useVault();
  const folders = useList("folders");
  const file = fileId ? vault.files.find((f) => f.id === fileId && !f.deletedAt) : undefined;
  const { role } = useMe();
  const canWrite = can(role, "files", "write");
  const canDelete = can(role, "files", "admin");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [tag, setTag] = useState("");
  const [linking, setLinking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return;
    setName(file.name);
    setNote(file.note);
    setTag("");
  }, [file?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!file) return null;

  const patch = (p: Partial<FileEntry>) => requireStore().update("files", file.id, p, "file.update");
  const saveName = () => {
    const n = name.trim();
    if (!n) {
      setName(file.name);
      return;
    }
    if (n !== file.name) patch({ name: n });
  };
  const addTag = () => {
    const parts = tag.split(",").map(normalizeTag).filter(Boolean);
    if (!parts.length) return;
    patch({ tags: [...new Set([...file.tags, ...parts])] });
    setTag("");
  };
  const addLink = (l: EntityLink) => {
    if (file.links.some((x) => sameLink(x, l))) return;
    patch({ links: [...file.links, l] });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={<span className="block max-w-[60vw] truncate">{file.name}</span>}
      size="lg"
      footer={
        <>
          {canDelete ? (
            <Button variant="ghost" className="mr-auto text-red-600" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" /> Löschen
            </Button>
          ) : null}
          <Button variant="outline" loading={busy} onClick={async () => { setBusy(true); await downloadAttachment(file.attachmentId, file.name, file.mime); setBusy(false); }}>
            <Download className="h-4 w-4" /> Herunterladen
          </Button>
          <Button onClick={onClose}>Fertig</Button>
        </>
      }
    >
      <div className="space-y-5">
        <FilePreview attachmentId={file.attachmentId} mime={file.mime} name={file.name} />
        <div className="text-xs text-(--text-muted)">
          {fmtBytes(file.size)} · hinzugefügt {fmtDateTime(file.createdAt)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} disabled={!canWrite} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          </Field>
          <Field label="Ordner">
            <Select value={file.folderId ?? ""} disabled={!canWrite} onChange={(e) => patch({ folderId: e.target.value || undefined })}>
              <option value="">Ohne Ordner</option>
              {flattenFolders(folders).map(({ folder, depth }) => (
                <option key={folder.id} value={folder.id}>
                  {"  ".repeat(depth)}
                  {folder.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <div className="mb-1.5 text-[13px] font-medium text-(--text-muted)">Schlagwörter</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {file.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-(--surface-2) py-0.5 pr-1 pl-2.5 text-xs font-medium">
                {t}
                {canWrite ? (
                  <button type="button" onClick={() => patch({ tags: file.tags.filter((x) => x !== t) })} className="rounded-full p-0.5 text-(--text-muted) hover:text-(--text)" aria-label={`${t} entfernen`}>
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </span>
            ))}
            {canWrite ? (
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder={file.tags.length ? "weiteres …" : "z. B. vertrag, plan"}
                className="h-7 min-w-28 flex-1 rounded-full bg-transparent px-2 text-xs outline-none placeholder:text-slate-400"
              />
            ) : !file.tags.length ? <span className="text-xs text-(--text-muted)">Keine</span> : null}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-(--text-muted)">Gehört zu</span>
            {canWrite ? (
              <Button variant="ghost" size="sm" onClick={() => setLinking(true)}>
                <Link2 className="h-3.5 w-3.5" /> Verknüpfen
              </Button>
            ) : null}
          </div>
          {file.links.length ? (
            <div className="flex flex-wrap gap-1.5">
              {file.links.map((l) => (
                <LinkChip key={`${l.type}:${l.id}`} vault={vault} link={l} onNavigate={onClose} onRemove={canWrite ? () => patch({ links: file.links.filter((x) => !sameLink(x, l)) }) : undefined} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-(--text-muted)">
              Noch mit nichts verknüpft. Verknüpfe die Datei mit einem Kunden, Projekt oder einer Rechnung – dann findest du sie dort wieder.
              {canWrite ? (
                <button type="button" onClick={() => setLinking(true)} className="ml-1 inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline dark:text-brand-400">
                  <Plus className="h-3 w-3" /> Verknüpfen
                </button>
              ) : null}
            </p>
          )}
        </div>

        <Field label="Notiz">
          <Textarea value={note} disabled={!canWrite} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== file.note && patch({ note })} placeholder="Was steht drin, wofür ist sie?" />
        </Field>
      </div>
      <LinkPicker open={linking} onClose={() => setLinking(false)} onPick={addLink} existing={file.links} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title="Datei löschen?"
        body={`„${file.name}“ wird endgültig gelöscht – auch auf deinen anderen Geräten.`}
        confirmLabel="Löschen"
        onConfirm={async () => {
          await deleteFileEntry(file);
          onClose();
        }}
      />
    </Modal>
  );
}
