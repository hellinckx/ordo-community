import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ChevronRight, Download, Files, Folder as FolderIcon, FolderOpen, FolderPlus, MoreHorizontal, Pencil, ReceiptText, Search, Trash2, Upload } from "lucide-react";
import { can, ids, nowIso, type Folder, type SummaDocument } from "@ordo/core";
import { useList, useProfile, useVault } from "@/state/hooks";
import { requireStore } from "@/state/session";
import { useIsInstalled, useMe } from "@/modules/registry";
import { toast } from "@/state/toasts";
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, Menu, Modal, PageHeader, Select } from "@/components/ui";
import { DocumentViewer } from "@/components/DocumentViewer";
import { cls, fmtBytes, fmtDate } from "@/lib/format";
import {
  SUMMA_FOLDER,
  downloadAttachment,
  ensureSystemFolders,
  filesFromDrop,
  flattenFolders,
  folderAndDescendants,
  folderPath,
  pickFiles,
  uploadFiles,
  type IncomingFile,
} from "./fileStore";
import { FileTile, LinkChip } from "./parts";
import { FileDropHint } from "@/components/FileDropHint";
import { FileDetail } from "./FileDetail";

/** dataTransfer type for dragging a file entry onto a folder. */
const INTERNAL = "application/x-ordo-file";
const ALL = "all";

const hasExternalFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

