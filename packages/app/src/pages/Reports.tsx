import { useMemo, useState } from "react";
import { byCategory, byContact, monthlySeries, relevantTransactions } from "@ordo/core";
import { useList, useProfile, useVault } from "@/state/hooks";
import { Card, EmptyState, PageHeader, Select, Stat, Tabs } from "@/components/ui";
import { IntakeButton } from "@/components/Intake";
import { CategoryDonut, CumulativeLine, MonthlyChart } from "@/components/charts";
import { CategoryIcon } from "@/lib/icons";
import { fmtMoney, fmtPct } from "@/lib/format";

export default function Reports() {
  const profile = useProfile();
  const vault = useVault();
  const txsAll = useList("transactions");
  const contacts = useList("contacts");
  const [year, setYear] = useState(new Date().getFullYear());
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const txs = useMemo(() => relevantTransactions(txsAll, profile.id), [txsAll, profile.id]);
  const years = useMemo(() => [...new Set(txs.map((t) => Number(t.date.slice(0, 4))))].sort((a, b) => b - a), [txs]);
  const months = useMemo(() => monthlySeries(txs, year), [txs, year]);
  const prev = useMemo(() => monthlySeries(txs, year - 1), [txs, year]);
  const cats = useMemo(() => byCategory(txs, vault.categories, kind, `${year}-01-01`, `${year}-12-31`), [txs, vault.categories, kind, year]);
  const vendors = useMemo(() => byContact(txs, contacts, kind, `${year}-01-01`, `${year}-12-31`, 10), [txs, contacts, kind, year]);
  const inc = months.reduce((s, m) => s + m.incomeCents, 0);
  const exp = months.reduce((s, m) => s + m.expenseCents, 0);
  const prevInc = prev.reduce((s, m) => s + m.incomeCents, 0);
  const prevExp = prev.reduce((s, m) => s + m.expenseCents, 0);
  const delta = (a: number, b: number) => (b ? (a - b) / b : null);
  const monthsWithData = months.filter((m) => m.incomeCents || m.expenseCents).length || 1;
  return (
    <div className="space-y-4">
      <PageHeader title="Analysen" subtitle="Wohin fließt das Geld? Monat für Monat, nach Kategorie und im Vergleich zum Vorjahr." actions={<Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">{(years.length ? years : [year]).map((y) => <option key={y} value={y}>{y}</option>)}</Select>} />
      {!inc && !exp ? (
        <EmptyState title={`Für ${year} gibt es noch nichts zu zeigen`} body="Sobald Rechnungen gebucht sind, siehst du hier Verlauf, Kategorien, Lieferanten und den Vergleich zum Vorjahr." action={<IntakeButton />} />
      ) : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={`Einnahmen ${year}`} value={fmtMoney(inc)} sub={delta(inc, prevInc) !== null ? `${delta(inc, prevInc)! >= 0 ? "+" : ""}${fmtPct(delta(inc, prevInc)!)} vs. ${year - 1}` : undefined} tone={inc ? "up" : undefined} />
        <Stat label={`Ausgaben ${year}`} value={fmtMoney(exp)} sub={delta(exp, prevExp) !== null ? `${delta(exp, prevExp)! >= 0 ? "+" : ""}${fmtPct(delta(exp, prevExp)!)} vs. ${year - 1}` : undefined} />
        <Stat label="Ausgaben pro Monat (Ø)" value={fmtMoney(Math.round(exp / monthsWithData))} sub={`${monthsWithData} Monate mit Daten`} />
        <Stat label={profile.mode === "business" ? "Ergebnis" : "Gespart"} value={fmtMoney(inc - exp)} sub={inc ? `${fmtPct((inc - exp) / inc)} der Einnahmen` : undefined} tone={inc - exp > 0 ? "up" : inc - exp < 0 ? "down" : undefined} />
      </div>
      <Card title={`Monat für Monat ${year}`}><MonthlyChart data={months} compare={prevExp ? prev : undefined} height={300} /></Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={profile.mode === "business" ? "Ergebnis übers Jahr" : "Übrig übers Jahr"} className="lg:col-span-3"><CumulativeLine data={months} /></Card>
      </div>
      <Tabs value={kind} onChange={setKind} tabs={[{ id: "expense", label: "Ausgaben" }, { id: "income", label: "Einnahmen" }]} className="w-fit" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`${kind === "expense" ? "Ausgaben" : "Einnahmen"} nach Kategorie`}>
          <CategoryDonut data={cats} />
          <table className="mt-2 w-full text-sm"><tbody className="divide-y divide-(--border)">{cats.map((c) => <tr key={c.categoryId ?? "none"}><td className="py-1.5"><span className="inline-flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded text-white" style={{ background: c.color }}><CategoryIcon name={c.icon} className="h-3 w-3" /></span>{c.name}</span></td><td className="py-1.5 text-right text-xs text-(--text-muted)">{c.count}×</td><td className="py-1.5 text-right tabular text-(--text-muted)">{fmtPct(c.pct)}</td><td className="py-1.5 text-right tabular font-medium">{fmtMoney(c.amountCents)}</td></tr>)}</tbody></table>
        </Card>
        <Card title={kind === "expense" ? "Top-Lieferanten" : "Top-Kunden"}>
          {!vendors.length ? <div className="py-8 text-center text-sm text-(--text-muted)">Noch keine Kontakte zugeordnet.</div> : (
            <ul className="space-y-2">{vendors.map((v, i) => { const max = vendors[0]!.amountCents || 1; return <li key={v.contactId ?? i}><div className="flex justify-between text-sm"><span className="truncate">{i + 1}. {v.name}</span><span className="tabular font-medium">{fmtMoney(v.amountCents)}</span></div><div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-(--surface-2)"><div className="h-full rounded-full bg-brand-600" style={{ width: `${(v.amountCents / max) * 100}%` }} /></div></li>; })}</ul>
          )}
        </Card>
      </div>
      <Card title="Monatsübersicht" padded={false}>
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="bg-(--surface-2) text-left text-xs font-medium text-(--text-muted)"><tr><th className="px-4 py-2">Monat</th><th className="px-4 py-2 text-right">Einnahmen</th><th className="px-4 py-2 text-right">Ausgaben</th><th className="px-4 py-2 text-right">Saldo</th><th className="px-4 py-2 text-right">Vorjahr Ausgaben</th></tr></thead>
          <tbody className="divide-y divide-(--border)">{months.map((m, i) => <tr key={m.month}><td className="px-4 py-1.5">{m.label} {year}</td><td className="px-4 py-1.5 text-right tabular text-emerald-700 dark:text-emerald-400">{fmtMoney(m.incomeCents)}</td><td className="px-4 py-1.5 text-right tabular">{fmtMoney(m.expenseCents)}</td><td className={`px-4 py-1.5 text-right tabular font-medium ${m.netCents < 0 ? "text-red-600" : ""}`}>{fmtMoney(m.netCents)}</td><td className="px-4 py-1.5 text-right tabular text-(--text-muted)">{fmtMoney(prev[i]?.expenseCents ?? 0)}</td></tr>)}</tbody>
          <tfoot><tr className="font-semibold"><td className="px-4 py-2">Gesamt</td><td className="px-4 py-2 text-right tabular text-emerald-700 dark:text-emerald-400">{fmtMoney(inc)}</td><td className="px-4 py-2 text-right tabular">{fmtMoney(exp)}</td><td className="px-4 py-2 text-right tabular">{fmtMoney(inc - exp)}</td><td className="px-4 py-2 text-right tabular text-(--text-muted)">{fmtMoney(prevExp)}</td></tr></tfoot>
        </table></div>
      </Card>
      </>}
    </div>
  );
}
