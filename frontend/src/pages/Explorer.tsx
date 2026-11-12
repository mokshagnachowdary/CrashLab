import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Check, ChevronDown, Download, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ASSETS, LABEL, MODEL_LABEL, api, apiUrl, pct, pctU, useScenario, useScenarios } from "../api";
import { Empty, ErrorState, GlassCard, Metric, PageIntro, Skeleton, Tabs, useToast } from "../components/ui";
import { FanChart, Heatmap, Histogram, HBar, PathsChart, C } from "../components/charts";
import { useApp } from "../store";
import { useStress } from "./Portfolio";

export default function Explorer() {
  const [sp, setSp] = useSearchParams(); const { simId, setSimId, weights, v0 } = useApp();
  const location = useLocation();
  const queryClient = useQueryClient(), toast = useToast();
  const [scenarioSource, setScenarioSource] = useState("all");
  const [scenarioModel, setScenarioModel] = useState("all");
  const [scenarioMenuOpen, setScenarioMenuOpen] = useState(false);
  const [deleteScenarioId, setDeleteScenarioId] = useState<string>();
  const scenarioMenuRef = useRef<HTMLDivElement>(null);
  const urlId = sp.get("sim");
  const requestedId = urlId ?? simId;
  const list = useScenarios();
  const allScenarios = list.data ?? [];
  const deleteScenario = useMutation({
    mutationFn: (scenarioId: string) => api(`/api/scenarios/${scenarioId}`, { method: "DELETE" }),
    onSuccess: async (_result, scenarioId) => {
      await queryClient.invalidateQueries({ queryKey: ["scenarios"] });
      queryClient.removeQueries({ queryKey: ["scenario", scenarioId] });
      setDeleteScenarioId(undefined);
      setScenarioMenuOpen(false);
      if (scenarioId === id) {
        setSimId(undefined);
        setSp({}, { replace: true });
      }
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
  const deleteTarget = allScenarios.find((scenario: any) => scenario.id === deleteScenarioId);
  const justCreated = Boolean((location.state as { createdScenario?: boolean } | null)?.createdScenario && urlId === id);
  useEffect(() => {
    if (!scenarioMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !scenarioMenuRef.current?.contains(event.target)) setScenarioMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setScenarioMenuOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [scenarioMenuOpen]);
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
  const scenarioSelect = <div ref={scenarioMenuRef} className="relative flex min-w-[260px] flex-col gap-1 text-[11px] text-tx3">
    <span>Saved simulation</span>
    <button type="button" className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/[.1] bg-surface px-3 py-2 text-left text-[12px] text-tx hover:border-cyan/30"
      aria-label="Select generated scenario" aria-expanded={scenarioMenuOpen} onClick={() => setScenarioMenuOpen((open) => !open)}>
      <span className="min-w-0 truncate">{selectedScenario?.name ?? "Choose a saved simulation"}</span><ChevronDown size={14} className="shrink-0" />
    </button>
    {scenarioMenuOpen && <div aria-label="Saved simulations" className="absolute left-0 top-full z-30 mt-1 max-h-80 w-[min(90vw,24rem)] overflow-y-auto rounded-xl border border-white/[.12] bg-[#11111d] p-1.5 shadow-2xl">
      {filteredScenarios.map((scenario: any) => {
        const source = sourceOf(scenario);
        const origin = source === "preset" ? "Built-in example" : source === "legacy" ? "Older run · origin unknown" : "Your Story Mode scenario";
        const canDelete = source === "custom" && !["queued", "running"].includes(scenario.status);
        const selected = scenario.id === id;
        return <div key={scenario.id} className={`flex items-center gap-1 rounded-lg ${selected ? "bg-cyan/[.08]" : "hover:bg-white/[.04]"}`}>
          <button type="button" className="flex min-w-0 flex-1 items-start gap-2 px-2.5 py-2 text-left" onClick={() => {
            setSimId(scenario.id); setSp({ sim: scenario.id }); setScenarioMenuOpen(false); setDeleteScenarioId(undefined);
          }}>
            <span className="mt-0.5 w-4 shrink-0">{selected && <Check size={13} className="text-cyan" />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[12px] text-tx">{scenario.name}</span>
              <span className="mt-0.5 block truncate text-[10.5px] text-tx3">{origin} · {MODEL_LABEL[scenario.request.model]}{scenario.status === "completed" ? "" : ` · ${scenario.status}`}</span></span>
          </button>
          {canDelete && <button type="button" className="mr-1 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[10.5px] text-tx3 hover:bg-down/10 hover:text-down"
            aria-label={`Delete ${scenario.name}`} title="Delete this custom scenario" onClick={() => { setDeleteScenarioId(scenario.id); setScenarioMenuOpen(false); }}>
            <Trash2 size={13} /><span>Delete</span>
          </button>}
        </div>;
      })}
      {!filteredScenarios.length && <p className="px-3 py-4 text-[11.5px] text-tx3">No saved scenarios match these filters.</p>}
    </div>}
  </div>;
  const scenarioFilters = <div className="flex flex-wrap items-end gap-3">
    {sourceFilter}
    <label className="flex flex-col gap-1 text-[11px] text-tx3">Model
      <select className="!w-auto min-w-[180px]" value={scenarioModel} onChange={(e) => setScenarioModel(e.target.value)} aria-label="Filter by model">
        <option value="all">All models</option>{Object.entries(MODEL_LABEL).filter(([modelId]) => modelId !== "PORTFOLIO").map(([modelId, label]) => <option key={modelId} value={modelId}>{label}</option>)}
      </select>
    </label>
    {scenarioSelect}
  </div>;
  const filterHelp = <p className="text-[11.5px] text-tx3">
    Each item is a saved simulation run. Template runs started from a built-in Story Mode template; custom runs started from text you entered; older runs may not have saved origin information.
  </p>;
  const deleteConfirmation = deleteTarget?.request.source === "custom" && !["queued", "running"].includes(deleteTarget.status)
    ? <div className="rounded-xl border border-down/30 bg-down/5 p-3 text-[12.5px]" role="alert">
      <p><b>Delete “{deleteTarget.name}”?</b> This permanently removes the saved run and its generated paths. Preset and older runs cannot be deleted here.</p>
      <div className="mt-2 flex gap-2">
        <button className="btn !bg-down !text-white" disabled={deleteScenario.isPending} onClick={() => deleteScenario.mutate(deleteTarget.id)}>
          {deleteScenario.isPending ? "Deleting…" : "Yes, delete this run"}
        </button>
        <button className="btn btn-ghost" disabled={deleteScenario.isPending} onClick={() => setDeleteScenarioId(undefined)}>Cancel</button>
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
  const requestedTargets = j.request.shocks ?? {};
  const constraintReports = Array.isArray(m.constraint_report) ? m.constraint_report : [];
  return (
    <div className="min-w-0 space-y-4">
      {intro}
      <section className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan/25 bg-cyan/[.045] p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><p className="text-[11px] font-semibold tracking-wide text-cyan">Currently showing:</p>{justCreated && <span className="rounded-full bg-up/10 px-2 py-0.5 text-[10px] font-medium text-up">Just created</span>}</div>
          <h2 className="mt-1 break-words text-lg font-semibold text-tx">{j.name}</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-tx2">
            {sourceOf(selectedScenario) === "preset" ? `Built-in example${selectedScenario.request.preset_name ? `: ${selectedScenario.request.preset_name}` : ""}` : sourceOf(selectedScenario) === "legacy" ? "Saved run · origin unknown" : "Your Story Mode scenario"}
            {" · "}{MODEL_LABEL[m.model]} · {m.n.toLocaleString()} possible paths · {m.horizon} trading days
          </p>
        </div>
        {justCreated && <span className="shrink-0 rounded-lg border border-up/20 bg-up/[.06] px-3 py-1.5 text-[11px] text-up">Your new simulation is open below</span>}
      </section>
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        {scenarioFilters}
        <span className="flex shrink-0 gap-2"><a className="btn btn-ghost !py-1.5" href={apiUrl(`/api/scenarios/${id}/export?format=csv`)}><Download size={14} />CSV</a><a className="btn btn-ghost !py-1.5" href={apiUrl(`/api/scenarios/${id}/export?format=json`)}><Download size={14} />JSON</a></span>
      </div>
      {deleteConfirmation}
      {deleteScenario.isError && <ErrorState error={deleteScenario.error} />}
      <p className="text-[11px] leading-relaxed text-tx3">
        {Object.keys(j.request.shocks ?? {}).length > 0
          ? ` Requested targets: ${Object.entries(j.request.shocks).map(([asset, value]) => `${LABEL[asset] ?? asset} ${pct(value as number, 0)}`).join(", ")}.`
          : " No asset return targets were requested; this is an unconditional simulation."}
        {" "}The graphs below summarize this run’s outputs; these are conditional model simulations, not forecasts.
      </p>
      <GlassCard title={`How might ${LABEL[tab]} move in this scenario?`} right={<div><span className="mb-1 block text-right text-[10px] text-tx3">Choose what to follow</span><Tabs items={[...ASSETS, "PORTFOLIO"] as const} value={tab as any} onChange={setTab} labels={LABEL} /></div>}>
        {bands ? <><FanChart bands={bands} history={tab === "PORTFOLIO" ? undefined : hist.data?.path}
          guide={`This chart follows ${LABEL[tab]} through the selected scenario. The bright line is the middle result; the shaded areas show how far different simulated outcomes spread. If the middle line is below zero, the typical simulated path loses value. A wider shaded area means less certainty about the outcome.`} />
          {hist.data && tab !== "PORTFOLIO" && <p className="mt-1 text-[11.5px] text-tx3"><span className="text-warn">- - -</span> For context only: the worst historical {hz}-day move in the available data ({hist.data.start} → {hist.data.end}). This is one past period, not a prediction.</p>}</> : tab === "PORTFOLIO" && stress.isError ? <ErrorState error={stress.error} /> : <Skeleton h={340} />}
      </GlassCard>
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <GlassCard title="How closely did the paths match your targets?" hint="A target is a request to the model, not a guaranteed outcome. These figures report the paths as generated; none are altered to force a match." className="min-w-0 lg:col-span-2">
          {!Object.keys(requestedTargets).length
            ? <p className="text-[12px] leading-relaxed text-tx2">No asset return targets were requested for this run, so there is no target match to measure. This was an unconditional simulation.</p>
            : !constraintReports.length
              ? <div className="rounded-lg border border-warn/20 bg-warn/[.04] p-3 text-[12px] leading-relaxed text-tx2">
                <b className="text-tx">Target diagnostics are not available for this saved run.</b> This run includes requested changes, but its saved results do not contain the per-asset comparison report. Older simulations created before target diagnostics were added cannot be backfilled from the summary alone. Generate a new scenario to see the requested-versus-realised comparison.
              </div>
              : <div className="space-y-2">
                <p className="text-[11px] leading-relaxed text-tx3">Requested vs. typical result, plus the share of paths close to the target. Expand a row for ranges, violations, and diagnostics.</p>
                <div className="grid grid-cols-[minmax(72px,.8fr)_minmax(118px,1.2fr)_minmax(112px,1fr)_auto] items-center gap-x-2 px-2 text-[9.5px] font-medium uppercase tracking-wide text-tx3 max-sm:hidden">
                  <span>Asset</span><span>Asked → median</span><span>Within tolerance</span><span />
                </div>
                {constraintReports.map((report: any) => <details key={report.asset} className="group min-w-0 rounded-lg border border-white/[.08] bg-white/[.02] px-2.5 py-2">
                  <summary className="grid cursor-pointer list-none grid-cols-2 items-center gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(72px,.8fr)_minmax(118px,1.2fr)_minmax(112px,1fr)_auto]">
                    <span className="text-[11.5px] font-semibold text-tx">{LABEL[report.asset] ?? report.asset}</span>
                    <span className="num text-[11px] text-tx2"><span className="text-tx3">{pct(report.target_simple, 1)}</span> <span aria-hidden="true">→</span> {pct(report.realised_median_simple, 1)}</span>
                    <span className={`num text-[11px] ${report.share_within_tolerance >= .5 ? "text-up" : "text-warn"}`}>{pctU(report.share_within_tolerance, 0)} <span className="font-sans text-tx3">of paths</span></span>
                    <span className="col-span-2 text-[10px] text-cyan sm:col-span-1 sm:text-right">Details <span className="inline-block transition group-open:rotate-180">⌄</span></span>
                  </summary>
                  <div className="mt-2 grid gap-2 border-t border-white/[.07] pt-2 text-[10.5px] sm:grid-cols-2">
                    <p className="text-tx2">Middle result 95% CI: {Array.isArray(report.realised_median_ci95_simple) ? `${pct(report.realised_median_ci95_simple[0], 1)} to ${pct(report.realised_median_ci95_simple[1], 1)}` : "not available"}.</p>
                    <p className="text-tx2">Middle 90% of paths: {pct(report.p05_simple, 1)} to {pct(report.p95_simple, 1)}.</p>
                    <p className="text-tx2">Within-tolerance 95% CI: {Array.isArray(report.share_within_tolerance_ci95) ? `${pctU(report.share_within_tolerance_ci95[0], 1)} to ${pctU(report.share_within_tolerance_ci95[1], 1)}` : "not available"}.</p>
                    <p className="text-tx2">{report.violation_count ?? "—"} of {m.n.toLocaleString()} paths outside tolerance{report.violation_rate !== undefined ? ` (${pctU(report.violation_rate, 1)})` : ""}; tolerance {pctU(report.tolerance_log, 2)}.</p>
                    {report.diagnostics?.map((message: string) => <p key={`${report.asset}-${message}`} className="rounded-md bg-warn/[.05] px-2 py-1.5 leading-relaxed text-warn sm:col-span-2">{message}</p>)}
                  </div>
                </details>)}
              </div>}
        </GlassCard>
        <GlassCard className="min-w-0" title="When NIFTY falls sharply, what else falls?" hint="Looks only at this scenario’s simulated paths. It counts how often another asset also has a very bad result when NIFTY is among its worst outcomes.">
          <HBar data={ASSETS.filter((a) => a !== "NIFTY").map((a) => ({ name: a, v: S.joint_tail_given_nifty[a] }))} fmt={(v) => pctU(v, 0)} color={C.cyan} height={200}
            guide="Longer bars mean that asset landed among its worst outcomes more often in paths where NIFTY also did badly. This describes the simulation only; it is not the chance of a real market event." /></GlassCard></div>
      {fin && <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard title={`How did ${LABEL[tab]} finish?`}><Histogram counts={fin.counts} edges={fin.edges} neg /></GlassCard>
        <GlassCard title={`Other assets along NIFTY’s 15 worst paths`}><PathsChart paths={S.worst_paths_nifty.paths[tab]} /></GlassCard></div>}
      <GlassCard title="Which assets moved together in this scenario?">
        <Heatmap labels={[...ASSETS]} m={S.corr} /></GlassCard>
    </div>);
}
