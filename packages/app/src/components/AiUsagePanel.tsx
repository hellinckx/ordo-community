import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ExternalLink, Gauge } from "lucide-react";
import { AI_FEATURE_LABELS, aiUsageByModel, aiUsageByMonth } from "@ordo/core";
import { Badge, Button, Card, EmptyState, Field, Input, Stat } from "@/components/ui";
import { openExternal } from "@/components/LegalLinks";
import { useSettingsMutator, useVault } from "@/state/hooks";
import { extractionModelLabel } from "@ordo/core";
import { fmtNumber } from "@/lib/format";

const usd = (cents: number) => (cents / 100).toLocaleString("de-AT", { style: "currency", currency: "USD", minimumFractionDigits: cents && cents < 100 ? 3 : 2, maximumFractionDigits: cents && cents < 100 ? 3 : 2 });
const MONTHS = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
const tokens = (n: number) => (n >= 1_000_000 ? `${fmtNumber(n / 1_000_000, 1)} Mio.` : n >= 1000 ? `${fmtNumber(n / 1000, 0)} Tsd.` : String(Math.round(n)));
const modelName = (m: string) => (/^claude-/.test(m) ? `Claude ${extractionModelLabel(m)}` : m);

/** Einstellungen → KI-Verbrauch: what reading invoices and Atlas cost, per month and model, with an own limit. */
export function AiUsagePanel() {
  const vault = useVault();
  const mutate = useSettingsMutator();
  const usage = vault.settings.aiUsage;
  const [limit, setLimit] = useState(usage.monthlyLimitCents ? String(usage.monthlyLimitCents / 100).replace(".", ",") : "");
  const months = useMemo(() => aiUsageByMonth(usage, 12), [usage]);
  const now = months[months.length - 1]!;
  const prev = months[months.length - 2]!;
  const year = now.month.slice(0, 4);
  const yearCost = Object.entries(usage.months).filter(([m]) => m.startsWith(year)).reduce((s, [m]) => s + (aiUsageByMonth(usage, 1, new Date(`${m}-15T00:00:00Z`))[0]?.costCents ?? 0), 0);
  const models = useMemo(() => aiUsageByModel(usage, now.month), [usage, now.month]);
  const unpriced = models.reduce((s, r) => s + r.bucket.unpriced, 0);
  const empty = !Object.keys(usage.months).length;
  const saveLimit = () => {
    const n = Math.round(Number(limit.replace(",", ".")) * 100);
    mutate((st) => ({ ...st, aiUsage: { ...st.aiUsage, monthlyLimitCents: Number.isFinite(n) && n > 0 ? n : 0, warnedMonth: "" } }));
  };
  const chart = months.map((m) => ({ label: monthLabel(m.month), [AI_FEATURE_LABELS.invoices]: Math.round(m.byFeature.invoices.costCents) / 100, [AI_FEATURE_LABELS.atlas]: Math.round(m.byFeature.atlas.costCents) / 100 }));
  const overLimit = usage.monthlyLimitCents > 0 && now.costCents > usage.monthlyLimitCents;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Dieser Monat (geschätzt)" value={usd(now.costCents)} sub={`${now.calls} Aufrufe`} tone={overLimit ? "down" : undefined} />
        <Stat label="Letzter Monat" value={usd(prev.costCents)} sub={`${prev.calls} Aufrufe`} />
        <Stat label={`Jahr ${year}`} value={usd(yearCost)} />
        <Stat label="Monatslimit" value={usage.monthlyLimitCents ? usd(usage.monthlyLimitCents) : "keins"} sub={usage.monthlyLimitCents ? `${Math.round((now.costCents / usage.monthlyLimitCents) * 100)} % genutzt` : "Ordo warnt dich, wenn du eines setzt"} />
      </div>
      {empty ? (
        <Card><EmptyState bare icon={<Gauge className="h-8 w-8" />} title="Noch kein KI-Verbrauch" body="Sobald die KI eine Rechnung liest oder Atlas antwortet, siehst du hier, was es gekostet hat – pro Monat und Modell." /></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card title="Verlauf (12 Monate)">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `$${v}`} />
                <Tooltip formatter={(v) => usd(Number(v) * 100)} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey={AI_FEATURE_LABELS.invoices} stackId="a" fill="#0a5fe0" radius={[0, 0, 0, 0]} />
                <Bar dataKey={AI_FEATURE_LABELS.atlas} stackId="a" fill="#8ab4ff" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card title="Diesen Monat nach Modell">
            {models.length ? (
              <ul className="divide-y divide-(--border) text-sm">
                {models.map((r) => (
                  <li key={`${r.feature}-${r.model}`} className="flex flex-wrap items-baseline gap-x-2 py-2">
                    <span className="font-medium">{modelName(r.model)}</span>
                    <Badge>{AI_FEATURE_LABELS[r.feature]}</Badge>
                    <span className="flex-1" />
                    <span className="tabular font-medium">{r.bucket.unpriced === r.bucket.calls ? "–" : usd(r.bucket.costCents)}</span>
                    <span className="w-full text-xs text-(--text-muted)">{r.bucket.calls} Aufrufe · {tokens(r.bucket.inputTokens)} Token gelesen · {tokens(r.bucket.outputTokens)} geschrieben</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-(--text-muted)">Diesen Monat noch nichts.</p>
            )}
          </Card>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Monatslimit">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Warnen ab (US-$ pro Monat)" className="w-48"><Input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d,.]/g, ""))} placeholder="z. B. 5" /></Field>
            <Button variant="outline" onClick={saveLimit}>Speichern</Button>
          </div>
          <p className="mt-2 text-xs text-(--text-muted)">Ordo stoppt nichts, sagt dir aber einmal im Monat Bescheid, wenn die Schätzung darüber liegt. Ein hartes Limit setzt du beim Anbieter (Anthropic: Limits in der Console).</p>
        </Card>
        <Card title="Wie gerechnet wird">
          <ul className="list-disc space-y-1 pl-5 text-xs text-(--text-muted)">
            <li>Geschätzt aus den Token jeder Anfrage und den Listenpreisen von Anthropic (in US-Dollar, wie Anthropic abrechnet). Die genaue Rechnung steht in der Anthropic Console.</li>
            <li>ChatGPT über die Windows-App und Ollama kosten pro Aufruf nichts extra und stehen mit 0 da{unpriced ? `; ${unpriced} Aufrufe diesen Monat haben keinen bekannten Preis (z. B. OpenAI-API)` : ""}.</li>
            <li>Gespeichert werden nur Zahlen pro Monat und Modell – keine Fragen, Antworten oder Rechnungsinhalte.</li>
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => openExternal("https://console.anthropic.com/usage")}><ExternalLink className="h-4 w-4" /> Anthropic Console</Button>
        </Card>
      </div>
    </div>
  );
}
