import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Camera, Check, ChevronLeft, ChevronRight, Copy, FileStack, Pause, Play, RefreshCw, Trash2, Undo2, Upload, X, Sparkles, Wand2, Zap } from "lucide-react";
import { CLAUDE_AUTO_MODEL, documentDirection, estimateReadCostCents, extractionModelLabel, fieldStates as computeFieldStates, isGoodsCategory, nowIso, type FieldStateKey, type SummaDocument, type Transaction } from "@ordo/core";
import { useList, useProfile, useVault } from "@/state/hooks";
import { requireStore, useSession } from "@/state/session";
import { Badge, Button, ConfirmDialog, EmptyState, Kbd, Modal, PageHeader, Progress, Spinner, Tabs } from "@/components/ui";
import { DocumentViewer } from "@/components/DocumentViewer";
import { TransactionForm, emptyTransaction, validateTransaction } from "@/components/TransactionForm";
import { importFiles, useImporter } from "@/services/importer";
import { bookDocument, reopenDocument } from "@/services/booking";
import { toast, useToasts } from "@/state/toasts";
import { cls, fmtDate, fmtMoney, fmtRelative } from "@/lib/format";
import { isMobile } from "@/platform";
import { IntakeButton } from "@/components/Intake";
import { FileDropHint } from "@/components/FileDropHint";
import { EnableClaudeDialog } from "@/components/AiProviderSetup";
import { FolderLinkButton, FolderLinks } from "@/components/FolderLinks";
import { aiReadiness, type AiReadiness } from "@/services/extraction";
import { rereadSummary, useAiReread, type RereadScope } from "@/services/aiReread";
import { useAskAtlas } from "@/atlas/hooks";
import { useIsInstalled } from "@/modules/registry";
import { NO_PURCHASE_STOCK, PurchaseStockCard, type PurchaseStock } from "@/modules/produkte/PurchaseStockCard";
import { bookPurchaseStock } from "@/services/invoiceStock";

type Filter = "review" | "all" | "approved" | "rejected" | "error";
type Direction = "eingang" | "ausgang";

const STATUS_LABEL: Record<SummaDocument["status"], { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" | "brand" }> = {
  inbox: { label: "Neu", tone: "info" },
  processing: { label: "Wird gelesen …", tone: "warning" },
  review: { label: "Prüfen", tone: "warning" },
  approved: { label: "Gebucht", tone: "success" },
  rejected: { label: "Aussortiert", tone: "neutral" },
  error: { label: "Nicht lesbar", tone: "danger" },
  duplicate: { label: "Doppelt", tone: "neutral" },
};

