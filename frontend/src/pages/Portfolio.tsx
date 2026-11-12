import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Calculator, CircleHelp } from "lucide-react";
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
  const { simId, setSimId, weights, setWeights, v0, setV0 } = useApp(); const toast = useToast();
  const [draft, setDraft] = useState<Record<string, number>>({ ...DEFAULT_W, ...weights }); const [v, setV] = useState(v0);
  const list = useScenarios(); const done = (list.data ?? []).filter((x: any) => x.status === "completed");
  const sim = done.some((scenario: any) => scenario.id === simId) ? simId : done[0]?.id;
  const st = useStress(sim, weights, v0);
  const activeScenario = done.find((scenario: any) => scenario.id === sim);
  const total = Object.values(draft).reduce((a, b) => a + b, 0);
  const previewWeights = normW(draft);
  const hasDraftChanges = JSON.stringify(normW(draft)) !== JSON.stringify(normW(weights)) || v !== v0;
  const cmp = useQuery({ queryKey: ["cmp-sims", done.slice(0, 4).map((d: any) => d.id).join(), JSON.stringify(normW(weights)), v0], enabled: done.length > 1,
    queryFn: async () => { const p = await post("/api/portfolios", { name: "cmp", weights: normW(weights), initial_value: v0, normalize: true });
      return Promise.all(done.slice(0, 4).map(async (d: any) => ({ d, r: await post(`/api/portfolios/${p.id}/stress-test`, { simulation_id: d.id }) }))); } });
  const apply = () => {
    if (total <= 0 || !Number.isFinite(total)) return toast("Add a positive allocation to at least one holding.", "err");
    if (Object.values(draft).some((value) => !Number.isFinite(value) || value < 0)) return toast("Allocation values must be zero or more.", "err");
    if (v <= 0 || !Number.isFinite(v)) return toast("Portfolio value must be a positive number.", "err");
    setWeights(draft); setV0(v);
  };
  const m = st.data?.metrics, w = normW(weights);
  const var95 = m?.var_95, var99 = m?.var_99;
  return (
    <div className="space-y-4">
      <PageIntro
        title="Portfolio Risk"
        description="See how a chosen mix of holdings performed across the simulated paths of one selected scenario. Nothing here is a forecast."
      />
      <section className="glass grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center md:p-5">
        <div><p className="lbl">What this page does</p><p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-tx2">Set the share of your example portfolio in each asset, choose a saved simulation, and compare the resulting range of gains and losses. The results only describe that model run and those assumptions.</p></div>
        <Link to="/story" className="inline-flex items-center gap-1 text-[12px] text-cyan">Create a different scenario <ArrowRight size={13} /></Link>
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard title="1. Set your example portfolio" hint="Enter percentages for each holding. CrashLab normalises the mix to 100% for calculations; these are research inputs, not a brokerage account." className="lg:col-span-1">
          <div className="mb-3 rounded-lg bg-white/[.025] p-3 text-[11.5px] leading-relaxed text-tx2"><b className="text-tx">How to use this:</b> Increase a holding to give it more influence on the portfolio result. Cash is assumed not to change value. Gold and crude are price-return proxies; USD/INR represents a long-USD exposure.</div>
          <div className="space-y-2.5">{KEYS.map((k) => (<div key={k} className="grid grid-cols-[88px_1fr_54px] items-center gap-3"><span className="text-[12.5px]">{k === "CASH" ? "Cash" : LABEL[k]}</span>
            <input type="range" min={0} max={100} step={1} value={Math.min(100, draft[k] ?? 0)} onChange={(e) => setDraft({ ...draft, [k]: +e.target.value })} aria-label={`${k} weight`} />
            <input className="num !px-1.5 !py-1 text-right" type="number" min={0} value={draft[k] ?? 0} onChange={(e) => setDraft({ ...draft, [k]: e.target.value === "" ? 0 : +e.target.value })} /></div>))}</div>
          <div className="mt-3 flex items-center justify-between text-[12.5px]"><span>Entered total</span><span className={`num ${Math.abs(total - 100) < 0.01 ? "text-up" : "text-warn"}`}>{total.toFixed(1)}%</span></div>
          <p className="mt-1 text-[11px] leading-relaxed text-tx3">{Math.abs(total - 100) < .01 ? "Your entries add to 100%." : `The preview below converts your ${total.toFixed(1)}% total into a 100% mix before calculating results.`}</p>
          <div className="mt-3"><label className="lbl" htmlFor="portfolio-value">Example starting value</label><p className="mb-1 text-[11px] text-tx3">The amount used to translate percentage outcomes into currency.</p><input id="portfolio-value" type="number" min={1} value={v} onChange={(e) => setV(e.target.value === "" ? 0 : +e.target.value)} className="num" /></div>
          <button className="btn btn-primary mt-4 w-full justify-center" onClick={apply}><Calculator size={15} />{hasDraftChanges ? "Update portfolio & recalculate" : "Recalculate with saved mix"}</button>
          {hasDraftChanges && <p className="mt-2 text-center text-[11px] text-warn">Results still use the saved mix until you update it.</p>}
          <div className="mt-4 border-t border-white/[.07] pt-3">
            <p className="text-[11.5px] font-semibold">Preview of the mix used after updating</p>
            <div className="mt-2 grid grid-cols-[110px_1fr] items-center gap-2"><Donut height={120} data={Object.entries(previewWeights).map(([k, x]) => ({ name: k === "CASH" ? "Cash" : LABEL[k], v: x }))} />
              <ul className="space-y-1 text-[11px]">{Object.entries(previewWeights).map(([k, x], i) => <li key={k} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-tx2"><span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % 7] }} />{k === "CASH" ? "Cash" : LABEL[k]}</span><span className="num">{pctU(x, 1)}</span></li>)}</ul></div>
          </div>
        </GlassCard>
        <div className="space-y-4 lg:col-span-2">
          {!sim ? <Empty text="Generate a scenario first — risk metrics are computed from its simulated paths." action={<Link to="/story" className="btn btn-primary">Open Story Mode</Link>} /> :
            st.isError ? <ErrorState error={st.error} /> : !m ? <Skeleton h={220} /> : <>
              <section className="rounded-xl border border-cyan/20 bg-cyan/[.035] p-4">
                <p className="lbl">2. Choose the saved simulation for these results</p>
                <label htmlFor="portfolio-scenario" className="sr-only">Choose a completed scenario</label>
                <select id="portfolio-scenario" className="mt-2" value={sim} onChange={(event) => setSimId(event.target.value)} aria-label="Choose scenario for portfolio risk">
                  {done.map((scenario: any) => <option key={scenario.id} value={scenario.id}>{scenario.name} · {scenario.request.source === "preset" ? "example" : scenario.request.source === "custom" ? "your scenario" : "saved run"} · {new Date(scenario.created_at).toLocaleDateString()}</option>)}
                </select>
                <p className="mt-2 text-[11px] text-tx3">Changing the scenario recalculates the charts and risk figures below using the saved portfolio mix.</p>
              </section>
              <p className="rounded-lg border border-white/[.07] bg-white/[.025] p-3 text-[12px] text-tx2">
                <b className="text-tx">Scenario used for every risk chart below:</b> {activeScenario?.name ?? sim}
                {activeScenario && <> · {activeScenario.request.source === "preset" ? `built-in template: ${activeScenario.request.preset_name ?? activeScenario.name}` : activeScenario.request.source === "custom" ? "custom Story Mode input" : "older run; origin unknown"} · {MODEL_LABEL[activeScenario.request.model]}</>}
                {" · "}{m.n_scenarios.toLocaleString()} paths · {m.horizon_days}-day horizon · initial value {money(m.v0)}.
                {" "}The graphs compare portfolio outcomes across those simulated paths, not predicted market outcomes.
              </p>
              <div className="mb-2 flex items-start gap-2 rounded-lg border border-white/[.07] bg-white/[.02] p-3 text-[12px] leading-relaxed text-tx2"><CircleHelp size={15} className="mt-0.5 shrink-0 text-cyan" /><p><b className="text-tx">3. Read the results:</b> “Loss threshold (95% of paths)” is the loss boundary for 95 of 100 simulated paths. “Average loss in worst 5%” is the average across the roughest paths. These are conditional model results—not odds of a real-world event.</p></div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Metric label="Loss threshold (95% of paths)" value={pctU(m.var_95)} sub={money(m.var_95_amount)} tone="warn" tip="95% of simulated paths had a loss below this amount; 5% lost more." />
                <Metric label="Loss threshold (99% of paths)" value={pctU(m.var_99)} sub={money(m.var_99_amount)} tone="bad" tip="99% of simulated paths had a loss below this amount; 1% lost more." />
                <Metric label="Average loss in worst 5%" value={pctU(m.es_95)} sub={money(m.es_95_amount)} tone="warn" tip="Average loss among the 5% most damaging simulated paths." />
                <Metric label="Average loss in worst 1%" value={pctU(m.es_99)} sub={money(m.es_99_amount)} tone="bad" tip="Average loss among the 1% most damaging simulated paths." />
                <Metric label="Largest peak-to-bottom fall" value={pctU(m.max_drawdown_worst)} sub={`average ${pctU(m.max_drawdown_mean)} · 95th percentile ${pctU(m.max_drawdown_p95)}`} tone="bad" />
                <Metric label="Middle outcome" value={pct(m.median_return)} sub={`worst path ${pct(m.worst_return)}`} tone={m.median_return < 0 ? "bad" : "good"} tip="Half the simulated paths finished above this return and half below." /></div>
              <div className="grid grid-cols-3 gap-3">{[["> 5%", m.prob_loss_gt_5], ["> 10%", m.prob_loss_gt_10], ["> 20%", m.prob_loss_gt_20]].map(([l, p]: any) => <Metric key={l} label={`Share of paths, loss ${l}`} value={pctU(p)} tip="Fraction of this simulation's paths, conditional on the scenario — not a real-world probability" />)}</div></>}
        </div></div>
      {m && <>
        <div className="grid gap-4 lg:grid-cols-2">
          <GlassCard title="How much could the portfolio lose by the end?" hint="Each bar counts simulated outcomes. The markers show the middle result, loss thresholds, and average loss among the roughest paths."><Histogram counts={st.data.loss_hist.counts} edges={st.data.loss_hist.edges} tailFrom={var95} height={280} fmt={(v) => pctU(v, 0)}
            markers={[{ x: m.median_return * -1, label: "median", color: C.cyan }, { x: var95, label: "VaR95", color: C.warn }, { x: var99, label: "VaR99", color: C.purple }, { x: m.es_95, label: "ES95", color: C.pink }].filter((x) => x.x >= st.data.loss_hist.edges[0] && x.x <= st.data.loss_hist.edges.at(-1))} /></GlassCard>
          <GlassCard title="How could my portfolio change over time?"><FanChart bands={Object.fromEntries(Object.entries(st.data.value_bands).map(([k, a]: any) => [k, a.map((x: number) => x / m.v0 - 1)]))} height={280}
            guide="The bright line shows the middle simulated portfolio return on each day. The shaded area shows the range of outcomes across paths. Below zero means the portfolio is worth less than at the start; wider shading means outcomes vary more. This is not a forecast." /></GlassCard></div>
        <div className="grid gap-4 lg:grid-cols-3">
          <GlassCard title="Which holdings drive the biggest losses?">
            <HBar data={ASSETS.map((a) => ({ name: a, v: st.data.contributions_es95[a] })).filter((d) => Math.abs(d.v) > 1e-9).sort((a, b) => b.v - a.v)} xLabel="Share of total portfolio loss"
              guide="Bars show each holding’s average share of the portfolio loss in the worst 5% of simulated outcomes. Longer bars mean a larger contribution to loss; a bar extending the other way means that holding offset some losses." /></GlassCard>
          <GlassCard title="Worst scenarios" hint="The five paths with the largest portfolio losses under the selected run. Path index refers to the exported simulation path list; final value is measured from the initial portfolio value shown above.">
            <table className="num"><thead><tr className="lbl"><th>Path index</th><th>Loss</th><th>Final value</th></tr></thead><tbody>{st.data.worst_scenarios.map((s: any) => <tr key={s.index}><td>{s.index}</td><td className="text-down">{pctU(s.loss_pct)}</td><td>{money(s.final_value)}</td></tr>)}</tbody></table></GlassCard>
          <GlassCard title="Scenario comparison" hint="Expected Shortfall and median return for the same portfolio across recent completed runs. ES95 summarizes average loss in each run’s worst 5%; compare to understand how scenario assumptions change risk.">
            {!cmp.data ? <p className="text-[12.5px] text-tx3">{done.length > 1 ? "Loading…" : "Run a second scenario to compare."}</p> :
            <table className="num"><thead><tr className="lbl"><th>Scenario</th><th>ES95</th><th>Median</th></tr></thead><tbody>{cmp.data.map(({ d, r }: any) => <tr key={d.id}><td className="max-w-[130px] truncate font-sans" title={`${d.name} · ${MODEL_LABEL[d.request.model]}`}>{d.name}</td><td className="text-warn">{pctU(r.metrics.es_95)}</td><td className={r.metrics.median_return < 0 ? "text-down" : "text-up"}>{pct(r.metrics.median_return)}</td></tr>)}</tbody></table>}</GlassCard></div>
        <Disclaimer /></>}
    </div>);
}
