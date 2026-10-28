import { create } from "zustand";
import {
  decideAutoBook,
  extractDocument,
  fieldStates,
  usageCostCents,
  sha256Hex,
  nowIso,
  ids,
  mimeFor,
  transactionFromExtraction,
  type SummaDocument,
  type DocumentSource,
  type Transaction,
} from "@ordo/core";
import { requirePlatform, requireStore, useSession } from "@/state/session";
import { recordAiUsage } from "./aiUsage";
import { toast, useToasts } from "@/state/toasts";
import { fmtMoney } from "@/lib/format";
import { aiErrorCode, aiErrorMessage, createProvider, getTextExtractor } from "./extraction";
import { bookDocument, reopenDocument } from "./booking";
import { PHOTO, PREVIEW, jpgName, shrinkImage } from "@/lib/shrink";

export interface ImportJob {
  id: string;
  name: string;
  size: number;
  status: "queued" | "hashing" | "extracting" | "ocr" | "ai" | "done" | "duplicate" | "error";
  detail?: string;
  documentId?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

interface ImporterState {
  jobs: ImportJob[];
  running: boolean;
  enqueue(files: { name: string; mime?: string; bytes: Uint8Array; path?: string; source: DocumentSource; direction?: "incoming" | "outgoing" }[]): void;
  clearFinished(): void;
  /** "Neu lesen" / "Mit KI lesen" from the review screen: toasts on failure, never throws. */
  reprocess(documentId: string, opts?: ReprocessOptions): Promise<ReprocessResult | undefined>;
}

export interface ReprocessOptions {
  /** Read with the AI regardless of strategy (no local OCR); on failure the document stays as it was. */
  forceAi?: boolean;
  signal?: AbortSignal;
  /** No toasts per document (bulk runs show their own summary). */
  quiet?: boolean;
  /**
   * Booked documents stay booked; only when the new reading disagrees on amount or date they go back to
   * review (the booking itself is never changed without the person).
   */
  keepBooking?: boolean;
  onStatus?: (detail: string) => void;
}

export interface ReprocessResult {
  status: SummaDocument["status"];
  autoBooked: boolean;
  /** Date, amount, partner (and VAT where it matters) read with confidence. */
  confident: boolean;
  overall: number;
  provider: string;
  model?: string;
  /** What the AI calls cost, in US cents (Claude only). */
  costCents: number;
  /** A booked document went back to review because the new reading disagrees. */
  reopened?: boolean;
  aiError?: string;
}

type QueuedFile = { name: string; mime: string; bytes: Uint8Array; path?: string; source: DocumentSource; direction?: "incoming" | "outgoing" };
const queue: { job: ImportJob; file: QueuedFile }[] = [];

export const useImporter = create<ImporterState>((set, get) => ({
  jobs: [],
  running: false,
  enqueue(files) {
    const jobs: ImportJob[] = [];
    for (const f of files) {
      const job: ImportJob = { id: ids.document(), name: f.name, size: f.bytes.byteLength, status: "queued" };
      jobs.push(job);
      queue.push({ job, file: { ...f, mime: f.mime || mimeFor(f.name) } });
    }
    set({ jobs: [...get().jobs, ...jobs] });
    void pump();
  },
  clearFinished() {
    set({ jobs: get().jobs.filter((j) => j.status !== "done" && j.status !== "duplicate" && j.status !== "error") });
  },
  async reprocess(documentId, opts = {}) {
    try {
      return await reprocessDocument(documentId, opts);
    } catch (e) {
      if (aiErrorCode(e) !== "aborted") toast.error(opts.forceAi ? "Lesen mit KI fehlgeschlagen" : "Erkennung fehlgeschlagen", aiErrorMessage(e));
      return undefined;
    }
  },
}));

/**
 * Reads a stored document again. Throws on failure: with `forceAi` the document is left exactly as it was
 * (so a bulk run can retry), otherwise it is marked as not readable.
 */
export async function reprocessDocument(documentId: string, opts: ReprocessOptions = {}): Promise<ReprocessResult> {
  const store = requireStore();
  const doc = store.byId("documents", documentId);
  if (!doc || doc.deletedAt) throw new Error("Die Rechnung gibt es nicht mehr.");
  const bytes = await store.getAttachmentBytes(doc.attachmentId);
  if (!bytes) throw new Error("Die Datei zu dieser Rechnung fehlt.");
  const before = { status: doc.status, error: doc.error };
  store.update("documents", documentId, { status: "processing", error: undefined });
  try {
    return await runExtraction(doc, bytes, (_s, detail) => {
      if (detail) opts.onStatus?.(detail);
    }, doc.originalName, doc.mime, opts);
  } catch (e) {
    if (store !== useSession.getState().store) throw e; // vault locked meanwhile – nothing to restore
    if (opts.forceAi) store.update("documents", documentId, before);
    else store.update("documents", documentId, { status: "error", error: aiErrorMessage(e) });
    throw e;
  }
}

function patchJob(id: string, patch: Partial<ImportJob>) {
  useImporter.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
}

async function pump() {
  if (useImporter.getState().running) return;
  useImporter.setState({ running: true });
  try {
    while (queue.length) {
      const next = queue.shift()!;
      try {
        await processOne(next.job, next.file);
      } catch (e) {
        // e.g. vault locked between enqueue and processing – never leave a job stuck on "wartet"
        patchJob(next.job.id, { status: "error", error: e instanceof Error ? e.message : String(e), finishedAt: Date.now() });
      }
    }
  } finally {
    useImporter.setState({ running: false });
  }
}

async function processOne(job: ImportJob, file: QueuedFile) {
  const store = requireStore();
  const profile = store.activeProfile;
  patchJob(job.id, { status: "hashing", startedAt: Date.now() });
  if (file.source === "bank") {
    try {
      const { importBankStatement } = await import("./bankImport");
      patchJob(job.id, { status: "extracting", detail: "Kontoauszug wird gelesen …" });
      const r = await importBankStatement(file, (d) => patchJob(job.id, { status: "extracting", detail: d }));
      patchJob(job.id, { status: "done", detail: `${r.added} Umsätze · ${r.autoMatched} zugeordnet`, finishedAt: Date.now() });
      toast.success(`Kontoauszug importiert: ${file.name}`, `${r.added} Umsätze (${r.duplicates} bekannt) · ${r.autoMatched} automatisch zugeordnet · ${r.suggested} Vorschläge`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patchJob(job.id, { status: msg.includes("bereits importiert") ? "duplicate" : "error", error: msg, finishedAt: Date.now() });
      if (!msg.includes("bereits importiert")) toast.error(`Kontoauszug: ${file.name}`, msg);
    }
    return;
  }
  try {
    const sha = await sha256Hex(file.bytes);
    const dup = store.list("documents", { profileId: profile.id }).find((d) => d.sha256 === sha);
    if (dup) {
      patchJob(job.id, { status: "duplicate", detail: `Bereits vorhanden: ${dup.originalName}`, documentId: dup.id, finishedAt: Date.now() });
      return;
    }
    // big phone photos are stored smaller (still easy to read); PDFs and e-invoices stay exactly as they came
    const photo = file.mime.startsWith("image/") && file.bytes.byteLength > PHOTO.minBytes ? await shrinkImage(file.bytes, file.mime, PHOTO.maxSide, PHOTO.quality) : null;
    const attachment = await store.putAttachment(profile.id, photo?.bytes ?? file.bytes, photo ? { name: jpgName(file.name), mime: photo.mime, width: photo.width, height: photo.height } : { name: file.name, mime: file.mime });
    const now = nowIso();
    const doc: SummaDocument = {
      id: job.id,
      profileId: profile.id,
      attachmentId: attachment.id,
      originalName: file.name,
      originalPath: file.path,
      mime: file.mime,
      sha256: sha,
      source: file.source,
      direction: file.direction,
      importedAt: now,
      status: "processing",
      createdAt: now,
      updatedAt: now,
    };
    store.insert("documents", doc, "document.import");
    patchJob(job.id, { status: "extracting", documentId: doc.id });
    await runExtraction(doc, file.bytes, (status, detail) => patchJob(job.id, { status, detail }), file.name, file.mime);
    patchJob(job.id, { status: "done", finishedAt: Date.now() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    patchJob(job.id, { status: "error", error: msg, finishedAt: Date.now() });
    if (store.byId("documents", job.id)) store.update("documents", job.id, { status: "error", error: msg });
  }
}

async function runExtraction(doc: SummaDocument, bytes: Uint8Array, onStatus: (s: ImportJob["status"], detail?: string) => void, name: string, mime: string, opts: ReprocessOptions = {}): Promise<ReprocessResult> {
  const store = requireStore();
  const platform = requirePlatform();
  const vault = store.vault;
  // The document's own profile – a bulk run keeps going correctly when the person switches profiles.
  const profile = vault.profiles.find((p) => p.id === doc.profileId && !p.deletedAt) ?? store.activeProfile;
  const settings = vault.settings;
  const provider = createProvider(settings, platform);
  const outcome = await extractDocument(bytes, name, mime, {
    profile,
    settings,
    categories: vault.categories,
    contacts: vault.contacts.filter((c) => !c.deletedAt && c.profileId === profile.id),
    textExtractor: getTextExtractor(settings),
    provider: settings.ai.autoExtract || opts.forceAi ? provider : undefined,
    forceAi: opts.forceAi,
    signal: opts.signal,
    forceDirection: doc.direction,
    onProgress: (stage, detail) => {
      if (stage === "text") onStatus("extracting", "Text wird gelesen …");
      if (stage === "ocr") onStatus("ocr", "OCR läuft …");
      if (stage === "ai") onStatus("ai", `KI liest (${detail}) …`);
    },
  });
  // The vault may have been locked while the AI was reading – never write into a closed store.
  if (useSession.getState().store !== store) throw new Error("Tresor ist gesperrt.");
  const current = store.byId("documents", doc.id);
  if (!current || current.deletedAt) throw new Error("Die Rechnung wurde inzwischen gelöscht.");
  const costCents = outcome.aiUsage.reduce((s, u) => s + (usageCostCents(u.model, u.usage) ?? 0), 0);
  // the monthly KI-Verbrauch statistics: ChatGPT login (Codex) and Ollama cost nothing per call
  const flat = outcome.extraction.provider === "codex" || outcome.extraction.provider === "ollama";
  for (const u of outcome.aiUsage) recordAiUsage({ feature: "invoices", model: u.model, inputTokens: u.usage?.inputTokens, outputTokens: u.usage?.outputTokens, costCents: flat ? 0 : undefined });
  const confidentRead = (ex: typeof outcome.extraction) => fieldStates(ex, { mode: profile.mode, vatRegime: profile.vatRegime }).filter((f) => f.key !== "category" && f.key !== "invoiceNumber").every((f) => f.state === "ok");
  let previewAttachmentId: string | undefined;
  if (outcome.local.previewPng && outcome.local.kind === "pdf" && !doc.previewAttachmentId) {
    const small = await shrinkImage(outcome.local.previewPng, "image/png", PREVIEW.maxSide, PREVIEW.quality);
    const prev = small
      ? await store.putAttachment(profile.id, small.bytes, { name: `${name}.preview.jpg`, mime: small.mime, width: small.width, height: small.height })
      : await store.putAttachment(profile.id, outcome.local.previewPng, { name: `${name}.preview.png`, mime: "image/png", width: outcome.local.width, height: outcome.local.height });
    previewAttachmentId = prev.id;
  }
  // Draft transaction (unreviewed) so that numbers already show up as "offen" in reports.
  const draft: Transaction = transactionFromExtraction(profile, outcome.extraction, outcome.suggestion, vault.categories, doc.id);
  const existingTx = doc.transactionId ? store.byId("transactions", doc.transactionId) : undefined;
  const base = { overall: outcome.extraction.overall, provider: outcome.extraction.provider, model: outcome.extraction.model, costCents, aiError: outcome.aiError };
  if (opts.keepBooking && existingTx?.reviewed && !existingTx.deletedAt) {
    // Booked: keep the booking, refresh what was read; disagreement on amount or date goes back to the person.
    const reasons: string[] = [];
    const de = (iso: string) => iso.split("-").reverse().join(".");
    if (draft.grossCents && draft.grossCents !== existingTx.grossCents) reasons.push(`Neu gelesen: ${fmtMoney(draft.grossCents)} statt gebucht ${fmtMoney(existingTx.grossCents)}`);
    const readDate = outcome.extraction.fields.invoiceDate;
    if (readDate && readDate !== existingTx.date) reasons.push(`Neu gelesen: Datum ${de(readDate)} statt gebucht ${de(existingTx.date)}`);
    if (reasons.length) {
      store.update("documents", doc.id, { status: "review", extraction: outcome.extraction, autoBooked: false, reviewedAt: undefined, error: undefined, autoBookReasons: reasons }, "document.extracted");
      store.update("transactions", existingTx.id, { reviewed: false, autoBooked: false }, "transaction.reopen");
      return { ...base, status: "review", autoBooked: false, confident: confidentRead(outcome.extraction), reopened: true };
    }
    store.update("documents", doc.id, { status: "approved", extraction: outcome.extraction, error: undefined }, "document.extracted");
    return { ...base, status: "approved", autoBooked: false, confident: confidentRead(outcome.extraction) };
  }
  if (existingTx && !existingTx.reviewed) {
    store.update("transactions", existingTx.id, { ...draft, id: existingTx.id, createdAt: existingTx.createdAt });
  } else if (!existingTx) {
    store.insert("transactions", draft, "transaction.draft");
  }
  const txId = existingTx?.id ?? draft.id;
  const tx = store.byId("transactions", txId);
  // Confident result from a trusted source → book it right away; the user can still correct it later.
  const decision = tx && !tx.reviewed
    ? decideAutoBook({ extraction: outcome.extraction, sources: outcome.sources, qrKinds: outcome.qrKinds, aiError: outcome.aiError, suggestion: outcome.suggestion, tx, ai: settings.ai, profile, categories: vault.categories, existingTxs: store.list("transactions", { profileId: profile.id }) })
    : { ok: false, reasons: [] };
  store.update("documents", doc.id, {
    status: "review",
    extraction: outcome.extraction,
    previewAttachmentId: previewAttachmentId ?? doc.previewAttachmentId,
    transactionId: txId,
    error: outcome.aiError,
    autoBookReasons: decision.ok || settings.ai.autoBook === "off" ? undefined : decision.reasons,
  }, "document.extracted");
  if (decision.ok && tx) {
    const fresh = store.byId("documents", doc.id)!;
    const saved = bookDocument(fresh, tx, { auto: true, extraction: outcome.extraction });
    onStatus("done", "automatisch gebucht");
    if (!opts.quiet) useToasts.getState().push({
      kind: "success",
      title: "Automatisch gebucht",
      body: `${fmtMoney(saved.grossCents)} · ${saved.description || name}`,
      timeout: 8000,
      action: { label: "Korrigieren", onClick: () => { const d = requireStore().byId("documents", doc.id); if (d) reopenDocument(d); window.location.hash = `#/belege/${doc.id}`; } },
    });
  }
  if (outcome.aiError && !opts.quiet) toast.warning("KI-Erkennung fehlgeschlagen", outcome.aiError.slice(0, 200));
  void useSession.getState().touch();
  return { ...base, status: decision.ok ? "approved" : "review", autoBooked: decision.ok, confident: decision.ok || confidentRead(outcome.extraction) };
}

/** Returns true if files were accepted. */
export function importFiles(files: { name: string; mime?: string; bytes: Uint8Array; path?: string }[], source: DocumentSource, opts: { direction?: "incoming" | "outgoing" } = {}): boolean {
  if (!files.length) return false;
  useImporter.getState().enqueue(files.map((f) => ({ ...f, source, direction: opts.direction })));
  if (source !== "bank") toast.info(files.length === 1 ? `„${files[0]!.name}“ wird verarbeitet` : `${files.length} Dateien werden verarbeitet`, opts.direction === "outgoing" ? "Rechnung an einen Kunden – wird als Einnahme gebucht." : "Eindeutiges bucht Summa selbst, der Rest wartet unter „Zu prüfen“.");
  return true;
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  const w = window as unknown as { __summa?: Record<string, unknown> };
  w.__summa = { ...(w.__summa ?? {}), importFiles, useImporter };
}
