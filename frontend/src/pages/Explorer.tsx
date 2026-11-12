import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ASSETS, LABEL, MODEL_LABEL, api, apiUrl, pct, pctU, useScenario, useScenarios } from "../api";
import { Empty, ErrorState, GlassCard, Metric, PageIntro, Skeleton, Tabs } from "../components/ui";
import { FanChart, Heatmap, Histogram, HBar, PathsChart, C } from "../components/charts";
import { useApp } from "../store";
import { useStress } from "./Portfolio";

export default function Explorer() {
  const [sp, setSp] = useSearchParams(); const { simId, setSimId, weights, v0 } = useApp();
  const urlId = sp.get("sim");
  const requestedId = urlId ?? simId;
  const list = useScenarios();
  const completedScenarios = (list.data ?? []).filter((scenario: any) => scenario.status === "completed");
  const selectedScenario = completedScenarios.find((scenario: any) => scenario.id === requestedId) ?? completedScenarios[0];
  const id = selectedScenario?.id;
  const q = useScenario(id);
  const [tab, setTab] = useState<string>("NIFTY");
  const stress = useStress(tab === "PORTFOLIO" ? id ?? undefined : undefined, weights, v0);
  const hz = q.data?.meta?.horizon;
  const hist = useQuery({ queryKey: ["href", tab, hz], enabled: !!hz && tab !== "PORTFOLIO", queryFn: () => api(`/api/data/history-ref?asset=${tab}&horizon=${hz}`) });
  useEffect(() => {
    if (!list.isSuccess) return;
    if (simId !== id) setSimId(id);
    if (urlId !== id) setSp(id ? { sim: id } : {}, { replace: true });
  }, [id, list.isSuccess, setSimId, setSp, simId, urlId]);
  if (list.isLoading) return <Skeleton h={400} />;
  if (list.isError) return <ErrorState error={list.error} />;
  if (!id) return <Empty text="No completed scenarios yet. Generate one in Story Mode first." action={<Link className="btn btn-primary" to="/story">Open Story Mode</Link>} />;
  if (q.isError) return <ErrorState error={q.error} />;
  const j = q.data; if (!j) return <Skeleton h={400} />;
  if (j.status === "failed") return <ErrorState error={j.error} />;
  if (j.status !== "completed") return <GlassCard title="Simulation running"><Skeleton h={200} /><p className="mt-2 text-tx2">{j.status} — {(j.progress * 100).toFixed(0)}%</p></GlassCard>;
  const S = j.summary, m = j.meta, bands = tab === "PORTFOLIO" ? (stress.data ? Object.fromEntries(Object.entries(stress.data.value_bands).map(([k, v]: any) => [k, v.map((x: number) => x / v0 - 1)])) : null) : S.bands[tab];
  const fin = tab === "PORTFOLIO" ? null : S.final_hist[tab];
  return (
    <div className="space-y-4">
      <PageIntro
        title="Scenario Explorer"
        description="Explore how different market conditions could affect your assets over time using the generated simulation paths and risk diagnostics."
      />
      <div className="flex flex-wrap items-center gap-3">
        <select className="!w-auto min-w-[220px]" value={id} onChange={(e) => { setSimId(e.target.value); setSp({ sim: e.target.value }); }}>
          {(list.data ?? []).filter((x: any) => x.status === "completed").map((x: any) => <option key={x.id} value={x.id}>{x.name} · {MODEL_LABEL[x.request.model]}</option>)}</select>
        <span className="text-[12px] text-tx3">{MODEL_LABEL[m.model]} v{m.model_version} · seed {m.seed} · {m.n.toLocaleString()} paths · {m.horizon}d · regime {m.regime ?? "mixed"} · {m.seconds.toFixed(2)}s</span>
        <span className="ml-auto flex gap-2"><a className="btn btn-ghost !py-1.5" href={apiUrl(`/api/scenarios/${id}/export?format=csv`)}><Download size={14} />CSV</a><a className="btn btn-ghost !py-1.5" href={apiUrl(`/api/scenarios/${id}/export?format=json`)}><Download size={14} />JSON</a></span></div>
      <GlassCard title={`${LABEL[tab]} — cumulative return fan`} right={<Tabs items={[...ASSETS, "PORTFOLIO"] as const} value={tab as any} onChange={setTab} labels={LABEL} />}
        hint="Bands are empirical quantiles across the generated paths at each day: dark = 25–75%, mid = 5–95%, light = 1–99%. Cyan = median. Not a forecast.">
        {bands ? <><FanChart bands={bands} history={tab === "PORTFOLIO" ? undefined : hist.data?.path} />{hist.data && tab !== "PORTFOLIO" && <p className="mt-1 text-[11.5px] text-tx3"><span className="text-warn">- - -</span> Worst {hz}-day window in the historical data for this asset ({hist.data.start} → {hist.data.end}), shown for reference only.</p>}</> : tab === "PORTFOLIO" && stress.isError ? <ErrorState error={stress.error} /> : <Skeleton h={340} />}
      </GlassCard>
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard title="Scenario constraint satisfaction" hint="Requested vs realised — measured, never forced" className="lg:col-span-2">
          {!m.constraint_report.length ? <p className="text-tx2 text-[13px]">Unconditional run — no constraints requested.</p> :
            <div className="overflow-x-auto"><table className="num"><thead><tr className="lbl"><th>Asset</th><th>Requested</th><th>Realised median</th><th>5–95% range</th><th>Within tol.</th></tr></thead><tbody>
              {m.constraint_report.map((r: any) => (<tr key={r.asset}><td className="font-sans">{LABEL[r.asset]}</td><td>{pct(r.target_simple)}</td><td>{pct(r.realised_median_simple)}</td><td className="text-tx2">{pct(r.p05_simple, 0)} … {pct(r.p95_simple, 0)}</td>
                <td className={r.share_within_tolerance > 0.5 ? "text-up" : r.share_within_tolerance > 0.2 ? "text-warn" : "text-down"}>{pctU(r.share_within_tolerance, 0)}</td></tr>))}</tbody></table>
              <p className="mt-2 text-[11.5px] text-tx3">Mode: <b>{m.conditioning}</b>{m.conditioning === "analog_selection" && ` (pool ${m.pool_size.toLocaleString()}, median selection distance ${m.median_selected_distance_sd.toFixed(2)} sd)`}. Tolerance: ±max(1pp, 15% of target) in log return.</p></div>}
        </GlassCard>
        <GlassCard title="Joint tail exceedance" hint="P(asset in own worst 5% | NIFTY in worst 5%)">
          <HBar data={ASSETS.filter((a) => a !== "NIFTY").map((a) => ({ name: a, v: S.joint_tail_given_nifty[a] }))} fmt={(v) => pctU(v, 0)} color={C.cyan} height={200} /></GlassCard></div>
      {fin && <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard title={`${LABEL[tab]} — horizon return distribution`}><Histogram counts={fin.counts} edges={fin.edges} neg /></GlassCard>
        <GlassCard title="Worst NIFTY paths" hint="15 generated paths with the lowest final NIFTY return"><PathsChart paths={S.worst_paths_nifty.paths[tab]} /></GlassCard></div>}
      <GlassCard title="Cross-asset correlation (horizon returns, generated)"><Heatmap labels={[...ASSETS]} m={S.corr} /></GlassCard>
    </div>);
}
