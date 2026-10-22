import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeftRight, Check, FileCheck2, Landmark, Link2, Plus, RefreshCw, Search, Upload, X, EyeOff, Sparkles, AlertTriangle } from "lucide-react";
import { reconcileStats, candidatesForLine, transactionFromBankLine, nowIso, type BankLine, type Transaction } from "@ordo/core";
import { useCategoryMap, useContactMap, useList, useProfile, useVault } from "@/state/hooks";
import { requirePlatform, requireStore } from "@/state/session";
import { FolderLinkButton, FolderLinks } from "@/components/FolderLinks";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Stat, Tabs, Spinner } from "@/components/ui";
import { TransactionForm, saveTransaction, validateTransaction } from "@/components/TransactionForm";
import { importBankFiles, runReconcile } from "@/services/bankImport";
import { cls, fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import { toast } from "@/state/toasts";
import { CategoryIcon } from "@/lib/icons";

type Filter = "open" | "suggested" | "matched" | "ignored" | "all";

export default function Bank() {
  const profile = useProfile();
  const vault = useVault();
  const lines = useList("bankLines");
  const statements = useList("bankStatements");
  const txs = useList("transactions");
  const cats = useCategoryMap();
  const cons = useContactMap();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [statementId, setStatementId] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ line: BankLine; tx: Transaction } | null>(null);
  const [linking, setLinking] = useState<BankLine | null>(null);
  const txById = useMemo(() => new Map(txs.map((t) => [t.id, t])), [txs]);
  const stmtById = useMemo(() => new Map(statements.map((s) => [s.id, s])), [statements]);

  const scoped = useMemo(() => lines.filter((l) => statementId === "all" || l.statementId === statementId), [lines, statementId]);
  const stats = useMemo(() => {
    // Only look for missing bank lines inside periods actually covered by imported statements.
    const relevant = statementId === "all" ? statements : statements.filter((s) => s.id === statementId);
    const froms = relevant.map((s) => s.from).filter(Boolean) as string[];
    const tos = relevant.map((s) => s.to).filter(Boolean) as string[];
    const from = froms.length ? froms.sort()[0] : undefined;
    const to = tos.length ? tos.sort()[tos.length - 1] : undefined;
    const base = reconcileStats(scoped, txs, from, to);
    if (statementId === "all" && relevant.length > 1) {
      base.unbankedTransactions = base.unbankedTransactions.filter((t) => relevant.some((s) => (!s.from || (t.paidDate ?? t.date) >= s.from) && (!s.to || (t.paidDate ?? t.date) <= s.to)));
    }
    return base;
  }, [scoped, txs, statementId, statements]);
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return scoped
      .filter((l) => {
        if (filter === "open" && l.status !== "unmatched" && l.status !== "suggested") return false;
        if (filter === "suggested" && l.status !== "suggested") return false;
        if (filter === "matched" && l.status !== "matched" && l.status !== "booked") return false;
        if (filter === "ignored" && l.status !== "ignored") return false;
        if (s && !`${l.counterparty} ${l.purpose} ${l.reference} ${l.amountCents / 100}`.toLowerCase().includes(s)) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [scoped, filter, q]);

  const upload = async () => {
    const files = await requirePlatform().pickFiles({ multiple: true, accept: [".pdf", ".csv", ".xml", ".txt", ".xlsx"] });
    if (!files.length) return;
    setBusy("Import läuft …");
    try {
      await importBankFiles(files, setBusy);
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (l: BankLine, status: BankLine["status"], matched?: string) => {
    requireStore().update("bankLines", l.id, { status, matchedTransactionId: matched, suggestedTransactionId: status === "matched" ? undefined : l.suggestedTransactionId, updatedAt: nowIso() }, "bank.status");
  };
  const acceptSuggestion = (l: BankLine) => l.suggestedTransactionId && setStatus(l, "matched", l.suggestedTransactionId);
  const startBooking = (l: BankLine) => {
    const tx = transactionFromBankLine(l, profile.id, profile.mode, vault.categories, vault.contacts.filter((c) => c.profileId === profile.id), profile.vatRegime);
    setBooking({ line: l, tx });
  };
  const confirmBooking = () => {
    if (!booking) return;
    const err = validateTransaction(booking.tx);
    if (err) {
      toast.warning(err);
      return;
    }
    const saved = saveTransaction(booking.tx, { isNew: true });
    setStatus(booking.line, "booked", saved.id);
    toast.success("Buchung aus Kontoauszug angelegt", `${fmtMoney(saved.grossCents)} · ${saved.description}`);
    setBooking(null);
  };
  const rerun = () => {
    const r = runReconcile();
    toast.info("Abgleich aktualisiert", `${r.autoMatched} automatisch zugeordnet, ${r.suggested} Vorschläge`);
  };

  const pct = stats.total ? (stats.matched + stats.booked + stats.ignored) / stats.total : 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Kontoauszüge" subtitle="Kontoauszug hochladen – Summa vergleicht jede Zeile mit deinen Buchungen und zeigt, was fehlt. Nichts vergessen, nichts doppelt." actions={<><FolderLinks kind="bank" /><Button variant="outline" onClick={rerun}><RefreshCw className="h-4 w-4" /> Neu vergleichen</Button><Button onClick={upload} loading={!!busy}><Upload className="h-4 w-4" /> Kontoauszug hochladen</Button></>} />
      {busy ? <div className="surface flex items-center gap-3 px-4 py-2 text-sm"><Spinner className="h-4 w-4" />{busy}</div> : null}
      {!lines.length ? (
        <EmptyState icon={<Landmark className="h-10 w-10" />} title="Noch kein Kontoauszug importiert" body={<>Lade den Kontoauszug deiner Bank hoch (PDF, CSV-Export oder CAMT-XML – z. B. aus George, ELBA, Bank Austria, N26, Revolut, PayPal). Summa ordnet jede Zeile automatisch einer Buchung zu und zeigt, was noch fehlt: Bankspesen, Lastschriften, Abos, Gutschriften. {profile.mode === "business" ? "Unter Einstellungen → Ordner kannst du einen Ordner für Kontoauszüge dauerhaft überwachen." : ""}</>} action={<div className="flex flex-wrap justify-center gap-2"><Button onClick={upload}><Upload className="h-4 w-4" /> Kontoauszug wählen</Button><FolderLinkButton kind="bank" /></div>} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Abgeglichen" value={fmtPct(pct)} sub={`${stats.matched + stats.booked} von ${stats.total} Umsätzen`} tone={pct > 0.95 ? "up" : undefined} />
            <Stat label="Offen" value={stats.unmatched} sub={`Abgänge ${fmtMoney(stats.unmatchedDebitCents)} · Eingänge ${fmtMoney(stats.unmatchedCreditCents)}`} tone={stats.unmatched ? "down" : "up"} />
            <Stat label="Vorschläge" value={stats.suggested} sub="bitte bestätigen" />
            <Stat label="Ohne Bankbeleg" value={stats.unbankedTransactions.length} sub="Buchungen (Bank) ohne Umsatz" />
            <Stat label="Auszüge" value={statements.length} sub={statements[0]?.iban ? `IBAN ${statements[0].iban.slice(0, 8)}…` : undefined} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={filter} onChange={setFilter} tabs={[{ id: "open", label: "Offen", badge: stats.unmatched + stats.suggested ? <Badge tone="warning">{stats.unmatched + stats.suggested}</Badge> : undefined }, { id: "suggested", label: "Vorschläge" }, { id: "matched", label: "Zugeordnet" }, { id: "ignored", label: "Ignoriert" }, { id: "all", label: "Alle" }]} />
            <Select value={statementId} onChange={(e) => setStatementId(e.target.value)} className="w-64"><option value="all">Alle Kontoauszüge</option>{[...statements].sort((a, b) => (b.from ?? "").localeCompare(a.from ?? "")).map((s) => <option key={s.id} value={s.id}>{s.from ? `${fmtDate(s.from)} – ${fmtDate(s.to)}` : s.importedAt.slice(0, 10)} · {s.bankName || s.iban || s.format.toUpperCase()}</option>)}</Select>
            <div className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen …" className="pl-9" /></div>
          </div>
          {statementId !== "all" && stmtById.get(statementId)?.warnings.length ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">{stmtById.get(statementId)!.warnings.map((w, i) => <div key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</div>)}</div> : null}
          <div className="surface overflow-x-auto">
            {!visible.length ? <div className="p-8 text-center text-sm text-(--text-muted)">{filter === "open" ? "Alles abgeglichen – nichts offen." : "Keine Einträge."}</div> : (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)"><tr><th className="px-3 py-2">Datum</th><th className="px-3 py-2">Zahlungspartner / Zweck</th><th className="px-3 py-2 text-right">Betrag</th><th className="px-3 py-2">Zuordnung</th><th className="px-3 py-2"></th></tr></thead>
                <tbody className="divide-y divide-(--border)">
                  {visible.map((l) => {
                    const matched = l.matchedTransactionId ? txById.get(l.matchedTransactionId) : undefined;
                    const suggested = l.suggestedTransactionId ? txById.get(l.suggestedTransactionId) : undefined;
                    const show = matched ?? suggested;
                    const cat = show?.categoryId ? cats.get(show.categoryId) : undefined;
                    return (
                      <tr key={l.id} className={cls("hover:bg-(--surface-2)", l.status === "ignored" && "opacity-50")}>
                        <td className="whitespace-nowrap px-3 py-2 tabular">{fmtDate(l.date)}</td>
                        <td className="w-1/2 max-w-0 px-3 py-2"><div className="truncate font-medium">{l.counterparty || "–"}</div><div className="truncate text-xs text-(--text-muted)" title={l.purpose}>{l.purpose}{l.reference ? ` · ${l.reference}` : ""}</div></td>
                        <td className={cls("whitespace-nowrap px-3 py-2 text-right tabular font-semibold", l.amountCents > 0 ? "text-emerald-600" : "")}>{l.amountCents > 0 ? "+" : ""}{fmtMoney(l.amountCents)}</td>
                        <td className="w-1/2 max-w-0 px-3 py-2">
                          {show ? (
                            <div className="flex min-w-0 items-center gap-2 text-xs">
                              {l.status === "suggested" ? <Sparkles className="h-3.5 w-3.5 text-amber-500" /> : <Check className="h-3.5 w-3.5 text-emerald-600" />}
                              {cat ? <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-white" style={{ background: cat.color }}><CategoryIcon name={cat.icon} className="h-3 w-3" /></span> : null}
                              <span className="truncate">{show.description || cat?.name}{show.contactId ? ` · ${cons.get(show.contactId)?.name ?? ""}` : ""} ({fmtDate(show.date)})</span>
                              {l.status === "suggested" && l.suggestionScore != null ? <Badge tone="warning">{Math.round(l.suggestionScore * 100)} %</Badge> : null}
                            </div>
                          ) : l.status === "ignored" ? <Badge>ignoriert</Badge> : <Badge tone="danger">keine Buchung</Badge>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right">
                          {l.status === "suggested" ? <><Button size="sm" variant="outline" onClick={() => acceptSuggestion(l)} title="Vorschlag übernehmen"><Check className="h-4 w-4" /> Ja</Button> <Button size="sm" variant="ghost" onClick={() => setLinking(l)} title="Andere Buchung wählen"><Link2 className="h-4 w-4" /></Button></> : null}
                          {l.status === "unmatched" ? <><Button size="sm" onClick={() => startBooking(l)}><Plus className="h-4 w-4" /> Buchen</Button> <Button size="sm" variant="ghost" onClick={() => setLinking(l)} title="Bestehender Buchung zuordnen"><Link2 className="h-4 w-4" /></Button> <Button size="sm" variant="ghost" onClick={() => setStatus(l, "ignored")} title="Ignorieren (privat/Umbuchung)"><EyeOff className="h-4 w-4" /></Button></> : null}
                          {l.status === "matched" || l.status === "booked" ? <Button size="sm" variant="ghost" onClick={() => setStatus(l, "unmatched", undefined)} title="Zuordnung lösen"><X className="h-4 w-4" /></Button> : null}
                          {l.status === "ignored" ? <Button size="sm" variant="ghost" onClick={() => setStatus(l, "unmatched")}>Zurück</Button> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {stats.unbankedTransactions.length ? (
            <Card title={`Buchungen mit Zahlungsart Bank ohne passenden Umsatz (${stats.unbankedTransactions.length})`}>
              <p className="mb-2 text-xs text-(--text-muted)">Entweder noch nicht am Konto, falsch erfasst (z. B. bar bezahlt) oder der Kontoauszug fehlt.</p>
              <ul className="divide-y divide-(--border) text-sm">{stats.unbankedTransactions.slice(0, 25).map((t) => <li key={t.id} className="flex items-center gap-3 py-1.5"><span className="tabular text-(--text-muted)">{fmtDate(t.paidDate ?? t.date)}</span><span className="flex-1 truncate">{t.description || cats.get(t.categoryId ?? "")?.name}</span><span className={cls("tabular font-medium", t.kind === "income" && "text-emerald-600")}>{t.kind === "income" ? "+" : "−"}{fmtMoney(t.grossCents)}</span><button className="text-xs text-brand-700 hover:underline" onClick={() => navigate("/buchungen")}>öffnen</button></li>)}</ul>
            </Card>
          ) : null}
        </>
      )}
      <Modal open={!!booking} onClose={() => setBooking(null)} title="Buchung aus Kontoauszug anlegen" size="lg" footer={<><Button variant="ghost" onClick={() => setBooking(null)}>Abbrechen</Button><Button onClick={confirmBooking}><FileCheck2 className="h-4 w-4" /> Buchen</Button></>}>
        {booking ? <><div className="mb-3 rounded-lg bg-(--surface-2) px-3 py-2 text-xs"><ArrowLeftRight className="mr-1 inline h-3.5 w-3.5" />{fmtDate(booking.line.date)} · {booking.line.counterparty} · {booking.line.purpose}</div><TransactionForm value={booking.tx} onChange={(t) => setBooking({ ...booking, tx: t })} /></> : null}
      </Modal>
      <LinkDialog line={linking} onClose={() => setLinking(null)} />
    </div>
  );
}

function LinkDialog({ line, onClose }: { line: BankLine | null; onClose: () => void }) {
  const txs = useList("transactions");
  const contacts = useContactMap();
  const cats = useCategoryMap();
  const lines = useList("bankLines");
  const [q, setQ] = useState("");
  const candidates = useMemo(() => {
    if (!line) return [];
    const taken = new Set(lines.filter((l) => l.matchedTransactionId && l.id !== line.id).map((l) => l.matchedTransactionId!));
    const c = candidatesForLine(line, txs, contacts, taken);
    const ids = new Set(c.map((x) => x.transactionId));
    const s = q.trim().toLowerCase();
    const extra = s ? txs.filter((t) => !ids.has(t.id) && !taken.has(t.id) && `${t.description} ${t.invoiceNumber} ${t.grossCents / 100}`.toLowerCase().includes(s)).slice(0, 20).map((t) => ({ transactionId: t.id, score: 0, reasons: ["Suchtreffer"] })) : [];
    return [...c, ...extra];
  }, [line, txs, contacts, lines, q]);
  if (!line) return null;
  const pick = (id: string) => {
    requireStore().update("bankLines", line.id, { status: "matched", matchedTransactionId: id, suggestedTransactionId: undefined, updatedAt: nowIso() }, "bank.link");
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Buchung zuordnen" size="lg">
      <div className="mb-3 rounded-lg bg-(--surface-2) px-3 py-2 text-xs">{fmtDate(line.date)} · {line.counterparty} · {line.purpose} · <strong>{fmtMoney(line.amountCents)}</strong></div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buchung suchen (Text, Betrag, Nummer) …" className="mb-3" />
      {!candidates.length ? <div className="py-6 text-center text-sm text-(--text-muted)">Keine passende Buchung gefunden – „Buchen“ legt eine neue an.</div> : null}
      <ul className="divide-y divide-(--border)">
        {candidates.map((c) => {
          const t = txs.find((x) => x.id === c.transactionId)!;
          const cat = t.categoryId ? cats.get(t.categoryId) : undefined;
          return (
            <li key={c.transactionId} className="flex items-center gap-3 py-2 text-sm">
              <span className="tabular text-(--text-muted)">{fmtDate(t.date)}</span>
              <span className="flex-1 truncate">{t.description || cat?.name}{t.contactId ? ` · ${contacts.get(t.contactId)?.name}` : ""}<span className="block text-xs text-(--text-muted)">{c.reasons.join(" · ")}</span></span>
              <span className="tabular font-medium">{fmtMoney(t.grossCents)}</span>
              {c.score ? <Badge tone={c.score >= 0.85 ? "success" : "warning"}>{Math.round(c.score * 100)} %</Badge> : null}
              <Button size="sm" variant="outline" onClick={() => pick(t.id)}>Zuordnen</Button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
