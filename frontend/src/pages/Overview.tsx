import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ASSETS, LABEL, MODEL_LABEL, pct, pctU, money, post, useHealth, useOverview, useScenarios } from "../api";
import { Empty, ErrorState, GlassCard, PageIntro, Skeleton, Status, SyntheticBanner } from "../components/ui";
import { Gauge, MiniBars, Sparkline } from "../components/charts";
import { useApp } from "../store";

export default function Overview() {
  const ov = useOverview(), health = useHealth(), sc = useScenarios(), { simId, weights, v0 } = useApp();
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const w = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]));
  const latest = (sc.data ?? []).find((s: any) => s.status === "completed");
  const risk = useQuery({ queryKey: ["ovrisk", latest?.id, JSON.stringify(w), v0], enabled: !!latest,
    queryFn: async () => { const p = await api("/api/portfolios", { method: "POST", body: JSON.stringify({ name: "overview", weights: w, initial_value: v0, normalize: true }) }); return api(`/api/portfolios/${p.id}/stress-test`, { method: "POST", body: JSON.stringify({ simulation_id: latest.id }) }); } });
  const pf = useQuery({ queryKey: ["ov-pf", JSON.stringify(w), v0], queryFn: () => post("/api/portfolios", { name: "overview", weights: w, initial_value: v0, normalize: true }), staleTime: 600000 });
  const hr = hour();
  if (ov.isError) return <ErrorState error={ov.error} />;
  const vs = ov.data?.vol_series;
  const jobs = sc.data ?? [];
  const done = jobs.filter((j: any) => j.status === "completed");
  const m = risk.data?.metrics;
  return (
    <div className="space-y-4">
      <PageIntro
        title="Overview"
        description="See the current market state, the health of the research stack, and the fastest path to running your next scenario."
      />
      <SyntheticBanner synthetic={ov.data?.synthetic} />
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard className="relative overflow-hidden lg:col-span-2">
          <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-cyan/10 blur-3xl" />
          <p className="text-tx2">{hr}.</p><h2 className="text-2xl font-semibold">Welcome to <span className="text-cyan">CrashLab</span>.</h2>
          <p className="mt-1 text-tx2">Explore market uncertainty. Stress-test what matters.</p>
          <div className="mt-4 h-[70px]">{vs ? <Sparkline values={vs.NIFTY} /> : <Skeleton h={56} />}</div>
          <div className="lbl mt-1">NIFTY 20-day realised volatility (annualised) — from data</div>
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-[12.5px]">
            <div><span className="lbl block">Regime now</span><b className="capitalize text-cyan">{ov.data?.current_regime ?? "—"}</b></div>
            <div><span className="lbl block">Default model</span><b>{MODEL_LABEL.cvae}</b></div>
            <div><span className="lbl block">Latest simulation</span><b>{latest ? new Date(latest.finished_at).toLocaleString() : "none yet"}</b></div></div>
        </GlassCard>
        <GlassCard title="Market conditions" hint={ov.data ? `Last observation ${ov.data.end}` : undefined}>
          {!ov.data ? <Skeleton h={200} /> : <table className="num"><thead><tr className="lbl"><th>Asset</th><th>Daily</th><th>Vol 20d</th><th>Status</th></tr></thead><tbody>
            {ASSETS.map((a) => { const x = ov.data.latest[a]; return (<tr key={a}><td className="font-sans text-tx">{LABEL[a]}</td><td className={x.daily_return >= 0 ? "text-up" : "text-down"}>{pct(x.daily_return, 2)}</td>
              <td className={x.vol_percentile > 0.9 ? "text-warn" : "text-tx2"} title={`${(x.vol_percentile * 100).toFixed(0)}th percentile of own history`}>{pctU(x.vol_20d_ann, 0)}</td>
              <td className={x.vol_percentile > 0.9 ? "text-warn" : x.vol_percentile > 0.7 ? "text-cyan" : "text-tx2"}>{x.vol_percentile > 0.9 ? "High" : x.vol_percentile > 0.7 ? "Elevated" : "Normal"}</td></tr>); })}</tbody></table>}
        </GlassCard></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard title="Portfolio stress" hint={latest ? "Your portfolio on the latest simulation" : "Run a scenario to populate"}>
          {!latest ? <Empty text="No completed simulation yet." action={<Link className="btn btn-primary" to="/story">Create scenario</Link>} /> : !m ? <Skeleton h={190} /> : <>
            <Gauge value={m.es_95 / 0.3} label={pctU(m.es_95)} sub="Expected Shortfall 95%" danger={m.es_95 > 0.1} />
            <div className="num mt-3 grid grid-cols-2 gap-2 text-[12.5px]"><div><span className="lbl block">Portfolio value</span>{money(v0)}</div><div><span className="lbl block">Median return</span><span className={m.median_return < 0 ? "text-down" : "text-up"}>{pct(m.median_return)}</span></div></div>
            <p className="mt-2 text-[11px] text-tx3">Gauge scales ES against a 30% reference for display only; it is not a probability.</p></>}
        </GlassCard>
        <GlassCard title="Simulation activity">
          {sc.isLoading ? <Skeleton h={150} /> : <div className="grid grid-cols-2 gap-3 text-[12.5px]">
            <div><span className="lbl block">Completed runs</span><span className="num text-xl">{done.length}</span></div>
            <div><span className="lbl block">Scenarios generated</span><span className="num text-xl">{done.reduce((a: number, j: any) => a + (j.meta?.n ?? 0), 0).toLocaleString()}</span></div>
            <div><span className="lbl block">Last duration</span><span className="num">{latest ? `${latest.meta.seconds.toFixed(2)}s` : "—"}</span></div>
            <div><span className="lbl block">Status</span><span className="capitalize">{jobs[0]?.status ?? "idle"}</span></div>
            <div className="col-span-2"><span className="lbl block">Active model</span>{latest ? MODEL_LABEL[latest.meta.model] : "—"}</div>
            <div className="col-span-2"><span className="lbl mb-1 block">Paths per run (latest 12)</span>{done.length ? <MiniBars values={done.slice(0, 12).reverse().map((j: any) => j.meta.n)} /> : <span className="text-tx3">no runs yet</span>}</div></div>}
        </GlassCard>
        <GlassCard title="System status" hint="Live checks against the backend">
          <div className="flex flex-col gap-2.5">
            <Status state={health.data ? "ok" : health.isError ? "error" : "unknown"} label="Backend API" />
            <Status state={health.data ? (health.data.database === "ok" ? "ok" : "error") : "unknown"} label="Database" />
            <Status state={health.data ? (health.data.models_loaded ? "ok" : "error") : "unknown"} label="Model artifacts" />
            <Status state={ov.data ? (ov.data.synthetic ? "warn" : "ok") : "unknown"} label={ov.data?.synthetic ? "Market data (SYNTHETIC)" : "Market data"} />
            <Status state={health.data ? (health.data.simulation_engine === "ok" ? "ok" : "error") : "unknown"} label="Simulation engine" /></div>
        </GlassCard></div>
      <GlassCard title="Recent scenarios" right={<Link to="/story" className="text-[12px] text-cyan">New scenario →</Link>}>
        {!jobs.length ? <Empty text="No scenarios generated yet. Story Mode lets you describe one in plain English." /> :
          <div className="overflow-x-auto"><table><thead><tr className="lbl"><th>Scenario</th><th>Created</th><th>Model</th><th>Paths</th><th>Shocks</th><th title="Expected Shortfall 95% for your portfolio weights on this scenario">Impact (ES95)</th><th>Status</th></tr></thead><tbody>
            {jobs.slice(0, 6).map((j: any) => (<tr key={j.id}><td><Link className="text-cyan" to={`/explorer?sim=${j.id}`}>{j.name}</Link></td><td className="text-tx2">{new Date(j.created_at).toLocaleString()}</td>
              <td>{MODEL_LABEL[j.request.model]}</td><td className="num">{j.request.n}</td><td className="num text-tx2">{Object.entries(j.request.shocks).map(([k, v]) => `${k} ${pct(v as number, 0)}`).join(", ") || "unconditional"}</td>
              <td className="num">{j.status === "completed" && pf.data ? <Impact sid={j.id} pid={pf.data.id} /> : "—"}</td><td className={j.status === "failed" ? "text-down" : "text-tx2"}>{j.status}</td></tr>))}</tbody></table></div>}
      </GlassCard>
    </div>);
}
const hour = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

function Impact({ sid, pid }: { sid: string; pid: number }) {
  const q = useQuery({ queryKey: ["impact", sid, pid], queryFn: () => api(`/api/risk/${sid}?portfolio_id=${pid}`), staleTime: 600000 });
  if (!q.data) return <span className="text-tx3">…</span>;
  const m = q.data.metrics; return <span className="text-warn" title={`median ${pct(m.median_return)}`}>{pctU(m.es_95)}</span>;
}
