import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Loader2, Sparkles, Wand2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ASSETS, LABEL, MODEL_LABEL, api, post, pct } from "../api";
import { ErrorState, GlassCard, PageIntro, SyntheticBanner, useToast } from "../components/ui";
import { useApp } from "../store";
import { useOverview } from "../api";

const PRESETS: { name: string; text: string }[] = [
  { name: "Banking Crisis", text: "Nifty falls 12% over 10 trading days, banking stocks fall 20%, rupee depreciates 3%, extreme volatility" },
  { name: "Currency Crisis", text: "Rupee depreciates 6% over 10 days, Nifty falls 8%, gold rises 5%, elevated volatility" },
  { name: "Global Recession", text: "Nifty falls 18% over 20 trading days, IT stocks fall 15%, crude oil falls 20%, rupee depreciates 4%, extreme volatility" },
  { name: "Oil Shock", text: "Crude oil increases 25% over 10 days, Nifty falls 7%, rupee depreciates 3%, elevated volatility" },
  { name: "Combined Market Crisis", text: "NIFTY falls 15% over 10 trading days, the rupee depreciates 4%, banking stocks experience severe volatility, and crude oil increases 12%." },
];
const SHOCK_ASSETS = ["NIFTY", "USDINR", "BANK", "IT", "GOLD", "CRUDE"] as const;
type Draft = { shocks: Record<string, number | undefined>; horizon: number; regime: string; n: number; model: string };
const MODEL_DESCRIPTION: Record<string, string> = {
  cvae: "Recommended. Learns patterns and generates connected asset paths, with support for return targets.",
  fhs: "Reuses historical market patterns and changing volatility.",
  gaussian: "A simpler model based on average returns and how assets moved together.",
  gaussian_copula: "Models assets moving together, but does not capture extreme co-moves as strongly.",
  t_copula: "Allows extreme moves across assets to occur together more often.",
};

