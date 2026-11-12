import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { ASSETS, LABEL, MODEL_LABEL, api, money, pct, pctU, post, useScenarios } from "../api";
import { Disclaimer, Empty, ErrorState, GlassCard, Metric, PageIntro, Skeleton, useToast } from "../components/ui";
import { Donut, FanChart, HBar, Histogram, PIE_COLORS, C } from "../components/charts";
import { DEFAULT_W, useApp } from "../store";

const KEYS = [...ASSETS, "CASH"];
export const normW = (w: Record<string, number>) => { const t = Object.values(w).reduce((a, b) => a + b, 0) || 1; return Object.fromEntries(Object.entries(w).filter(([, v]) => v !== 0).map(([k, v]) => [k, v / t])); };

/** Creates the portfolio (server-validated) and runs the stress test on a simulation. */
export function useStress(simId: string | undefined, weights: Record<string, number>, v0: number) {
  const w = normW(weights);
  return useQuery({ queryKey: ["stress", simId, JSON.stringify(w), v0], enabled: !!simId && Object.keys(w).length > 0,
    queryFn: async () => { const p = await post("/api/portfolios", { name: "ui", weights: w, initial_value: v0, normalize: true }); return post(`/api/portfolios/${p.id}/stress-test`, { simulation_id: simId }); } });
}

