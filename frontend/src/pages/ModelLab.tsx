import { useState } from "react";
import { ASSETS, MODEL_LABEL, pctU, useBacktest, useComparison, useModels } from "../api";
import { ErrorState, GlassCard, PageIntro, Skeleton, SyntheticBanner, Tabs } from "../components/ui";
import { LineSeries, C } from "../components/charts";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TT } from "../components/charts";

const MODELS = ["gaussian", "gaussian_copula", "t_copula", "fhs", "cvae"];
const COLORS: Record<string, string> = { gaussian: C.tx3, gaussian_copula: C.purple, t_copula: C.warn, fhs: C.up, cvae: C.cyan };
const f = (v: number | undefined, d = 3) => (v === undefined || v === null || Number.isNaN(v) ? "—" : v.toFixed(d));

/** Best model per metric — derived from data, with ties/closeness left visible in the table. */
function Winner({ vals, lowerBetter = true }: { vals: Record<string, number>; lowerBetter?: boolean }) {
  const e = Object.entries(vals).filter(([, v]) => Number.isFinite(v)); if (!e.length) return <>—</>;
  const [k] = e.sort((a, b) => (lowerBetter ? a[1] - b[1] : b[1] - a[1]))[0]; return <b style={{ color: COLORS[k] }}>{MODEL_LABEL[k]}</b>;
}

