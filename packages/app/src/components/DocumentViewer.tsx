import { useEffect, useState } from "react";
import { FileSpreadsheet, FileText, Maximize2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import type { SummaDocument } from "@ordo/core";
import { useSession } from "@/state/session";
import { Button, Spinner } from "@/components/ui";
import { ensureBlob } from "@/services/sync";
import { cls } from "@/lib/format";

const urlCache = new Map<string, string>();

/** Revokes all decrypted attachment URLs so nothing stays readable after lock or vault switch. */
export function clearAttachmentCache() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}

// Any store change (lock, unlock, demo adopt, backup import) invalidates the cache.
useSession.subscribe((s, prev) => {
  if (s.store !== prev.store) clearAttachmentCache();
});

/** Decrypts an attachment and returns an object URL (cached for the session). */
export function useAttachmentUrl(attachmentId: string | undefined, mime = "application/octet-stream"): { url: string | null; loading: boolean; error: string | null } {
  const store = useSession((s) => s.store);
  const [state, setState] = useState<{ url: string | null; loading: boolean; error: string | null }>({ url: attachmentId ? urlCache.get(attachmentId) ?? null : null, loading: !!attachmentId && !urlCache.has(attachmentId), error: null });
  useEffect(() => {
    if (!attachmentId || !store) {
      setState({ url: null, loading: false, error: null });
      return;
    }
    const cached = urlCache.get(attachmentId);
    if (cached) {
      setState({ url: cached, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ url: null, loading: true, error: null });
    store
      .getAttachmentBytes(attachmentId)
      .then(async (bytes) => {
        if (!bytes && (await ensureBlob(attachmentId, store.storage))) bytes = await store.getAttachmentBytes(attachmentId);
        return bytes;
      })
      .then((bytes) => {
        if (cancelled) return;
        if (!bytes) {
          setState({ url: null, loading: false, error: "Anhang nicht gefunden" });
          return;
        }
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
        urlCache.set(attachmentId, url);
        setState({ url, loading: false, error: null });
      })
      .catch((e) => !cancelled && setState({ url: null, loading: false, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [attachmentId, mime, store]);
  return state;
}

export function DocumentViewer({ doc, className }: { doc: SummaDocument; className?: string }) {
  const isPdf = doc.mime === "application/pdf" || doc.originalName.toLowerCase().endsWith(".pdf");
  const isImage = doc.mime.startsWith("image/");
  const previewId = isPdf ? doc.previewAttachmentId : isImage ? doc.attachmentId : undefined;
  const { url, loading, error } = useAttachmentUrl(previewId, isPdf ? "image/png" : doc.mime);
  const original = useAttachmentUrl(isPdf ? doc.attachmentId : undefined, "application/pdf");
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [showPdf, setShowPdf] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    setZoom(1);
    setRotate(0);
    setShowPdf(false);
  }, [doc.id]);

  const toolbar = (
    <div className="flex items-center gap-1 border-b border-(--border) bg-(--surface) px-2 py-1.5">
      <span className="mr-auto truncate px-1 text-xs text-(--text-muted)" title={doc.originalName}>{doc.originalName}</span>
      {isPdf && original.url ? (
        <Button variant="ghost" size="sm" onClick={() => setShowPdf((s) => !s)}>{showPdf ? "Vorschau" : "PDF öffnen"}</Button>
      ) : null}
      <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} title="Verkleinern"><ZoomOut className="h-4 w-4" /></Button>
      <span className="w-10 text-center text-xs tabular">{Math.round(zoom * 100)} %</span>
      <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} title="Vergrößern"><ZoomIn className="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" onClick={() => setRotate((r) => (r + 90) % 360)} title="Drehen"><RotateCw className="h-4 w-4" /></Button>
      <Button variant="ghost" size="icon" onClick={() => setFullscreen((f) => !f)} title="Vollbild"><Maximize2 className="h-4 w-4" /></Button>
    </div>
  );

  let body: React.ReactNode;
  if (showPdf && original.url) {
    body = <iframe title="PDF" src={original.url} className="h-full w-full bg-white" />;
  } else if (loading) {
    body = <div className="flex h-full items-center justify-center"><Spinner /></div>;
  } else if (url) {
    body = (
      <div className="flex h-full items-start justify-center overflow-auto bg-slate-100 p-3 dark:bg-slate-900">
        <img src={url} alt={doc.originalName} draggable={false} style={{ transform: `scale(${zoom}) rotate(${rotate}deg)`, transformOrigin: "top center", transition: "transform 0.15s" }} className="max-w-full select-none rounded shadow-lg" />
      </div>
    );
  } else {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-(--text-muted)">
        {doc.mime.includes("sheet") || doc.originalName.match(/\.(xlsx|xls|csv)$/i) ? <FileSpreadsheet className="h-10 w-10" /> : <FileText className="h-10 w-10" />}
        <div>{error ?? "Keine Bildvorschau für diesen Dateityp."}</div>
        {doc.extraction?.text ? <pre className="max-h-96 w-full overflow-auto rounded-lg bg-(--surface) p-3 text-left text-xs whitespace-pre-wrap">{doc.extraction.text.slice(0, 6000)}</pre> : null}
      </div>
    );
  }

  const content = (
    <div className={cls("flex h-full flex-col overflow-hidden rounded-xl border border-(--border)", className)}>
      {toolbar}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/90 p-4" onClick={() => setFullscreen(false)}>
        <div className="h-full" onClick={(e) => e.stopPropagation()}>{content}</div>
      </div>
    );
  }
  return content;
}
