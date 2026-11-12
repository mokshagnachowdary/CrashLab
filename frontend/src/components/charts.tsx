import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { pct } from "../api";
import { PieChart, Pie } from "recharts";
const REDUCE = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const AX = { stroke: "#9293A9", fontSize: 10, tickLine: false, axisLine: false } as const;
const GRID = <CartesianGrid stroke="rgba(125,110,190,.16)" vertical={false} />;
export const TT = { contentStyle: { background: "#11111D", color: "#F3F4FA", border: "1px solid rgba(125,110,190,.24)", borderRadius: 8, fontSize: 11 }, labelStyle: { color: "#9293A9" } };
export const C = { blue: "#00DFFF", cyan: "#00DFFF", purple: "#8B35FF", pink: "#FF29C6", up: "#39D98A", warn: "#FFB454", down: "#FF5C7A", tx: "#F3F4FA", tx2: "#9293A9", tx3: "#77788F" };

/** Fan chart from backend quantile bands (arrays indexed by day, day 0 included). */
export function FanChart({ bands, fmt = (v: number) => pct(v, 0), height = 340, xLabel = "trading day", history }: { bands: Record<string, number[]>; fmt?: (v: number) => string; height?: number; xLabel?: string; history?: number[] }) {
  const n = bands["50"].length;
  const data = Array.from({ length: n }, (_, t) => ({ t, p1: bands["1"][t], p5: bands["5"][t], p25: bands["25"][t], p50: bands["50"][t], p75: bands["75"][t], p95: bands["95"][t], p99: bands["99"][t],
    b99: [bands["1"][t], bands["99"][t]], b90: [bands["5"][t], bands["95"][t]], b50: [bands["25"][t], bands["75"][t]], h: history?.[t] }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 14 }}>
        <defs><filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        {GRID}<XAxis dataKey="t" {...AX} label={{ value: xLabel, fill: C.tx2, fontSize: 10, position: "insideBottom", offset: -8 }} height={40} /><YAxis {...AX} tickFormatter={fmt} width={52} />
        <Tooltip {...TT} formatter={(v: any, k: string) => [Array.isArray(v) ? `${fmt(v[0])} … ${fmt(v[1])}` : fmt(v), ({ b99: "1st–99th pct", b90: "5th–95th pct", b50: "25th–75th pct", p50: "Median", h: "Historical ref." } as any)[k] ?? k]} />
        <Area dataKey="b99" stroke="none" fill={C.purple} fillOpacity={0.12} isAnimationActive={false} />
        <Area dataKey="b90" stroke="none" fill={C.purple} fillOpacity={0.19} isAnimationActive={false} />
        <Area dataKey="b50" stroke="none" fill={C.purple} fillOpacity={0.27} isAnimationActive={false} />
        <Line dataKey="p1" stroke={C.pink} strokeDasharray="3 3" dot={false} strokeWidth={1} isAnimationActive={false} legendType="none" />
        <Line dataKey="p99" stroke={C.purple} strokeDasharray="3 3" dot={false} strokeWidth={1} isAnimationActive={false} />
        {history && <Line dataKey="h" stroke={C.warn} dot={false} strokeWidth={1.5} strokeDasharray="5 4" />}
        <Line dataKey="p50" stroke={C.cyan} strokeWidth={2.2} dot={false} />
        <ReferenceLine y={0} stroke="rgba(146,147,169,.35)" />
      </ComposedChart>
    </ResponsiveContainer>);
}

export function PathsChart({ paths, height = 260 }: { paths: number[][]; height?: number }) {
  const n = paths[0].length; const data = Array.from({ length: n }, (_, t) => Object.fromEntries([["t", t], ...paths.map((p, i) => [`p${i}`, p[t]])]));
  return (<ResponsiveContainer width="100%" height={height}><LineChart data={data} margin={{ left: 0, right: 8 }}>{GRID}<XAxis dataKey="t" {...AX} /><YAxis {...AX} tickFormatter={(v) => pct(v, 0)} width={52} />
    <Tooltip {...TT} formatter={(v: any) => pct(v)} labelFormatter={(l) => `day ${l}`} />
    {paths.map((_, i) => <Line key={i} dataKey={`p${i}`} stroke={i < 3 ? C.down : C.warn} strokeOpacity={Math.max(0.25, 1 - i * 0.07)} dot={false} strokeWidth={1.2} isAnimationActive={false} />)}
    <ReferenceLine y={0} stroke="rgba(146,147,169,.35)" /></LineChart></ResponsiveContainer>);
}

