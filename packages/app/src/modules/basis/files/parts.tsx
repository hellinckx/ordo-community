import { File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, X } from "lucide-react";
import { Link } from "react-router";
import type { EntityLink, Vault } from "@ordo/core";
import { Spinner } from "@/components/ui";
import { useAttachmentUrl } from "@/components/DocumentViewer";
import { cls } from "@/lib/format";
import { guessMime, linkHref, linkLabel, LINK_TYPE_LABELS, previewKind } from "./fileStore";

export function FileTypeIcon({ mime, name, className = "h-5 w-5" }: { mime: string; name: string; className?: string }) {
  const m = guessMime(name, mime);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (m.startsWith("image/")) return <FileImage className={className} />;
  if (m.startsWith("video/")) return <FileVideo className={className} />;
  if (m.startsWith("audio/")) return <FileAudio className={className} />;
  if (m.includes("sheet") || m.includes("excel") || ext === "csv") return <FileSpreadsheet className={className} />;
  if (m.includes("zip") || ["zip", "7z", "rar", "gz"].includes(ext)) return <FileArchive className={className} />;
  if (m === "application/pdf" || m.startsWith("text/") || m.includes("word") || m.includes("document")) return <FileText className={className} />;
  return <File className={className} />;
}

/** Square tile with the file type icon – the same look everywhere files are listed. */
export function FileTile({ mime, name, className }: { mime: string; name: string; className?: string }) {
  const m = guessMime(name, mime);
  const tone = m === "application/pdf" ? "text-red-600 dark:text-red-400" : m.startsWith("image/") ? "text-sky-600 dark:text-sky-400" : m.includes("sheet") ? "text-emerald-600 dark:text-emerald-400" : "text-(--text-muted)";
  return (
    <span className={cls("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-(--surface-2)", tone, className)}>
      <FileTypeIcon mime={mime} name={name} className="h-[18px] w-[18px]" />
    </span>
  );
}

/** Image / PDF / text preview of an encrypted attachment. */
export function FilePreview({ attachmentId, mime, name, className }: { attachmentId: string; mime: string; name: string; className?: string }) {
  const kind = previewKind(mime, name);
  const urlMime = kind === "pdf" ? "application/pdf" : kind === "text" ? "text/plain;charset=utf-8" : guessMime(name, mime);
  const { url, loading, error } = useAttachmentUrl(kind ? attachmentId : undefined, urlMime);
  const frame = cls("flex items-center justify-center overflow-hidden rounded-xl border border-(--border) bg-(--surface-2)", className);
  if (!kind) {
    return (
      <div className={cls(frame, "flex-col gap-2 p-8 text-center text-sm text-(--text-muted)")}>
        <FileTypeIcon mime={mime} name={name} className="h-10 w-10" />
        <span>Für diesen Dateityp gibt es keine Vorschau. Lade die Datei herunter, um sie zu öffnen.</span>
      </div>
    );
  }
  if (loading) return <div className={cls(frame, "h-64")}><Spinner /></div>;
  if (!url) return <div className={cls(frame, "h-40 p-6 text-center text-sm text-(--text-muted)")}>{error ? "Die Vorschau ist gerade nicht verfügbar. Ist das Gerät online?" : "Keine Vorschau"}</div>;
  if (kind === "image") {
    return (
      <div className={cls(frame, "p-2")}>
        <img src={url} alt={name} className="max-h-[60vh] max-w-full rounded-lg object-contain" />
      </div>
    );
  }
  return (
    <div className={frame}>
      <iframe title={name} src={url} className="h-[60vh] w-full bg-white" />
    </div>
  );
}

/** Small pill for a linked record; click opens it. */
export function LinkChip({ vault, link, onRemove, onNavigate }: { vault: Vault; link: EntityLink; onRemove?: () => void; onNavigate?: () => void }) {
  const label = linkLabel(vault, link);
  const href = label ? linkHref(vault, link) : null;
  const body = (
    <>
      <span className="text-(--text-muted)">{LINK_TYPE_LABELS[link.type]}</span>
      <span className="max-w-[16rem] truncate font-medium">{label ?? "gelöscht"}</span>
    </>
  );
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-(--border) bg-(--surface) py-0.5 pr-1 pl-2.5 text-xs">
      {href ? <Link to={href} onClick={onNavigate} className="inline-flex min-w-0 items-center gap-1.5 hover:underline">{body}</Link> : <span className="inline-flex min-w-0 items-center gap-1.5">{body}</span>}
      {onRemove ? (
        <button type="button" onClick={onRemove} className="rounded-full p-0.5 text-(--text-muted) hover:bg-(--surface-2) hover:text-(--text)" aria-label="Verknüpfung entfernen">
          <X className="h-3 w-3" />
        </button>
      ) : <span className="w-1" />}
    </span>
  );
}
