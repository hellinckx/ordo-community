import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeftRight, Check, FileCheck2, Landmark, Link2, Plus, RefreshCw, Search, Upload, X, EyeOff, Sparkles, AlertTriangle } from "lucide-react";
import { reconcileStats, candidatesForLine, transactionFromBankLine, bankSettlementInstructions, needsBankTransferReview, nowIso, type BankLine, type Transaction } from "@ordo/core";
import { useCategoryMap, useContactMap, useList, useProfile, useVault } from "@/state/hooks";
import { requirePlatform, requireStore } from "@/state/session";
import { FolderLinkButton, FolderLinks } from "@/components/FolderLinks";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Stat, Tabs, Spinner } from "@/components/ui";
import { TransactionForm, saveTransaction, validateTransaction } from "@/components/TransactionForm";
import { importBankFiles, runReconcile } from "@/services/bankImport";
import { cls, fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import { toast } from "@/state/toasts";
import { useAskAtlas } from "@/atlas/hooks";
import { CategoryIcon } from "@/lib/icons";

type Filter = "open" | "suggested" | "matched" | "ignored" | "ignoredIncome" | "all";

export default function Bank() {
  const profile = useProfile();
  const vault = useVault();
  const lines = useList("bankLines");
  const statements = useList("bankStatements");
  const txs = useList("transactions");
  const cats = useCategoryMap();
  const cons = useContactMap();
  const navigate = useNavigate();
  const askAtlas = useAskAtlas();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [statementId, setStatementId] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ line: BankLine; tx: Transaction } | null>(null);
  const [linking, setLinking] = useState<BankLine | null>(null);
  const [reviewIgnored, setReviewIgnored] = useState(false);
  const txById = useMemo(() => new Map(txs.map((t) => [t.id, t])), [txs]);

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
        if (filter === "ignoredIncome" && (l.status !== "ignored" || l.amountCents <= 0)) return false;
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
    requireStore().update("bankLines", l.id, { status, matchedTransactionId: matched, ignoreReason: status === "ignored" ? "Manuell ausgeschlossen" : undefined, suggestedTransactionId: undefined, suggestionScore: undefined, updatedAt: nowIso() }, "bank.status");
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

  const pct = stats.total ? (stats.matched + stats.booked) / stats.total : 0;
  const ignoredIncome = scoped.filter((l) => l.status === "ignored" && l.amountCents > 0);
  const restoreIgnored = () => {
    const ids = new Set(ignoredIncome.map((l) => l.id));
    requireStore().mutate((v) => {
      v.bankLines = v.bankLines.map((l) => ids.has(l.id) && l.profileId === profile.id && !l.deletedAt && l.status === "ignored" && !l.matchedTransactionId
        ? { ...l, status: "unmatched", ignoreReason: undefined, suggestedTransactionId: undefined, suggestionScore: undefined, updatedAt: nowIso() } : l);
    }, { audit: { action: "bank.review_ignored", entity: "bankLines", details: `${ids.size} Eingänge zur erneuten Prüfung` } });
    runReconcile();
    setReviewIgnored(false); setFilter("open"); setQ("");
    toast.info("Eingänge erneut geprüft", "Passende Buchungen wurden abgeglichen. Fehlende Einnahmen sind jetzt offen; es wurden keine neuen Buchungen angelegt.");
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Kontoauszüge" subtitle="Kontoauszug hochladen – Ordo vergleicht die erkannten Umsätze mit deinen Buchungen. Offene, zugeordnete und ignorierte Umsätze bleiben getrennt sichtbar." actions={<><FolderLinks kind="bank" /><Button variant="outline" onClick={rerun}><RefreshCw className="h-4 w-4" /> Neu vergleichen</Button><Button onClick={upload} loading={!!busy}><Upload className="h-4 w-4" /> Kontoauszug hochladen</Button></>} />
      {busy ? <div className="surface flex items-center gap-3 px-4 py-2 text-sm"><Spinner className="h-4 w-4" />{busy}</div> : null}
      {!lines.length ? (
        <EmptyState icon={<Landmark className="h-10 w-10" />} title="Noch kein Kontoauszug importiert" body={<>Lade den Kontoauszug deiner Bank hoch (PDF, CSV-Export oder CAMT-XML – z. B. aus George, ELBA, Bank Austria, N26, Revolut, PayPal). Ordo ordnet jede Zeile automatisch einer Buchung zu und zeigt, was noch fehlt: Bankspesen, Lastschriften, Abos, Gutschriften. {profile.mode === "business" ? "Unter Einstellungen → Ordner kannst du einen Ordner für Kontoauszüge dauerhaft überwachen." : ""}</>} action={<div className="flex flex-wrap justify-center gap-2"><Button onClick={upload}><Upload className="h-4 w-4" /> Kontoauszug wählen</Button><FolderLinkButton kind="bank" /></div>} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Mit Buchung abgeglichen" value={fmtPct(pct)} sub={`${stats.matched + stats.booked} von ${stats.total} Umsätzen · ${stats.ignored} ignoriert`} tone={pct > 0.95 ? "up" : undefined} />
            <Stat label="Offen" value={stats.unmatched} sub={`Abgänge ${fmtMoney(stats.unmatchedDebitCents)} · Eingänge ${fmtMoney(stats.unmatchedCreditCents)}`} tone={stats.unmatched ? "down" : "up"} />
            <Stat label="Vorschläge" value={stats.suggested} sub="bitte bestätigen" />
            <Stat label="Ohne Bankbeleg" value={stats.unbankedTransactions.length} sub="Buchungen (Bank) ohne Umsatz" />
            <Stat label="Auszüge" value={statements.length} sub={statements[0]?.iban ? `IBAN ${statements[0].iban.slice(0, 8)}…` : undefined} />
          </div>
          {stats.unmatched + stats.suggested ? (
            <div className="surface flex flex-wrap items-center gap-3 px-4 py-3">
              <Sparkles className="h-5 w-5 shrink-0 text-brand-700 dark:text-brand-400" />
              <div className="min-w-0 flex-[1_1_16rem] text-sm">
                <div className="font-medium">{stats.unmatched + stats.suggested} {stats.unmatched + stats.suggested === 1 ? "Umsatz wartet" : "Umsätze warten"} auf dich</div>
                <div className="text-xs text-(--text-muted)">{[stats.suggested ? `${stats.suggested} Vorschläge zum Bestätigen` : "", stats.unmatched ? `${stats.unmatched} ohne Buchung` : ""].filter(Boolean).join(" · ")}. Atlas ordnet zu, bucht Einnahmen und Ausgaben und sagt dir, wo eine Rechnung fehlt.</div>
              </div>
              <Button onClick={() => void askAtlas(bankSettlementInstructions(profile.mode))}><Sparkles className="h-4 w-4" /> Atlas erledigt das</Button>
            </div>
          ) : null}
          {stats.ignoredCredits ? <div role="status" className="surface flex flex-wrap items-center gap-3 px-4 py-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-[1_1_18rem] text-sm"><div className="font-medium">{stats.ignoredCredits} {stats.ignoredCredits === 1 ? "ignorierter Eingang" : "ignorierte Eingänge"} · {fmtMoney(stats.ignoredCreditCents)}</div><p className="text-xs text-(--text-muted)">Diese Eingänge sind keiner Einnahme zugeordnet. {profile.mode === "employee" ? "Taschengeld und Geschenke gehören zum privaten Budget. " : "Private Einlagen können zu Recht ausgeschlossen sein. "}Prüfe, ob echte Einnahmen oder Umbuchungen vorliegen.</p></div>
            <Button variant="outline" onClick={() => { setFilter("ignoredIncome"); setQ(""); }}>Eingänge ansehen</Button><Button variant="outline" onClick={() => setReviewIgnored(true)}>Erneut prüfen</Button>
          </div> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={filter} onChange={setFilter} tabs={[{ id: "open", label: "Offen", badge: stats.unmatched + stats.suggested ? <Badge tone="warning">{stats.unmatched + stats.suggested}</Badge> : undefined }, { id: "suggested", label: "Vorschläge" }, { id: "matched", label: "Zugeordnet" }, { id: "ignored", label: "Ignoriert" }, ...(stats.ignoredCredits ? [{ id: "ignoredIncome" as const, label: "Ignorierte Eingänge" }] : []), { id: "all", label: "Alle" }]} />
            <Select value={statementId} onChange={(e) => setStatementId(e.target.value)} className="w-64"><option value="all">Alle Kontoauszüge</option>{[...statements].sort((a, b) => (b.from ?? "").localeCompare(a.from ?? "")).map((s) => <option key={s.id} value={s.id}>{s.from ? `${fmtDate(s.from)} – ${fmtDate(s.to)}` : s.importedAt.slice(0, 10)} · {s.bankName || s.iban || s.format.toUpperCase()}</option>)}</Select>
            <div className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen …" className="pl-9" /></div>
          </div>
          {statements.filter((s) => (statementId === "all" || s.id === statementId) && s.warnings.length).map((s) => <div key={s.id} role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-100"><div className="mb-1 font-medium">Auszug {fmtDate(s.from)} – {fmtDate(s.to)}: Import prüfen</div>{s.warnings.map((w, i) => <div key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</div>)}</div>)}
          {filter === "ignoredIncome" ? <p className="text-sm text-(--text-muted)">Zeigt nur ignorierte Gutschriften. „Erneut prüfen“ gleicht zuerst vorhandene Buchungen ab. Fehlende Einnahmen erscheinen danach unter „Offen“ und können dort gebucht werden.</p> : null}
          <div className="surface overflow-x-auto">
            {!visible.length ? <div className="p-8 text-center text-sm text-(--text-muted)">{q.trim() ? "Keine passenden Umsätze gefunden." : filter === "open" ? `Keine offenen Umsätze.${stats.ignored ? ` ${stats.ignored} Umsätze wurden ignoriert und sind nicht als Einnahme oder Ausgabe erfasst.` : " Alle Umsätze sind einer Buchung zugeordnet."}` : "Keine Einträge."}</div> : (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)"><tr><th className="px-3 py-2">Datum</th><th className="px-3 py-2">Zahlungspartner / Zweck</th><th className="px-3 py-2 text-right">Betrag</th><th className="px-3 py-2">Zuordnung</th><th className="px-3 py-2"></th></tr></thead>
                <tbody className="divide-y divide-(--border)">
                  {visible.map((l) => {
                    const matched = l.matchedTransactionId ? txById.get(l.matchedTransactionId) : undefined;
                    const suggested = l.suggestedTransactionId ? txById.get(l.suggestedTransactionId) : undefined;
                    const show = matched ?? suggested;
                    const cat = show?.categoryId ? cats.get(show.categoryId) : undefined;
                    return (
                      <tr key={l.id} className="hover:bg-(--surface-2)">
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
                          ) : l.status === "ignored" ? <div><Badge>ignoriert</Badge><div className="mt-1 text-xs text-(--text-muted)">{l.ignoreReason || "Keine Begründung gespeichert"}</div></div> : <Badge tone="danger">keine Buchung</Badge>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right">
                          {l.status === "suggested" ? <><Button size="sm" variant="outline" onClick={() => acceptSuggestion(l)} title="Vorschlag übernehmen"><Check className="h-4 w-4" /> Ja</Button> <Button size="sm" variant="ghost" onClick={() => setLinking(l)} title="Andere Buchung wählen"><Link2 className="h-4 w-4" /></Button></> : null}
                          {l.status === "unmatched" ? <><Button size="sm" onClick={() => startBooking(l)}><Plus className="h-4 w-4" /> Buchen</Button> <Button size="sm" variant="ghost" onClick={() => setLinking(l)} title="Bestehender Buchung zuordnen"><Link2 className="h-4 w-4" /></Button> <Button size="sm" variant="ghost" onClick={() => setStatus(l, "ignored")} title="Umsatz aus Einnahmen und Ausgaben ausschließen"><EyeOff className="h-4 w-4" /></Button></> : null}
                          {l.status === "matched" || l.status === "booked" ? <Button size="sm" variant="ghost" onClick={() => setStatus(l, "unmatched", undefined)} title="Zuordnung lösen"><X className="h-4 w-4" /></Button> : null}
                          {l.status === "ignored" ? <Button size="sm" variant="outline" onClick={() => { setStatus(l, "unmatched"); runReconcile(); }}>Erneut prüfen</Button> : null}
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
        {booking ? <><div className="mb-3 rounded-lg bg-(--surface-2) px-3 py-2 text-xs"><ArrowLeftRight className="mr-1 inline h-3.5 w-3.5" />{fmtDate(booking.line.date)} · {booking.line.counterparty} · {booking.line.purpose}</div>{needsBankTransferReview(booking.line) ? <p role="status" className="mb-3 text-sm">Mögliche Umbuchung oder Bargeldbehebung: Prüfe den Zahlungsweg. Geld zwischen eigenen Konten oder zur eigenen Kasse verschieben zählt nicht als Einnahme oder Ausgabe. Wähle dafür „Umbuchung“ und die passenden Zahlungsarten.</p> : null}<TransactionForm value={booking.tx} onChange={(t) => setBooking({ ...booking, tx: t })} /></> : null}
      </Modal>
      <LinkDialog line={linking} onClose={() => setLinking(null)} />
      <Modal open={reviewIgnored} onClose={() => setReviewIgnored(false)} title="Ignorierte Eingänge erneut prüfen" size="lg" footer={<><Button variant="ghost" onClick={() => setReviewIgnored(false)}>Abbrechen</Button><Button onClick={restoreIgnored}>Abgleich starten</Button></>}>
        <p className="mb-3 text-sm">{ignoredIncome.length} Eingänge mit insgesamt {fmtMoney(stats.ignoredCreditCents)} werden wieder geprüft. Vorhandene Buchungen werden zuerst abgeglichen; fehlende bleiben offen. Echte Umbuchungen kannst du anschließend wieder ausschließen.</p>
        <ul className="divide-y divide-(--border)">{ignoredIncome.map((l) => <li key={l.id} className="flex gap-3 py-2 text-sm"><span className="shrink-0 tabular">{fmtDate(l.date)}</span><span className="min-w-0 flex-1 break-words">{l.counterparty}<span className="block text-xs text-(--text-muted)">{l.purpose}</span></span><span className="shrink-0 tabular">+{fmtMoney(l.amountCents)}</span></li>)}</ul>
      </Modal>
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
