import { useState } from "react";
import { FileUp, Paperclip, Search, X } from "lucide-react";
import type { Transaction } from "@ordo/core";
import { Button, Input } from "./ui";
import { useList } from "@/state/hooks";
import { requirePlatform } from "@/state/session";
import type { PickedFile } from "@/platform/types";
import { toast } from "@/state/toasts";
import { cls, fmtBytes } from "@/lib/format";

export function TransactionDocuments({ value, onChange, files, onFilesChange, disabled, onReadingChange }: {
  value: Transaction; onChange: (next: Transaction) => void; files: PickedFile[];
  onFilesChange: (files: PickedFile[]) => void; disabled: boolean; onReadingChange: (reading: boolean) => void;
}) {
  const documents = useList("documents");
  const transactions = useList("transactions");
  const [over, setOver] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState("");
  const [reading, setReading] = useState(false);
  const readingState = (next: boolean) => { setReading(next); onReadingChange(next); };
  const busy = disabled || reading;
  const selected = documents.filter((d) => value.documentIds.includes(d.id));
  const available = documents.filter((d) => !value.documentIds.includes(d.id) && !d.invoiceId && d.status !== "processing"
    && (!d.transactionId || d.transactionId === value.id)
    && !transactions.some((t) => t.id !== value.id && t.documentIds.includes(d.id))
    && `${d.originalName} ${d.extraction?.fields.invoiceNumber ?? ""}`.toLocaleLowerCase("de").includes(search.trim().toLocaleLowerCase("de")));
  const pick = async () => {
    readingState(true);
    try { onFilesChange([...files, ...await requirePlatform().pickFiles({ multiple: true, accept: [".pdf", "image/*", ".xml", ".eml"] })]); }
    catch (e) { toast.error("Dateien konnten nicht hinzugefügt werden", e instanceof Error ? e.message : String(e)); }
    finally { readingState(false); }
  };
  return (
    <section className="mt-5 space-y-3 border-t border-(--border) pt-4" aria-label="Rechnungen zur Buchung" data-own-drop="transaction">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium"><Paperclip className="h-4 w-4" aria-hidden="true" /> Rechnungen und Dateien</h3>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setChoosing(!choosing)} aria-expanded={choosing}>Vorhandene verknüpfen</Button>
      </div>
      <button type="button" disabled={busy} onClick={() => void pick()}
        onDragOver={(e) => { if (!e.dataTransfer.types.includes("Files")) return; e.preventDefault(); e.stopPropagation(); if (!busy) setOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
        onDrop={async (e) => {
          e.preventDefault(); e.stopPropagation(); setOver(false);
          if (busy) return;
          const incoming = [...e.dataTransfer.files];
          readingState(true);
          try {
            const picked = await Promise.all(incoming.map(async (file) => ({ name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })));
            onFilesChange([...files, ...picked]);
          } catch (error) { toast.error("Dateien konnten nicht gelesen werden", error instanceof Error ? error.message : String(error)); }
          finally { readingState(false); }
        }}
        className={cls("flex w-full flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-5 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-wait disabled:opacity-60", over ? "border-brand-500 bg-brand-50 dark:bg-brand-950/40" : "border-(--border) hover:border-brand-500 hover:bg-(--surface-2)")}>
        <FileUp className="mb-1 h-6 w-6 text-(--text-muted)" aria-hidden="true" />
        <span className="text-sm font-medium">{reading ? "Dateien werden gelesen …" : over ? "Loslassen zum Anhängen" : "Rechnung hierher ziehen oder Datei auswählen"}</span>
        <span className="text-xs text-(--text-muted)">PDF, Foto oder andere Rechnungsdatei · wird mit der Buchung gespeichert</span>
      </button>
      {selected.length || files.length ? <ul className="divide-y divide-(--border)" aria-label="Ausgewählte Dateien">
        {selected.map((doc) => <li key={doc.id} className="flex items-center gap-2 py-2 text-sm">
          <Paperclip className="h-4 w-4 shrink-0 text-(--text-muted)" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{doc.originalName}</span>
          <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`Verknüpfung mit ${doc.originalName} entfernen`} onClick={() => onChange({ ...value, documentIds: value.documentIds.filter((id) => id !== doc.id) })}><X className="h-4 w-4" /></Button>
        </li>)}
        {files.map((file, i) => <li key={i} className="flex items-center gap-2 py-2 text-sm">
          <Paperclip className="h-4 w-4 shrink-0 text-(--text-muted)" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="shrink-0 text-xs text-(--text-muted)">{fmtBytes(file.bytes.byteLength)}</span>
          <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={`${file.name} entfernen`} onClick={() => onFilesChange(files.filter((_, index) => index !== i))}><X className="h-4 w-4" /></Button>
        </li>)}
      </ul> : null}
      {choosing ? <div className="space-y-2">
        <label className="relative block"><span className="sr-only">Vorhandene Rechnungen suchen</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-(--text-muted)" aria-hidden="true" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Dateiname oder Rechnungsnummer suchen …" className="pl-9" /></label>
        <ul className="max-h-44 overflow-y-auto rounded-xl border border-(--border)">
          {available.map((doc) => <li key={doc.id}><button type="button" disabled={busy} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-(--surface-2) disabled:opacity-50" onClick={() => onChange({ ...value, documentIds: [...value.documentIds, doc.id] })}><Paperclip className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{doc.originalName}</span></button></li>)}
          {!available.length ? <li className="px-3 py-4 text-sm text-(--text-muted)">{search ? "Keine passende Rechnung gefunden." : "Keine unverknüpften Rechnungen verfügbar. Du kannst oben eine Datei hinzufügen."}</li> : null}
        </ul>
      </div> : null}
    </section>
  );
}
