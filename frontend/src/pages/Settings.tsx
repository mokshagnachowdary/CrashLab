import { useHealth } from "../api";
import { Disclaimer, GlassCard, PageIntro, Status } from "../components/ui";
import { DEFAULT_W, useApp } from "../store";

export default function Settings() {
  const h = useHealth(); const { setWeights, setV0, setSimId } = useApp();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageIntro
        title="Settings"
        description="Check service health, reset your local workspace, and review the platform disclaimer before you continue deeper analysis."
      />
      <GlassCard title="Service status"><div className="space-y-2"><Status state={h.data ? "ok" : h.isError ? "error" : "unknown"} label="API" /><Status state={h.data?.database === "ok" ? "ok" : h.data ? "error" : "unknown"} label="Database" />
        <Status state={h.data?.models_loaded ? "ok" : h.data ? "error" : "unknown"} label="Models" />{h.data?.models_error && <p className="text-down text-[12px]">{h.data.models_error}</p>}</div></GlassCard>
      <GlassCard title="Saved preferences" hint="Portfolio weights, value and selected simulation are kept in this browser only.">
        <button className="btn btn-ghost" onClick={() => { setWeights(DEFAULT_W); setV0(1_000_000); setSimId(undefined); }}>Reset to defaults</button></GlassCard>
      <GlassCard title="Disclaimer"><Disclaimer /></GlassCard>
    </div>);
}
