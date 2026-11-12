import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleHelp } from "lucide-react";
import { api, ASSETS, LABEL, MODEL_LABEL, pct, pctU, money, post, useHealth, useOverview, useScenarios } from "../api";
import { Empty, ErrorState, GlassCard, PageIntro, Skeleton, Status, SyntheticBanner } from "../components/ui";
import { Gauge, MiniBars, Sparkline } from "../components/charts";
import { useApp } from "../store";

export default function Overview() {
  const ov = useOverview(), health = useHealth(), sc = useScenarios(), { weights, v0 } = useApp();
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const normalizedWeights = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]));
  const jobs = sc.data ?? [];
  const done = jobs.filter((job: any) => job.status === "completed");
  const latest = done[0];
  const recentRuns = done.slice(0, 12).reverse();
  const risk = useQuery({ queryKey: ["ovrisk", latest?.id, JSON.stringify(normalizedWeights), v0], enabled: !!latest,
    queryFn: async () => { const portfolio = await post("/api/portfolios", { name: "overview", weights: normalizedWeights, initial_value: v0, normalize: true }); return api(`/api/portfolios/${portfolio.id}/stress-test`, { method: "POST", body: JSON.stringify({ simulation_id: latest.id }) }); } });
  const portfolio = useQuery({ queryKey: ["ov-pf", JSON.stringify(normalizedWeights), v0], queryFn: () => post("/api/portfolios", { name: "overview", weights: normalizedWeights, initial_value: v0, normalize: true }), staleTime: 600000 });
  const market = ov.data;
  const volValues = market?.vol_series?.NIFTY ?? [];
  if (ov.isError) return <ErrorState error={ov.error} />;

  return (
    <div className="space-y-4">
      <PageIntro title="Overview" description="A clear first look at recent market conditions, your saved simulations, and what you can explore next." />
      <SyntheticBanner synthetic={market?.synthetic} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-3">
        <GlassCard className="relative min-w-0 overflow-hidden xl:col-span-2">
          <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-cyan/10 blur-3xl" />
          <div className="relative">
            <p className="text-tx2">{hour()}.</p>
            <h2 className="mt-1 text-2xl font-semibold">Welcome to <span className="text-cyan">CrashLab</span>.</h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-tx2">Explore how a market shock could affect assets and portfolios. CrashLab generates possible outcomes under stated assumptions; these are not forecasts or real-world probabilities.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link className="btn btn-primary" to="/story">Describe a market scenario <ArrowRight size={14} /></Link>
              <Link className="btn btn-ghost" to="/portfolio">Explore portfolio risk</Link>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[["1", "Describe", "Pick an example or write a market shock."], ["2", "Simulate", "Generate paths under your assumptions."], ["3", "Understand", "Compare outcomes and portfolio impact."]].map(([number, title, copy]) => (
                <div key={number} className="flex min-w-0 items-start gap-2 rounded-lg border border-white/[.07] bg-black/10 p-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan/10 text-[11px] font-semibold text-cyan">{number}</span>
                  <div className="min-w-0"><p className="text-[11.5px] font-semibold">{title}</p><p className="mt-0.5 text-[10.5px] leading-relaxed text-tx3">{copy}</p></div>
                </div>))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:items-center">
              <div className="min-w-0">
                <p className="lbl">NIFTY 50: recent movement size</p>
                <div className="mt-1 h-[54px]">{volValues.length ? <Sparkline values={volValues} height={54} /> : <Skeleton h={54} />}</div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-tx3">Rolling 20-session annualised volatility: the size of recent price swings, not the direction.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-white/[.025] p-2.5"><span className="lbl block">Recent conditions</span><span className="mt-1 block text-[12px] capitalize text-cyan">{market?.current_regime ?? "Loading…"}</span><span className="mt-1 block text-[10px] text-tx3">Volatility regime, not a price forecast.</span></div>
                <div className="rounded-lg bg-white/[.025] p-2.5"><span className="lbl block">Market data through</span><span className="num mt-1 block text-[12px]">{market?.end ?? "—"}</span><span className="mt-1 block text-[10px] text-tx3">{market ? `${market.n_obs.toLocaleString()} daily observations` : "Loading data coverage."}</span></div>
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="min-w-0" title="Market conditions" hint={market ? `Latest observed daily changes and 20-session volatility through ${market.end}. Volatility is compared with each asset's own history.` : "Loading latest market observations."}>
          {!market ? <Skeleton h={220} /> : <>
            <div className="overflow-x-auto">
              <table className="min-w-[420px]">
                <thead><tr className="lbl"><th>Market</th><th>Latest day</th><th>Recent swings</th><th>Vs. history</th></tr></thead>
                <tbody>{ASSETS.map((asset) => {
                  const row = market.latest[asset];
                  const level = row.vol_percentile > .9 ? "Higher" : row.vol_percentile > .7 ? "Elevated" : "Usual";
                  return <tr key={asset}>
                    <td className="whitespace-nowrap font-medium text-tx">{LABEL[asset]}</td>
                    <td className={`num whitespace-nowrap ${row.daily_return >= 0 ? "text-up" : "text-down"}`}>{pct(row.daily_return, 2)}</td>
                    <td className="num whitespace-nowrap text-tx2">{pctU(row.vol_20d_ann, 0)}</td>
                    <td className={`whitespace-nowrap ${row.vol_percentile > .9 ? "text-warn" : row.vol_percentile > .7 ? "text-cyan" : "text-tx2"}`}>{level}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-tx3"><CircleHelp size={13} className="mt-0.5 shrink-0" />“Latest day” is the last observed daily return. “Recent swings” is annualised 20-day volatility; a higher value means larger movements, not a prediction of loss.</p>
          </>}
        </GlassCard>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <GlassCard className="min-w-0" title="Portfolio stress" hint={latest ? `Illustrative portfolio impact for “${latest.name}” using your saved mix.` : "Run a simulation to calculate portfolio impact."}>
          {!latest ? <Empty text="No completed simulation yet." action={<Link className="btn btn-primary" to="/story">Create scenario</Link>} /> :
            risk.isError ? <ErrorState error={risk.error} /> : !risk.data ? <Skeleton h={180} /> : <>
              <Gauge value={risk.data.metrics.es_95 / .3} label={pctU(risk.data.metrics.es_95)} sub="average loss in the worst 5%" danger={risk.data.metrics.es_95 > .1} />
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div><span className="lbl block">Example starting value</span>{money(v0)}</div>
                <div><span className="lbl block">Middle simulated result</span><span className={risk.data.metrics.median_return < 0 ? "text-down" : "text-up"}>{pct(risk.data.metrics.median_return)}</span></div>
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-tx3">Average loss among the roughest 5% of this scenario’s paths. The gauge is a visual scale, not a probability or forecast.</p>
              <Link className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-cyan" to={`/explorer?sim=${latest.id}`}>See the scenario results <ArrowRight size={12} /></Link>
            </>}
        </GlassCard>

        <GlassCard className="min-w-0" title="Simulation activity" hint="Saved model runs on this service. A path is one possible outcome generated by a simulation, not a real market event.">
          {sc.isLoading ? <Skeleton h={180} /> : <>
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <div><span className="lbl block">Completed runs</span><span className="num text-xl">{done.length}</span></div>
              <div><span className="lbl block">Paths generated</span><span className="num text-xl">{done.reduce((sum: number, job: any) => sum + (job.meta?.n ?? 0), 0).toLocaleString()}</span></div>
              <div className="col-span-2"><span className="lbl mb-1 block">Paths in recent runs</span>{recentRuns.length ? <MiniBars values={recentRuns.map((job: any) => job.meta?.n ?? 0)} labels={recentRuns.map((job: any) => job.name)} height={58} /> : <p className="text-[11px] text-tx3">No completed runs yet.</p>}</div>
              <p className="col-span-2 text-[10.5px] leading-relaxed text-tx3">Each bar is one run. Hover over a bar to see its scenario name and path count.</p>
            </div>
          </>}
        </GlassCard>

        <GlassCard className="min-w-0" title="Service status" hint="A live connection check—not a quality rating for simulation results.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Status state={health.data ? "ok" : health.isError ? "error" : "unknown"} label={health.data ? "API responding" : health.isError ? "API unavailable" : "Checking API"} />
            <Status state={health.data ? health.data.database === "ok" ? "ok" : "error" : "unknown"} label={health.data?.database === "ok" ? "Scenario storage connected" : health.data ? "Scenario storage unavailable" : "Checking storage"} />
            <Status state={health.data ? health.data.models_loaded ? "ok" : "error" : "unknown"} label={health.data?.models_loaded ? "Simulation models loaded" : health.data ? "Simulation models unavailable" : "Checking models"} />
            <Status state={market ? market.synthetic ? "warn" : "ok" : "unknown"} label={market?.synthetic ? "Market data is synthetic" : market ? `Market data: ${market.source}` : "Checking market data"} />
          </div>
          <Link to="/settings" className="mt-3 inline-flex items-center gap-1 text-[11px] text-cyan">What do these checks mean? <ArrowRight size={12} /></Link>
        </GlassCard>
      </div>

      <GlassCard title="Recent scenarios" hint="Each row is a saved simulation. Requested market changes are scenario inputs; portfolio impact is the average loss in the roughest 5% of paths for your saved mix." right={<Link to="/story" className="text-[12px] text-cyan">New scenario →</Link>}>
        {!jobs.length ? <Empty text="Your saved runs will appear here. Start with a plain-language scenario." action={<Link className="btn btn-primary" to="/story">Create a scenario</Link>} /> :
          <div className="overflow-x-auto"><table className="min-w-[760px]"><thead><tr className="lbl"><th>Scenario</th><th>Created</th><th>Model</th><th>Paths</th><th>Requested changes</th><th>Impact (ES95)</th><th>Status</th></tr></thead><tbody>
            {jobs.slice(0, 6).map((job: any) => <tr key={job.id}>
              <td><Link className="text-cyan" to={`/explorer?sim=${job.id}`}>{job.name}</Link></td>
              <td className="whitespace-nowrap text-tx2">{new Date(job.created_at).toLocaleString()}</td>
              <td>{MODEL_LABEL[job.request.model] ?? job.request.model}</td>
              <td className="num">{job.request.n.toLocaleString()}</td>
              <td className="num text-tx2">{Object.entries(job.request.shocks ?? {}).map(([asset, value]) => `${LABEL[asset] ?? asset} ${pct(value as number, 0)}`).join(", ") || "No specific target"}</td>
              <td className="num">{job.status === "completed" && portfolio.data ? <Impact sid={job.id} pid={portfolio.data.id} /> : "—"}</td>
              <td className={job.status === "failed" ? "text-down" : "text-tx2"}>{job.status}</td>
            </tr>)}</tbody></table></div>}
      </GlassCard>
      <p className="text-[10.5px] leading-relaxed text-tx3">All results are conditional model-based simulations. They are not forecasts, guarantees, real-world probabilities, or investment advice.</p>
    </div>);
}

const hour = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

function Impact({ sid, pid }: { sid: string; pid: number }) {
  const query = useQuery({ queryKey: ["impact", sid, pid], queryFn: () => api(`/api/risk/${sid}?portfolio_id=${pid}`), staleTime: 600000 });
  if (query.isError) return <span className="text-tx3" title={(query.error as Error).message}>Unavailable</span>;
  if (!query.data) return <span className="text-tx3">Calculating…</span>;
  const metrics = query.data.metrics;
  return <span className="text-warn" title={`Average loss among the worst 5% of simulated paths; median outcome ${pct(metrics.median_return)}`}>{pctU(metrics.es_95)}</span>;
}