/** Histogram from backend counts/edges; bars right of `markers` thresholds are tinted as the tail. */
export function Histogram({ counts, edges, markers = [], tailFrom, height = 260, fmt = (v: number) => pct(v, 0), neg = false }: { counts: number[]; edges: number[]; markers?: { x: number; label: string; color: string }[]; tailFrom?: number; height?: number; fmt?: (v: number) => string; neg?: boolean }) {
  const data = counts.map((c, i) => ({ x: (edges[i] + edges[i + 1]) / 2, c }));
  const w = edges[1] - edges[0];
  return (<ResponsiveContainer width="100%" height={height}><BarChart data={data} margin={{ left: 0, right: 8 }} barCategoryGap={0}>{GRID}
    <XAxis dataKey="x" type="number" domain={[edges[0], edges[edges.length - 1]]} {...AX} tickFormatter={fmt} /><YAxis {...AX} width={36} />
    <Tooltip {...TT} formatter={(v: any) => [v, "scenarios"]} labelFormatter={(l) => fmt(Number(l))} cursor={{ fill: "rgba(67,139,255,.08)" }} />
    <Bar dataKey="c" isAnimationActive={false}>{data.map((d, i) => <Cell key={i} fill={tailFrom !== undefined && d.x + w / 2 >= tailFrom ? C.pink : neg && d.x < 0 ? C.warn : C.blue} fillOpacity={0.85} />)}</Bar>
    {markers.map((m) => <ReferenceLine key={m.label} x={m.x} stroke={m.color} strokeDasharray="4 3" label={{ value: m.label, fill: m.color, fontSize: 10.5, position: "top" }} />)}
  </BarChart></ResponsiveContainer>);
}

export function HBar({ data, fmt = (v: number) => pct(v, 2), height = 240, color }: { data: { name: string; v: number }[]; fmt?: (v: number) => string; height?: number; color?: string }) {
  return (<ResponsiveContainer width="100%" height={height}><BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}><CartesianGrid stroke="rgba(125,110,190,.16)" horizontal={false} />
    <XAxis type="number" {...AX} tickFormatter={fmt} /><YAxis type="category" dataKey="name" {...AX} width={78} />
    <Tooltip {...TT} formatter={(v: any) => fmt(v)} cursor={{ fill: "rgba(67,139,255,.08)" }} />
    <Bar dataKey="v" radius={[0, 6, 6, 0]} isAnimationActive={false}>{data.map((d, i) => <Cell key={i} fill={color ?? (d.v > 0 ? C.down : C.up)} />)}</Bar></BarChart></ResponsiveContainer>);
}

export function LineSeries({ data, keys, height = 260, fmt = (v: number) => v.toFixed(2), xKey = "x", colors = [C.cyan, C.blue, C.purple, C.warn, C.up, C.down] }: { data: any[]; keys: string[]; height?: number; fmt?: (v: number) => string; xKey?: string; colors?: string[] }) {
  return (<ResponsiveContainer width="100%" height={height}><LineChart data={data} margin={{ left: 0, right: 8 }}>{GRID}<XAxis dataKey={xKey} {...AX} minTickGap={40} /><YAxis {...AX} tickFormatter={fmt} width={48} />
    <Tooltip {...TT} formatter={(v: any) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 10, color: C.tx2 }} />
    {keys.map((k, i) => <Line key={k} dataKey={k} stroke={colors[i % colors.length]} dot={false} strokeWidth={1.6} isAnimationActive={false} />)}</LineChart></ResponsiveContainer>);
}

