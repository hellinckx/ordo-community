/**
 * "Alle mit KI neu lesen": a background queue that reads many documents again with the AI (forceAi).
 * Lives outside React so it keeps running while the person moves to other pages; stops when the vault locks.
 */
import { create } from "zustand";
import { useSession } from "@/state/session";
import { toast } from "@/state/toasts";
import { aiErrorCode, aiErrorMessage } from "./extraction";
import { reprocessDocument, type ReprocessResult } from "./importer";

export type RereadScope = "review" | "open" | "all";

export interface RereadItem {
  docId: string;
  name: string;
  state: "queued" | "running" | "done" | "error" | "skipped";
  detail?: string;
  result?: ReprocessResult;
  error?: string;
}

export interface RereadSummary {
  autoBooked: number;
  /** Read with confidence but waiting for the person (e.g. category unsure, auto-booking off). */
  confident: number;
  /** Still unsure after the AI read. */
  unsure: number;
  /** Booked documents whose new reading disagrees – back in review. */
  reopened: number;
  /** Booked and confirmed by the new reading. */
  confirmed: number;
  failed: number;
  costCents: number;
}

interface RereadState {
  status: "idle" | "running" | "paused" | "done";
  items: RereadItem[];
  scope: RereadScope;
  /** Why the run stopped or paused on its own (no key, offline, vault locked, …). */
  notice?: string;
  /** Waiting for a rate limit to pass. */
  waitingUntil?: number;
  startedAt?: number;
  finishedAt?: number;
  cancelled: boolean;
  start(docs: { id: string; name: string }[], scope: RereadScope): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  /** Hide the finished run. */
  dismiss(): void;
}

/** Parallel AI calls – enough to be quick, few enough to stay clear of rate limits. */
const CONCURRENCY = 3;
const MAX_RETRIES = 4;
/** Errors that make every further call pointless: stop and tell the person. */
const FATAL = new Set(["no_provider", "no_key", "consent", "auth", "billing", "permission", "not_found"]);

let controllers = new Set<AbortController>();
let runId = 0;

export const useAiReread = create<RereadState>((set, get) => ({
  status: "idle",
  items: [],
  scope: "review",
  cancelled: false,
  start(docs, scope) {
    if (get().status === "running" || get().status === "paused") return;
    runId++;
    set({ status: "running", scope, items: docs.map((d) => ({ docId: d.id, name: d.name, state: "queued" })), notice: undefined, waitingUntil: undefined, startedAt: Date.now(), finishedAt: undefined, cancelled: false });
    void run(runId);
  },
  pause() {
    if (get().status === "running") set({ status: "paused" });
  },
  resume() {
    const s = get();
    if (s.status !== "paused") return;
    if (useSession.getState().status !== "unlocked") return;
    set({ status: "running", notice: undefined });
    // workers still finishing their current document keep going; top up to full speed
    void run(runId, CONCURRENCY - active);
  },
  cancel() {
    const s = get();
    if (s.status !== "running" && s.status !== "paused") return;
    for (const c of controllers) c.abort();
    controllers = new Set();
    set({ cancelled: true, status: "done", finishedAt: Date.now(), waitingUntil: undefined, items: s.items.map((i) => (i.state === "queued" || i.state === "running" ? { ...i, state: "skipped", detail: undefined } : i)) });
  },
  dismiss() {
    if (get().status === "done") set({ status: "idle", items: [], notice: undefined, cancelled: false });
  },
}));

let active = 0;

