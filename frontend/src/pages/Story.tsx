import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
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
  cvae: "Conditional VAE: a learned sequence generator with native asset-target conditioning.",
  fhs: "Filtered Historical Simulation: resamples synchronized historical residuals with volatility dynamics.",
  gaussian: "Gaussian: multivariate normal returns using estimated means and covariance.",
  gaussian_copula: "Gaussian Copula: t-distributed asset returns with Gaussian cross-asset dependence.",
  t_copula: "Student-t Copula: t-distributed asset returns with tail-dependent cross-asset dependence.",
};

export default function Story() {
  const nav = useNavigate(), toast = useToast(), { setSimId } = useApp(), ov = useOverview();
  const [text, setText] = useState(""); const [parsed, setParsed] = useState<any>(null); const [lastParsed, setLastParsed] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [d, setD] = useState<Draft>({ shocks: {}, horizon: 10, regime: "", n: 1000, model: "cvae" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [job, setJob] = useState<any>(null);
  const modelsQuery = useQuery({ queryKey: ["models"], queryFn: () => api("/api/models") });
  const models: string[] = modelsQuery.data?.models?.map((model: any) => model.id) ?? [];

  const parse = async (t = text) => {
    setErr(null);
    try {
      const p = await post("/api/scenarios/parse", { text: t }); setParsed(p); setLastParsed(t);
      setD((x) => ({ ...x, shocks: Object.fromEntries(Object.entries(p.shocks)), horizon: p.horizon ?? x.horizon, regime: p.regime ?? "" }));
      if (!Object.keys(p.shocks).length && !p.horizon && !p.regime) toast("Nothing recognised in that text — see the hints below.", "err");
      return p;
    } catch (e) { setErr(e); toast(String((e as Error).message), "err"); }
  };
  const run = async () => {
    setErr(null);
    let draft = d;
    let validationErrors = lastParsed === text ? (parsed?.validation_errors ?? []) : [];
    if (text.trim().length >= 3 && lastParsed !== text) {
      setBusy(true);
      const p = await parse();
      if (!p || !p.found.length) { setBusy(false); return; }
      draft = { ...d, shocks: Object.fromEntries(Object.entries(p.shocks)), horizon: p.horizon ?? d.horizon, regime: p.regime ?? "" };
      validationErrors = p.validation_errors ?? [];
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
      <div className="py-4 text-center"><h2 className="text-3xl font-semibold">Dream a <span className="text-cyan">market crash.</span></h2>
        <p className="mx-auto mt-2 max-w-xl text-tx2">Describe a hypothetical financial crisis. Let the simulation engine explore how markets and portfolios could respond.</p></div>
      <GlassCard title="1. Choose where your scenario starts">
        <p className="mb-3 text-[12px] text-tx2">Built-in templates are examples you can edit. Choose “Custom input” to write a scenario from scratch. Nothing is generated until you press Generate.</p>
        <div className="mb-3 max-w-sm"><label className="lbl" htmlFor="scenario-preset">Starting point</label>
          <select id="scenario-preset" value={selectedPreset} onChange={(e) => {
            const preset = PRESETS.find((item) => item.name === e.target.value);
            setSelectedPreset(preset?.name ?? "");
            if (preset) { setText(preset.text); parse(preset.text); }
          }}>
            <option value="">Custom input — write your own scenario</option>
            {PRESETS.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
          </select>
        </div>
        <p className="mb-2 rounded-lg border border-white/[.07] bg-white/[.025] px-3 py-2 text-[12px] text-tx2" role="status">
          {selectedPreset
            ? <>Starting from built-in template: <b className="text-cyan">{selectedPreset}</b>. You can edit it; this run will remain labeled as template-based.</>
            : <>Starting from <b className="text-cyan">your custom input</b>. This run will be labeled as a custom Story Mode scenario.</>}
        </p>
        <textarea rows={4} value={text} onChange={(e) => { setText(e.target.value); setSelectedPreset(""); }} className="!text-[15px]" aria-label="Scenario description"
          placeholder="NIFTY falls 15% over 10 trading days, the rupee depreciates by 4%, banking stocks experience elevated volatility, and crude oil increases 12%..." />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn btn-ghost ml-auto" onClick={() => parse()} disabled={text.trim().length < 3}><Wand2 size={15} />Parse text</button></div>
        {parsed && <div className="mt-3 rounded-xl border border-blue/25 bg-blue/5 p-3 text-[12.5px]"><b className="text-cyan">Interpreted as:</b> {parsed.found.length ? parsed.found.join(" · ") : "nothing recognised"}
          {parsed.warnings.map((w: string) => <div key={w} className="mt-1 text-warn">{w}</div>)}{parsed.validation_errors.map((w: string) => <div key={w} className="mt-1 text-down">{w}</div>)}
          {parsed.defaults_applied.horizon && <div className="mt-1 text-tx3">No horizon found — defaulting to 10 trading days (editable below).</div>}
          <div className="mt-1 text-tx3">Rule-based interpretation. Edit any value below before generating; new text is interpreted automatically when you generate.</div></div>}
      </GlassCard>
      <GlassCard title="2. Review scenario parameters" hint="Cumulative shocks over the horizon are probabilistic targets, not hard constraints. Leave a shock off to leave that asset unconstrained. USD/INR + means rupee depreciation.">
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{SHOCK_ASSETS.map((a) => { const v = d.shocks[a]; return (
          <div key={a}><div className="mb-1 flex items-center justify-between"><label className="text-[12.5px]">{a === "NIFTY" ? "NIFTY cumulative shock" : a === "USDINR" ? "USD/INR shock" : `${LABEL[a]} shock`}</label>
            <span className="flex items-center gap-2"><span className="num text-[12.5px] text-cyan">{v === undefined ? "free" : pct(v, 0)}</span>
              {v !== undefined && <button className="text-[11px] text-tx3 hover:text-down" onClick={() => setShock(a, undefined)}>clear</button>}</span></div>
            <input type="range" min={-0.4} max={a === "CRUDE" || a === "GOLD" ? 0.5 : 0.2} step={0.01} value={v ?? 0} onChange={(e) => setShock(a, +e.target.value)} aria-label={`${a} shock`} /></div>); })}</div>
        <div className="mt-5 grid gap-4 sm:grid-cols-4">
          <div><label className="lbl">Horizon (days)</label><select value={d.horizon} onChange={(e) => setD({ ...d, horizon: +e.target.value })}>{[5, 10, 15, 20].map((h) => <option key={h}>{h}</option>)}{![5, 10, 15, 20].includes(d.horizon) && <option>{d.horizon}</option>}</select></div>
          <div><label className="lbl">Volatility regime</label><select value={d.regime} onChange={(e) => setD({ ...d, regime: e.target.value })}><option value="">Unspecified (historical mix)</option><option value="normal">Normal</option><option value="elevated">Elevated</option><option value="extreme">Extreme</option></select></div>
          <div><label className="lbl">Scenarios (max 5,000)</label><select value={d.n} onChange={(e) => setD({ ...d, n: +e.target.value })}>{[1000, 2000, 5000].map((h) => <option key={h}>{h}</option>)}</select></div>
          <div><label className="lbl">Simulation model</label><select value={d.model} onChange={(e) => setD({ ...d, model: e.target.value })} disabled={modelsQuery.isLoading || modelsQuery.isError || models.length === 0}>
            {models.map((m) => <option key={m} value={m}>{MODEL_LABEL[m] ?? m}</option>)}
          </select></div></div>
        {modelsQuery.isError
          ? <p className="mt-3 text-[12px] text-down">Could not load available models: {(modelsQuery.error as Error).message}</p>
          : <p className="mt-3 text-[12px] text-tx3">{MODEL_DESCRIPTION[d.model] ?? ""} Every available model produces a saved run that appears in Scenario Explorer; the model changes the simulation method, not where the output is displayed.</p>}
        {Object.keys(d.shocks).some((k) => d.shocks[k] !== undefined) && <p className="mt-3 text-[12px] text-tx3">Targets condition a proposal distribution and guide kernel-weighted selection. Paths are not modified; outcomes are not guaranteed. If the requested move is outside model support, the report shows the proposal range and attainment diagnostics.</p>}
        <div className="mt-5 flex items-center gap-4"><button className="btn btn-primary" disabled={busy || modelsQuery.isLoading || modelsQuery.isError || models.length === 0} onClick={run}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}GENERATE SCENARIOS</button>
          {busy && <div className="flex-1"><div className="h-1.5 overflow-hidden rounded bg-white/10"><div className="h-full bg-gradient-to-r from-blue to-cyan transition-all" style={{ width: `${Math.max(5, (job?.progress ?? 0) * 100)}%` }} /></div>
            <div className="mt-1 text-[11.5px] text-tx3">{job ? `${job.status} · ${(job.progress * 100).toFixed(0)}%` : "submitting"}</div></div>}</div>
      </GlassCard>
      {err != null && <ErrorState error={err} />}
    </div>);
}
