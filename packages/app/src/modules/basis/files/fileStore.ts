import { ids, nowIso, type EntityLink, type FileEntry, type Folder, type Vault, type VaultStore } from "@ordo/core";
import { requirePlatform, requireStore } from "@/state/session";
import { ensureBlob } from "@/services/sync";
import { toast } from "@/state/toasts";

/* ------------------------------------------------------------------ */
/* System folders                                                      */
/* ------------------------------------------------------------------ */

/**
 * Root folders every workspace has. They are marked with owner { type: "system", id: key } so they are found
 * again even if someone renames them (an importer may create "Kunden" etc. too – a root folder with the same name
 * is adopted instead of creating a second one).
 */
export const SYSTEM_ROOTS = [
  { key: "kunden", name: "Kunden" },
  { key: "projekte", name: "Projekte" },
  { key: "allgemein", name: "Allgemein" },
] as const;
export type SystemRootKey = (typeof SYSTEM_ROOTS)[number]["key"];

/** Virtual folder in the tree that lists Ordo's incoming/outgoing invoice files (read-only). */
export const SUMMA_FOLDER = "__summa";

const live = (f: { deletedAt?: string }) => !f.deletedAt;

function findRoot(folders: Folder[], profileId: string, key: string, name: string): Folder | undefined {
  const mine = folders.filter((f) => live(f) && f.profileId === profileId && !f.parentId);
  return mine.find((f) => f.owner?.type === "system" && f.owner.id === key) ?? mine.find((f) => f.name.trim().toLowerCase() === name.toLowerCase());
}

/** Creates the system folders Kunden, Projekte, Allgemein once per profile and returns their ids. */
export function ensureSystemFolders(store: VaultStore, profileId: string): Record<SystemRootKey, string> {
  const out = {} as Record<SystemRootKey, string>;
  const created: Folder[] = [];
  const adopt = new Map<string, SystemRootKey>();
  const now = nowIso();
  for (const r of SYSTEM_ROOTS) {
    const f = findRoot(store.vault.folders, profileId, r.key, r.name);
    if (f) {
      out[r.key] = f.id;
      if (!f.system || f.owner?.type !== "system") adopt.set(f.id, r.key);
    } else {
      const folder: Folder = { id: ids.folder(), profileId, name: r.name, system: true, owner: { type: "system", id: r.key }, createdAt: now, updatedAt: now };
      created.push(folder);
      out[r.key] = folder.id;
    }
  }
  if (created.length || adopt.size) {
    store.mutate((v) => {
      v.folders = [...v.folders.map((f) => (adopt.has(f.id) ? { ...f, system: true, owner: { type: "system", id: adopt.get(f.id)! }, updatedAt: now } : f)), ...created];
    });
  }
  return out;
}

/** The record whose folder a file for `link` belongs into (customer or project), or null for "Allgemein". */
export function folderOwnerFor(vault: Vault, link: EntityLink): EntityLink | null {
  const byProjectOrCustomer = (x: { projectId?: string; customerId?: string } | undefined): EntityLink | null =>
    x?.projectId ? { type: "project", id: x.projectId } : x?.customerId ? { type: "contact", id: x.customerId } : null;
  switch (link.type) {
    case "contact":
    case "project":
      return link;
    case "task": {
      const t = vault.tasks.find((x) => x.id === link.id);
      return t ? { type: "project", id: t.projectId } : null;
    }
    case "offer":
      return byProjectOrCustomer(vault.offers.find((x) => x.id === link.id));
    case "invoice":
      return byProjectOrCustomer(vault.invoices.find((x) => x.id === link.id));
    case "workOrder":
      return byProjectOrCustomer(vault.workOrders.find((x) => x.id === link.id));
    case "transaction": {
      const t = vault.transactions.find((x) => x.id === link.id);
      return t?.projectId ? { type: "project", id: t.projectId } : t?.contactId ? { type: "contact", id: t.contactId } : null;
    }
    default:
      return null;
  }
}

function ownerFolderName(vault: Vault, owner: EntityLink): string | null {
  if (owner.type === "contact") {
    const c = vault.contacts.find((x) => x.id === owner.id);
    return c ? (c.number ? `${c.name} · ${c.number}` : c.name) : null;
  }
  if (owner.type === "project") {
    const p = vault.projects.find((x) => x.id === owner.id);
    return p ? (p.number ? `${p.number} · ${p.name}` : p.name) : null;
  }
  return null;
}

/** Folder of a record, e.g. Kunden/Alpenblick Hotel · K-0001 – created the first time a file is added there. */
export function findOwnerFolder(vault: Vault, profileId: string, owner: EntityLink): Folder | undefined {
  return vault.folders.find((f) => live(f) && f.profileId === profileId && f.owner?.type === owner.type && f.owner.id === owner.id);
}

