import { useState, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ASSETS, LABEL, pct, pctU, useOverview, useResearch } from "../api";
import { ErrorState, GlassCard, PageIntro, Skeleton, SyntheticBanner } from "../components/ui";
import { AreaSeries, Heatmap, LineSeries } from "../components/charts";

const Fold = ({ t, children }: { t: string; children: ReactNode }) => { const [o, s] = useState(false);
  return (<div className="border-b border-white/[.07] py-2"><button className="flex w-full items-center justify-between text-left text-[13px] font-medium" onClick={() => s(!o)} aria-expanded={o}>{t}<ChevronDown size={15} className={`transition ${o ? "rotate-180" : ""}`} /></button>
    {o && <div className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-tx2">{children}</div>}</div>); };

export default function DataResearch() {
  const ov = useOverview(), rs = useResearch(); const [rec, setRec] = useState(false);
  if (ov.isError) return <ErrorState error={ov.error} />; if (!ov.data) return <Skeleton h={500} />;
  const o = ov.data, q = o.quality, vs = o.vol_series;
  const volData = vs.dates.map((d: string, i: number) => ({ x: d, ...Object.fromEntries(["NIFTY", "BANK", "GOLD", "CRUDE", "USDINR"].map((a) => [LABEL[a], vs[a][i]])) }));
  return (
    <div className="space-y-4">
      <PageIntro
        title="Data & Research"
        description="Trace where the market inputs come from, how they are filtered, and what limitations they impose on the simulation results."
      />
      <SyntheticBanner synthetic={o.synthetic} />
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard title="Data source & coverage" className="lg:col-span-1"><dl className="space-y-1.5 text-[12.5px]">
          <div className="flex justify-between"><dt className="text-tx3">Source</dt><dd className={o.synthetic ? "text-warn" : ""}>{q.source}</dd></div>
          <div className="flex justify-between"><dt className="text-tx3">Range</dt><dd className="num">{q.start} → {q.end}</dd></div>
          <div className="flex justify-between"><dt className="text-tx3">Common trading days</dt><dd className="num">{q.common_days.toLocaleString()}</dd></div>
          <div className="flex justify-between"><dt className="text-tx3">Dropped for alignment</dt><dd className="num">{q.rows_dropped_for_alignment}</dd></div>
          <div className="flex justify-between"><dt className="text-tx3">Max calendar gap</dt><dd className="num">{q.max_calendar_gap_days}d</dd></div>
          <div className="flex justify-between"><dt className="text-tx3">Freshness (last obs.)</dt><dd className="num">{q.end}</dd></div></dl>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-[11.5px] text-tx3">{q.notes.map((n: string) => <li key={n}>{n}</li>)}</ul></GlassCard>
        <GlassCard title="Data quality & missing observations" hint="Per asset, before alignment" className="lg:col-span-2"><div className="overflow-x-auto"><table className="num"><thead><tr className="lbl"><th>Asset</th><th>Raw rows</th><th>Dupes</th><th>Invalid</th><th>Missing vs union</th><th>&gt;5σ days</th><th>Max |ret|</th></tr></thead><tbody>
          {ASSETS.map((a) => { const x = q.assets[a]; return <tr key={a}><td className="font-sans">{LABEL[a]}</td><td>{x.raw_rows}</td><td>{x.duplicates_removed}</td><td>{x.invalid_removed}</td><td>{pctU(x.missing_share_vs_union_calendar)}</td><td>{x.extreme_obs_gt5sd}</td><td>{pctU(x.max_abs_return)}</td></tr>; })}</tbody></table></div>
          <p className="mt-2 text-[11.5px] text-tx3">Nothing is forward-filled or imputed; dates missing for any asset are excluded from the common calendar.</p></GlassCard></div>
      <GlassCard title="Rolling 20-day volatility (annualised)" hint={`Regime thresholds (NIFTY, train-only): elevated ≥ ${pctU(o.regime_thresholds.q_elevated, 1)} (75th pct), extreme ≥ ${pctU(o.regime_thresholds.q_extreme, 1)} (95th pct). Labels describe volatility level, not crises. Current: ${o.current_regime}.`}>
        <LineSeries data={volData} keys={Object.values(["NIFTY", "BANK", "GOLD", "CRUDE", "USDINR"].map((a) => LABEL[a]))} fmt={(v) => pctU(v, 0)} height={280} /></GlassCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard title="NIFTY drawdown" hint="Peak-to-trough from cumulative log returns"><AreaSeries data={o.nifty_drawdown.dates.map((d: string, i: number) => ({ x: d, dd: o.nifty_drawdown.dd[i] }))} k="dd" fmt={(v) => pctU(v, 0)} /></GlassCard>
        <GlassCard title="Historical stress periods" hint="NIFTY drawdowns deeper than 10% found in this dataset (data-derived; no event labels)">
          {!o.stress_periods.length ? <p className="text-[13px] text-tx2">No drawdown beyond 10% in this dataset.</p> : <table className="num"><thead><tr className="lbl"><th>Peak</th><th>Trough</th><th>Depth</th></tr></thead><tbody>{o.stress_periods.map((s: any) => <tr key={s.trough}><td>{s.start}</td><td>{s.trough}</td><td className="text-down">{pct(s.depth, 1)}</td></tr>)}</tbody></table>}</GlassCard></div>
      <GlassCard title="Correlation matrix (daily log returns)" right={<button className="btn btn-ghost !py-1 !text-[11.5px]" onClick={() => setRec(!rec)}>{rec ? "Showing last 250 days" : "Showing full sample"}</button>}>
        <Heatmap labels={[...ASSETS]} m={rec ? o.corr_recent_250 : o.corr} /></GlassCard>
      <GlassCard title="Methodology, assumptions & limitations">
        <Fold t="Return definition & sign conventions"><p>r<sub>t</sub> = ln(P<sub>t</sub>/P<sub>t−1</sub>) between consecutive common trading dates. For USD/INR a positive return means rupee depreciation. A user shock s (simple return) is converted to a log constraint ln(1+s).</p></Fold>
        <Fold t="Model A — Filtered Historical Simulation"><p>Each asset gets a GJR-GARCH(1,1) with Student-t innovations (arch library). Returns are standardised by conditional volatility; whole residual <i>rows</i> are resampled so cross-asset dependence is preserved; returns are rebuilt with the simulated variance recursion σ²<sub>t+1</sub> = ω + (α + γ·1[ε&lt;0])ε² + βσ²<sub>t</sub>.</p></Fold>
        <Fold t="Models B/C — Gaussian & Student-t copula"><p>Student-t marginals, rank pseudo-observations, correlation from Kendall's τ (ρ = sin(πτ/2), repaired to PSD), ν by profile likelihood. A t-copula has tail dependence λ = 2·t<sub>ν+1</sub>(−√((ν+1)(1−ρ)/(1+ρ))) &gt; 0 whereas the Gaussian copula has λ = 0, so it understates joint extremes. Both are i.i.d. across days (no volatility clustering).</p></Fold>
        <Fold t="Model D — Conditional GRU-VAE"><p>Encoder GRU → latent z (reparameterised) → GRU decoder. Condition = target cumulative returns (+ masks) per asset, horizon, one-hot vol regime; masks are randomly dropped in training so the same net does unconditional and partial conditioning. Loss = Gaussian (or optional Student-t) NLL with a learned full-covariance residual + β·KL (annealed) + an auxiliary cumulative-return consistency term. Trained on chronological train windows, early-stopped on validation. Outputs are never rescaled to meet a constraint.</p></Fold>
        <Fold t="Risk metrics"><p>Loss L = (V₀ − V<sub>T</sub>)/V₀ from buy-and-hold valuation of simulated paths. VaR<sub>α</sub> = α-quantile of L; ES<sub>α</sub> = E[L | L ≥ VaR<sub>α</sub>]. Backtests: Kupiec POF, Christoffersen independence/conditional coverage, Acerbi–Székely Z₂ with Monte-Carlo p-values.</p></Fold>
        <Fold t="Known limitations"><ul className="list-disc space-y-1 pl-4"><li>Generated probabilities are conditional model outputs, not real-world probabilities; no model can anticipate unprecedented regimes.</li><li>Horizon limited to 20 trading days; the cVAE is trained on windows of 5/10/15/20 days only.</li><li>Finite proposal pools may provide weak support for extreme targets; runtime kernel selection is reported with effective sample size and does not guarantee requested returns.</li><li>Gold and crude are USD futures proxies; continuous-contract roll gaps may appear. USD/INR is INR per USD.</li><li>Back-test samples are small (see Model Lab); 99% tests have little power.</li><li>{o.synthetic ? "CURRENT BUILD USES SYNTHETIC DATA, so no real-market conclusion can be drawn from these results." : "Yahoo Finance data is unofficial and subject to provider terms."}</li></ul></Fold>
        {rs.data && <Fold t="Train / validation / test split (chronological)"><p>Train {rs.data.split.n_train} · validation {rs.data.split.n_val} · test {rs.data.split.n_test} daily returns (test starts {rs.data.split.test_start}). Scalers and regime thresholds are fitted on train only.</p></Fold>}
      </GlassCard>
    </div>);
}