export default function Documents() {
  const docs = useList("documents");
  const txs = useList("transactions");
  const profile = useProfile();
  const navigate = useNavigate();
  const askAtlas = useAskAtlas();
  const { id } = useParams();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("review");
  const jobs = useImporter((s) => s.jobs);
  const txById = useMemo(() => new Map(txs.map((t) => [t.id, t])), [txs]);
  const isBusiness = profile.mode === "business";
  // Incoming receipts vs. own outgoing invoices – only businesses issue invoices.
  const dir: Direction = isBusiness && params.get("richtung") === "ausgang" ? "ausgang" : "eingang";
  const search = params.toString() ? `?${params.toString()}` : "";
  const go = (docId?: string) => navigate({ pathname: docId ? `/belege/${docId}` : "/belege", search });
  const dirOf = (d: SummaDocument): Direction => (documentDirection(d, d.transactionId ? txById.get(d.transactionId) : undefined) === "outgoing" ? "ausgang" : "eingang");

  const inDir = useMemo(() => (isBusiness ? docs.filter((d) => dirOf(d) === dir) : docs), [docs, dir, isBusiness, txById]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    const sorted = [...inDir].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    switch (filter) {
      case "review":
        return sorted.filter((d) => d.status === "review" || d.status === "inbox" || d.status === "processing");
      case "approved":
        return sorted.filter((d) => d.status === "approved");
      case "rejected":
        return sorted.filter((d) => d.status === "rejected" || d.status === "duplicate");
      case "error":
        return sorted.filter((d) => d.status === "error");
      default:
        return sorted;
    }
  }, [inDir, filter]);

  // Documents moved to the other direction from here – they leave this list, the view stays.
  const movedRef = useRef(new Map<string, Direction>());
  const movedAway = (docId: string) => movedRef.current.get(docId) === dir;
  const selected = id ? docs.find((d) => d.id === id && !movedAway(d.id)) : list.find((d) => d.status === "review");
  const index = selected ? list.findIndex((d) => d.id === selected.id) : -1;
  // Opening a document from the other direction (deep link, e.g. from a toast) switches the segment.
  useEffect(() => {
    if (selected && isBusiness && !movedAway(selected.id) && dirOf(selected) !== dir) navigate({ pathname: `/belege/${selected.id}`, search: dirOf(selected) === "ausgang" ? "?richtung=ausgang" : "" }, { replace: true });
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /** After "Ausgehend ⇄ Eingehend": the next document of this list, like after booking. */
  const moved = (docId: string, to: "incoming" | "outgoing") => {
    movedRef.current.set(docId, dir);
    const i = list.findIndex((d) => d.id === docId);
    const rest = list.filter((d) => d.id !== docId);
    const from = Math.max(0, i);
    const n = rest.slice(from).find((d) => d.status === "review") ?? rest[from] ?? rest.slice(0, from).reverse().find((d) => d.status === "review") ?? rest[from - 1];
    go(n?.id);
    toast.success(to === "incoming" ? "Zu eingehenden Rechnungen verschoben" : "Zu ausgehenden Rechnungen verschoben", "Sie wird dort neu gelesen.");
  };
  const goto = (i: number) => {
    const d = list[i];
    if (d) go(d.id);
  };
  const next = () => {
    const n = list.slice(index + 1).find((d) => d.status === "review") ?? list[index + 1];
    go(n?.id);
  };

  const pick = async (capture = false) => {
    const platform = useSession.getState().platform!;
    const files = await platform.pickFiles({ multiple: !capture, capture });
    if (files.length) importFiles(files, capture ? "camera" : "upload", { direction: dir === "ausgang" ? "outgoing" : undefined });
  };

  const reviewCount = inDir.filter((d) => d.status === "review").length;
  const autoCount = inDir.filter((d) => d.status === "approved" && d.autoBooked).length;
  const running = jobs.filter((j) => j.status !== "done" && j.status !== "duplicate" && j.status !== "error");
  const hasRejected = inDir.some((d) => d.status === "rejected" || d.status === "duplicate");
  const hasErrors = inDir.some((d) => d.status === "error");
  const reread = useAiReread((s) => s.status);
  const [rereadOpen, setRereadOpen] = useState(false);
  const rereadScopes = useMemo(() => {
    const review = inDir.filter((d) => d.status === "review" || d.status === "inbox");
    const open = inDir.filter((d) => d.status === "review" || d.status === "inbox" || d.status === "error");
    const all = [...open, ...inDir.filter((d) => d.status === "approved")];
    return { review, open, all };
  }, [inDir]);
  const canReread = reread === "idle" && rereadScopes.open.length > 0;

  return (
    <div className="flex h-full flex-col gap-4">
      {dir === "ausgang" ? (
        <button type="button" onClick={() => navigate("/rechnungen")} className="-mb-2 inline-flex w-fit items-center gap-1 text-sm text-(--text-muted) hover:text-(--text)"><ArrowLeft className="h-4 w-4" /> Ausgehende Rechnungen</button>
      ) : null}
      <PageHeader
        title={dir === "ausgang" ? "Ausgehende Rechnungen prüfen" : isBusiness ? "Eingehende Rechnungen" : "Rechnungen & Bons"}
        subtitle={dir === "ausgang" ? "Rechnungen, die du deinen Kunden gestellt hast. Sie zählen als Einnahme und bleiben offen, bis das Geld am Konto ist." : <>Alles, was du bezahlt hast: Rechnungen, Kassenbons, Quittungen. Eindeutiges bucht Ordo selbst{autoCount ? ` (bisher ${autoCount})` : ""}, der Rest wartet hier auf einen kurzen Blick.</>}
        actions={
          <>
            {isMobile ? <Button onClick={() => void pick(true)}><Camera className="h-4 w-4" /> Fotografieren</Button> : null}
            {canReread ? <Button variant="outline" onClick={() => setRereadOpen(true)} title="Rechnungen noch einmal mit der KI lesen lassen"><Sparkles className="h-4 w-4" /> Alle mit KI neu lesen</Button> : null}
            <FolderLinks kind={dir === "ausgang" ? "outgoing" : "receipts"} />
            {dir === "ausgang" ? <Button variant={isMobile ? "outline" : "primary"} onClick={() => void pick(false)}><Upload className="h-4 w-4" /> Rechnung hochladen</Button> : isMobile ? <Button variant="outline" onClick={() => void pick(false)}><Upload className="h-4 w-4" /> Hochladen</Button> : <IntakeButton />}
          </>
        }
      />
      <FileDropHint onChoose={() => void pick(false)}>Rechnungen und Kassenbons ins Fenster ziehen oder Dateien auswählen</FileDropHint>
      {running.length ? (
        <div className="surface flex items-center gap-3 px-4 py-2 text-sm">
          <Spinner className="h-4 w-4" />
          <span className="flex-1">{running[0]!.name} – {running[0]!.detail ?? ({ queued: "wartet", hashing: "prüft auf Doppelte", extracting: "liest Text", ocr: "liest Bild", ai: "KI liest mit" } as Record<string, string>)[running[0]!.status]}</span>
          {running.length > 1 ? <Badge tone="warning">+{running.length - 1} weitere</Badge> : null}
        </div>
      ) : null}
      <RereadPanel />
      <RereadDialog open={rereadOpen} onClose={() => setRereadOpen(false)} scopes={rereadScopes} />
      {reviewCount > 1 ? (
        <div className="surface flex flex-wrap items-center gap-3 px-4 py-3">
          <Sparkles className="h-5 w-5 shrink-0 text-brand-700 dark:text-brand-400" />
          <div className="min-w-0 flex-[1_1_16rem] text-sm">
            <div className="font-medium">{reviewCount} Rechnungen warten auf dich</div>
            <div className="text-xs text-(--text-muted)">Atlas prüft die vorbereiteten Buchungen, bucht Eindeutiges und sagt dir, wo etwas fehlt oder unklar ist.</div>
          </div>
          <Button onClick={() => void askAtlas(dir === "ausgang" ? "Prüf meine offenen ausgehenden Rechnungen: Buch alles, was eindeutig ist, als Einnahme und sag mir, wo etwas fehlt oder unklar ist." : "Prüf meine offenen eingehenden Rechnungen: Buch alles, was eindeutig ist, mit passender Kategorie und sag mir, wo etwas fehlt oder unklar ist – etwa ein Betrag, eine Rechnungsnummer oder ob es eigentlich eine Einnahme ist.")}><Sparkles className="h-4 w-4" /> Atlas erledigt das</Button>
        </div>
      ) : null}
      <Tabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "review", label: "Zu prüfen", badge: reviewCount ? <Badge tone="warning">{reviewCount}</Badge> : undefined },
          { id: "approved", label: "Gebucht" },
          { id: "all", label: "Alle" },
          ...(hasRejected || filter === "rejected" ? [{ id: "rejected" as Filter, label: "Aussortiert" }] : []),
          ...(hasErrors || filter === "error" ? [{ id: "error" as Filter, label: "Nicht lesbar", badge: hasErrors ? <Badge tone="danger">!</Badge> : undefined }] : []),
        ]}
        className="w-fit"
      />
      {!inDir.length ? (
        <EmptyState
          icon={<FileStack className="h-10 w-10" />}
          title={dir === "ausgang" ? "Noch keine ausgehenden Rechnungen" : "Noch keine Rechnungen"}
          body={dir === "ausgang" ? <>Lade Rechnungen hoch, die du mit einem anderen Programm erstellt hast – oder verbinde unter Einstellungen → Ordner deinen Ordner dafür.</> : <>Zieh PDFs, Fotos von Kassenbons oder Scans einfach hier hinein. Noch bequemer: unter Einstellungen → Ordner einen Ordner verbinden, Ordo holt neue Dateien dann selbst. Tastenkürzel: <Kbd>U</Kbd></>}
          action={<div className="flex flex-wrap justify-center gap-2"><Button onClick={() => void pick(false)}><Upload className="h-4 w-4" /> Dateien auswählen</Button><FolderLinkButton kind={dir === "ausgang" ? "outgoing" : "receipts"} /></div>}
        />
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="surface max-h-[70vh] overflow-y-auto lg:max-h-none">
            {!list.length ? <div className="p-6 text-center text-sm text-(--text-muted)">{filter === "review" ? "Nichts zu prüfen – alles erledigt." : "Hier ist nichts."}</div> : null}
            <ul className="divide-y divide-(--border)">
              {list.map((d) => {
                const tx = d.transactionId ? txById.get(d.transactionId) : undefined;
                const f = d.extraction?.fields;
                const active = selected?.id === d.id;
                return (
                  <li key={d.id}>
                    <button onClick={() => go(d.id)} className={cls("flex w-full items-start gap-3 border-l-[3px] px-3 py-2.5 text-left transition-colors hover:bg-(--surface-2)", active ? "border-brand-600 bg-brand-50 dark:bg-brand-900/30" : "border-transparent")}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cls("truncate text-sm font-medium", active && "text-brand-800 dark:text-brand-100")}>{(dir === "ausgang" ? f?.customerName : f?.vendorName) ?? f?.vendorName ?? d.originalName}</span>
                        </div>
                        <div className="truncate text-xs text-(--text-muted)">{f?.invoiceDate ? fmtDate(f.invoiceDate) : fmtRelative(d.importedAt)} · {d.originalName}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone={STATUS_LABEL[d.status].tone}>{STATUS_LABEL[d.status].label}</Badge>
                          {d.autoBooked ? <Badge tone="brand"><Zap className="mr-0.5 inline h-3 w-3" />automatisch</Badge> : null}
                          {d.extraction ? <span className="text-[11px] text-(--text-muted)">{Math.round(d.extraction.overall * 100)} % sicher</span> : null}
                        </div>
                      </div>
                      <div className="tabular text-sm font-semibold">{tx ? fmtMoney(tx.grossCents) : f?.grossCents != null ? fmtMoney(f.grossCents) : ""}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="min-h-0">
            {selected ? <ReviewPane key={selected.id} doc={selected} onPrev={index > 0 ? () => goto(index - 1) : undefined} onNext={index < list.length - 1 ? () => goto(index + 1) : undefined} afterAction={next} onMoved={moved} profileId={profile.id} /> : <EmptyState title="Nichts ausgewählt" body="Wähle links eine Rechnung, um sie anzusehen." />}
          </div>
        </div>
      )}
    </div>
  );
}

function focusField(inputId: string) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  (el as HTMLElement).focus({ preventScroll: true });
}

