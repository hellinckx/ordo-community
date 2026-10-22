import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { AlertTriangle, BookOpen, Download, FileDown, Info, Plus, Landmark, ScrollText, Scale, Sigma, Trash2 } from "lucide-react";
import {
  computeUva, computeE1a, computeL1, uvaPdf, e1aPdf, l1Pdf, journalPdf, tablePdf, kennzahlenCsv, journalCsv, steuerberaterCsv, formatForFinanzOnline, periodForDate, periodsOfYear, daysUntil, estDeadlines, constantsFor,
  deriveJournal, saldenliste, guv, bilanz, kontoblatt, accountName, validateEntry, CHART_OF_ACCOUNTS, ids, nowIso, todayIso, incomeTaxCents, tariffTable,
  type UvaResult, type JournalEntry, type JournalLine,
} from "@ordo/core";
import { useList, useProfile, useVault } from "@/state/hooks";
import { requirePlatform, requireStore } from "@/state/session";
import { Badge, Button, Card, ConfirmDialog, CopyButton, DateInput, EmptyState, Field, Input, Modal, MoneyInput, PageHeader, Select, Stat, Tabs } from "@/components/ui";
import { cls, fmtDate, fmtMoney, fmtPct } from "@/lib/format";
import { toast } from "@/state/toasts";

type Tab = "uva" | "euer" | "anv" | "doppik";

export default function Taxes() {
  const profile = useProfile();
  const { tab } = useParams();
  const navigate = useNavigate();
  const isBusiness = profile.mode === "business";
  const tabs: { id: Tab; label: React.ReactNode }[] = isBusiness
    ? [{ id: "uva", label: "Umsatzsteuer (UVA)" }, { id: "euer", label: "Gewinn (E1a)" }, ...(profile.accountingMethod === "doppik" ? [{ id: "doppik" as Tab, label: "Doppelte Buchführung" }] : [])]
    : [{ id: "anv", label: "Arbeitnehmerveranlagung (L1)" }];
  const current: Tab = (tab as Tab) && tabs.some((t) => t.id === tab) ? (tab as Tab) : tabs[0]!.id;
  return (
    <div className="space-y-4">
      <PageHeader title="Steuern" subtitle="Alles fertig ausgerechnet. Jeden Wert mit einem Klick kopieren und in FinanzOnline einfügen." />
      {tabs.length > 1 ? <Tabs tabs={tabs} value={current} onChange={(t) => navigate(`/steuern/${t}`)} className="w-fit" /> : null}
      {current === "uva" ? <UvaTab /> : current === "euer" ? <E1aTab /> : current === "anv" ? <L1Tab /> : <DoppikTab />}
    </div>
  );
}

