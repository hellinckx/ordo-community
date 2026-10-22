import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { CHART } from "@/components/charts";
import { fmtMoney, fmtNumber } from "@/lib/format";
import type { AtlasChartSpec, AtlasVisual } from "./tools";

/** Series colours: the Ordo blue first, the warm counter-colour second, then calm tints – never a rainbow. */
const SERIES = [CHART.income, CHART.expense, "#86b8ff", CHART.expensePrev, "#a2a19c", "#0b4fb8"];
const PIE = [CHART.income, "#4d93ff", "#86b8ff", "#bad6ff", CHART.expense, CHART.expensePrev, "#a2a19c", "#d4d4d8"];

const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--text)" };
const tick = { fontSize: 11, fill: "var(--text-muted)" };

function formatter(unit: AtlasChartSpec["unit"]) {
  return (v: unknown) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (unit === "eur") return fmtMoney(Math.round(n * 100));
    if (unit === "hours") return `${fmtNumber(n, n % 1 ? 1 : 0)} Std.`;
    if (unit === "percent") return `${fmtNumber(n, n % 1 ? 1 : 0)} %`;
    return fmtNumber(n, n % 1 ? 1 : 0);
  };
}

/** Axis labels: 0, 850, 1,2k, 14k. */
function axis(unit: AtlasChartSpec["unit"]) {
  return (v: unknown) => {
    const n = Number(v);
    const base = Math.abs(n) < 1000 ? n.toLocaleString("de-AT", { maximumFractionDigits: 1 }) : `${(n / 1000).toLocaleString("de-AT", { maximumFractionDigits: Math.abs(n) < 10_000 ? 1 : 0 })}k`;
    return unit === "percent" ? `${base} %` : base;
  };
}

export function AtlasChartView({ spec }: { spec: AtlasChartSpec }) {
  const fmt = formatter(spec.unit);
  const height = spec.kind === "pie" ? 240 : 250;
  const many = spec.data.length > 8;
  const xAxis = <XAxis dataKey={spec.x} tick={tick} axisLine={false} tickLine={false} interval={many ? "preserveStartEnd" : 0} minTickGap={8} />;
  const yAxis = <YAxis tick={tick} axisLine={false} tickLine={false} width={52} tickFormatter={axis(spec.unit)} />;
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />;
  const legend = spec.series.length > 1 ? <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} /> : null;
  const tip = <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} cursor={{ fill: "var(--surface-2)" }} />;
  let chart;
  if (spec.kind === "pie") {
    const key = spec.series[0]?.key ?? "";
    const rows = spec.data.map((d) => ({ name: String(d[spec.x]), value: Number(d[key]) || 0 })).filter((r) => r.value > 0);
    chart = (
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="var(--surface)">
          {rows.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmt(v)} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
      </PieChart>
    );
  } else if (spec.kind === "line") {
    chart = (
      <LineChart data={spec.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {grid}
        {xAxis}
        {yAxis}
        {tip}
        {legend}
        {spec.series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={SERIES[i % SERIES.length]} strokeWidth={2.5} dot={spec.data.length <= 12} />)}
      </LineChart>
    );
  } else if (spec.kind === "area") {
    chart = (
      <AreaChart data={spec.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {grid}
        {xAxis}
        {yAxis}
        {tip}
        {legend}
        {spec.series.map((s, i) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={SERIES[i % SERIES.length]} fill={SERIES[i % SERIES.length]} fillOpacity={0.12} strokeWidth={2} />)}
      </AreaChart>
    );
  } else {
    const stacked = spec.kind === "stacked-bar";
    chart = (
      <BarChart data={spec.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        {grid}
        {xAxis}
        {yAxis}
        {tip}
        {legend}
        {spec.series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={SERIES[i % SERIES.length]} stackId={stacked ? "a" : undefined} radius={!stacked || i === spec.series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={48} />)}
      </BarChart>
    );
  }
  return (
    <figure className="surface my-3 overflow-hidden p-4">
      <figcaption className="mb-2 text-[13px] font-semibold">{spec.title}</figcaption>
      <ResponsiveContainer width="100%" height={height}>
        {chart}
      </ResponsiveContainer>
    </figure>
  );
}

const looksNumeric = (s: string | number) => typeof s === "number" || (/\d/.test(s) && /^[-+−]?\s?[\d.,\s]+\s?(€|%|Std\.?|h)?$/.test(s.trim()));

export function AtlasTableView({ title, columns, rows }: { title?: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <div className="surface my-3 overflow-hidden">
      {title ? <div className="border-b border-(--glass-border) px-4 py-2.5 text-[13px] font-semibold">{title}</div> : null}
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-(--surface-2) text-(--text-muted)">
            <tr>{columns.map((c, i) => <th key={i} className={`px-3 py-2 font-medium whitespace-nowrap ${looksNumeric(rows[0]?.[i] ?? "") ? "text-right" : "text-left"}`}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-(--border)">
                {columns.map((_, j) => {
                  const cell = r[j] ?? "";
                  return <td key={j} className={`px-3 py-1.5 align-top ${looksNumeric(cell) ? "text-right tabular whitespace-nowrap" : ""}`}>{typeof cell === "number" ? fmtNumber(cell, cell % 1 ? 2 : 0) : cell}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AtlasLinkChip({ to, label, onNavigate }: { to: string; label: string; onNavigate?: () => void }) {
  return (
    <Link to={to} onClick={onNavigate} className="inline-flex max-w-full items-center gap-1 rounded-full border border-(--border) bg-(--surface) px-2.5 py-1 text-[12.5px] font-medium text-brand-700 hover:bg-(--surface-2) dark:text-brand-400">
      <span className="truncate">{label}</span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
    </Link>
  );
}

export function AtlasVisualView({ visual, onNavigate }: { visual: AtlasVisual; onNavigate?: () => void }) {
  if (visual.type === "chart") return <AtlasChartView spec={visual.chart} />;
  if (visual.type === "table") return <AtlasTableView title={visual.title} columns={visual.columns} rows={visual.rows} />;
  return <AtlasLinkChip to={visual.to} label={visual.label} onNavigate={onNavigate} />;
}