function ReviewPane({ doc, onPrev, onNext, afterAction, onMoved, profileId }: { doc: SummaDocument; onPrev?: () => void; onNext?: () => void; afterAction: () => void; onMoved: (docId: string, to: "incoming" | "outgoing") => void; profileId: string }) {
  const txs = useList("transactions");
  const profile = useProfile();
  const existing = doc.transactionId ? txs.find((t) => t.id === doc.transactionId) : undefined;
  const [value, setValue] = useState<Transaction>(() => existing ?? { ...emptyTransaction(profileId), documentIds: [doc.id], origin: "extraction", reviewed: false });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [touched, setTouched] = useState<Set<FieldStateKey>>(() => new Set());
  const [openMore, setOpenMore] = useState(false);
  const reprocess = useImporter((s) => s.reprocess);
  const isApproved = doc.status === "approved" && existing?.reviewed;
  const ex = doc.extraction;
  const direction = documentDirection(doc, existing);
  const isBusiness = profile.mode === "business";
  const states = useMemo(() => computeFieldStates(ex, { mode: profile.mode, vatRegime: profile.vatRegime }), [ex, profile.mode, profile.vatRegime]);
  const pending = states.filter((s) => s.state !== "ok" && !touched.has(s.key));
  const vault = useVault();
  const platform = useSession((s) => s.platform);
  const navigate = useNavigate();
  const [aiDetail, setAiDetail] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [enableClaude, setEnableClaude] = useState(false);
  const produkte = useIsInstalled("produkte");
  const products = useList("products");
  const stockMoves = useList("stockMoves");
  const [stock, setStock] = useState<PurchaseStock>(NO_PURCHASE_STOCK);
  // Goods purchase (Wareneinkauf/Material, a supplier of an article, or already in stock) → offer "Ins Lager buchen".
  const showStock = produkte && value.kind === "expense" && (stock.open || isGoodsCategory(vault.categories.find((c) => c.id === value.categoryId)) || (!!value.contactId && products.some((p) => p.supplierId === value.contactId)) || stockMoves.some((m) => m.transactionId === value.id));

  useEffect(() => {
    if (existing) setValue(existing);
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Read again (here, in a bulk run or after a direction switch): show the new result unless the person is editing.
  useEffect(() => {
    if (existing && !touched.size) setValue(existing);
  }, [ex?.extractedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = touched.size > 0 || (!!existing && JSON.stringify(value) !== JSON.stringify(existing));
  const readWithAi = async () => {
    setTouched(new Set());
    setAiDetail("KI liest …");
    const r = await reprocess(doc.id, { forceAi: true, onStatus: (d) => setAiDetail(d) });
    setAiDetail(null);
    const fresh = requireStore().byId("transactions", existing?.id ?? requireStore().byId("documents", doc.id)?.transactionId ?? "");
    if (fresh) setValue(fresh);
    if (!r) return;
    const who = r.model ? extractionModelLabel(r.model) : "KI";
    if (r.autoBooked) toast.success(`Mit KI gelesen (${who}) und gebucht`, `${Math.round(r.overall * 100)} % sicher – du findest sie unter „Gebucht“.`);
    else if (r.confident) toast.success(`Mit KI gelesen (${who})`, `${Math.round(r.overall * 100)} % sicher – kurz drüberschauen und buchen.`);
    else toast.info(`Mit KI gelesen (${who})`, `${Math.round(r.overall * 100)} % sicher – die markierten Felder bitte prüfen.`);
  };
  const askReadWithAi = () => {
    const ready: AiReadiness = aiReadiness(vault.settings, platform);
    if (!ready.ok) {
      if (ready.code === "offer_claude") setEnableClaude(true);
      else useToasts.getState().push({ kind: "warning", title: "KI noch nicht bereit", body: ready.message, timeout: 9000, action: { label: "Einstellungen", onClick: () => navigate("/einstellungen/ki") } });
      return;
    }
    if (dirty) setConfirmOverwrite(true);
    else void readWithAi();
  };

  // A field the user edited no longer needs the "unsicher/fehlt" chip.
  const change = (nextValue: Transaction) => {
    const t = new Set(touched);
    if (nextValue.date !== value.date) t.add("date");
    if (nextValue.grossCents !== value.grossCents) t.add("gross");
    if (nextValue.contactId !== value.contactId) t.add("partner");
    if (nextValue.categoryId !== value.categoryId) t.add("category");
    if (nextValue.vatTreatment !== value.vatTreatment || JSON.stringify(nextValue.vatLines) !== JSON.stringify(value.vatLines)) t.add("vat");
    if (nextValue.invoiceNumber !== value.invoiceNumber) t.add("invoiceNumber");
    if (t.size !== touched.size) setTouched(t);
    setValue(nextValue);
  };
  const jumpTo = (key: FieldStateKey, inputId: string) => {
    if (key === "invoiceNumber") {
      setOpenMore(true);
      setTimeout(() => focusField(inputId), 50);
    } else focusField(inputId);
  };

  const approve = () => {
    const err = validateTransaction(value);
    if (err) {
      toast.warning(err);
      return;
    }
    try {
      const saved = bookDocument(doc, value, { draftCategoryId: existing?.categoryId });
      const stocked = showStock && stock.open ? bookPurchaseStock(saved, stock.lines, { updateCost: stock.updateCost }) : 0;
      if (stocked) setStock(NO_PURCHASE_STOCK);
      toast.success("Gebucht", `${fmtMoney(saved.grossCents)} · ${saved.description || "Buchung"}${stocked ? ` · ${stocked === 1 ? "ein Artikel" : `${stocked} Artikel`} ins Lager` : ""}`);
      afterAction();
    } catch (error) { toast.error("Buchung konnte nicht gespeichert werden", error instanceof Error ? error.message : String(error)); }
  };
  const reopen = () => {
    reopenDocument(doc);
    toast.info("Zur Prüfung geöffnet", "Die Buchung zählt wieder als offen, bis du sie bestätigst.");
  };
  const toggleDirection = () => {
    const nextDir = direction === "outgoing" ? "incoming" : "outgoing";
    requireStore().update("documents", doc.id, { direction: nextDir }, "document.direction");
    onMoved(doc.id, nextDir);
    void reprocess(doc.id);
  };
  const reject = () => {
    const store = requireStore();
    store.update("documents", doc.id, { status: "rejected", reviewedAt: nowIso() }, "document.reject");
    if (existing && !existing.reviewed) store.softDelete("transactions", existing.id);
    toast.info("Aussortiert", "Die Datei bleibt gespeichert, wird aber nicht gebucht.");
    afterAction();
  };
  const remove = async () => {
    const store = requireStore();
    if (existing && !existing.reviewed) store.softDelete("transactions", existing.id);
    store.softDelete("documents", doc.id, "document.delete");
    afterAction();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        approve();
      }
      if (typing) return;
      if (e.key === "ArrowRight" && onNext) onNext();
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      if (e.key === "Enter" && !isApproved) approve();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid h-full min-w-0 gap-4 2xl:grid-cols-2">
      <div className="min-h-[360px] xl:min-h-0">
        <DocumentViewer doc={doc} className="h-[60vh] xl:h-full" />
      </div>
      <div className="surface flex min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-(--border) px-4 py-2">
          <Button variant="ghost" size="icon" onClick={onPrev} disabled={!onPrev} title="Vorheriger (←)"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={onNext} disabled={!onNext} title="Nächster (→)"><ChevronRight className="h-4 w-4" /></Button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium">
            {ex ? (
              <span className="inline-flex items-center gap-1.5">
                {ex.provider === "rules" ? <Wand2 className="h-4 w-4 text-brand-600" /> : <Sparkles className="h-4 w-4 text-brand-600" />}
                {ex.provider === "rules" ? "Ohne KI gelesen" : ex.provider === "manual" ? "Von Hand erfasst" : `Mit KI gelesen (${extractionModelLabel(ex.model) || ex.provider})`} · {Math.round(ex.overall * 100)} % sicher
              </span>
            ) : doc.status === "processing" ? "Wird gelesen …" : STATUS_LABEL[doc.status].label}
          </div>
          {isBusiness && !isApproved && doc.status !== "processing" ? (
            <Button variant="ghost" size="sm" onClick={toggleDirection} title={direction === "outgoing" ? "Ist doch eine Rechnung, die ich bezahle – neu lesen" : "Ist eine Rechnung, die ich gestellt habe – neu lesen"}>
              <ArrowLeftRight className="h-4 w-4" /> {direction === "outgoing" ? "Ausgehend" : "Eingehend"}
            </Button>
          ) : null}
          {doc.autoBooked ? <Badge tone="brand"><Zap className="mr-0.5 inline h-3 w-3" />automatisch</Badge> : null}
          <Badge tone={STATUS_LABEL[doc.status].tone}>{STATUS_LABEL[doc.status].label}</Badge>
        </div>
        {doc.status === "processing" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-sm text-(--text-muted)"><Spinner />{aiDetail ? <span>{aiDetail}</span> : null}</div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {ex && !isApproved && doc.status === "review" ? (
                <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
                  {pending.length ? (
                    pending.map((s) => (
                      <button key={s.key} type="button" onClick={() => jumpTo(s.key, s.inputId)} title="Zum Feld springen" className={cls("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium transition-colors", s.state === "missing" ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200" : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200")}>
                        {s.state === "missing" ? <X className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {s.label} {s.state === "missing" ? "fehlt" : s.confidence > 0 ? `unsicher (${Math.round(s.confidence * 100)} %)` : "prüfen"}
                      </button>
                    ))
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"><Check className="h-3 w-3" /> Alles gelesen – kurz drüberschauen und buchen</span>
                  )}
                </div>
              ) : null}
              {doc.autoBookReasons?.length && doc.status === "review" ? <p className="mb-3 text-xs text-(--text-muted)">Nicht automatisch gebucht: {doc.autoBookReasons.join(" · ")}</p> : null}
              {ex?.warnings.length ? (
                <div className="mb-3 space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                  {ex.warnings.slice(0, 4).map((w, i) => <div key={i} className="flex gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</div>)}
                </div>
              ) : null}
              {doc.error && doc.status === "error" ? <div className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-800">{doc.error}</div> : null}
              {doc.status === "duplicate" ? <div className="mb-3 rounded-lg bg-slate-100 p-2 text-xs"><Copy className="mr-1 inline h-3 w-3" />Diese Datei ist schon in Ordo.</div> : null}
              {direction === "outgoing" ? <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100">Rechnung an einen Kunden – zählt als <strong>Einnahme</strong> und bleibt offen, bis das Geld am Konto eingegangen ist.</div> : null}
              <TransactionForm value={value} onChange={change} confidence={ex?.confidence} fieldStates={states} openMore={openMore} suggestedVendor={value.kind === "income" ? ex?.fields.customerName : ex?.fields.vendorName} />
              {showStock ? <PurchaseStockCard tx={value} lineItems={ex?.fields.lineItems ?? []} value={stock} onChange={setStock} /> : null}
              {ex?.fields.lineItems.length ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-(--text-muted)">Positionen ({ex.fields.lineItems.length})</summary>
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      {ex.fields.lineItems.map((li, i) => (
                        <tr key={i} className="border-t border-(--border)">
                          <td className="py-1 pr-2">{li.description}</td>
                          <td className="py-1 pr-2 text-right tabular">{li.quantity ?? ""}</td>
                          <td className="py-1 text-right tabular">{li.totalCents != null ? fmtMoney(li.totalCents) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ) : null}
              {ex?.text ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-(--text-muted)">Gelesener Text</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-(--surface-2) p-2 text-[11px] whitespace-pre-wrap">{ex.text.slice(0, 8000)}</pre>
                </details>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-(--border) px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => void reprocess(doc.id)} title="Noch einmal lesen"><RefreshCw className="h-4 w-4" /> Neu lesen</Button>
              {!isApproved ? <Button variant="ghost" size="sm" onClick={askReadWithAi} disabled={!!aiDetail} title="Die KI liest das Bild dieser Rechnung – unabhängig von der Einstellung unter KI-Erkennung"><Sparkles className="h-4 w-4" /> Mit KI lesen</Button> : null}
              <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setConfirmDelete(true)} title="Löschen" aria-label="Löschen"><Trash2 className="h-4 w-4" /></Button>
              <span className="flex-1" />
              {isApproved && doc.autoBooked ? <Button variant="outline" size="sm" onClick={reopen} title="Zurück in die Prüfung"><Undo2 className="h-4 w-4" /> Korrigieren</Button> : null}
              {!isApproved ? <Button variant="outline" size="sm" onClick={reject} title="Keine Rechnung oder nicht relevant"><X className="h-4 w-4" /> Aussortieren</Button> : null}
              <Button size="sm" onClick={approve}><Check className="h-4 w-4" /> {isApproved ? "Änderungen speichern" : "Passt – buchen"} <Kbd>↵</Kbd></Button>
            </div>
          </>
        )}
      </div>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} danger title="Rechnung löschen?" body="Die Datei und – falls noch nicht geprüft – die Buchung dazu werden gelöscht." confirmLabel="Löschen" onConfirm={remove} />
      <ConfirmDialog open={confirmOverwrite} onClose={() => setConfirmOverwrite(false)} title="Deine Änderungen überschreiben?" body="Du hast in dieser Rechnung schon Felder geändert. Liest die KI neu, werden sie durch das neue Ergebnis ersetzt." confirmLabel="Mit KI lesen" onConfirm={() => { void readWithAi(); }} />
      <EnableClaudeDialog open={enableClaude} onClose={() => setEnableClaude(false)} onEnabled={() => { if (dirty) setConfirmOverwrite(true); else void readWithAi(); }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "Alle mit KI neu lesen"                                             */
/* ------------------------------------------------------------------ */

const fmtUsCents = (c: number) => (c < 100 ? `${c.toLocaleString("de-AT", { maximumFractionDigits: c < 10 ? 1 : 0 })} Cent` : `${(c / 100).toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

function RereadDialog({ open, onClose, scopes }: { open: boolean; onClose: () => void; scopes: Record<RereadScope, SummaDocument[]> }) {
  const vault = useVault();
  const platform = useSession((s) => s.platform);
  const navigate = useNavigate();
  const [scope, setScope] = useState<RereadScope>("review");
  const [enableClaude, setEnableClaude] = useState(false);
  useEffect(() => {
    if (open) setScope(scopes.review.length ? "review" : "open");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const ai = vault.settings.ai;
  const ready = aiReadiness(vault.settings, platform);
  const docs = scopes[scope];
  const claude = ai.provider === "anthropic";
  const model = ai.anthropicModel.trim() || CLAUDE_AUTO_MODEL;
  const est = estimateReadCostCents(docs.length, model);
  const options: { id: RereadScope; label: string; hint?: string }[] = [
    { id: "review", label: `Zu prüfen (${scopes.review.length})`, hint: "Empfohlen. Was danach sicher gelesen ist, bucht Ordo wie beim Hochladen selbst." },
    { id: "open", label: `Alle nicht gebuchten (${scopes.open.length})`, hint: "Auch Rechnungen, die bisher nicht lesbar waren." },
    { id: "all", label: `Auch gebuchte (${scopes.all.length})`, hint: "Gebuchtes bleibt gebucht. Liest die KI einen anderen Betrag oder ein anderes Datum, kommt die Rechnung zurück in die Prüfung." },
  ];
  const start = () => {
    useAiReread.getState().start(docs.map((d) => ({ id: d.id, name: d.extraction?.fields.vendorName ?? d.originalName })), scope);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Alle mit KI neu lesen" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={start} disabled={!ready.ok || !docs.length}><Sparkles className="h-4 w-4" /> {docs.length === 1 ? "1 Rechnung lesen" : `${docs.length} Rechnungen lesen`}</Button></>}>
      <div className="space-y-4 text-sm">
        <p className="text-(--text-muted)">Die KI liest das Bild jeder Rechnung noch einmal – ohne die lokale Texterkennung. Das läuft im Hintergrund weiter, auch wenn du die Seite wechselst.</p>
        <div className="space-y-2">
          {options.map((o) => {
            const active = scope === o.id;
            const empty = !scopes[o.id].length;
            return (
              <button key={o.id} type="button" disabled={empty} onClick={() => setScope(o.id)} className={cls("flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50", active ? "border-brand-600 bg-brand-50 dark:bg-brand-900/20" : "border-(--border) hover:bg-(--surface-2)")}>
                <span className={cls("mt-1 h-4 w-4 shrink-0 rounded-full border-2", active ? "border-brand-600 bg-brand-600" : "border-slate-300")} />
                <span className="flex-1"><span className="block font-medium">{o.label}</span>{o.hint ? <span className="block text-(--text-muted)">{o.hint}</span> : null}</span>
              </button>
            );
          })}
        </div>
        {ready.ok ? (
          <div className="rounded-xl bg-(--surface-2) p-3">
            {claude ? (
              <>
                <div className="font-medium">Geschätzte Kosten: ca. {fmtUsCents(est.low)} bis {fmtUsCents(est.high)}</div>
                <p className="mt-1 text-xs text-(--text-muted)">
                  {model === CLAUDE_AUTO_MODEL
                    ? `Haiku 5.5 liest jede Rechnung für ca. ${fmtUsCents(estimateReadCostCents(1, "claude-haiku-5-5").perInvoice.low)}–${fmtUsCents(estimateReadCostCents(1, "claude-haiku-5-5").perInvoice.high)}. Ist sie unsicher (erfahrungsgemäß jede 3. bis 10.), liest Opus 5.5 nach – das kostet ca. ${fmtUsCents(estimateReadCostCents(1, "claude-opus-5-5").perInvoice.low)}–${fmtUsCents(estimateReadCostCents(1, "claude-opus-5-5").perInvoice.high)} für diese Rechnung.`
                    : `${extractionModelLabel(model)}: ca. ${fmtUsCents(est.perInvoice.low)}–${fmtUsCents(est.perInvoice.high)} pro Rechnung mit 1–2 Seiten.`}{" "}
                  Grobe Schätzung, Anthropic rechnet in US-Dollar über deinen Account ab. Am Ende siehst du, was es wirklich gekostet hat.
                </p>
              </>
            ) : (
              <p className="text-(--text-muted)">Die Kosten hängen von deinem KI-Anbieter ab{ai.provider === "ollama" ? " – mit Ollama auf deinem Rechner kostet es nichts" : ai.provider === "codex" ? " – über dein ChatGPT-Abo ohne Zusatzkosten" : ""}.</p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
            <p>{ready.message}</p>
            <div className="mt-2">
              {ready.code === "offer_claude" ? <Button size="sm" onClick={() => setEnableClaude(true)}><Sparkles className="h-4 w-4" /> Claude auch zum Lesen verwenden</Button> : <Button size="sm" variant="outline" onClick={() => { onClose(); navigate("/einstellungen/ki"); }}>Zu den Einstellungen</Button>}
            </div>
          </div>
        )}
      </div>
      <EnableClaudeDialog open={enableClaude} onClose={() => setEnableClaude(false)} />
    </Modal>
  );
}

/** Progress of the bulk run (state lives in services/aiReread, so it survives page changes). */
function RereadPanel() {
  const { status, items, notice, waitingUntil, cancelled } = useAiReread();
  if (status === "idle") return null;
  const total = items.length;
  const finished = items.filter((i) => i.state === "done" || i.state === "error" || i.state === "skipped").length;
  const runningItems = items.filter((i) => i.state === "running");
  const sum = rereadSummary(items);
  const { pause, resume, cancel, dismiss } = useAiReread.getState();
  return (
    <div className="surface space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {status === "running" ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4 text-brand-600" />}
        <span className="font-medium">
          {status === "done" ? (cancelled ? "Neu lesen abgebrochen" : notice ? "Neu lesen angehalten" : "Neu lesen mit KI fertig") : status === "paused" ? "Neu lesen pausiert" : "Liest mit KI"}
          {" "}<span className="tabular text-(--text-muted)">{finished} von {total}</span>
        </span>
        <span className="flex-1" />
        {status === "running" ? <Button size="sm" variant="ghost" onClick={pause}><Pause className="h-4 w-4" /> Pause</Button> : null}
        {status === "paused" ? <Button size="sm" variant="ghost" onClick={resume}><Play className="h-4 w-4" /> Fortsetzen</Button> : null}
        {status === "running" || status === "paused" ? <Button size="sm" variant="ghost" onClick={cancel}><X className="h-4 w-4" /> Abbrechen</Button> : null}
        {status === "done" ? <Button size="sm" variant="ghost" onClick={dismiss}>Schließen</Button> : null}
      </div>
      {status !== "done" ? <Progress value={total ? finished / total : 0} /> : null}
      {status === "running" && runningItems.length ? (
        <div className="space-y-0.5 text-xs text-(--text-muted)">
          {runningItems.map((i) => <div key={i.docId} className="truncate">{i.name}{i.detail ? ` – ${i.detail}` : ""}</div>)}
          {waitingUntil ? <div>Claude bremst gerade – es geht gleich automatisch weiter.</div> : null}
        </div>
      ) : null}
      {notice ? <div className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">{notice}</div> : null}
      {finished ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-(--text-muted)">
          {sum.autoBooked ? <span><Zap className="mr-0.5 inline h-3 w-3 text-brand-600" />{sum.autoBooked} automatisch gebucht</span> : null}
          {sum.confident ? <span>{sum.confident} sicher gelesen, warten auf dein OK</span> : null}
          {sum.unsure ? <span>{sum.unsure} weiter zu prüfen</span> : null}
          {sum.confirmed ? <span>{sum.confirmed} Buchungen bestätigt</span> : null}
          {sum.reopened ? <span>{sum.reopened} weichen von der Buchung ab</span> : null}
          {sum.failed ? <span className="text-red-600">{sum.failed} nicht gelesen</span> : null}
          {sum.costCents > 0 ? <span>Kosten bisher ca. {fmtUsCents(sum.costCents)} (US-Dollar)</span> : null}
        </div>
      ) : null}
      {status === "done" && sum.failed ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-(--text-muted)">Was nicht geklappt hat</summary>
          <ul className="mt-1 space-y-0.5">{items.filter((i) => i.state === "error").slice(0, 20).map((i) => <li key={i.docId}><span className="font-medium">{i.name}:</span> {i.error}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}