export function AreaSeries({ data, k, height = 200, fmt = (v: number) => v.toFixed(2), color = C.down }: { data: any[]; k: string; height?: number; fmt?: (v: number) => string; color?: string }) {
  return (<ResponsiveContainer width="100%" height={height}><AreaChart data={data} margin={{ left: 0, right: 8 }}>{GRID}<XAxis dataKey="x" {...AX} minTickGap={50} /><YAxis {...AX} tickFormatter={fmt} width={48} />
    <Tooltip {...TT} formatter={(v: any) => fmt(v)} /><Area dataKey={k} stroke={color} fill={color} fillOpacity={0.18} isAnimationActive={false} /></AreaChart></ResponsiveContainer>);
}

export function Heatmap({ labels, m }: { labels: string[]; m: number[][] }) {
  const color = (v: number) => (v >= 0 ? `rgba(67,139,255,${0.12 + 0.75 * v})` : `rgba(255,100,124,${0.12 + 0.75 * -v})`);
  return (<div className="overflow-x-auto"><table className="num !w-auto text-[11.5px]"><thead><tr><th />{labels.map((l) => <th key={l} className="text-tx3 font-medium">{l}</th>)}</tr></thead>
    <tbody>{m.map((row, i) => (<tr key={i}><th className="text-tx3 font-medium">{labels[i]}</th>{row.map((v, j) => <td key={j} title={`${labels[i]} × ${labels[j]}: ${v.toFixed(3)}`} style={{ background: color(v), textAlign: "center", minWidth: 46 }}>{v.toFixed(2)}</td>)}</tr>))}</tbody></table></div>);
}

export function Sparkline({ values, color = C.cyan, height = 56 }: { values: number[]; color?: string; height?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  return (<ResponsiveContainer width="100%" height={height}><AreaChart data={data}><defs><linearGradient id="spk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.35} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
    <Area dataKey="v" stroke={color} strokeWidth={1.8} fill="url(#spk)" isAnimationActive={!REDUCE} animationDuration={1600} /></AreaChart></ResponsiveContainer>);
}

export function Gauge({ value, label, sub, danger }: { value: number; label: string; sub?: string; danger?: boolean }) {
  const v = Math.max(0, Math.min(1, value)), R = 70, circ = Math.PI * R;
  return (<div className="relative mx-auto w-[190px]"><svg viewBox="0 0 180 110" className="w-full"><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0%" stopColor={danger ? C.warn : C.blue} /><stop offset="100%" stopColor={danger ? C.down : C.cyan} /></linearGradient></defs>
    <path d="M20 95 A70 70 0 0 1 160 95" fill="none" stroke="rgba(125,110,190,.18)" strokeWidth="12" strokeLinecap="round" />
    <path d="M20 95 A70 70 0 0 1 160 95" fill="none" stroke="url(#gg)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${circ * v} ${circ}`} style={{ filter: "drop-shadow(0 0 6px rgba(53,215,255,.5))" }} /></svg>
    <div className="absolute inset-x-0 bottom-1 text-center"><div className="num text-2xl font-semibold">{label}</div>{sub && <div className="text-[11px] text-tx3">{sub}</div>}</div></div>);
}

export function MiniBars({ values, labels, color = C.blue, height = 52 }: { values: number[]; labels?: string[]; color?: string; height?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  return (<ResponsiveContainer width="100%" height={height}><BarChart data={data} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}><Tooltip {...TT} formatter={(v: any) => [Number(v).toLocaleString(), "simulated paths"]} labelFormatter={(i) => labels?.[Number(i)] ?? `Run ${Number(i) + 1}`} cursor={false} />
    <Bar dataKey="v" fill={color} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={!REDUCE} /></BarChart></ResponsiveContainer>);
}

const PIE = [C.blue, C.cyan, C.purple, C.warn, C.pink, C.up, C.tx3];
export function Donut({ data, height = 170 }: { data: { name: string; v: number }[]; height?: number }) {
  return (<ResponsiveContainer width="100%" height={height}><PieChart><Tooltip {...TT} formatter={(v: any) => `${(Number(v) * 100).toFixed(1)}%`} />
    <Pie data={data} dataKey="v" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={2} stroke="none" isAnimationActive={!REDUCE}>{data.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}</Pie></PieChart></ResponsiveContainer>);
}
export const PIE_COLORS = PIE;