/** Returns the folder id where a file for `link` should go, creating system and record folders when needed. */
export function ensureFolderFor(store: VaultStore, profileId: string, link: EntityLink): string {
  const roots = ensureSystemFolders(store, profileId);
  const owner = folderOwnerFor(store.vault, link);
  if (!owner) return roots.allgemein;
  const name = ownerFolderName(store.vault, owner);
  if (!name) return roots.allgemein;
  const existing = findOwnerFolder(store.vault, profileId, owner);
  if (existing) {
    if (existing.name !== name) store.update("folders", existing.id, { name });
    return existing.id;
  }
  const now = nowIso();
  const folder: Folder = { id: ids.folder(), profileId, parentId: owner.type === "contact" ? roots.kunden : roots.projekte, name, system: true, owner, createdAt: now, updatedAt: now };
  store.insert("folders", folder, "folder.create");
  return folder.id;
}

/** All ids of a folder and its subfolders. */
export function folderAndDescendants(folders: Folder[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Folders as a flat list in tree order with depth (for selects). */
export function flattenFolders(folders: Folder[]): { folder: Folder; depth: number }[] {
  const byParent = new Map<string, Folder[]>();
  for (const f of folders) {
    const k = f.parentId ?? "";
    (byParent.get(k) ?? byParent.set(k, []).get(k)!).push(f);
  }
  const order = (list: Folder[]) => [...list].sort((a, b) => Number(b.system && !b.parentId) - Number(a.system && !a.parentId) || a.name.localeCompare(b.name, "de"));
  const out: { folder: Folder; depth: number }[] = [];
  const known = new Set(folders.map((f) => f.id));
  const seen = new Set<string>();
  const walk = (parent: string, depth: number) => {
    for (const f of order(byParent.get(parent) ?? [])) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk("", 0);
  // orphans (parent deleted) go to the top level
  for (const f of folders) {
    if (f.parentId && !known.has(f.parentId) && !seen.has(f.id)) {
      seen.add(f.id);
      out.push({ folder: f, depth: 0 });
      walk(f.id, 1);
    }
  }
  return out;
}

/** "Kunden / Alpenblick Hotel" */
export function folderPath(folders: Folder[], id: string | undefined): string {
  const parts: string[] = [];
  let cur = folders.find((f) => f.id === id);
  let guard = 0;
  while (cur && guard++ < 20) {
    parts.unshift(cur.name);
    cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined;
  }
  return parts.join(" / ");
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

export interface IncomingFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  dwg: "image/vnd.dwg",
  dxf: "image/vnd.dxf",
  step: "model/step",
  stp: "model/step",
  stl: "model/stl",
};

export function guessMime(name: string, given?: string): string {
  if (given && given !== "application/octet-stream") return given;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export type PreviewKind = "image" | "pdf" | "text" | null;
export function previewKind(mime: string, name: string): PreviewKind {
  const m = guessMime(name, mime);
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/") && !["image/heic", "image/vnd.dwg", "image/vnd.dxf"].includes(m)) return "image";
  if (m.startsWith("text/") || m === "application/json" || m === "application/xml") return "text";
  return null;
}

/** Reads files from a drop event (external files only). */
export async function filesFromDrop(dt: DataTransfer | null): Promise<IncomingFile[]> {
  const list = [...(dt?.files ?? [])];
  return Promise.all(list.map(async (f) => ({ name: f.name, mime: guessMime(f.name, f.type), bytes: new Uint8Array(await f.arrayBuffer()) })));
}

export async function pickFiles(): Promise<IncomingFile[]> {
  const picked = await requirePlatform().pickFiles({ multiple: true });
  return picked.map((p) => ({ name: p.name, mime: guessMime(p.name, p.mime), bytes: p.bytes }));
}

/** Stores the files encrypted in the vault and lists them in the file store. */
export async function uploadFiles(profileId: string, files: IncomingFile[], opts: { folderId?: string; links?: EntityLink[] } = {}): Promise<FileEntry[]> {
  const store = requireStore();
  const out: FileEntry[] = [];
  const tooBig = files.filter((f) => f.bytes.byteLength > MAX_FILE_BYTES);
  for (const f of files) {
    if (f.bytes.byteLength > MAX_FILE_BYTES) continue;
    const mime = guessMime(f.name, f.mime);
    const att = await store.putAttachment(profileId, f.bytes, { name: f.name, mime });
    const now = nowIso();
    const entry: FileEntry = { id: ids.file(), profileId, folderId: opts.folderId, attachmentId: att.id, name: f.name, mime, size: f.bytes.byteLength, tags: [], links: opts.links ?? [], note: "", createdAt: now, updatedAt: now };
    store.insert("files", entry, "file.upload");
    out.push(entry);
  }
  if (tooBig.length) toast.warning(`${tooBig.length === 1 ? "Eine Datei ist" : `${tooBig.length} Dateien sind`} zu groß`, "Höchstens 50 MB pro Datei.");
  if (out.length) toast.success(out.length === 1 ? `„${out[0]!.name}“ gespeichert` : `${out.length} Dateien gespeichert`);
  return out;
}

/** Decrypted bytes of an attachment, fetched from the sync server when this device does not have it yet. */
export async function attachmentBytes(attachmentId: string): Promise<Uint8Array | null> {
  const store = requireStore();
  let bytes = await store.getAttachmentBytes(attachmentId);
  if (!bytes && (await ensureBlob(attachmentId, store.storage))) bytes = await store.getAttachmentBytes(attachmentId);
  return bytes;
}

export async function downloadAttachment(attachmentId: string, name: string, mime: string): Promise<void> {
  try {
    const bytes = await attachmentBytes(attachmentId);
    if (!bytes) {
      toast.error("Datei nicht gefunden", "Sie ist auf diesem Gerät noch nicht vorhanden.");
      return;
    }
    await requirePlatform().saveFile(name, bytes, mime);
  } catch (e) {
    toast.error("Download fehlgeschlagen", e instanceof Error ? e.message : String(e));
  }
}

/** Removes the file entry and its encrypted content (unless something else still uses the same content). */
export async function deleteFileEntry(file: FileEntry): Promise<void> {
  const store = requireStore();
  store.softDelete("files", file.id, "file.delete");
  const v = store.vault;
  const stillUsed =
    v.files.some((f) => !f.deletedAt && f.id !== file.id && f.attachmentId === file.attachmentId) ||
    v.documents.some((d) => !d.deletedAt && (d.attachmentId === file.attachmentId || d.previewAttachmentId === file.attachmentId)) ||
    v.invoices.some((i) => !i.deletedAt && i.pdfAttachmentId === file.attachmentId);
  if (!stillUsed) {
    try {
      await store.deleteAttachment(file.attachmentId);
    } catch {
      /* the entry is gone either way */
    }
  }
}

export function normalizeTag(t: string): string {
  return t.trim().replace(/^#/, "").replace(/\s+/g, " ").toLowerCase();
}

export function sameLink(a: EntityLink, b: EntityLink): boolean {
  return a.type === b.type && a.id === b.id;
}

/* ------------------------------------------------------------------ */
/* Links to records                                                    */
/* ------------------------------------------------------------------ */

export const LINK_TYPE_LABELS: Record<EntityLink["type"], string> = {
  contact: "Kontakt",
  project: "Projekt",
  task: "Aufgabe",
  offer: "Angebot",
  invoice: "Rechnung",
  product: "Produkt",
  workOrder: "Fertigungsauftrag",
  transaction: "Buchung",
  member: "Team",
};

/** Human label of a linked record, e.g. "P-0003 · Website Relaunch". Null when the record is gone. */
export function linkLabel(vault: Vault, link: EntityLink): string | null {
  const join = (...p: (string | undefined)[]) => p.filter(Boolean).join(" · ");
  switch (link.type) {
    case "contact": {
      const c = vault.contacts.find((x) => x.id === link.id && !x.deletedAt);
      return c ? join(c.number, c.name) : null;
    }
    case "project": {
      const p = vault.projects.find((x) => x.id === link.id && !x.deletedAt);
      return p ? join(p.number, p.name) : null;
    }
    case "task": {
      const t = vault.tasks.find((x) => x.id === link.id && !x.deletedAt);
      return t ? t.title : null;
    }
    case "offer": {
      const o = vault.offers.find((x) => x.id === link.id && !x.deletedAt);
      return o ? join(o.number, o.subject) : null;
    }
    case "invoice": {
      const i = vault.invoices.find((x) => x.id === link.id && !x.deletedAt);
      return i ? join(i.number, i.customerSnapshot.name) : null;
    }
    case "product": {
      const p = vault.products.find((x) => x.id === link.id && !x.deletedAt);
      return p ? join(p.sku, p.name) : null;
    }
    case "workOrder": {
      const w = vault.workOrders.find((x) => x.id === link.id && !x.deletedAt);
      if (!w) return null;
      return join(w.number, vault.products.find((p) => p.id === w.productId)?.name);
    }
    case "transaction": {
      const t = vault.transactions.find((x) => x.id === link.id && !x.deletedAt);
      return t ? t.description || t.invoiceNumber || "Buchung" : null;
    }
    case "member": {
      const m = vault.members.find((x) => x.id === link.id && !x.deletedAt);
      return m ? m.name : null;
    }
  }
}

/** Where a linked record opens in the app. */
export function linkHref(vault: Vault, link: EntityLink): string | null {
  switch (link.type) {
    case "contact":
      return `/kontakte/${link.id}`;
    case "project":
      return `/projekte/${link.id}`;
    case "task": {
      const t = vault.tasks.find((x) => x.id === link.id);
      return t ? `/projekte/${t.projectId}` : null;
    }
    case "offer":
      return `/angebote/${link.id}`;
    case "invoice":
      return `/rechnungen/${link.id}`;
    case "product":
      return `/produkte/${link.id}`;
    case "workOrder":
      return `/produktion/${link.id}`;
    case "transaction":
      return "/buchungen";
    case "member":
      return "/team";
  }
}