export default function Portfolio() {
  const { simId, weights, setWeights, v0, setV0 } = useApp(); const toast = useToast();
  const [draft, setDraft] = useState<Record<string, number>>({ ...DEFAULT_W, ...weights }); const [v, setV] = useState(v0);
  const list = useScenarios(); const done = (list.data ?? []).filter((x: any) => x.status === "completed");
  const sim = simId ?? done[0]?.id; const st = useStress(sim, weights, v0);
  const activeScenario = done.find((scenario: any) => scenario.id === sim);
  const total = Object.values(draft).reduce((a, b) => a + b, 0);
  const cmp = useQuery({ queryKey: ["cmp-sims", done.slice(0, 4).map((d: any) => d.id).join(), JSON.stringify(normW(weights)), v0], enabled: done.length > 1,
    queryFn: async () => { const p = await post("/api/portfolios", { name: "cmp", weights: normW(weights), initial_value: v0, normalize: true });
      return Promise.all(done.slice(0, 4).map(async (d: any) => ({ d, r: await post(`/api/portfolios/${p.id}/stress-test`, { simulation_id: d.id }) }))); } });
  const apply = () => { if (total <= 0) return toast("Weights must sum to a positive number", "err"); if (v <= 0) return toast("Portfolio value must be positive", "err"); setWeights(draft); setV0(v); };
  const m = st.data?.metrics, w = normW(weights);
  const var95 = m?.var_95, var99 = m?.var_99;
  return (
    <div className="space-y-4">
      <PageIntro
        title="Portfolio Risk"
        description="Understand how your asset mix could lose value under the scenarios you generate, with plain-language explanations around each risk metric."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard title="Portfolio allocation" hint="Long-only, buy-and-hold over the horizon, cash earns 0%. Gold & crude are futures-return proxies, USD/INR is a long-USD position." className="lg:col-span-1">
          <div className="space-y-2.5">{KEYS.map((k) => (<div key={k} className="grid grid-cols-[88px_1fr_54px] items-center gap-3"><span className="text-[12.5px]">{k === "CASH" ? "Cash" : LABEL[k]}</span>
            <input type="range" min={0} max={100} step={1} value={draft[k] ?? 0} onChange={(e) => setDraft({ ...draft, [k]: +e.target.value })} aria-label={`${k} weight`} />
            <input className="num !px-1.5 !py-1 text-right" type="number" min={0} max={100} value={draft[k] ?? 0} onChange={(e) => setDraft({ ...draft, [k]: Math.max(0, +e.target.value) })} /></div>))}</div>
          <div className="mt-3 flex items-center justify-between text-[12.5px]"><span>Sum</span><span className={`num ${Math.abs(total - 100) < 0.01 ? "text-up" : "text-warn"}`}>{total.toFixed(1)}%{Math.abs(total - 100) >= 0.01 && " → will be normalised"}</span></div>
          <div className="mt-3"><label className="lbl">Initial portfolio value</label><input type="number" min={1} value={v} onChange={(e) => setV(+e.target.value)} className="num" /></div>
          <button className="btn btn-primary mt-4 w-full justify-center" onClick={apply}><Calculator size={15} />Apply &amp; stress test</button>
          <div className="mt-4 text-[11.5px] text-tx3">Allocation chart: each slice is an asset’s share of the portfolio after weights are normalised to 100%.</div>
          <div className="mt-2 grid grid-cols-[130px_1fr] items-center gap-3"><Donut height={130} data={Object.entries(w).map(([k, x]) => ({ name: k === "CASH" ? "Cash" : LABEL[k], v: x }))} />
            <ul className="space-y-1 text-[11.5px]">{Object.entries(w).map(([k, x], i) => <li key={k} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-tx2"><span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % 7] }} />{k === "CASH" ? "Cash" : LABEL[k]}</span><span className="num">{pctU(x, 1)}</span></li>)}</ul></div>
        </GlassCard>
        <div className="space-y-4 lg:col-span-2">
          {!sim ? <Empty text="Generate a scenario first — risk metrics are computed from its simulated paths." action={<Link to="/story" className="btn btn-primary">Open Story Mode</Link>} /> :
            st.isError ? <ErrorState error={st.error} /> : !m ? <Skeleton h={220} /> : <>
              <p className="rounded-lg border border-white/[.07] bg-white/[.025] p-3 text-[12px] text-tx2">
                <b className="text-tx">Scenario used for every risk chart below:</b> {activeScenario?.name ?? sim}
                {activeScenario && <> · {activeScenario.request.source === "preset" ? `built-in template: ${activeScenario.request.preset_name ?? activeScenario.name}` : activeScenario.request.source === "custom" ? "custom Story Mode input" : "older run; origin unknown"} · {MODEL_LABEL[activeScenario.request.model]}</>}
                {" · "}{m.n_scenarios.toLocaleString()} paths · {m.horizon_days}-day horizon · initial value {money(m.v0)}.
                {" "}The graphs compare portfolio outcomes across those simulated paths, not predicted market outcomes.
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Metric label="VaR 95%" value={pctU(m.var_95)} sub={money(m.var_95_amount)} tone="warn" tip="95th percentile of simulated horizon loss" />
                <Metric label="VaR 99%" value={pctU(m.var_99)} sub={money(m.var_99_amount)} tone="bad" />
                <Metric label="ES 95%" value={pctU(m.es_95)} sub={money(m.es_95_amount)} tone="warn" tip="Mean loss in the worst 5% of scenarios" />
                <Metric label="ES 99%" value={pctU(m.es_99)} sub={money(m.es_99_amount)} tone="bad" />
                <Metric label="Max drawdown (worst path)" value={pctU(m.max_drawdown_worst)} sub={`mean ${pctU(m.max_drawdown_mean)} · p95 ${pctU(m.max_drawdown_p95)}`} tone="bad" />
                <Metric label="Median return" value={pct(m.median_return)} sub={`worst ${pct(m.worst_return)}`} tone={m.median_return < 0 ? "bad" : "good"} /></div>
              <div className="grid grid-cols-3 gap-3">{[["> 5%", m.prob_loss_gt_5], ["> 10%", m.prob_loss_gt_10], ["> 20%", m.prob_loss_gt_20]].map(([l, p]: any) => <Metric key={l} label={`Share of paths, loss ${l}`} value={pctU(p)} tip="Fraction of this simulation's paths, conditional on the scenario — not a real-world probability" />)}</div></>}
        </div></div>
      {m && <>
        <div className="grid gap-4 lg:grid-cols-2">
          <GlassCard title="Portfolio loss distribution" hint="Loss = (V₀ − V_T)/V₀. Red bars = the Expected-Shortfall region (beyond VaR 95%); ES is the mean loss inside it."><Histogram counts={st.data.loss_hist.counts} edges={st.data.loss_hist.edges} tailFrom={var95} height={280} fmt={(v) => pctU(v, 0)}
            markers={[{ x: m.median_return * -1, label: "median", color: C.cyan }, { x: var95, label: "VaR95", color: C.warn }, { x: var99, label: "VaR99", color: C.purple }, { x: m.es_95, label: "ES95", color: C.pink }].filter((x) => x.x >= st.data.loss_hist.edges[0] && x.x <= st.data.loss_hist.edges.at(-1))} /></GlassCard>
          <GlassCard title="Portfolio value through time" hint="Quantile bands show the cumulative portfolio return by day across paths from the selected scenario. The median is typical within this simulation; wider bands mean more dispersion. These are conditional model outputs, not confidence guarantees or forecasts."><FanChart bands={Object.fromEntries(Object.entries(st.data.value_bands).map(([k, a]: any) => [k, a.map((x: number) => x / m.v0 - 1)]))} height={280} /></GlassCard></div>
        <div className="grid gap-4 lg:grid-cols-3">
          <GlassCard title="Loss contribution — worst 5% of paths" hint="Average contribution of each asset to portfolio loss among the worst 5% of simulated outcomes. Contributions sum to ES 95%; a negative bar means that asset gained value on average in those worst paths. Use this to see which holdings drive tail loss.">
            <HBar data={ASSETS.map((a) => ({ name: a, v: st.data.contributions_es95[a] })).filter((d) => Math.abs(d.v) > 1e-9).sort((a, b) => b.v - a.v)} /></GlassCard>
          <GlassCard title="Worst scenarios" hint="The five paths with the largest portfolio losses under the selected run. Path index refers to the exported simulation path list; final value is measured from the initial portfolio value shown above.">
            <table className="num"><thead><tr className="lbl"><th>Path index</th><th>Loss</th><th>Final value</th></tr></thead><tbody>{st.data.worst_scenarios.map((s: any) => <tr key={s.index}><td>{s.index}</td><td className="text-down">{pctU(s.loss_pct)}</td><td>{money(s.final_value)}</td></tr>)}</tbody></table></GlassCard>
          <GlassCard title="Scenario comparison" hint="Expected Shortfall and median return for the same portfolio across recent completed runs. ES95 summarizes average loss in each run’s worst 5%; compare to understand how scenario assumptions change risk.">
            {!cmp.data ? <p className="text-[12.5px] text-tx3">{done.length > 1 ? "Loading…" : "Run a second scenario to compare."}</p> :
            <table className="num"><thead><tr className="lbl"><th>Scenario</th><th>ES95</th><th>Median</th></tr></thead><tbody>{cmp.data.map(({ d, r }: any) => <tr key={d.id}><td className="max-w-[130px] truncate font-sans" title={`${d.name} · ${MODEL_LABEL[d.request.model]}`}>{d.name}</td><td className="text-warn">{pctU(r.metrics.es_95)}</td><td className={r.metrics.median_return < 0 ? "text-down" : "text-up"}>{pct(r.metrics.median_return)}</td></tr>)}</tbody></table>}</GlassCard></div>
        <Disclaimer /></>}
    </div>);
}