export default function Story() {
  const nav = useNavigate(), toast = useToast(), { setSimId } = useApp(), ov = useOverview();
  const [text, setText] = useState(""); const [parsed, setParsed] = useState<any>(null); const [lastParsed, setLastParsed] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [parsing, setParsing] = useState(false);
  const [d, setD] = useState<Draft>({ shocks: {}, horizon: 10, regime: "", n: 1000, model: "cvae" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [job, setJob] = useState<any>(null);
  const modelsQuery = useQuery({ queryKey: ["models"], queryFn: () => api("/api/models") });
  const models: string[] = modelsQuery.data?.models?.map((model: any) => model.id) ?? [];

  const parse = async (t = text) => {
    setErr(null); setParsing(true);
    try {
      const p = await post("/api/scenarios/parse", { text: t }); setParsed(p); setLastParsed(t);
      setD((x) => ({ ...x, shocks: Object.fromEntries(Object.entries(p.shocks)), horizon: p.horizon ?? x.horizon, regime: p.regime ?? "" }));
      if (!p.found.length) toast("I couldn't identify a market move. Try an example or edit the settings below.", "err");
      return p;
    } catch (e) { setErr(e); toast(String((e as Error).message), "err"); }
    finally { setParsing(false); }
  };
  const run = async () => {
    setErr(null);
    const draft = d;
    const validationErrors = lastParsed === text ? (parsed?.validation_errors ?? []) : [];
    if (text.trim() && lastParsed !== text) return;
    if (text.trim() && !parsed?.found?.length) {
      setErr(new Error("CrashLab couldn't identify a market move in this description. Edit it or clear it and set the targets below."));
      return;
    }
    const verrs = [...validationErrors];
    if (draft.n < 1 || draft.n > 5000) verrs.push("Scenario count must be 1–5,000");
    if (verrs.length) { setBusy(false); toast(verrs.join("; "), "err"); setErr(new Error(verrs.join("; "))); return; }
    setBusy(true); setJob(null);
    try {
      const shocks = Object.fromEntries(Object.entries(draft.shocks).filter(([, v]) => v !== undefined && !Number.isNaN(v)));
      const name = selectedPreset || text.trim().slice(0, 60) || (Object.keys(shocks).length ? "Custom stress scenario" : "Unconditional scenario");
      const r = await post("/api/scenarios/generate", {
        name, model: draft.model, horizon: draft.horizon, n: draft.n,
        regime: draft.regime || null, shocks, seed: 42,
        source: selectedPreset ? "preset" : "custom",
        preset_name: selectedPreset || null,
      });
      for (let i = 0; i < 900; i++) {
        const j = await api(`/api/scenarios/${r.id}`, undefined); setJob(j);
        if (j.status === "completed") { setSimId(j.id); toast("Scenarios generated"); nav(`/explorer?sim=${j.id}`); return; }
        if (j.status === "failed") throw new Error(j.error);
        await new Promise((res) => setTimeout(res, 500));
      }
      throw new Error("timed out waiting for the simulation");
    } catch (e) { setErr(e); toast(String((e as Error).message), "err"); } finally { setBusy(false); }
  };
  const setShock = (a: string, v: number | undefined) => setD((x) => ({ ...x, shocks: { ...x.shocks, [a]: v } }));
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageIntro
        title="Story Mode"
        description="Describe a market shock in plain English and turn it into a structured scenario for simulation and risk analysis."
      />
      <SyntheticBanner synthetic={ov.data?.synthetic} />
      <div className="rounded-xl border border-white/[.08] bg-white/[.025] p-4">
        <p className="text-[13px] font-semibold">Create a scenario in three steps</p>
        <div className="mt-2 grid gap-2 text-[12px] text-tx2 sm:grid-cols-3">
          <p><b className="text-cyan">1. Start</b> with an example or your own idea.</p>
          <p><b className="text-cyan">2. Review</b> what CrashLab understood and change it.</p>
          <p><b className="text-cyan">3. Create</b> simulated possibilities to explore.</p>
        </div>
      </div>
      <GlassCard title="1. Choose an example or start from scratch">
        <p className="mb-3 text-[12px] text-tx2">Choose a ready-made example to edit, or leave them unselected and describe your own market event.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((preset) => <button key={preset.name} type="button" disabled={busy || parsing} className={`rounded-lg border p-3 text-left transition ${selectedPreset === preset.name ? "border-cyan/50 bg-cyan/10" : "border-white/[.08] bg-white/[.02] hover:border-white/20"}`}
            onClick={() => { setSelectedPreset(preset.name); setText(preset.text); setParsed(null); setLastParsed(""); setD((x) => ({ ...x, shocks: {}, horizon: 10, regime: "" })); setErr(null); }}>
            <span className="block text-[12.5px] font-semibold">{preset.name}</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-tx3">{preset.text}</span>
          </button>)}
          <button type="button" disabled={busy || parsing} className={`rounded-lg border p-3 text-left transition ${!selectedPreset ? "border-cyan/50 bg-cyan/10" : "border-white/[.08] bg-white/[.02] hover:border-white/20"}`}
            onClick={() => { setSelectedPreset(""); setText(""); setParsed(null); setLastParsed(""); setD((x) => ({ ...x, shocks: {}, horizon: 10, regime: "" })); setErr(null); }}>
            <span className="block text-[12.5px] font-semibold">My own idea</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-tx3">Start with a blank description and choose your own market changes.</span>
          </button>
        </div>
        <p className="mt-3 text-[11.5px] text-tx3" role="status">
          {selectedPreset
            ? <>Example selected: <b className="text-cyan">{selectedPreset}</b>. You can edit the text and settings before creating the run.</>
            : <>Your idea: describe a market event in your own words. Nothing runs until you choose Create scenario.</>}
        </p>
      </GlassCard>
      <GlassCard title="2. Describe what happens">
        <label className="lbl" htmlFor="scenario-description">What changes in the market?</label>
        <p className="mb-2 text-[11.5px] text-tx3">Helpful format: name an asset, say whether it rises or falls, give a percentage, and say over how many days. Example: “NIFTY falls 10% over 10 trading days.”</p>
        <textarea id="scenario-description" rows={4} disabled={busy || parsing} value={text} onChange={(e) => { setText(e.target.value); setSelectedPreset(""); setParsed(null); setLastParsed(""); setErr(null); }}
          className="!text-[15px]" aria-label="Scenario description"
          placeholder="For example: NIFTY falls 10% over 10 days, banks fall 15%, and the rupee weakens 3%." />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-tx3">CrashLab uses rule-based text matching. Always check the interpretation below.</span>
          <button className="btn btn-ghost" onClick={() => parse()} disabled={text.trim().length < 3 || parsing || busy}>
            {parsing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}{parsing ? "Checking…" : "Check my description"}
          </button>
        </div>
        {parsed && lastParsed === text && <div className="mt-3 rounded-xl border border-blue/25 bg-blue/5 p-3 text-[12.5px]">
          <b className="text-cyan">Here’s what CrashLab understood</b>
          {Object.keys(parsed.shocks).length
            ? <ul className="mt-2 grid gap-1 sm:grid-cols-2">{Object.entries(parsed.shocks).map(([asset, value]) => <li key={asset}>{LABEL[asset] ?? asset}: <b>{pct(value as number, 0)} over {parsed.horizon ?? d.horizon} days</b></li>)}</ul>
            : <p className="mt-1">No asset changes were identified. You can set them yourself in Step 3.</p>}
          <p className="mt-1">Time period: <b>{parsed.horizon ?? d.horizon} trading days</b> · Market conditions: <b>{parsed.regime ?? "use a mix of historical conditions"}</b></p>
          {parsed.warnings.map((w: string) => <div key={w} className="mt-2 text-warn">Please note: {w}</div>)}
          {parsed.validation_errors.map((w: string) => <div key={w} className="mt-2 text-down">{w}</div>)}
          <p className="mt-2 text-tx3">This is an interpretation, not a prediction. Change any setting below if it isn’t what you meant.</p>
        </div>}
      </GlassCard>
      <GlassCard title="3. Review and adjust the market changes">
        <p className="mb-1 text-[12.5px] text-tx2">These are total changes across the selected time period—not changes per day.</p>
        <p className="mb-3 text-[11.5px] text-tx3">Leave a field blank to let that asset move freely. A negative number means it falls; a positive number means it rises. For USD/INR, a positive number means the rupee weakens.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SHOCK_ASSETS.map((a) => { const v = d.shocks[a]; return (
            <label key={a} className="rounded-lg border border-white/[.08] bg-white/[.02] p-3">
              <span className="block text-[12px] font-medium">{LABEL[a]}</span>
              <span className="mt-1 block text-[10.5px] text-tx3">Optional total change</span>
              <span className="mt-2 flex items-center gap-2">
                <input className="num !py-1.5" type="number" min="-94" max="500" step="1" placeholder="Leave blank" disabled={busy} value={v === undefined ? "" : (v * 100).toFixed(0)}
                  onChange={(e) => setShock(a, e.target.value === "" ? undefined : Number(e.target.value) / 100)} aria-label={`${LABEL[a]} total change percent`} />
                <span className="text-[12px] text-tx3">%</span>
                {v !== undefined && <button type="button" disabled={busy} className="text-[11px] text-tx3 hover:text-down" onClick={() => setShock(a, undefined)}>Clear</button>}
              </span>
            </label>); })}
        </div>
        <div className="mt-4 max-w-xs">
          <label className="lbl" htmlFor="scenario-horizon">How long does the event last?</label>
          <select id="scenario-horizon" value={d.horizon} disabled={busy} onChange={(e) => setD({ ...d, horizon: +e.target.value })}>{[5, 10, 15, 20].map((h) => <option key={h} value={h}>{h} trading days</option>)}</select>
        </div>
        <details className="mt-4 rounded-lg border border-white/[.08] p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[12px] font-medium">Advanced options <ChevronDown size={14} /></summary>
          <p className="mt-2 text-[11.5px] text-tx3">The defaults are suitable for most users. Change these only if you know what you need.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div><label className="lbl" htmlFor="scenario-regime">Market volatility</label><select id="scenario-regime" value={d.regime} disabled={busy} onChange={(e) => setD({ ...d, regime: e.target.value })}><option value="">Mixed historical conditions</option><option value="normal">Calmer than usual</option><option value="elevated">More volatile</option><option value="extreme">Extremely volatile</option></select></div>
            <div><label className="lbl" htmlFor="scenario-path-count">Number of possibilities</label><select id="scenario-path-count" value={d.n} disabled={busy} onChange={(e) => setD({ ...d, n: +e.target.value })}>{[1000, 2000, 5000].map((n) => <option key={n} value={n}>{n.toLocaleString()} paths</option>)}</select></div>
            <div><label className="lbl" htmlFor="scenario-model">Simulation method</label><select id="scenario-model" value={d.model} onChange={(e) => setD({ ...d, model: e.target.value })} disabled={busy || modelsQuery.isLoading || modelsQuery.isError || models.length === 0}>
              {models.map((m) => <option key={m} value={m}>{MODEL_LABEL[m] ?? m}{m === "cvae" ? " — recommended" : ""}</option>)}
            </select></div>
          </div>
          {modelsQuery.isError
            ? <p className="mt-3 text-[12px] text-down">Could not load simulation methods: {(modelsQuery.error as Error).message}</p>
            : <p className="mt-3 text-[12px] text-tx3">{MODEL_DESCRIPTION[d.model] ?? ""} All methods create a saved result you can open in Scenario Explorer.</p>}
          <p className="mt-2 text-[11px] text-tx3">More paths take longer to calculate. Volatility is how much prices move up or down. “Mixed historical conditions” uses the model’s usual mix.</p>
        </details>
        <div className="mt-5 rounded-lg border border-white/[.08] bg-white/[.02] p-3 text-[12px] text-tx2">
          <b className="text-tx">Before you create it:</b> {Object.values(d.shocks).some((value) => value !== undefined)
            ? `${Object.values(d.shocks).filter((value) => value !== undefined).length} market change(s) set over ${d.horizon} trading days.`
            : "No specific asset changes set; the model will generate an unconditioned range of possibilities."}
          {" "}These are requests to the model, not guaranteed outcomes. The results show what the simulation produced.
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button className="btn btn-primary" disabled={busy || parsing || (text.trim().length > 0 && lastParsed !== text) || modelsQuery.isLoading || modelsQuery.isError || models.length === 0} onClick={run}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? "Creating possibilities…" : `Create scenario · ${d.n.toLocaleString()} paths`}
          </button>
          {text.trim().length > 0 && lastParsed !== text && <span className="text-[11.5px] text-warn">First choose “Check my description” above and review what was understood.</span>}
          {busy && <div className="min-w-[220px] flex-1"><div className="h-1.5 overflow-hidden rounded bg-white/10"><div className="h-full bg-gradient-to-r from-blue to-cyan transition-all" style={{ width: `${Math.max(5, (job?.progress ?? 0) * 100)}%` }} /></div>
            <div className="mt-1 text-[11.5px] text-tx3">{job ? `Creating: ${job.status} · ${(job.progress * 100).toFixed(0)}%` : "Starting simulation…"}</div></div>}
        </div>
      </GlassCard>
      {err != null && <ErrorState error={err} />}
    </div>);
}