function KzTable({ rows, copyAll }: { rows: { kz: string; label: string; section: string; base?: number; tax?: number; amount?: number; note?: string; count?: number }[]; copyAll: string }) {
  let lastSection = "";
  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-(--border) px-4 py-2">
        <span className="text-xs text-(--text-muted)">Werte im FinanzOnline-Format (Euro,Cent). Klick auf das Kopiersymbol kopiert den Wert.</span>
        <CopyButton text={copyAll} label="Alle kopieren" />
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <RowGroup key={r.kz} r={r} showSection={r.section !== lastSection ? ((lastSection = r.section), true) : false} />
          ))}
          {!rows.length ? <tr><td className="px-4 py-8 text-center text-(--text-muted)">Keine Werte im Zeitraum.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function RowGroup({ r, showSection }: { r: { kz: string; label: string; section: string; base?: number; tax?: number; amount?: number; note?: string; count?: number }; showSection: boolean }) {
  return (
    <>
      {showSection ? <tr><td colSpan={4} className="bg-(--surface-2) px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--text-muted)">{r.section}</td></tr> : null}
      <tr className="border-t border-(--border) hover:bg-(--surface-2)/60">
        <td className="w-16 px-4 py-2 font-mono text-xs font-bold text-brand-700">{r.kz}</td>
        <td className="px-2 py-2 text-xs leading-snug">{r.label}{r.note ? <div className="mt-0.5 text-[11px] text-amber-700">{r.note}</div> : null}{r.count ? <div className="text-[11px] text-(--text-muted)">{r.count} Buchung{r.count === 1 ? "" : "en"}</div> : null}</td>
        <td className="w-40 px-2 py-2 text-right">{r.base !== undefined ? <span className="inline-flex items-center gap-1"><span className="tabular">{formatForFinanzOnline(r.base)}</span><CopyButton text={formatForFinanzOnline(r.base)} /></span> : null}</td>
        <td className="w-40 px-2 py-2 text-right">{r.tax !== undefined ? <span className="inline-flex items-center gap-1"><span className="tabular font-semibold">{formatForFinanzOnline(r.tax)}</span><CopyButton text={formatForFinanzOnline(r.tax)} /></span> : r.amount !== undefined ? <span className="inline-flex items-center gap-1"><span className="tabular font-semibold">{formatForFinanzOnline(r.amount)}</span><CopyButton text={formatForFinanzOnline(r.amount)} /></span> : null}</td>
      </tr>
    </>
  );
}

function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <div className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
      {list.map((w, i) => <div key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</div>)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UVA                                                                 */
/* ------------------------------------------------------------------ */

function UvaTab() {
  const profile = useProfile();
  const vault = useVault();
  const txs = useList("transactions");
  const [params, setParams] = useSearchParams();
  const kind = profile.uvaPeriod === "monthly" ? "monthly" : "quarterly";
  const today = periodForDate(todayIso(), kind);
  const year = Number(params.get("year") ?? today.year);
  const index = Number(params.get("index") ?? (today.index === 1 ? (kind === "monthly" ? 12 : 4) : today.index - 1));
  const periods = periodsOfYear(year, kind);
  const result: UvaResult = useMemo(() => computeUva(profile, { year, index, kind }, txs, vault.categories), [profile, year, index, kind, txs, vault.categories]);
  const rows = result.lines.map((l) => ({ kz: l.kz, label: l.label, section: l.section, base: l.baseCents, tax: l.taxCents }));
  const copyAll = result.lines.map((l) => `KZ ${l.kz}: ${l.baseCents !== undefined ? formatForFinanzOnline(l.baseCents) : ""}${l.taxCents !== undefined ? (l.baseCents !== undefined ? " / " : "") + formatForFinanzOnline(l.taxCents) : ""}`).join("\n");
  const days = daysUntil(result.period.dueDate);
  const exportPdf = async () => requirePlatform().saveFile(`UVA_${year}_${kind === "monthly" ? "M" : "Q"}${index}.pdf`, await uvaPdf(result, profile), "application/pdf");
  const exportCsv = () => requirePlatform().saveFile(`UVA_${year}_${kind === "monthly" ? "M" : "Q"}${index}.csv`, kennzahlenCsv(result.lines), "text/csv");
  if (profile.uvaPeriod === "none") return <EmptyState icon={<Landmark className="h-8 w-8" />} title="Keine UVA-Pflicht eingestellt" body="Kleinunternehmer müssen in der Regel keine Umsatzsteuervoranmeldung abgeben. Unter Einstellungen → Steuern kannst du monatlich/vierteljährlich aktivieren." />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={year} onChange={(e) => setParams({ year: e.target.value, index: "1" })} className="w-28">{[year + 1, year, year - 1, year - 2].filter((y) => y >= 2020).map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-(--surface-2) p-1">
          {periods.map((p) => <button key={p.ref.index} onClick={() => setParams({ year: String(year), index: String(p.ref.index) })} className={cls("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm", p.ref.index === index ? "bg-(--surface) shadow-sm font-medium" : "text-(--text-muted)")}>{kind === "monthly" ? p.label.split(" ")[0] : `Q${p.ref.index}`}</button>)}
        </div>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4" /> CSV</Button>
        <Button variant="outline" size="sm" onClick={exportPdf}><FileDown className="h-4 w-4" /> PDF</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Zeitraum" value={result.period.label} sub={`${fmtDate(result.period.from)} – ${fmtDate(result.period.to)} · ${result.info.basis === "ist" ? "Ist" : "Soll"}besteuerung`} />
        <Stat label="Umsatzsteuer" value={fmtMoney(result.totals.umsatzsteuer)} sub={`Bemessungsgrundlage ${fmtMoney(result.totals.bemessungsgrundlage)}`} />
        <Stat label="Vorsteuer" value={fmtMoney(result.totals.vorsteuer)} sub={`${result.info.transactionCount} Buchungen`} />
        <Stat label={result.totals.zahllast >= 0 ? "Zahllast (KZ 095)" : "Gutschrift (KZ 095)"} value={fmtMoney(Math.abs(result.totals.zahllast))} sub={`Fällig ${fmtDate(result.period.dueDate)}${days >= 0 ? ` (in ${days} Tagen)` : " (überfällig)"}`} tone={result.totals.zahllast > 0 ? "down" : "up"} />
      </div>
      <Warnings list={result.warnings} />
      {result.info.zmAuslandsleistungenCents ? <div className="rounded-xl border border-(--border) bg-(--surface) px-4 py-2 text-xs text-(--text-muted)"><Info className="mr-1 inline h-3.5 w-3.5" />Nicht steuerbare Auslandsleistungen (Reverse Charge, B2B): <strong>{fmtMoney(result.info.zmAuslandsleistungenCents)}</strong> – nicht in der UVA, aber in der Zusammenfassenden Meldung (ZM) anzugeben.</div> : null}
      <KzTable rows={rows} copyAll={copyAll} />
      <p className="text-xs text-(--text-muted)">Einreichung in FinanzOnline: Eingaben/Erklärungen → Umsatzsteuervoranmeldung (U30) → Zeitraum wählen → Kennzahlen eintragen. Zahlung mit Verwendungszweck „U {kind === "monthly" ? `${String(index).padStart(2, "0")}` : `${(index - 1) * 3 + 1}-${index * 3}`}/{year}“ an das Finanzamt.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* E1a / EÜR                                                           */
/* ------------------------------------------------------------------ */

function E1aTab() {
  const profile = useProfile();
  const vault = useVault();
  const txs = useList("transactions");
  const assets = useList("assets");
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const result = useMemo(() => computeE1a(profile, year, txs, vault.categories, assets), [profile, year, txs, vault.categories, assets]);
  const c = constantsFor(year);
  const rows = result.lines.map((l) => ({ kz: l.kz, label: l.label, section: l.section, amount: l.amountCents, count: l.transactionIds.length }));
  const copyAll = result.lines.map((l) => `KZ ${l.kz}: ${formatForFinanzOnline(l.amountCents)}`).join("\n");
  const dl = estDeadlines(year);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">{[year + 1, year, year - 1, year - 2, year - 3].filter((y) => y >= 2020).map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <Badge tone="brand">{result.info.pauschalierung === "none" ? "Ohne Pauschalierung" : result.info.pauschalierung === "basis" ? "Basispauschalierung" : "Kleinunternehmerpauschalierung"}</Badge>
        <Badge>USt-{result.info.ustSystem === "brutto" ? "Brutto" : "Netto"}system</Badge>
        <button className="text-xs text-brand-700 hover:underline" onClick={() => navigate("/einstellungen/steuern")}>ändern</button>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => requirePlatform().saveFile(`E1a_${year}.csv`, kennzahlenCsv(result.lines), "text/csv")}><Download className="h-4 w-4" /> CSV</Button>
        <Button variant="outline" size="sm" onClick={async () => requirePlatform().saveFile(`EUeR_E1a_${year}.pdf`, await e1aPdf(result, profile), "application/pdf")}><FileDown className="h-4 w-4" /> PDF</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Betriebseinnahmen" value={fmtMoney(result.einnahmenCents)} tone="up" />
        <Stat label="Betriebsausgaben" value={fmtMoney(result.ausgabenCents + result.pauschaleCents)} sub={result.pauschaleCents ? `davon Pauschale ${fmtMoney(result.pauschaleCents)}` : undefined} />
        <Stat label="Gewinnfreibetrag" value={fmtMoney(result.grundfreibetragCents + result.investFreibetragCoveredCents)} sub={`Grundfreibetrag ${c.gewinnfreibetrag.grundPct} % bis ${c.gewinnfreibetrag.grundBasisMax.toLocaleString("de-AT")} €`} />
        <Stat label="Gewinn (steuerpflichtig)" value={fmtMoney(result.gewinnCents)} tone={result.gewinnCents >= 0 ? "up" : "down"} />
        <Stat label="ESt-Schätzung" value={fmtMoney(result.estSchaetzungCents)} sub="nur Betrieb, ohne Absetzbeträge/SV" />
      </div>
      <Warnings list={result.warnings} />
      <KzTable rows={rows} copyAll={copyAll} />
      <Card title="Einreichung">
        <ul className="list-disc space-y-1 pl-5 text-sm text-(--text-muted)">
          <li>Einkommensteuererklärung {year}: Formular <strong>E 1</strong> mit Beilage <strong>E 1a</strong> (Punkt 2 bis 4) – die Kennzahlen oben eins zu eins übertragen.</li>
          <li>Frist: Papier bis {fmtDate(dl.paper)}, FinanzOnline bis {fmtDate(dl.finanzOnline)} (bei steuerlicher Vertretung länger).</li>
          <li>KZ 9050 immer ausfüllen (auch mit 0). Rechnungen 7 Jahre aufbewahren – Summa speichert sie verschlüsselt.</li>
          <li>Einkommensteuertarif {year}: {tariffTable(year).map((b) => `${Math.round(b.rate * 100)} %${b.to ? ` bis ${b.to.toLocaleString("de-AT")} €` : " darüber"}`).join(" · ")}</li>
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* L1 / ANV                                                            */
/* ------------------------------------------------------------------ */

function L1Tab() {
  const profile = useProfile();
  const vault = useVault();
  const txs = useList("transactions");
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear() - (new Date().getMonth() < 2 ? 1 : 0));
  const employee = vault.settings.employee[profile.id];
  const result = useMemo(() => computeL1(profile, year, txs, vault.categories, employee), [profile, year, txs, vault.categories, employee]);
  const rows = result.lines.map((l) => ({ kz: l.kz, label: l.label, section: l.section, amount: l.amountCents, note: l.note, count: l.transactionIds.length }));
  const copyAll = result.lines.map((l) => `KZ ${l.kz}: ${formatForFinanzOnline(l.amountCents)}`).join("\n");
  const c = constantsFor(year);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">{[year + 1, year, year - 1, year - 2, year - 3, year - 4].filter((y) => y >= 2020).map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <button className="text-xs text-brand-700 hover:underline" onClick={() => navigate("/einstellungen/steuern")}>Gehalt & Pendlerpauschale eintragen</button>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => requirePlatform().saveFile(`ANV_L1_${year}.csv`, kennzahlenCsv(result.lines), "text/csv")}><Download className="h-4 w-4" /> CSV</Button>
        <Button variant="outline" size="sm" onClick={async () => requirePlatform().saveFile(`ANV_L1_${year}.pdf`, await l1Pdf(result, profile), "application/pdf")}><FileDown className="h-4 w-4" /> PDF</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Werbungskosten" value={fmtMoney(result.werbungskostenCents)} sub={`Pauschbetrag ${c.werbungskostenPauschale} € wird automatisch berücksichtigt`} />
        <Stat label="Sonderausgaben" value={fmtMoney(result.sonderausgabenCents)} />
        <Stat label="Außergew. Belastungen" value={fmtMoney(result.agbMitSelbstbehaltCents + result.agbOhneSelbstbehaltCents)} sub={`Selbstbehalt ca. ${fmtMoney(result.selbstbehaltCents)} (${result.selbstbehaltPct} %)`} />
        <Stat label="Grenzsteuersatz" value={fmtPct(result.marginalRate)} sub={`Einkommen geschätzt ${fmtMoney(result.taxableIncomeEstimateCents)}`} />
        <Stat label="Geschätzte Gutschrift" value={fmtMoney(result.estimatedRefundCents)} tone="up" sub="grobe Schätzung" />
      </div>
      <Warnings list={result.warnings} />
      <KzTable rows={rows} copyAll={copyAll} />
      <Card title="So reichst du ein">
        <ul className="list-disc space-y-1 pl-5 text-sm text-(--text-muted)">
          <li>FinanzOnline → Eingaben → Erklärungen → <strong>Erklärung zur Arbeitnehmerveranlagung (L 1)</strong> für {year}.</li>
          <li>Werbungskosten in L 1 (Punkt 9/10), außergewöhnliche Belastungen in Beilage <strong>L 1ab</strong>, Sonderausgaben (z. B. Steuerberatung) in <strong>L 1d</strong>, Kinder in <strong>L 1k</strong>.</li>
          <li>Kirchenbeitrag und Spenden an österreichische Organisationen werden automatisch übermittelt – nur bei Abweichung eintragen.</li>
          <li>Die ANV {year} kann bis 31.12.{year + 5} eingereicht werden. Rechnungen 7 Jahre aufbewahren.</li>
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Doppik                                                              */
/* ------------------------------------------------------------------ */

type DoppikView = "journal" | "saldenliste" | "guv" | "bilanz" | "konto";

function DoppikTab() {
  const profile = useProfile();
  const vault = useVault();
  const txs = useList("transactions");
  const assets = useList("assets");
  const manual = useList("journalEntries");
  const [view, setView] = useState<DoppikView>("journal");
  const [year, setYear] = useState(new Date().getFullYear());
  const [account, setAccount] = useState("2800");
  const [manualOpen, setManualOpen] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState<string | null>(null);
  const journal = useMemo(() => deriveJournal(profile, txs, assets, vault.categories, manual), [profile, txs, assets, vault.categories, manual]);
  const yearEntries = useMemo(() => journal.filter((e) => e.date.startsWith(String(year))), [journal, year]);
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const sl = useMemo(() => saldenliste(journal, from, to), [journal, from, to]);
  const g = useMemo(() => guv(journal, from, to), [journal, from, to]);
  const b = useMemo(() => bilanz(journal, to), [journal, to]);
  const kb = useMemo(() => kontoblatt(journal, account, from, to), [journal, account, from, to]);
  const accounts = useMemo(() => { const set = new Set(journal.flatMap((e) => e.lines.map((l) => l.account))); return CHART_OF_ACCOUNTS.filter((a) => set.has(a.number)); }, [journal]);
  const years = useMemo(() => [...new Set(journal.map((e) => Number(e.date.slice(0, 4))))].sort((a, b2) => b2 - a), [journal]);

  const exportCurrent = async () => {
    const p = requirePlatform();
    if (view === "journal") await p.saveFile(`Journal_${year}.pdf`, await journalPdf(yearEntries, profile, `Buchungsjournal ${year}`), "application/pdf");
    else if (view === "saldenliste") await p.saveFile(`Saldenliste_${year}.pdf`, await tablePdf(`Saldenliste ${year}`, `${fmtDate(from)} – ${fmtDate(to)}`, profile, ["Konto", "Bezeichnung", "Soll", "Haben", "Saldo"], sl.map((r) => [r.account, r.name, fmtMoney(r.debitCents), fmtMoney(r.creditCents), fmtMoney(r.balanceCents)]), [2, 3, 4]), "application/pdf");
    else if (view === "guv") await p.saveFile(`GuV_${year}.pdf`, await tablePdf(`Gewinn- und Verlustrechnung ${year}`, `Ergebnis: ${fmtMoney(g.resultCents)}`, profile, ["Konto", "Bezeichnung", "Betrag"], [...g.revenues.map((r) => [r.account, r.name, fmtMoney(-r.balanceCents)]), ["", "Summe Erträge", fmtMoney(g.revenueTotalCents)], ...g.expenses.map((r) => [r.account, r.name, fmtMoney(r.balanceCents)]), ["", "Summe Aufwendungen", fmtMoney(g.expenseTotalCents)], ["", "Jahresergebnis", fmtMoney(g.resultCents)]], [2]), "application/pdf");
    else if (view === "bilanz") await p.saveFile(`Bilanz_${year}.pdf`, await tablePdf(`Bilanz zum ${fmtDate(to)}`, `Bilanzsumme ${fmtMoney(b.aktivaTotalCents)}`, profile, ["Seite", "Konto", "Bezeichnung", "Betrag"], [...b.aktiva.map((r) => ["Aktiva", r.account, r.name, fmtMoney(r.balanceCents)]), ["Aktiva", "", "Summe", fmtMoney(b.aktivaTotalCents)], ...b.passiva.map((r) => ["Passiva", r.account, r.name, fmtMoney(r.balanceCents)]), ["Passiva", "", "Summe", fmtMoney(b.passivaTotalCents)]], [3]), "application/pdf");
    else await p.saveFile(`Kontoblatt_${account}_${year}.pdf`, await tablePdf(`Kontoblatt ${account} ${accountName(account)}`, `${year}`, profile, ["Nr.", "Datum", "Text", "Gegenkonto", "Soll", "Haben", "Saldo"], kb.map((r) => [r.entryNumber, fmtDate(r.date), r.description, r.counterAccounts.join(", "), r.debitCents ? fmtMoney(r.debitCents) : "", r.creditCents ? fmtMoney(r.creditCents) : "", fmtMoney(r.balanceCents)]), [4, 5, 6]), "application/pdf");
  };

  return (
    <div className="space-y-4">
      {profile.accountingMethod !== "doppik" ? <div className="rounded-xl border border-(--border) bg-(--surface) px-4 py-2 text-xs text-(--text-muted)"><Info className="mr-1 inline h-3.5 w-3.5" />Dein Profil nutzt die Einnahmen-Ausgaben-Rechnung. Die doppelte Buchführung wird trotzdem automatisch aus allen Buchungen abgeleitet (Sollbesteuerung, EKR) – nützlich für GmbH, Bilanzierer oder den Steuerberater.</div> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onChange={setView} tabs={[{ id: "journal", label: <span className="inline-flex items-center gap-1"><ScrollText className="h-3.5 w-3.5" />Journal</span> }, { id: "saldenliste", label: "Saldenliste" }, { id: "guv", label: "GuV" }, { id: "bilanz", label: <span className="inline-flex items-center gap-1"><Scale className="h-3.5 w-3.5" />Bilanz</span> }, { id: "konto", label: <span className="inline-flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" />Kontoblatt</span> }]} />
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">{(years.length ? years : [year]).map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        {view === "konto" ? <Select value={account} onChange={(e) => setAccount(e.target.value)} className="w-72">{(accounts.length ? accounts : CHART_OF_ACCOUNTS).map((a) => <option key={a.number} value={a.number}>{a.number} {a.name}</option>)}</Select> : null}
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setManualOpen(true)}><Plus className="h-4 w-4" /> Manuelle Buchung</Button>
        <Button variant="outline" size="sm" onClick={() => requirePlatform().saveFile(`Journal_${year}.csv`, journalCsv(yearEntries), "text/csv")}><Download className="h-4 w-4" /> CSV</Button>
        <Button variant="outline" size="sm" onClick={() => requirePlatform().saveFile(`Buchungen_Steuerberater_${year}.csv`, steuerberaterCsv(yearEntries), "text/csv")} title="Export für Steuerberater (BMD/DATEV-ähnlich)"><Download className="h-4 w-4" /> StB-Export</Button>
        <Button variant="outline" size="sm" onClick={exportCurrent}><FileDown className="h-4 w-4" /> PDF</Button>
      </div>
      {view === "journal" ? (
        <div className="surface overflow-hidden">
          {!yearEntries.length ? <div className="p-8 text-center text-sm text-(--text-muted)">Keine Buchungen in {year}.</div> : (
            <table className="w-full text-sm">
              <thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)"><tr><th className="px-3 py-2">Nr.</th><th className="px-3 py-2">Datum</th><th className="px-3 py-2">Buchungstext</th><th className="px-3 py-2">Konto</th><th className="px-3 py-2 text-right">Soll</th><th className="px-3 py-2 text-right">Haben</th><th className="w-10" /></tr></thead>
              <tbody>
                {yearEntries.map((e) => e.lines.map((l, i) => (
                  <tr key={`${e.id}-${i}`} className={cls("hover:bg-(--surface-2)", i === 0 && "border-t border-(--border)")}>
                    <td className="px-3 py-1 tabular text-(--text-muted)">{i === 0 ? e.number : ""}</td>
                    <td className="px-3 py-1 tabular">{i === 0 ? fmtDate(e.date) : ""}</td>
                    <td className="px-3 py-1">{i === 0 ? <span>{e.description}{e.source === "manual" ? <Badge className="ml-2">manuell</Badge> : null}</span> : <span className="text-xs text-(--text-muted)">{l.text}</span>}</td>
                    <td className="px-3 py-1"><span className="font-mono text-xs">{l.account}</span> <span className="text-xs text-(--text-muted)">{accountName(l.account)}</span></td>
                    <td className="px-3 py-1 text-right tabular">{l.debitCents ? fmtMoney(l.debitCents) : ""}</td>
                    <td className="px-3 py-1 text-right tabular">{l.creditCents ? fmtMoney(l.creditCents) : ""}</td>
                    <td className="px-2">{i === 0 && e.source === "manual" ? <button className="rounded p-1 text-(--text-muted) hover:text-red-600" onClick={() => setDeleteEntry(e.id)}><Trash2 className="h-3.5 w-3.5" /></button> : null}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
      {view === "saldenliste" ? (
        <div className="surface overflow-hidden"><table className="w-full text-sm"><thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)"><tr><th className="px-3 py-2">Konto</th><th className="px-3 py-2">Bezeichnung</th><th className="px-3 py-2 text-right">Soll</th><th className="px-3 py-2 text-right">Haben</th><th className="px-3 py-2 text-right">Saldo</th></tr></thead><tbody className="divide-y divide-(--border)">{sl.map((r) => <tr key={r.account} className="hover:bg-(--surface-2)"><td className="px-3 py-1.5 font-mono text-xs">{r.account}</td><td className="px-3 py-1.5">{r.name}</td><td className="px-3 py-1.5 text-right tabular">{fmtMoney(r.debitCents)}</td><td className="px-3 py-1.5 text-right tabular">{fmtMoney(r.creditCents)}</td><td className={cls("px-3 py-1.5 text-right tabular font-medium", r.balanceCents < 0 && "text-(--text-muted)")}>{fmtMoney(Math.abs(r.balanceCents))} {r.balanceCents >= 0 ? "S" : "H"}</td></tr>)}</tbody></table></div>
      ) : null}
      {view === "guv" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Erträge"><table className="w-full text-sm"><tbody className="divide-y divide-(--border)">{g.revenues.map((r) => <tr key={r.account}><td className="py-1.5 font-mono text-xs">{r.account}</td><td className="py-1.5">{r.name}</td><td className="py-1.5 text-right tabular">{fmtMoney(-r.balanceCents)}</td></tr>)}<tr className="font-semibold"><td /><td className="py-2">Summe Erträge</td><td className="py-2 text-right tabular text-emerald-600">{fmtMoney(g.revenueTotalCents)}</td></tr></tbody></table></Card>
          <Card title="Aufwendungen"><table className="w-full text-sm"><tbody className="divide-y divide-(--border)">{g.expenses.map((r) => <tr key={r.account}><td className="py-1.5 font-mono text-xs">{r.account}</td><td className="py-1.5">{r.name}</td><td className="py-1.5 text-right tabular">{fmtMoney(r.balanceCents)}</td></tr>)}<tr className="font-semibold"><td /><td className="py-2">Summe Aufwendungen</td><td className="py-2 text-right tabular">{fmtMoney(g.expenseTotalCents)}</td></tr></tbody></table></Card>
          <div className="surface flex items-center justify-between p-4 lg:col-span-2"><span className="font-semibold">Jahresergebnis {year}</span><span className={cls("text-xl font-bold tabular", g.resultCents >= 0 ? "text-emerald-600" : "text-red-600")}>{fmtMoney(g.resultCents)}</span></div>
        </div>
      ) : null}
      {view === "bilanz" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Aktiva"><table className="w-full text-sm"><tbody className="divide-y divide-(--border)">{b.aktiva.map((r) => <tr key={r.account}><td className="py-1.5 font-mono text-xs">{r.account}</td><td className="py-1.5">{r.name}</td><td className="py-1.5 text-right tabular">{fmtMoney(r.balanceCents)}</td></tr>)}<tr className="font-semibold"><td /><td className="py-2">Bilanzsumme</td><td className="py-2 text-right tabular">{fmtMoney(b.aktivaTotalCents)}</td></tr></tbody></table></Card>
          <Card title="Passiva"><table className="w-full text-sm"><tbody className="divide-y divide-(--border)">{b.passiva.map((r) => <tr key={r.account + r.name}><td className="py-1.5 font-mono text-xs">{r.account}</td><td className="py-1.5">{r.name}</td><td className="py-1.5 text-right tabular">{fmtMoney(r.balanceCents)}</td></tr>)}<tr className="font-semibold"><td /><td className="py-2">Bilanzsumme</td><td className="py-2 text-right tabular">{fmtMoney(b.passivaTotalCents)}</td></tr></tbody></table></Card>
          {Math.abs(b.aktivaTotalCents - b.passivaTotalCents) > 0 ? <Warnings list={[`Bilanz nicht ausgeglichen (Differenz ${fmtMoney(b.aktivaTotalCents - b.passivaTotalCents)}) – manuelle Buchungen prüfen.`]} /> : null}
        </div>
      ) : null}
      {view === "konto" ? (
        <div className="surface overflow-hidden"><table className="w-full text-sm"><thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)"><tr><th className="px-3 py-2">Nr.</th><th className="px-3 py-2">Datum</th><th className="px-3 py-2">Text</th><th className="px-3 py-2">Gegenkonto</th><th className="px-3 py-2 text-right">Soll</th><th className="px-3 py-2 text-right">Haben</th><th className="px-3 py-2 text-right">Saldo</th></tr></thead><tbody className="divide-y divide-(--border)">{kb.map((r, i) => <tr key={i} className="hover:bg-(--surface-2)"><td className="px-3 py-1.5 tabular text-(--text-muted)">{r.entryNumber}</td><td className="px-3 py-1.5 tabular">{fmtDate(r.date)}</td><td className="px-3 py-1.5">{r.description}</td><td className="px-3 py-1.5 font-mono text-xs">{r.counterAccounts.join(", ")}</td><td className="px-3 py-1.5 text-right tabular">{r.debitCents ? fmtMoney(r.debitCents) : ""}</td><td className="px-3 py-1.5 text-right tabular">{r.creditCents ? fmtMoney(r.creditCents) : ""}</td><td className="px-3 py-1.5 text-right tabular font-medium">{fmtMoney(r.balanceCents)}</td></tr>)}{!kb.length ? <tr><td colSpan={7} className="px-3 py-8 text-center text-(--text-muted)">Keine Bewegungen.</td></tr> : null}</tbody></table></div>
      ) : null}
      <ManualEntryDialog open={manualOpen} onClose={() => setManualOpen(false)} />
      <ConfirmDialog open={!!deleteEntry} onClose={() => setDeleteEntry(null)} danger title="Manuelle Buchung löschen?" confirmLabel="Löschen" onConfirm={() => requireStore().softDelete("journalEntries", deleteEntry!)} />
    </div>
  );
}

function ManualEntryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useProfile();
  const [date, setDate] = useState(todayIso());
  const [desc, setDesc] = useState("");
  const [lines, setLines] = useState<JournalLine[]>([{ account: "7990", debitCents: 0, creditCents: 0, text: "" }, { account: "2800", debitCents: 0, creditCents: 0, text: "" }]);
  const errors = validateEntry(lines.filter((l) => l.debitCents || l.creditCents));
  const save = () => {
    const used = lines.filter((l) => l.debitCents || l.creditCents);
    const errs = validateEntry(used);
    if (errs.length || !desc.trim()) {
      toast.warning(errs[0] ?? "Buchungstext fehlt.");
      return;
    }
    const e: JournalEntry = { id: ids.journal(), profileId: profile.id, number: 0, date, description: desc, lines: used, documentIds: [], source: "manual", locked: false, createdAt: nowIso(), updatedAt: nowIso() };
    requireStore().insert("journalEntries", e, "journal.manual");
    toast.success("Buchungssatz gespeichert");
    setDesc("");
    setLines([{ account: "7990", debitCents: 0, creditCents: 0, text: "" }, { account: "2800", debitCents: 0, creditCents: 0, text: "" }]);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Manueller Buchungssatz" size="lg" footer={<><Button variant="ghost" onClick={onClose}>Abbrechen</Button><Button onClick={save} disabled={errors.length > 0}>Buchen</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <Field label="Datum"><DateInput value={date} onChange={(d) => setDate(d ?? todayIso())} /></Field>
          <Field label="Buchungstext"><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="z. B. Abgrenzung Versicherung" /></Field>
        </div>
        <div className="grid grid-cols-[1fr_120px_120px] gap-2 text-[11px] font-medium text-(--text-muted)"><span>Konto</span><span className="text-right">Soll</span><span className="text-right">Haben</span></div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_120px_120px] gap-2">
            <Select value={l.account} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))}>{CHART_OF_ACCOUNTS.map((a) => <option key={a.number} value={a.number}>{a.number} {a.name}</option>)}</Select>
            <MoneyInput value={l.debitCents || null} onChange={(c) => setLines(lines.map((x, j) => (j === i ? { ...x, debitCents: c ?? 0, creditCents: c ? 0 : x.creditCents } : x)))} />
            <MoneyInput value={l.creditCents || null} onChange={(c) => setLines(lines.map((x, j) => (j === i ? { ...x, creditCents: c ?? 0, debitCents: c ? 0 : x.debitCents } : x)))} />
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setLines([...lines, { account: "7990", debitCents: 0, creditCents: 0, text: "" }])}><Plus className="h-4 w-4" /> Zeile</Button>
          <span className="text-xs text-(--text-muted)">Soll {fmtMoney(lines.reduce((s, l) => s + l.debitCents, 0))} · Haben {fmtMoney(lines.reduce((s, l) => s + l.creditCents, 0))}</span>
        </div>
        {errors.length ? <Warnings list={errors} /> : null}
      </div>
    </Modal>
  );
}

export { Sigma, incomeTaxCents };