export default function ModelLab() {
  const mods = useModels(), cmp = useComparison();
  const [bm, setBm] = useState("cvae"); const [alpha, setAlpha] = useState<"0.95" | "0.99">("0.95");
  const bt = useBacktest(bm);
  if (cmp.isError) return <ErrorState error={cmp.error} />;
  if (!cmp.data || !mods.data) return <Skeleton h={500} />;
  const M = cmp.data.oos.metrics, hist = mods.data.cvae_history;
  const rowsW = MODELS.map((m) => ({ m, v: M[m].wasserstein_mean })), td = (m: string, p: string, k: "model" | "real") => M[m].tail_dep_lower_q05[p][k];
  const distBars = ASSETS.map((a) => ({ asset: a, ...Object.fromEntries(MODELS.map((m) => [m, M[m].wasserstein_sd[a]])) }));
  const metricRows: { name: string; vals: Record<string, number>; note: string }[] = [
    { name: "Mean Wasserstein (sd units) ↓", vals: Object.fromEntries(MODELS.map((m) => [m, M[m].wasserstein_mean])), note: "marginal 10-day return distributions" },
    { name: "Correlation error (RMS) ↓", vals: Object.fromEntries(MODELS.map((m) => [m, M[m].corr_frobenius])), note: "vs test-period correlation matrix" },
    { name: "|Tail dep. error| NIFTY–BANK ↓", vals: Object.fromEntries(MODELS.map((m) => [m, Math.abs(td(m, "NIFTY-BANK", "model") - td(m, "NIFTY-BANK", "real"))])), note: "lower-tail dependence, q = 5%" },
    { name: "|Joint exceedance error| ↓", vals: Object.fromEntries(MODELS.map((m) => [m, Math.abs(M[m].joint_exceed_nifty_down_inr_weak.model - M[m].joint_exceed_nifty_down_inr_weak.real)])), note: "NIFTY ≤ q5 ∧ USDINR ≥ q95" },
    { name: "|Vol-clustering ACF error| ↓", vals: Object.fromEntries(MODELS.map((m) => [m, Math.abs(M[m].vol_clustering_acf1_sq_nifty.model - M[m].vol_clustering_acf1_sq_nifty.real)])), note: "lag-1 autocorr of squared NIFTY returns" },
    { name: "|ES95 error| NIFTY ↓", vals: Object.fromEntries(MODELS.map((m) => [m, Math.abs(M[m].es95_cum.NIFTY.model - M[m].es95_cum.NIFTY.real)])), note: "10-day NIFTY expected shortfall" },
  ];
  const cons = cmp.data.constraints; const btR = bt.data?.results?.[alpha];
  const cvaeCfg = mods.data.cvae_config;
  return (
    <div className="space-y-4">
      <PageIntro
        title="Model Lab"
        description="Compare how each model reproduces market dynamics, stress dependence, and tail-risk behavior before you rely on a simulation."
      />
      <SyntheticBanner synthetic={cmp.data.synthetic} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{mods.data.models.map((m: any) => (
        <div key={m.id} className="glass p-3.5" style={{ borderTop: `2px solid ${COLORS[m.id]}` }}><div className="text-[13px] font-semibold">{MODEL_LABEL[m.id]}</div><div className="mt-0.5 text-[11.5px] text-tx3">{m.type}</div>
          <div className="mt-2 space-y-0.5 text-[11.5px] text-tx2"><div>Status: <span className="text-up">trained</span> · v{m.version}</div><div>Last trained: {m.trained_at}</div><div>Validation: {m.validation}</div><div>Conditioning: {m.supports_native_conditioning ? "native" : "analog selection"}</div>
            <div>{m.params ? `${m.params.toLocaleString()} params · ${f(m.train_seconds, 0)}s train` : m.id === "t_copula" ? `ν = ${f(mods.data.t_copula_nu, 1)}` : "closed-form / MLE fit"}</div></div></div>))}</div>
      <GlassCard title="Who wins on what — out-of-sample" hint={`Test period from ${cmp.data.split.test_start} (${cmp.data.split.n_test} days, untouched in training/selection). ${cmp.data.oos.note} No single metric proves overall superiority.`}>
        <div className="overflow-x-auto"><table className="num"><thead><tr className="lbl"><th>Metric</th>{MODELS.map((m) => <th key={m} style={{ color: COLORS[m] }}>{MODEL_LABEL[m]}</th>)}<th>Best</th></tr></thead><tbody>
          {metricRows.map((r) => (<tr key={r.name}><td className="font-sans" title={r.note}>{r.name}<div className="text-[10.5px] text-tx3">{r.note}</div></td>{MODELS.map((m) => <td key={m}>{f(r.vals[m])}</td>)}<td className="font-sans"><Winner vals={r.vals} /></td></tr>))}</tbody></table></div>
        <p className="mt-2 text-[11.5px] text-tx3">Real windows overlap (stride 1), so the effective sample is ≈ n/10; differences between close values are not statistically established.</p>
      </GlassCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard title="Distribution comparison" hint="Wasserstein distance per asset (10-day cumulative returns, in test-sd units; lower = closer)">
          <ResponsiveContainer width="100%" height={280}><BarChart data={distBars}><CartesianGrid stroke="rgba(125,110,190,.16)" vertical={false} /><XAxis dataKey="asset" stroke={C.tx2} fontSize={10} /><YAxis stroke={C.tx2} fontSize={10} width={34} />
            <Tooltip {...TT} formatter={(v: any) => Number(v).toFixed(3)} /><Legend wrapperStyle={{ fontSize: 11 }} />{MODELS.map((m) => <Bar key={m} dataKey={m} name={MODEL_LABEL[m]} fill={COLORS[m]} isAnimationActive={false} />)}</BarChart></ResponsiveContainer></GlassCard>
        <GlassCard title="Tail dependence & joint exceedance" hint="Lower-tail dependence at 5% (pooled daily paths) vs the real test data">
          <ResponsiveContainer width="100%" height={280}><BarChart data={[...["NIFTY-BANK", "NIFTY-IT", "NIFTY-CRUDE"].map((p) => ({ k: p, real: td("fhs", p, "real"), ...Object.fromEntries(MODELS.map((m) => [m, td(m, p, "model")])) })),
            { k: "NIFTY↓ ∧ INR↓", real: M.fhs.joint_exceed_nifty_down_inr_weak.real * 20, ...Object.fromEntries(MODELS.map((m) => [m, M[m].joint_exceed_nifty_down_inr_weak.model * 20])) }]}>
            <CartesianGrid stroke="rgba(125,110,190,.16)" vertical={false} /><XAxis dataKey="k" stroke={C.tx2} fontSize={10} /><YAxis stroke={C.tx2} fontSize={10} width={34} /><Tooltip {...TT} formatter={(v: any) => Number(v).toFixed(3)} /><Legend wrapperStyle={{ fontSize: 10, color: C.tx2 }} />
            <Bar dataKey="real" name="Real (test)" fill={C.tx} isAnimationActive={false} />{MODELS.map((m) => <Bar key={m} dataKey={m} name={MODEL_LABEL[m]} fill={COLORS[m]} isAnimationActive={false} />)}</BarChart></ResponsiveContainer>
          <p className="text-[11px] text-tx3">Joint-exceedance bars are scaled ×20 (a joint 5%/5% event is 0.25% under independence) so they share the axis.</p></GlassCard></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard title="Volatility reproduction" hint="Lag-1 autocorrelation of squared NIFTY daily returns (volatility clustering) vs the real test data">
          <ResponsiveContainer width="100%" height={240}><BarChart data={[{ k: "Real (test)", v: M.fhs.vol_clustering_acf1_sq_nifty.real, id: "real" }, ...MODELS.map((m) => ({ k: MODEL_LABEL[m], v: M[m].vol_clustering_acf1_sq_nifty.model, id: m }))]} layout="vertical" margin={{ left: 20, right: 16 }}>
            <CartesianGrid stroke="rgba(125,110,190,.16)" horizontal={false} /><XAxis type="number" stroke={C.tx2} fontSize={10} /><YAxis type="category" dataKey="k" stroke={C.tx2} fontSize={10} width={110} />
            <Tooltip {...TT} formatter={(v: any) => Number(v).toFixed(3)} /><Bar dataKey="v" isAnimationActive={false}>{[...Array(MODELS.length + 1)].map((_, i) => <Cell key={i} fill={i === 0 ? C.tx : COLORS[MODELS[i - 1]]} />)}</Bar></BarChart></ResponsiveContainer></GlassCard>
        <GlassCard title="Out-of-sample Expected Shortfall (95%, 10-day)" hint="Mean loss in the worst 5% of 10-day windows per asset, model vs real test data (closer to real = better)">
          <ResponsiveContainer width="100%" height={240}><BarChart data={ASSETS.map((a) => ({ asset: a, real: M.fhs.es95_cum[a].real, ...Object.fromEntries(MODELS.map((m) => [m, M[m].es95_cum[a].model])) }))}>
            <CartesianGrid stroke="rgba(125,110,190,.16)" vertical={false} /><XAxis dataKey="asset" stroke={C.tx2} fontSize={10} /><YAxis stroke={C.tx2} fontSize={10} width={40} tickFormatter={(v) => pctU(v, 0)} />
            <Tooltip {...TT} formatter={(v: any) => pctU(Number(v), 1)} /><Legend wrapperStyle={{ fontSize: 10, color: C.tx2 }} /><Bar dataKey="real" name="Real (test)" fill={C.tx} isAnimationActive={false} />{MODELS.map((m) => <Bar key={m} dataKey={m} name={MODEL_LABEL[m]} fill={COLORS[m]} isAnimationActive={false} />)}</BarChart></ResponsiveContainer></GlassCard></div>
      <GlassCard title="Scenario constraint satisfaction — same stress for every model" hint="Request: NIFTY −12% and USD/INR +3% over 10 days, extreme regime. cVAE is conditioned natively; baselines by analog selection. Share of 1,000 paths within tolerance.">
        <div className="overflow-x-auto"><table className="num"><thead><tr className="lbl"><th>Model</th><th>Mode</th>{cons.cvae.report.map((r: any) => <th key={r.asset}>{r.asset} median / within tol.</th>)}</tr></thead><tbody>
          {MODELS.map((m) => <tr key={m}><td className="font-sans" style={{ color: COLORS[m] }}>{MODEL_LABEL[m]}</td><td className="font-sans text-tx2">{cons[m].conditioning}</td>{cons[m].report.map((r: any) => <td key={r.asset}>{(r.realised_median_simple * 100).toFixed(1)}% / {pctU(r.share_within_tolerance, 0)}</td>)}</tr>)}</tbody></table></div></GlassCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard title="cVAE training history" hint={`Early stopping on validation loss at full KL weight; ${hist.length} epochs run. KL weight is annealed 0 → β=${cvaeCfg.beta_max} over ${cvaeCfg.warmup} epochs, so early-epoch losses are not comparable.`}>
          <LineSeries data={hist.map((h: any) => ({ x: h.epoch, Train: h.train_loss, Validation: h.val_loss }))} keys={["Train", "Validation"]} fmt={(v) => v.toFixed(0)} colors={[C.blue, C.cyan]} /></GlassCard>
        <GlassCard title="Backtest — 5-day portfolio loss VaR / ES" right={<div className="flex gap-2"><select className="!w-auto !py-1" value={bm} onChange={(e) => setBm(e.target.value)}>{MODELS.map((m) => <option key={m} value={m}>{MODEL_LABEL[m]}</option>)}</select><Tabs items={["0.95", "0.99"] as const} value={alpha} onChange={setAlpha} labels={{ "0.95": "95%", "0.99": "99%" }} /></div>}
          hint={bt.data ? `${bt.data.n_windows} non-overlapping test windows. ${bt.data.note}` : undefined}>
          {!btR ? <Skeleton h={200} /> : <table className="num"><tbody>
            <tr><td className="font-sans">Exceedances (expected {btR.kupiec.expected.toFixed(1)})</td><td>{btR.kupiec.exceedances} / {btR.kupiec.T}</td></tr>
            <tr><td className="font-sans">Kupiec POF p-value</td><td className={btR.kupiec.p_value < 0.05 ? "text-down" : "text-up"}>{f(btR.kupiec.p_value)}</td></tr>
            <tr><td className="font-sans">Christoffersen independence p</td><td className={btR.christoffersen.p_ind < 0.05 ? "text-down" : "text-up"}>{f(btR.christoffersen.p_ind)}</td></tr>
            <tr><td className="font-sans">Conditional coverage p</td><td className={btR.christoffersen.p_cc < 0.05 ? "text-down" : "text-up"}>{f(btR.christoffersen.p_cc)}</td></tr>
            <tr><td className="font-sans">Acerbi–Székely Z₂ (0 = calibrated; &gt;0 = ES too low)</td><td>{f(btR.acerbi_szekely.z2, 2)} {btR.acerbi_szekely.p_value !== undefined && <span className={btR.acerbi_szekely.p_value < 0.05 ? "text-down" : "text-up"}>(MC p={f(btR.acerbi_szekely.p_value, 2)})</span>}</td></tr></tbody></table>}
          <p className="mt-2 text-[11px] text-tx3">Red = rejected at 5%. Small samples → low power, especially at 99%. Passing a backtest does not show a model can anticipate unprecedented crises.</p></GlassCard></div>
      <GlassCard title="Experiment history" hint="Every training run recorded by the pipeline (main models, then ablation variants if they were run)">
        <div className="overflow-x-auto"><table className="num"><thead><tr className="lbl"><th>Run</th><th>Trained</th><th>Data</th><th>Epochs / params</th><th>Train time</th><th>Val loss</th><th>OOS Wasserstein</th></tr></thead><tbody>
          {mods.data.models.map((m: any) => <tr key={m.id}><td className="font-sans">{MODEL_LABEL[m.id]}</td><td>{m.trained_at}</td><td className="font-sans text-tx2">{m.trained_on}</td><td>{m.params ? `${hist.length} ep · ${m.params.toLocaleString()} p` : "—"}</td><td>{m.train_seconds ? `${m.train_seconds.toFixed(0)}s` : "—"}</td><td>{m.id === "cvae" ? f(Math.min(...hist.map((h: any) => h.val_loss)), 1) : "—"}</td><td>{f(M[m.id].wasserstein_mean)}</td></tr>)}
          {(cmp.data.ablations ?? []).map((a: any) => <tr key={a.variant}><td className="font-sans">ablation: {a.variant}</td><td>—</td><td className="font-sans text-tx2">same split</td><td>{a.epochs_run} ep</td><td>{f(a.train_seconds, 0)}s</td><td>{f(a.best_val_loss, 1)}</td><td>{f(a.oos_wasserstein_mean)}</td></tr>)}</tbody></table></div>
        {!cmp.data.ablations && <p className="mt-2 text-[11.5px] text-tx3">Ablation runs were not executed in this build.</p>}</GlassCard>
      <GlassCard title="Ablation studies" hint={cmp.data.ablation_note ?? "Run the full pipeline to populate ablations."}>
        {!cmp.data.ablations ? <p className="text-[13px] text-tx2">Ablations were not run in this training build.</p> :
          <div className="overflow-x-auto"><table className="num"><thead><tr className="lbl"><th>Variant</th><th>Best val loss</th><th>Epochs</th><th>OOS Wasserstein ↓</th><th>OOS corr. error ↓</th><th>Tail dep. N–B (real: {f(td("fhs", "NIFTY-BANK", "real"), 2)})</th><th>Train s</th></tr></thead><tbody>
            {cmp.data.ablations.map((a: any) => <tr key={a.variant}><td className="font-sans">{a.variant}</td><td>{f(a.best_val_loss, 0)}</td><td>{a.epochs_run}</td><td>{f(a.oos_wasserstein_mean)}</td><td>{f(a.oos_corr_frobenius)}</td><td>{f(a.oos_tail_dep_nifty_bank, 2)}</td><td>{f(a.train_seconds, 0)}</td></tr>)}</tbody></table></div>}
      </GlassCard>
    </div>);
}
