import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Database, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { LABEL, money, useHealth, useOverview, useScenarios } from "../api";
import { Disclaimer, ErrorState, GlassCard, PageIntro, Status, SyntheticBanner } from "../components/ui";
import { DEFAULT_W, useApp } from "../store";

export default function Settings() {
  const health = useHealth(), overview = useOverview(), scenarios = useScenarios();
  const { simId, weights, v0, setWeights, setV0, setSimId } = useApp();
  const [confirmReset, setConfirmReset] = useState(false);
  const selectedScenario = (scenarios.data ?? []).find((scenario: any) => scenario.id === simId);
  const weightTotal = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  const normalizedWeights = Object.entries(weights).filter(([, value]) => value > 0).map(([asset, value]) => [asset, value / weightTotal] as const);

  const reset = () => {
    setWeights(DEFAULT_W);
    setV0(1_000_000);
    setSimId(undefined);
    setConfirmReset(false);
  };

  return (
    <div className="space-y-5">
      <PageIntro title="Settings & workspace" description="See what CrashLab remembers in this browser, check whether the research service is ready, and understand the limits of the results." />
      <SyntheticBanner synthetic={overview.data?.synthetic} />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <GlassCard title="Your research workspace" hint="These choices are saved in this browser only. They are used when you visit Portfolio Risk; they are not a trading account or synced profile.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-white/[.07] bg-white/[.025] p-3">
              <p className="lbl">Example portfolio starting value</p>
              <p className="num mt-1 text-xl">{money(v0)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-tx3">This scales simulated percentage returns into an illustrative currency amount.</p>
            </div>
            <div className="rounded-lg border border-white/[.07] bg-white/[.025] p-3">
              <p className="lbl">Scenario selected for portfolio risk</p>
              <p className="mt-1 truncate text-[13px] font-medium">{selectedScenario?.name ?? "Most recent completed scenario"}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-tx3">{selectedScenario ? "This saved simulation is selected in your browser." : "Portfolio Risk uses the latest completed simulation until you choose another."}</p>
            </div>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-[12px] font-semibold">Saved portfolio mix <span className="font-normal text-tx3">(normalised to 100%)</span></p>
            <div className="space-y-2">{normalizedWeights.map(([asset, value]) => <div key={asset} className="grid grid-cols-[90px_1fr_48px] items-center gap-2 text-[11.5px]">
              <span className="text-tx2">{asset === "CASH" ? "Cash" : LABEL[asset] ?? asset}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[.08]"><div className="h-full rounded-full bg-cyan" style={{ width: `${value * 100}%` }} /></div>
              <span className="num text-right">{(value * 100).toFixed(1)}%</span>
            </div>)}</div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[.07] pt-3">
            <Link to="/portfolio" className="btn btn-ghost">Edit portfolio mix <ArrowRight size={13} /></Link>
            <Link to="/explorer" className="btn btn-ghost">Choose a scenario <ArrowRight size={13} /></Link>
            {!confirmReset ? <button className="btn btn-ghost" onClick={() => setConfirmReset(true)}><RotateCcw size={13} />Reset workspace</button> : <>
              <span className="text-[11.5px] text-warn">Reset mix, starting value, and selected scenario?</span>
              <button className="btn btn-primary" onClick={reset}>Yes, reset</button>
              <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
            </>}
          </div>
          <p className="mt-2 text-[10.5px] text-tx3">Reset does not delete any saved scenarios or generated results.</p>
        </GlassCard>

        <GlassCard title="Service and data checks" hint="These live checks tell you whether the application can reach its supporting services. They do not certify that a model result is accurate.">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-tx3">{health.data?.checked_at ? `Last checked ${new Date(health.data.checked_at * 1000).toLocaleTimeString()}` : "Checks update automatically."}</span>
            <button type="button" className="btn btn-ghost !px-2.5 !py-1.5" onClick={() => { void health.refetch(); void overview.refetch(); }} disabled={health.isFetching || overview.isFetching}><RefreshCw size={13} className={health.isFetching || overview.isFetching ? "animate-spin" : ""} />Refresh checks</button>
          </div>
          {health.isError && <div className="mb-3"><ErrorState error={health.error} /></div>}
          <div className="space-y-3">
            <CheckRow icon={<ShieldCheck size={15} />} title="API" explanation="Receives requests from this website." state={health.data ? "ok" : health.isError ? "error" : "unknown"} status={health.data ? "Responding" : health.isError ? "Could not be reached" : "Checking"} />
            <CheckRow icon={<Database size={15} />} title="Scenario storage" explanation="Stores generated scenario runs so you can reopen them." state={health.data ? health.data.database === "ok" ? "ok" : "error" : "unknown"} status={health.data ? health.data.database === "ok" ? "Connected" : "Unavailable" : "Checking"} />
            <CheckRow icon={<ShieldCheck size={15} />} title="Model files" explanation="The trained simulation artifacts needed to produce model-based paths." state={health.data ? health.data.models_loaded ? "ok" : "error" : "unknown"} status={health.data ? health.data.models_loaded ? "Loaded" : "Unavailable" : "Checking"} />
            <CheckRow icon={<ShieldCheck size={15} />} title="Simulation engine" explanation="Runs the selected model to generate possible paths." state={health.data ? health.data.simulation_engine === "ok" ? "ok" : "error" : "unknown"} status={health.data ? health.data.simulation_engine === "ok" ? "Ready" : "Unavailable" : "Checking"} />
            <CheckRow icon={<Database size={15} />} title="Market data" explanation={overview.data ? `${overview.data.source}, covering ${overview.data.start} to ${overview.data.end}.` : "Loads the historical inputs used by the app."} state={overview.data ? overview.data.synthetic ? "warn" : "ok" : overview.isError ? "error" : "unknown"} status={overview.data ? overview.data.synthetic ? "Synthetic development data" : "Loaded" : overview.isError ? "Unavailable" : "Checking"} />
          </div>
          {health.data?.models_error && <p className="mt-3 rounded-lg bg-down/5 p-3 text-[11.5px] text-down">Model loading detail: {health.data.models_error}</p>}
          <Link to="/research" className="mt-4 inline-flex items-center gap-1 text-[11.5px] text-cyan">Review data coverage and quality <ArrowRight size={12} /></Link>
        </GlassCard>
      </div>

      <GlassCard title="How to interpret CrashLab" hint="A reminder of what the platform's outputs do—and do not—tell you.">
        <div className="grid gap-4 md:grid-cols-3">
          <Interpretation title="Conditional results" text="A result depends on the scenario description, portfolio mix, selected model, and generated paths." />
          <Interpretation title="Not probabilities of real events" text="A share of simulated paths is a share within that model run. It is not the chance that the event will happen in real markets." />
          <Interpretation title="Research only" text="CrashLab does not execute trades or provide personal investment advice." />
        </div>
        <div className="mt-4 border-t border-white/[.07] pt-3"><Disclaimer /></div>
      </GlassCard>
    </div>);
}

function CheckRow({ icon, title, explanation, state, status }: { icon: React.ReactNode; title: string; explanation: string; state: "ok" | "error" | "unknown" | "warn"; status: string }) {
  return <div className="flex items-start gap-3 rounded-lg border border-white/[.07] bg-white/[.02] p-3">
    <span className="mt-0.5 text-cyan">{icon}</span>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[12px] font-semibold">{title}</p><Status state={state} label={status} /></div><p className="mt-1 text-[11px] leading-relaxed text-tx3">{explanation}</p></div>
  </div>;
}

function Interpretation({ title, text }: { title: string; text: string }) {
  return <div className="rounded-lg border border-white/[.07] bg-white/[.02] p-3"><p className="text-[12px] font-semibold">{title}</p><p className="mt-1 text-[11.5px] leading-relaxed text-tx2">{text}</p></div>;
}
