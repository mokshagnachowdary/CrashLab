import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ASSETS, LABEL, MODEL_LABEL, api, apiUrl, pct, pctU, useScenario, useScenarios } from "../api";
import { Empty, ErrorState, GlassCard, Metric, PageIntro, Skeleton, Tabs, useToast } from "../components/ui";
import { FanChart, Heatmap, Histogram, HBar, PathsChart, C } from "../components/charts";
import { useApp } from "../store";
import { useStress } from "./Portfolio";

export default function Explorer() {
  const [sp, setSp] = useSearchParams(); const { simId, setSimId, weights, v0 } = useApp();
  const queryClient = useQueryClient(), toast = useToast();
  const [scenarioSource, setScenarioSource] = useState("all");
  const [scenarioModel, setScenarioModel] = useState("all");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const urlId = sp.get("sim");
  const requestedId = urlId ?? simId;
  const list = useScenarios();
  const allScenarios = list.data ?? [];
  const deleteScenario = useMutation({
    mutationFn: (scenarioId: string) => api(`/api/scenarios/${scenarioId}`, { method: "DELETE" }),
    onSuccess: async (_result, scenarioId) => {
      await queryClient.invalidateQueries({ queryKey: ["scenarios"] });
      queryClient.removeQueries({ queryKey: ["scenario", scenarioId] });
      setConfirmDelete(false);
      setSimId(undefined);
      setSp({}, { replace: true });
      toast("Custom scenario and its generated paths were deleted.");
    },
    onError: (error) => toast((error as Error).message, "err"),
  });
  const completedScenarios = allScenarios.filter((scenario: any) => scenario.status === "completed");
  const sourceOf = (scenario: any) => scenario.request.source ?? "legacy";
  const filteredScenarios = allScenarios.filter((scenario: any) =>
    (scenarioSource === "all" || sourceOf(scenario) === scenarioSource)
    && (scenarioModel === "all" || scenario.request.model === scenarioModel),
  );
  const selectedScenario = filteredScenarios.find((scenario: any) => scenario.id === requestedId)
    ?? filteredScenarios.find((scenario: any) => scenario.status === "completed")
    ?? filteredScenarios.find((scenario: any) => scenario.status === "failed")
    ?? filteredScenarios[0];
  const id = selectedScenario?.id;
  const intro = <PageIntro
    title="Scenario Explorer"
    description="Explore how different market conditions could affect your assets over time using the generated simulation paths and risk diagnostics."
  />;
  const sourceFilter = <label className="flex flex-col gap-1 text-[11px] text-tx3">Scenario origin
    <select className="!w-auto min-w-[190px]" value={scenarioSource} onChange={(e) => setScenarioSource(e.target.value)} aria-label="Filter by scenario type">
      <option value="all">All generated runs</option>
      <option value="preset">Built-in template</option>
      <option value="custom">Custom Story Mode input</option>
      <option value="legacy">Older run — origin unknown</option>
    </select>
  </label>;
  const scenarioSelect = <label className="flex flex-col gap-1 text-[11px] text-tx3">Saved simulation
    <select className="!w-auto min-w-[260px]" value={id ?? ""} onChange={(e) => { setSimId(e.target.value); setSp({ sim: e.target.value }); setConfirmDelete(false); }} aria-label="Select generated scenario">
      {filteredScenarios.map((scenario: any) => {
        const source = sourceOf(scenario);
        const label = source === "preset"
          ? `Template run: ${scenario.request.preset_name ?? scenario.name}`
          : source === "legacy"
            ? `Older run (origin unknown): ${scenario.name}`
            : `Custom Story Mode input: ${scenario.name}`;
        const status = scenario.status === "completed" ? "" : ` · ${scenario.status}`;
        return <option key={scenario.id} value={scenario.id}>{label} · {MODEL_LABEL[scenario.request.model]}{status}</option>;
      })}
    </select>
  </label>;
  const scenarioFilters = <div className="flex flex-wrap items-end gap-3">
    {sourceFilter}
    <label className="flex flex-col gap-1 text-[11px] text-tx3">Model
      <select className="!w-auto min-w-[180px]" value={scenarioModel} onChange={(e) => setScenarioModel(e.target.value)} aria-label="Filter by model">
        <option value="all">All models</option>{Object.entries(MODEL_LABEL).filter(([modelId]) => modelId !== "PORTFOLIO").map(([modelId, label]) => <option key={modelId} value={modelId}>{label}</option>)}
      </select>
    </label>
    <div className="flex flex-wrap items-end gap-2">
      {scenarioSelect}
      {selectedScenario?.request.source === "custom" && !["queued", "running"].includes(selectedScenario.status) && <button className="btn btn-ghost !border-down/30 !text-down !py-2" onClick={() => setConfirmDelete(true)} aria-label="Delete selected custom scenario">
        <Trash2 size={14} />Delete custom run
      </button>}
    </div>
  </div>;
  const filterHelp = <p className="text-[11.5px] text-tx3">
    Each item is a saved simulation run. Template runs started from a built-in Story Mode template; custom runs started from text you entered; older runs may not have saved origin information.
  </p>;
  const deleteConfirmation = confirmDelete && selectedScenario?.request.source === "custom" && !["queued", "running"].includes(selectedScenario.status)
    ? <div className="rounded-xl border border-down/30 bg-down/5 p-3 text-[12.5px]" role="alert">
      <p><b>Delete “{selectedScenario.name}”?</b> This permanently removes the saved run and its generated paths. Preset and older runs cannot be deleted here.</p>
      <div className="mt-2 flex gap-2">
        <button className="btn !bg-down !text-white" disabled={deleteScenario.isPending} onClick={() => deleteScenario.mutate(selectedScenario.id)}>
          {deleteScenario.isPending ? "Deleting…" : "Yes, delete this run"}
        </button>
        <button className="btn btn-ghost" disabled={deleteScenario.isPending} onClick={() => setConfirmDelete(false)}>Cancel</button>
      </div>
    </div>
    : null;
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
  if (!id) return <div className="space-y-4">{intro}
    {scenarioFilters}
    {filterHelp}
    {allScenarios.length
      ? <Empty text="No scenarios match these filters." action={<button className="btn btn-ghost" onClick={() => { setScenarioSource("all"); setScenarioModel("all"); }}>Show all scenarios</button>} />
      : <Empty text="No completed scenarios yet. Generate one in Story Mode first." action={<Link className="btn btn-primary" to="/story">Open Story Mode</Link>} />}
  </div>;
  if (q.isError) return <ErrorState error={q.error} />;
  const j = q.data; if (!j) return <Skeleton h={400} />;
  if (j.status === "failed") return <div className="space-y-4">{intro}{scenarioFilters}{filterHelp}{deleteConfirmation}
    {deleteScenario.isError && <ErrorState error={deleteScenario.error} />}
    <ErrorState error={new Error(j.error || "The selected simulation failed without an error message.")} />
  </div>;
  if (j.status !== "completed") return <div className="space-y-4">{intro}{scenarioFilters}{filterHelp}
    <GlassCard title="Simulation in progress" hint="The page checks the backend until this run completes or fails. Running jobs cannot be deleted.">
      <Skeleton h={200} /><p className="mt-2 text-tx2">{j.status} — {(j.progress * 100).toFixed(0)}%</p></GlassCard>
  </div>;
  const S = j.summary, m = j.meta, bands = tab === "PORTFOLIO" ? (stress.data ? Object.fromEntries(Object.entries(stress.data.value_bands).map(([k, v]: any) => [k, v.map((x: number) => x / v0 - 1)])) : null) : S.bands[tab];
  const fin = tab === "PORTFOLIO" ? null : S.final_hist[tab];
  return (
    <div className="space-y-4">
      {intro}
      <div className="flex flex-wrap items-center gap-3">
        {scenarioFilters}
        <span className="text-[12px] text-tx3">{MODEL_LABEL[m.model]} v{m.model_version} · seed {m.seed} · {m.n.toLocaleString()} paths · {m.horizon}d · regime {m.regime ?? "mixed"} · {m.seconds.toFixed(2)}s</span>
        <span className="ml-auto flex gap-2"><a className="btn btn-ghost !py-1.5" href={apiUrl(`/api/scenarios/${id}/export?format=csv`)}><Download size={14} />CSV</a><a className="btn btn-ghost !py-1.5" href={apiUrl(`/api/scenarios/${id}/export?format=json`)}><Download size={14} />JSON</a></span></div>
      {filterHelp}
      {deleteConfirmation}
      {deleteScenario.isError && <ErrorState error={deleteScenario.error} />}
      <div className="rounded-xl border border-white/[.07] bg-white/[.025] px-4 py-3 text-[12.5px] text-tx2">
        <b className="text-tx">This page is showing:</b> “{j.name}” · {sourceOf(selectedScenario) === "preset"
          ? `built-in template ${selectedScenario.request.preset_name ?? ""}`
          : sourceOf(selectedScenario) === "legacy" ? "older run with unknown origin" : "your custom Story Mode input"}
        {" · "}{MODEL_LABEL[m.model]} · {m.n.toLocaleString()} simulated paths across {m.horizon} trading days.
        {Object.keys(j.request.shocks ?? {}).length > 0
          ? ` Requested targets: ${Object.entries(j.request.shocks).map(([asset, value]) => `${LABEL[asset] ?? asset} ${pct(value as number, 0)}`).join(", ")}.`
          : " No asset return targets were requested; this is an unconditional simulation."}
        {" "}The graphs below summarize this run’s outputs; they are conditional model simulations, not forecasts.
      </div>
      <GlassCard title={`How might ${LABEL[tab]} move in this scenario?`} right={<div><span className="mb-1 block text-right text-[10px] text-tx3">Choose what to follow</span><Tabs items={[...ASSETS, "PORTFOLIO"] as const} value={tab as any} onChange={setTab} labels={LABEL} /></div>}>
        {bands ? <><FanChart bands={bands} history={tab === "PORTFOLIO" ? undefined : hist.data?.path}
          guide={`This chart follows ${LABEL[tab]} through the selected scenario. The bright line is the middle result; the shaded areas show how far different simulated outcomes spread. If the middle line is below zero, the typical simulated path loses value. A wider shaded area means less certainty about the outcome.`} />
          {hist.data && tab !== "PORTFOLIO" && <p className="mt-1 text-[11.5px] text-tx3"><span className="text-warn">- - -</span> For context only: the worst historical {hz}-day move in the available data ({hist.data.start} → {hist.data.end}). This is one past period, not a prediction.</p>}</> : tab === "PORTFOLIO" && stress.isError ? <ErrorState error={stress.error} /> : <Skeleton h={340} />}
      </GlassCard>
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard title="Did the simulation reach the requested changes?" hint="Targets are requests, not promises. These results show what the model actually produced. The paths are never edited to force a match." className="lg:col-span-2">
          {!m.constraint_report.length ? <p className="text-tx2 text-[13px]">Unconditional run — no constraints requested.</p> :
            <div className="overflow-x-auto"><table className="num"><thead><tr className="lbl"><th>Asset</th><th>Requested target</th><th>Realised median (sampling 95% CI)</th><th>Predictive interval (5–95%)</th><th>Within tolerance (Wilson 95% CI)</th><th>Violations</th></tr></thead><tbody>
              {m.constraint_report.map((r: any) => (<tr key={r.asset}>
                <td className="font-sans">{LABEL[r.asset]}</td>
                <td>{pct(r.target_simple)}</td>
                <td>{pct(r.realised_median_simple)}{r.realised_median_ci95_simple && <span className="block text-[10px] text-tx3">{pct(r.realised_median_ci95_simple[0], 0)} … {pct(r.realised_median_ci95_simple[1], 0)}</span>}</td>
                <td className="text-tx2">{pct(r.p05_simple, 0)} … {pct(r.p95_simple, 0)}</td>
                <td className={r.share_within_tolerance > 0.5 ? "text-up" : r.share_within_tolerance > 0.2 ? "text-warn" : "text-down"}>
                  {pctU(r.share_within_tolerance, 0)}{r.share_within_tolerance_ci95 && <span className="block text-[10px] text-tx3">{pctU(r.share_within_tolerance_ci95[0], 0)} … {pctU(r.share_within_tolerance_ci95[1], 0)}</span>}</td>
                <td>{r.violation_count ?? "—"}{r.violation_rate !== undefined && <span className="block text-[10px] text-tx3">{pctU(r.violation_rate, 0)}</span>}</td>
              </tr>))}</tbody></table>
              <p className="mt-2 text-[11.5px] text-tx3">“Realised middle” is the middle outcome the simulation produced. “Within target” is the share of paths close to what you asked for; the small range below it shows uncertainty from the finite number of paths. A target can be missed when it is unusual for the data or model. No path is changed to force a match.</p>
              {m.constraint_report.map((r: any) => r.diagnostics?.map((message: string) => <p key={`${r.asset}-${message}`} className="mt-1 text-[11.5px] text-warn">{LABEL[r.asset]}: {message}</p>))}</div>}
        </GlassCard>
        <GlassCard title="When NIFTY falls sharply, what else falls?" hint="Looks only at this scenario’s simulated paths. It counts how often another asset also has a very bad result when NIFTY is among its worst outcomes.">
          <HBar data={ASSETS.filter((a) => a !== "NIFTY").map((a) => ({ name: a, v: S.joint_tail_given_nifty[a] }))} fmt={(v) => pctU(v, 0)} color={C.cyan} height={200}
            guide="Longer bars mean that asset landed among its worst outcomes more often in paths where NIFTY also did badly. This describes the simulation only; it is not the chance of a real market event." /></GlassCard></div>
      {fin && <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard title={`How did ${LABEL[tab]} finish?`}><Histogram counts={fin.counts} edges={fin.edges} neg /></GlassCard>
        <GlassCard title={`Other assets along NIFTY’s 15 worst paths`}><PathsChart paths={S.worst_paths_nifty.paths[tab]} /></GlassCard></div>}
      <GlassCard title="Which assets moved together in this scenario?">
        <Heatmap labels={[...ASSETS]} m={S.corr} /></GlassCard>
    </div>);
}