/** /dateien – folders and files, linked to customers, projects, invoices. */
export default function FilesPage() {
  const profile = useProfile();
  const vault = useVault();
  const folders = useList("folders");
  const files = useList("files");
  const documents = useList("documents");
  const navigate = useNavigate();
  const { role } = useMe();
  // the read-only folder with Ordo's invoices – only for people who may see the bookkeeping
  const summa = useIsInstalled("summa") && can(role, "summa", "read");
  const canRead = can(role, "files", "read");
  const canWrite = can(role, "files", "write");
  const canAdmin = can(role, "files", "admin");
  const [params, setParams] = useSearchParams();

  const [selected, setSelected] = useState<string>(() => params.get("ordner") ?? ALL);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<SummaDocument | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ mode: "new"; parentId?: string } | { mode: "rename"; folder: Folder } | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<Folder | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [pageOver, setPageOver] = useState(false);
  const [busy, setBusy] = useState(false);

  // system folders Kunden, Projekte, Allgemein exist from the first visit on
  useEffect(() => {
    if (canWrite) ensureSystemFolders(requireStore(), profile.id);
  }, [profile.id, canWrite]);

  // "+ Neu → Datei hochladen" lands here with ?neu=1
  useEffect(() => {
    if (params.get("neu") !== "1") return;
    if (canWrite) setUploadOpen(true);
    const next = new URLSearchParams(params);
    next.delete("neu");
    setParams(next, { replace: true });
  }, [params, setParams, canWrite]);

  // the selected folder was deleted (here or on another device)
  useEffect(() => {
    if (selected === SUMMA_FOLDER ? !summa : selected !== ALL && !folders.some((f) => f.id === selected)) setSelected(ALL);
  }, [folders, selected, summa]);

  const childrenOf = useMemo(() => {
    const m = new Map<string, Folder[]>();
    const known = new Set(folders.map((f) => f.id));
    for (const f of folders) {
      const k = f.parentId && known.has(f.parentId) ? f.parentId : "";
      (m.get(k) ?? m.set(k, []).get(k)!).push(f);
    }
    for (const list of m.values()) list.sort((a, b) => Number(b.system && !b.parentId) - Number(a.system && !a.parentId) || a.name.localeCompare(b.name, "de"));
    return m;
  }, [folders]);

  const counts = useMemo(() => {
    const direct = new Map<string, number>();
    for (const f of files) if (f.folderId) direct.set(f.folderId, (direct.get(f.folderId) ?? 0) + 1);
    const total = new Map<string, number>();
    const visit = (id: string, guard = 0): number => {
      if (total.has(id)) return total.get(id)!;
      let n = direct.get(id) ?? 0;
      if (guard < 30) for (const c of childrenOf.get(id) ?? []) n += visit(c.id, guard + 1);
      total.set(id, n);
      return n;
    };
    for (const f of folders) visit(f.id);
    return total;
  }, [files, folders, childrenOf]);

  const selectedFolder = folders.find((f) => f.id === selected);

  // open the path to the selected folder
  useEffect(() => {
    if (!selectedFolder) return;
    const path: string[] = [];
    let cur = selectedFolder.parentId ? folders.find((f) => f.id === selectedFolder.parentId) : undefined;
    let guard = 0;
    while (cur && guard++ < 30) {
      path.push(cur.id);
      cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined;
    }
    if (path.some((id) => !expanded.has(id))) setExpanded((s) => new Set([...s, ...path]));
  }, [selectedFolder?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleFiles = useMemo(() => {
    const scope = selectedFolder ? folderAndDescendants(folders, selectedFolder.id) : null;
    const s = q.trim().toLowerCase();
    return files
      .filter((f) => !scope || (f.folderId && scope.has(f.folderId)))
      .filter((f) => !s || f.name.toLowerCase().includes(s) || f.tags.some((t) => t.includes(s)) || f.note.toLowerCase().includes(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [files, folders, selectedFolder, q]);

  const summaCount = useMemo(() => documents.filter((d) => d.status !== "duplicate").length, [documents]);
  const summaDocs = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...documents]
      .filter((d) => d.status !== "duplicate")
      .filter((d) => !s || d.originalName.toLowerCase().includes(s) || (d.extraction?.fields.vendorName ?? "").toLowerCase().includes(s) || (d.extraction?.fields.customerName ?? "").toLowerCase().includes(s))
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }, [documents, q]);

  if (!canRead) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dateien" />
        <EmptyState icon={<FolderOpen className="h-8 w-8" />} title="Kein Zugriff" body="Mit deiner Rolle siehst du die Dateiablage nicht. Frag die Inhaberin oder den Inhaber, wenn du sie brauchst." />
      </div>
    );
  }

  /** Where new files go when nothing more specific is chosen. */
  const targetFolderId = () => (selectedFolder ? selectedFolder.id : ensureSystemFolders(requireStore(), profile.id).allgemein);

  const upload = async (incoming: IncomingFile[], folderId?: string) => {
    if (!incoming.length) return;
    setBusy(true);
    try {
      await uploadFiles(profile.id, incoming, { folderId: folderId ?? targetFolderId() });
    } catch (e) {
      toast.error("Hochladen fehlgeschlagen", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const moveFile = (fileId: string, folderId: string) => {
    const f = files.find((x) => x.id === fileId);
    if (!f || f.folderId === folderId) return;
    requireStore().update("files", fileId, { folderId }, "file.move");
    const target = folders.find((x) => x.id === folderId);
    toast.success(`Verschoben nach „${target?.name ?? "Ordner"}“`);
  };

  const deleteFolder = (folder: Folder) => {
    const store = requireStore();
    const fallback = folder.parentId ?? ensureSystemFolders(store, profile.id).allgemein;
    const now = nowIso();
    store.mutate(
      (v) => {
        v.files = v.files.map((f) => (f.folderId === folder.id ? { ...f, folderId: fallback, updatedAt: now } : f));
        v.folders = v.folders.map((f) => (f.id === folder.id ? { ...f, deletedAt: now, updatedAt: now } : f.parentId === folder.id ? { ...f, parentId: folder.parentId, updatedAt: now } : f));
      },
      { audit: { action: "folder.delete", entity: "folders", entityId: folder.id } },
    );
    if (selected === folder.id) setSelected(folder.parentId ?? ALL);
  };

  const toggle = (id: string) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  // dropping files anywhere on the page uploads them into the open folder
  const pageDrop = canWrite
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!hasExternalFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setPageOver(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!hasExternalFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
        },
        onDragLeave: (e: DragEvent) => {
          e.stopPropagation();
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPageOver(false);
        },
        onDrop: async (e: DragEvent) => {
          if (!hasExternalFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setPageOver(false);
          if (selected === SUMMA_FOLDER) {
            toast.info("Rechnungen in der Buchhaltung ablegen", "Zieh sie unter „Eingehende Rechnungen“ hinein, dann liest Ordo sie selbst.");
            return;
          }
          void upload(await filesFromDrop(e.dataTransfer));
        },
      }
    : {};

  const folderDrop = (folderId: string) =>
    canWrite
      ? {
          onDragOver: (e: DragEvent) => {
            const t = e.dataTransfer.types;
            if (!t.includes(INTERNAL) && !t.includes("Files")) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = t.includes(INTERNAL) ? "move" : "copy";
            if (dragOver !== folderId) setDragOver(folderId);
          },
          onDragLeave: (e: DragEvent) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver((d) => (d === folderId ? null : d));
          },
          onDrop: async (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(null);
            setPageOver(false);
            const fileId = e.dataTransfer.getData(INTERNAL);
            if (fileId) moveFile(fileId, folderId);
            else void upload(await filesFromDrop(e.dataTransfer), folderId);
          },
        }
      : {};

  const renderFolder = (f: Folder, depth: number) => {
    const kids = childrenOf.get(f.id) ?? [];
    const open = expanded.has(f.id);
    const active = selected === f.id;
    return (
      <li key={f.id}>
        <div
          {...folderDrop(f.id)}
          className={cls(
            "group flex items-center gap-1 rounded-[10px] pr-2 text-sm transition-colors",
            active ? "bg-brand-50 text-brand-800 dark:bg-brand-950/60 dark:text-brand-200" : "hover:bg-(--surface-2)",
            dragOver === f.id && "ring-2 ring-brand-600",
          )}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          <button type="button" onClick={() => kids.length && toggle(f.id)} className={cls("flex h-7 w-5 shrink-0 items-center justify-center text-(--text-muted)", !kids.length && "invisible")} aria-label={open ? "Zuklappen" : "Aufklappen"}>
            <ChevronRight className={cls("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
          </button>
          <button type="button" onClick={() => setSelected(f.id)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
            {active ? <FolderOpen className="h-4 w-4 shrink-0" /> : <FolderIcon className={cls("h-4 w-4 shrink-0", f.system ? "text-brand-700 dark:text-brand-400" : "text-(--text-muted)")} />}
            <span className={cls("truncate", active && "font-medium")}>{f.name}</span>
          </button>
          {counts.get(f.id) ? <span className="text-xs tabular text-(--text-muted)">{counts.get(f.id)}</span> : null}
        </div>
        {open && kids.length ? <ul>{kids.map((k) => renderFolder(k, depth + 1))}</ul> : null}
      </li>
    );
  };

  const flat = flattenFolders(folders);
  const title = selected === SUMMA_FOLDER ? "Rechnungen" : selectedFolder ? selectedFolder.name : "Alle Dateien";
  const crumbs = selectedFolder?.parentId ? folderPath(folders, selectedFolder.parentId) : "";
  const isProtected = !!selectedFolder?.system;

  return (
    <div {...pageDrop} className="relative space-y-4">
      <PageHeader
        title="Dateien"
        subtitle="Pläne, Verträge, Fotos – verschlüsselt in deinem Tresor. Ordner für Kunden und Projekte legt Ordo selbst an, sobald du dort etwas ablegst."
        actions={
          canWrite ? (
            <>
              <Button variant="outline" onClick={() => setFolderDialog({ mode: "new", parentId: selectedFolder?.id })}>
                <FolderPlus className="h-4 w-4" /> Neuer Ordner
              </Button>
              <Button loading={busy} onClick={async () => void upload(await pickFiles())} disabled={selected === SUMMA_FOLDER}>
                <Upload className="h-4 w-4" /> Hochladen
              </Button>
            </>
          ) : null
        }
      />

      {canWrite && selected !== SUMMA_FOLDER ? <FileDropHint disabled={busy} onChoose={async () => void upload(await pickFiles())}>Dateien in diesen Bereich oder direkt auf einen Ordner ziehen – oder Dateien auswählen</FileDropHint> : null}
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Folder tree (desktop) */}
        <aside className="surface hidden self-start p-2 lg:block">
          <ul className="space-y-0.5">
            <li>
              <button type="button" onClick={() => setSelected(ALL)} className={cls("flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-sm", selected === ALL ? "bg-brand-50 font-medium text-brand-800 dark:bg-brand-950/60 dark:text-brand-200" : "hover:bg-(--surface-2)")}>
                <Files className="h-4 w-4 shrink-0" />
                <span className="flex-1">Alle Dateien</span>
                {files.length ? <span className="text-xs font-normal tabular text-(--text-muted)">{files.length}</span> : null}
              </button>
            </li>
          </ul>
          <ul className="mt-1 space-y-0.5">{(childrenOf.get("") ?? []).map((f) => renderFolder(f, 0))}</ul>
          {summa ? (
            <div className="mt-2 border-t border-(--border) pt-2">
              <button type="button" onClick={() => setSelected(SUMMA_FOLDER)} className={cls("flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-sm", selected === SUMMA_FOLDER ? "bg-brand-50 font-medium text-brand-800 dark:bg-brand-950/60 dark:text-brand-200" : "hover:bg-(--surface-2)")}>
                <ReceiptText className="h-4 w-4 shrink-0" />
                <span className="flex-1">Rechnungen</span>
                {summaCount ? <span className="text-xs font-normal tabular text-(--text-muted)">{summaCount}</span> : null}
              </button>
            </div>
          ) : null}
        </aside>

        <section className="min-w-0 space-y-3">
          {/* Folder choice (phone/tablet) */}
          <div className="lg:hidden">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Ordner">
              <option value={ALL}>Alle Dateien ({files.length})</option>
              {flat.map(({ folder, depth }) => (
                <option key={folder.id} value={folder.id}>
                  {"   ".repeat(depth)}
                  {folder.name}
                  {counts.get(folder.id) ? ` (${counts.get(folder.id)})` : ""}
                </option>
              ))}
              {summa ? <option value={SUMMA_FOLDER}>Rechnungen{summaCount ? ` (${summaCount})` : ""}</option> : null}
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              {crumbs ? <div className="truncate text-xs text-(--text-muted)">{crumbs}</div> : null}
              <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
            </div>
            {selectedFolder && canWrite ? (
              <Menu
                trigger={<Button variant="ghost" size="icon" aria-label="Ordner-Aktionen"><MoreHorizontal className="h-4 w-4" /></Button>}
                items={[
                  { label: "Neuer Unterordner", icon: <FolderPlus className="h-4 w-4" />, onClick: () => setFolderDialog({ mode: "new", parentId: selectedFolder.id }) },
                  { label: isProtected ? "Umbenennen (von Ordo verwaltet)" : "Umbenennen", icon: <Pencil className="h-4 w-4" />, disabled: isProtected, onClick: () => setFolderDialog({ mode: "rename", folder: selectedFolder }) },
                  ...(canAdmin ? [{ label: isProtected ? "Löschen (von Ordo verwaltet)" : "Ordner löschen", icon: <Trash2 className="h-4 w-4" />, danger: !isProtected, disabled: isProtected, onClick: () => setConfirmDeleteFolder(selectedFolder) }] : []),
                ]}
              />
            ) : null}
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name oder Schlagwort …" className="pl-9" />
            </div>
          </div>

          {selected === SUMMA_FOLDER ? (
            <SummaList docs={summaDocs} hasAny={summaCount > 0} onOpen={setOpenDoc} />
          ) : visibleFiles.length ? (
            <div className="surface overflow-hidden">
              <ul className="divide-y divide-(--border)">
                {visibleFiles.map((f) => {
                  const where = f.folderId !== selectedFolder?.id ? folderPath(folders, f.folderId) : "";
                  return (
                    <li
                      key={f.id}
                      draggable={canWrite}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(INTERNAL, f.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDragOver(null)}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-(--surface-2)"
                    >
                      <button type="button" onClick={() => setOpenFile(f.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <FileTile mime={f.mime} name={f.name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{f.name}</span>
                          <span className="block truncate text-xs text-(--text-muted)">
                            {[fmtDate(f.createdAt), fmtBytes(f.size), where].filter(Boolean).join(" · ")}
                          </span>
                          {f.tags.length ? (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {f.tags.map((t) => (
                                <span key={t} className="rounded-full bg-(--surface-2) px-2 py-0.5 text-[11px] font-medium text-(--text-muted)">{t}</span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      {f.links.length ? (
                        <span className="hidden max-w-[40%] flex-wrap justify-end gap-1 xl:flex">
                          {f.links.slice(0, 2).map((l) => (
                            <LinkChip key={`${l.type}:${l.id}`} vault={vault} link={l} />
                          ))}
                          {f.links.length > 2 ? <Badge>+{f.links.length - 2}</Badge> : null}
                        </span>
                      ) : null}
                      <button type="button" onClick={() => void downloadAttachment(f.attachmentId, f.name, f.mime)} className="rounded-lg p-1.5 text-(--text-muted) hover:bg-(--surface) hover:text-(--text)" title="Herunterladen" aria-label={`${f.name} herunterladen`}>
                        <Download className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : q ? (
            <EmptyState icon={<Search className="h-8 w-8" />} title="Nichts gefunden" body={`Keine Datei mit „${q}“ im Namen oder als Schlagwort${selectedFolder ? " in diesem Ordner" : ""}.`} />
          ) : (
            <EmptyState
              icon={<FolderOpen className="h-8 w-8" />}
              title={selectedFolder ? "Dieser Ordner ist leer" : "Noch keine Dateien"}
              body={canWrite ? "Zieh Dateien hierher oder lade sie hoch. Verknüpfst du sie mit einem Kunden oder Projekt, findest du sie auch dort." : "Hier liegt noch nichts."}
              action={canWrite ? <Button loading={busy} onClick={async () => void upload(await pickFiles())}><Upload className="h-4 w-4" /> Dateien hochladen</Button> : undefined}
            />
          )}
          {canWrite && selected !== SUMMA_FOLDER && visibleFiles.length ? <p className="text-xs text-(--text-muted)">Tipp: Zieh eine Datei auf einen Ordner links, um sie zu verschieben.</p> : null}
        </section>
      </div>

      {pageOver ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 lg:bottom-10">
          <div className="glass-strong rounded-full px-4 py-2 text-sm font-medium shadow-pop">
            {selected === SUMMA_FOLDER ? "Rechnungen bitte in Ordo ablegen" : `Loslassen – landet in „${dragOver ? folders.find((f) => f.id === dragOver)?.name ?? "Ordner" : selectedFolder?.name ?? "Allgemein"}“`}
          </div>
        </div>
      ) : null}

      <FileDetail fileId={openFile} onClose={() => setOpenFile(null)} />
      <SummaDocModal doc={openDoc} onClose={() => setOpenDoc(null)} onOpenInSumma={(d) => navigate(`/belege/${d.id}`)} />
      <FolderDialog state={folderDialog} profileId={profile.id} onClose={() => setFolderDialog(null)} onCreated={(id) => setSelected(id)} />
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} defaultFolderId={selectedFolder?.id} onUpload={upload} />
      <ConfirmDialog
        open={!!confirmDeleteFolder}
        onClose={() => setConfirmDeleteFolder(null)}
        danger
        title="Ordner löschen?"
        body={confirmDeleteFolder ? `„${confirmDeleteFolder.name}“ wird gelöscht. Dateien und Unterordner darin bleiben erhalten und wandern nach „${confirmDeleteFolder.parentId ? folders.find((f) => f.id === confirmDeleteFolder.parentId)?.name ?? "oben" : "Allgemein"}“.` : ""}
        confirmLabel="Ordner löschen"
        onConfirm={() => {
          if (confirmDeleteFolder) deleteFolder(confirmDeleteFolder);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ordo's invoices (read-only)                                        */
/* ------------------------------------------------------------------ */

function docPartner(d: SummaDocument): string {
  const f = d.extraction?.fields;
  return (d.direction === "outgoing" ? f?.customerName : f?.vendorName) ?? f?.vendorName ?? f?.customerName ?? "";
}

function SummaList({ docs, hasAny, onOpen }: { docs: SummaDocument[]; hasAny: boolean; onOpen: (d: SummaDocument) => void }) {
  if (!docs.length) {
    return <EmptyState icon={<ReceiptText className="h-8 w-8" />} title={hasAny ? "Nichts gefunden" : "Noch keine Rechnungen in Ordo"} body={hasAny ? "Keine Rechnung passt zur Suche." : "Rechnungen und Kassenbons, die Ordo liest, erscheinen hier automatisch – zum Ansehen und Herunterladen."} />;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-(--text-muted)">Die Rechnungen, die Ordo gelesen hat. Hier nur zum Ansehen – bearbeitet werden sie unter „Rechnungen“.</p>
      <div className="surface overflow-hidden">
        <ul className="divide-y divide-(--border)">
          {docs.map((d) => {
            const date = d.extraction?.fields.invoiceDate ?? d.importedAt.slice(0, 10);
            return (
              <li key={d.id}>
                <button type="button" onClick={() => onOpen(d)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-(--surface-2)">
                  <FileTile mime={d.mime} name={d.originalName} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{docPartner(d) || d.originalName}</span>
                    <span className="block truncate text-xs text-(--text-muted)">{[fmtDate(date), docPartner(d) ? d.originalName : ""].filter(Boolean).join(" · ")}</span>
                  </span>
                  {d.status === "review" || d.status === "inbox" || d.status === "processing" ? <Badge tone="warning">offen</Badge> : d.direction === "outgoing" ? <Badge>Ausgang</Badge> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function SummaDocModal({ doc, onClose, onOpenInSumma }: { doc: SummaDocument | null; onClose: () => void; onOpenInSumma: (d: SummaDocument) => void }) {
  const [busy, setBusy] = useState(false);
  if (!doc) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={<span className="block max-w-[60vw] truncate">{docPartner(doc) || doc.originalName}</span>}
      size="lg"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => { onOpenInSumma(doc); onClose(); }}>In Ordo öffnen</Button>
          <Button variant="outline" loading={busy} onClick={async () => { setBusy(true); await downloadAttachment(doc.attachmentId, doc.originalName, doc.mime); setBusy(false); }}>
            <Download className="h-4 w-4" /> Herunterladen
          </Button>
          <Button onClick={onClose}>Fertig</Button>
        </>
      }
    >
      <div className="h-[65vh]">
        <DocumentViewer doc={doc} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

function FolderDialog({ state, profileId, onClose, onCreated }: { state: { mode: "new"; parentId?: string } | { mode: "rename"; folder: Folder } | null; profileId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const folders = useList("folders");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("");
  useEffect(() => {
    if (!state) return;
    setName(state.mode === "rename" ? state.folder.name : "");
    setParentId(state.mode === "new" ? state.parentId ?? "" : "");
  }, [state]);
  if (!state) return null;
  const save = () => {
    const n = name.trim();
    if (!n) {
      toast.warning("Gib dem Ordner einen Namen.");
      return;
    }
    const store = requireStore();
    if (state.mode === "rename") {
      store.update("folders", state.folder.id, { name: n }, "folder.rename");
    } else {
      const siblings = folders.filter((f) => (f.parentId ?? "") === parentId);
      if (siblings.some((f) => f.name.toLowerCase() === n.toLowerCase())) {
        toast.warning("Diesen Ordner gibt es hier schon.");
        return;
      }
      const now = nowIso();
      const folder: Folder = { id: ids.folder(), profileId, parentId: parentId || undefined, name: n, system: false, createdAt: now, updatedAt: now };
      store.insert("folders", folder, "folder.create");
      onCreated(folder.id);
    }
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={state.mode === "rename" ? "Ordner umbenennen" : "Neuer Ordner"} size="sm" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={save}>{state.mode === "rename" ? "Speichern" : "Anlegen"}</Button></>}>
      <div className="space-y-3">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="z. B. Verträge" />
        </Field>
        {state.mode === "new" ? (
          <Field label="Liegt in">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Oberste Ebene</option>
              {flattenFolders(folders).map(({ folder, depth }) => (
                <option key={folder.id} value={folder.id}>
                  {"  ".repeat(depth)}
                  {folder.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

function UploadDialog({ open, onClose, defaultFolderId, onUpload }: { open: boolean; onClose: () => void; defaultFolderId?: string; onUpload: (files: IncomingFile[], folderId?: string) => Promise<void> }) {
  const profile = useProfile();
  const folders = useList("folders");
  const [folderId, setFolderId] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFolderId(defaultFolderId ?? ensureSystemFolders(requireStore(), profile.id).allgemein);
  }, [open, defaultFolderId, profile.id]);
  if (!open) return null;
  const go = async (incoming: IncomingFile[]) => {
    if (!incoming.length) return;
    setBusy(true);
    await onUpload(incoming, folderId || undefined);
    setBusy(false);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Dateien hochladen" size="md" footer={<Button variant="ghost" onClick={onClose}>Abbrechen</Button>}>
      <div className="space-y-4">
        <Field label="In Ordner">
          <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            {flattenFolders(folders).map(({ folder, depth }) => (
              <option key={folder.id} value={folder.id}>
                {"  ".repeat(depth)}
                {folder.name}
              </option>
            ))}
          </Select>
        </Field>
        <div
          onDragEnter={(e) => { if (hasExternalFiles(e)) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
          onDragOver={(e) => { if (hasExternalFiles(e)) { e.preventDefault(); e.stopPropagation(); } }}
          onDragLeave={(e) => { e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
          onDrop={async (e) => { if (!hasExternalFiles(e)) return; e.preventDefault(); e.stopPropagation(); setOver(false); void go(await filesFromDrop(e.dataTransfer)); }}
          className={cls("flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center", over ? "border-brand-600 bg-brand-50/60 dark:bg-brand-950/40" : "border-(--border)")}
        >
          <Upload className="h-8 w-8 text-brand-700 dark:text-brand-400" />
          <div className="text-sm text-(--text-muted)">Dateien hierher ziehen – oder</div>
          <Button loading={busy} onClick={async () => void go(await pickFiles())}>Dateien auswählen</Button>
        </div>
      </div>
    </Modal>
  );
}
