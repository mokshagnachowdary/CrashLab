import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
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
  const parseRequest = useRef(0);
  const [d, setD] = useState<Draft>({ shocks: {}, horizon: 10, regime: "", n: 1000, model: "cvae" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [job, setJob] = useState<any>(null);
  const modelsQuery = useQuery({ queryKey: ["models"], queryFn: () => api("/api/models") });
  const models: string[] = modelsQuery.data?.models?.map((model: any) => model.id) ?? [];

  const parse = useCallback(async (t: string) => {
    const requestId = ++parseRequest.current;
    setErr(null); setParsing(true);
    try {
      const p = await post("/api/scenarios/parse", { text: t });
      if (requestId !== parseRequest.current) return;
      setParsed(p); setLastParsed(t);
      setD((x) => ({ ...x, shocks: Object.fromEntries(Object.entries(p.shocks)), horizon: p.horizon ?? x.horizon, regime: p.regime ?? "" }));
      return p;
    } catch (e) {
      if (requestId === parseRequest.current) { setErr(e); toast(String((e as Error).message), "err"); }
    } finally {
      if (requestId === parseRequest.current) setParsing(false);
    }
  }, [toast]);
  useEffect(() => {
    if (text.trim().length < 3) {
      parseRequest.current += 1;
      setParsing(false);
      setParsed(null);
      setLastParsed("");
      return;
    }
    const timer = window.setTimeout(() => { void parse(text); }, 400);
    return () => window.clearTimeout(timer);
  }, [parse, text]);
  const run = async () => {
    setErr(null);
    const draft = d;
    const validationErrors = lastParsed === text ? (parsed?.validation_errors ?? []) : [];
    if (text.trim() && lastParsed !== text) return;
    if (text.trim() && !parsed?.found?.length && !manualTargetsSet) {
      setErr(new Error("CrashLab couldn't identify a market move. Rewrite the description or add a target in Settings (optional)."));
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
  const manualTargetsSet = Object.values(d.shocks).some((value) => value !== undefined);
  const understoodTargets = parsed?.shocks
    ? Object.entries(parsed.shocks).map(([asset, value]) => {
      const move = value as number;
      if (asset === "USDINR") return `rupee ${move >= 0 ? "weakens" : "strengthens"} ${Math.abs(move * 100).toFixed(0)}%`;
      return `${LABEL[asset] ?? asset} ${move >= 0 ? "rises" : "falls"} ${Math.abs(move * 100).toFixed(0)}%`;
    }).join(" · ")
    : "";
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageIntro
        title="Story Mode"
        description="Describe a market shock in plain English and turn it into a structured scenario for simulation and risk analysis."
      />
      <SyntheticBanner synthetic={ov.data?.synthetic} />
      <GlassCard title="What should happen to the market?">
        <p className="mb-2 text-[12px] text-tx2">Write a sentence, or start with an example. You can change anything before running it.</p>
        <textarea id="scenario-description" rows={3} disabled={busy} value={text} onChange={(e) => { setText(e.target.value); setSelectedPreset(""); setErr(null); }}
          className="!text-[15px]" aria-label="Scenario description"
          placeholder="For example: NIFTY falls 10% over 10 days and the rupee weakens 3%." />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[10.5px] text-tx3">Try:</span>
          {PRESETS.slice(0, 4).map((preset) => <button key={preset.name} type="button" disabled={busy}
            className={`rounded-full border px-3 py-1 text-[11px] transition ${selectedPreset === preset.name ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-white/[.1] text-tx2 hover:border-white/30"}`}
            onClick={() => { setSelectedPreset(preset.name); setText(preset.text); setParsed(null); setLastParsed(""); setD((x) => ({ ...x, shocks: {}, horizon: 10, regime: "" })); setErr(null); }}>
            {preset.name}
          </button>)}
          {selectedPreset && <button type="button" className="text-[11px] text-tx3 underline" onClick={() => { setSelectedPreset(""); setText(""); setParsed(null); setLastParsed(""); setD((x) => ({ ...x, shocks: {}, horizon: 10, regime: "" })); }}>Clear</button>}
        </div>
        <div className="mt-3 min-h-8 text-[12px]" aria-live="polite">
          {parsing && <span className="text-tx3">Checking your description…</span>}
          {!parsing && parsed && lastParsed === text && parsed.found.length > 0 && <div className="rounded-lg border border-white/[.08] bg-white/[.025] px-3 py-2">
            <b className="text-tx">We’ll explore:</b>{" "}
            {Object.entries(parsed.shocks).length
              ? understoodTargets
              : "a range of market outcomes"}
            {parsed.warnings.length > 0 && <span className="ml-1 text-warn">{parsed.warnings[0]}</span>}
            <span className="ml-1 text-tx3"> over {parsed.horizon ?? d.horizon} days.</span>
          </div>}
          {!parsing && text.trim().length >= 3 && lastParsed === text && !parsed?.found?.length && <p className="text-warn">I couldn’t find a clear market move. Try “NIFTY falls 10% over 10 days” or open settings to enter a target.</p>}
        </div>
      </GlassCard>
      <details className="rounded-xl border border-white/[.08] bg-white/[.025] px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between text-[12px] font-medium">Settings (optional)<ChevronDown size={14} /></summary>
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
        <div className="mt-4 border-t border-white/[.08] pt-3">
          <p className="text-[11.5px] text-tx3">Advanced</p>
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
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" disabled={busy || parsing || (text.trim().length > 0 && (lastParsed !== text || (!parsed?.found?.length && !manualTargetsSet))) || modelsQuery.isLoading || modelsQuery.isError || models.length === 0} onClick={run}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? "Creating…" : "Create scenario"}
          </button>
          <span className="text-[10.5px] text-tx3">1,000 simulated possibilities · usually a few seconds</span>
          {busy && <div className="min-w-[220px] flex-1"><div className="h-1.5 overflow-hidden rounded bg-white/10"><div className="h-full bg-gradient-to-r from-blue to-cyan transition-all" style={{ width: `${Math.max(5, (job?.progress ?? 0) * 100)}%` }} /></div>
            <div className="mt-1 text-[11.5px] text-tx3">{job ? `Creating: ${job.status} · ${(job.progress * 100).toFixed(0)}%` : "Starting simulation…"}</div></div>}
      </div>
      {err != null && <ErrorState error={err} />}
    </div>);
}
