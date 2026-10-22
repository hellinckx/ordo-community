import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CategoryTotal, MonthPoint } from "@ordo/core";
import { fmtMoney } from "@/lib/format";

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--text)" };

/** Income in the Ordo blue, spending in a warm counter-colour: easy to tell apart, calm next to each other. */
export const CHART = { income: "#0a5fe0", expense: "#f2994a", expensePrev: "#f8d3b0", line: "#0a5fe0" };

/** Axis labels: 0, 850, 1,2k, 14k – never a row of "0k". */
function axisMoney(v: unknown): string {
  const n = Number(v);
  if (Math.abs(n) < 1000) return n.toLocaleString("de-AT", { maximumFractionDigits: 0 });
  return `${(n / 1000).toLocaleString("de-AT", { maximumFractionDigits: Math.abs(n) < 10_000 ? 1 : 0 })}k`;
}

/** Fills a Card with fill: at least `height` tall, taller when the card next to it is taller. */
function Grow({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div className="relative min-w-0 flex-1" style={{ minHeight: height }}>
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}

export function MonthlyChart({ data, height = 260, compare, grow }: { data: MonthPoint[]; height?: number; compare?: MonthPoint[]; grow?: boolean }) {
  const rows = data.map((d, i) => ({ ...d, income: d.incomeCents / 100, expense: d.expenseCents / 100, prevExpense: compare ? (compare[i]?.expenseCents ?? 0) / 100 : undefined }));
  const chart = (
    <ResponsiveContainer width="100%" height={grow ? "100%" : height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={56} tickFormatter={axisMoney} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMoney(Math.round(Number(v) * 100))} cursor={{ fill: "var(--surface-2)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
        <Bar dataKey="income" name="Einnahmen" fill={CHART.income} radius={[4, 4, 0, 0]} />
        <Bar dataKey="expense" name="Ausgaben" fill={CHART.expense} radius={[4, 4, 0, 0]} />
        {compare ? <Bar dataKey="prevExpense" name="Ausgaben Vorjahr" fill={CHART.expensePrev} radius={[4, 4, 0, 0]} /> : null}
      </BarChart>
    </ResponsiveContainer>
  );
  return grow ? <Grow height={height}>{chart}</Grow> : chart;
}

export function CategoryDonut({ data, height = 240 }: { data: CategoryTotal[]; height?: number }) {
  const top = data.slice(0, 8);
  const rest = data.slice(8).reduce((s, d) => s + d.amountCents, 0);
  const rows = [...top.map((d) => ({ name: d.name, value: d.amountCents / 100, color: d.color })), ...(rest ? [{ name: "Sonstige", value: rest / 100, color: "#a2a19c" }] : [])];
  if (!rows.length) return <div className="flex h-40 items-center justify-center text-sm text-(--text-muted)">Noch keine Daten</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="var(--surface)">
          {rows.map((r, i) => <Cell key={i} fill={r.color} />)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMoney(Math.round(Number(v) * 100))} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function CumulativeLine({ data, height = 220 }: { data: MonthPoint[]; height?: number }) {
  let acc = 0;
  const rows = data.map((d) => {
    acc += d.netCents;
    return { label: d.label, saldo: acc / 100 };
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={56} tickFormatter={axisMoney} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMoney(Math.round(Number(v) * 100))} />
        <Line type="monotone" dataKey="saldo" name="Übrig bisher" stroke={CHART.line} strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