function patch(docId: string, p: Partial<RereadItem>) {
  useAiReread.setState((s) => ({ items: s.items.map((i) => (i.docId === docId ? { ...i, ...p } : i)) }));
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

/** Stops the run on its own (fatal error, vault locked); queued items stay "queued" for a later resume. */
function haltWith(notice: string, pause: boolean) {
  for (const c of controllers) c.abort();
  controllers = new Set();
  useAiReread.setState((s) => ({
    status: pause ? "paused" : "done",
    notice,
    waitingUntil: undefined,
    finishedAt: pause ? undefined : Date.now(),
    items: s.items.map((i) => (i.state === "running" ? { ...i, state: pause ? "queued" : "skipped", detail: undefined } : !pause && i.state === "queued" ? { ...i, state: "skipped" } : i)),
  }));
}

async function run(id: number, count = CONCURRENCY) {
  const workers = Array.from({ length: Math.max(0, count) }, () => worker(id));
  await Promise.all(workers);
  const s = useAiReread.getState();
  if (id !== runId || s.status !== "running" || active > 0) return;
  if (s.items.some((i) => i.state === "queued" || i.state === "running")) return;
  useAiReread.setState({ status: "done", finishedAt: Date.now(), waitingUntil: undefined });
  const sum = rereadSummary(s.items);
  toast.success("Neu lesen mit KI fertig", summaryText(sum));
}

async function worker(id: number) {
  active++;
  try {
    for (;;) {
      const s = useAiReread.getState();
      if (id !== runId || s.status !== "running") return;
      const next = s.items.find((i) => i.state === "queued");
      if (!next) return;
      patch(next.docId, { state: "running", detail: "wird vorbereitet …", error: undefined });
      await readOne(id, next.docId);
    }
  } finally {
    active--;
  }
}

async function readOne(id: number, docId: string) {
  for (let attempt = 0; ; attempt++) {
    const s = useAiReread.getState();
    if (id !== runId || s.status !== "running") {
      if (useAiReread.getState().items.find((i) => i.docId === docId)?.state === "running") patch(docId, { state: s.status === "paused" ? "queued" : "skipped", detail: undefined });
      return;
    }
    const store = useSession.getState().store;
    if (!store) {
      haltWith("Der Tresor wurde gesperrt – Lesen angehalten.", false);
      return;
    }
    const doc = store.byId("documents", docId);
    if (!doc || doc.deletedAt || doc.status === "rejected" || doc.status === "duplicate") {
      patch(docId, { state: "skipped", detail: "nicht mehr vorhanden" });
      return;
    }
    if (doc.status === "processing") {
      patch(docId, { state: "skipped", detail: "wird gerade schon gelesen" });
      return;
    }
    const ctrl = new AbortController();
    controllers.add(ctrl);
    try {
      const result = await reprocessDocument(docId, { forceAi: true, quiet: true, keepBooking: true, signal: ctrl.signal, onStatus: (d) => patch(docId, { detail: d }) });
      patch(docId, { state: "done", detail: undefined, result });
      return;
    } catch (e) {
      const code = aiErrorCode(e);
      const msg = aiErrorMessage(e);
      if (id !== runId || ctrl.signal.aborted || code === "aborted") {
        const st = useAiReread.getState().status;
        patch(docId, { state: st === "paused" ? "queued" : "skipped", detail: undefined });
        return;
      }
      if (useSession.getState().status !== "unlocked") {
        haltWith("Der Tresor wurde gesperrt – Lesen angehalten.", false);
        return;
      }
      if (FATAL.has(code)) {
        patch(docId, { state: "queued", detail: undefined });
        haltWith(msg, true);
        return;
      }
      if (code === "network") {
        patch(docId, { state: "queued", detail: undefined });
        haltWith("Keine Verbindung zum KI-Anbieter. Sobald du wieder online bist: Fortsetzen.", true);
        return;
      }
      if ((code === "rate_limit" || code === "overloaded") && attempt < MAX_RETRIES) {
        const hint = e && typeof e === "object" && "retryAfterMs" in e ? (e as { retryAfterMs?: number }).retryAfterMs : undefined;
        const wait = Math.min(60_000, Math.max(hint ?? 0, 5000 * 2 ** attempt));
        useAiReread.setState({ waitingUntil: Date.now() + wait });
        patch(docId, { detail: code === "rate_limit" ? `zu viele Anfragen – neuer Versuch in ${Math.round(wait / 1000)} s` : `Claude überlastet – neuer Versuch in ${Math.round(wait / 1000)} s` });
        await sleep(wait, ctrl.signal);
        useAiReread.setState({ waitingUntil: undefined });
        continue;
      }
      patch(docId, { state: "error", detail: undefined, error: msg });
      return;
    } finally {
      controllers.delete(ctrl);
    }
  }
}

export function rereadSummary(items: RereadItem[]): RereadSummary {
  const sum: RereadSummary = { autoBooked: 0, confident: 0, unsure: 0, reopened: 0, confirmed: 0, failed: 0, costCents: 0 };
  for (const i of items) {
    if (i.state === "error") sum.failed++;
    const r = i.result;
    if (!r) continue;
    sum.costCents += r.costCents;
    if (r.reopened) sum.reopened++;
    else if (r.autoBooked) sum.autoBooked++;
    else if (r.status === "approved") sum.confirmed++;
    else if (r.confident) sum.confident++;
    else sum.unsure++;
  }
  return sum;
}

export function summaryText(s: RereadSummary): string {
  const parts: string[] = [];
  if (s.autoBooked) parts.push(`${s.autoBooked} automatisch gebucht`);
  if (s.confident) parts.push(`${s.confident} sicher gelesen, warten auf dein OK`);
  if (s.unsure) parts.push(`${s.unsure} weiter zu prüfen`);
  if (s.confirmed) parts.push(`${s.confirmed} Buchungen bestätigt`);
  if (s.reopened) parts.push(`${s.reopened} Buchungen weichen ab, zurück in der Prüfung`);
  if (s.failed) parts.push(`${s.failed} nicht gelesen`);
  return parts.join(" · ") || "Nichts zu tun.";
}

// The queue never outlives an unlocked vault.
useSession.subscribe((s, prev) => {
  if (prev.status === "unlocked" && s.status !== "unlocked") {
    const st = useAiReread.getState().status;
    if (st === "running" || st === "paused") haltWith("Der Tresor wurde gesperrt – Lesen angehalten.", false);
  } else if (prev.store && s.store && prev.store !== s.store) {
    // another vault (e.g. demo) – the queued ids do not belong to it
    const st = useAiReread.getState().status;
    if (st === "running" || st === "paused") haltWith("Anderer Tresor geöffnet – Lesen angehalten.", false);
  }
});

