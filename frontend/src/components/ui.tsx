import { ReactNode, createContext, useCallback, useContext, useState } from "react";
import { AlertTriangle, Inbox, Info } from "lucide-react";

export const GlassCard = ({ title, hint, right, children, className = "" }: { title?: string; hint?: string; right?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`glass min-w-0 p-4 fade ${className}`}>
    {(title || right) && (
      <header className="mb-3 flex min-h-[2.5rem] min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1"><h3 className="text-[13px] font-semibold text-tx">{title}</h3>{hint && <p className="mt-0.5 text-[11.5px] leading-relaxed text-tx3">{hint}</p>}</div>{right && <div className="max-w-full min-w-0">{right}</div>}
      </header>)}
    {children}
  </section>
);

export const Metric = ({ label, value, sub, tone = "neutral", tip }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "neutral" | "bad" | "good" | "warn"; tip?: string }) => (
  <div className="glass p-3.5" title={tip}>
    <div className="lbl flex items-center gap-1">{label}{tip && <Info size={11} />}</div>
    <div className={`num mt-1.5 text-[22px] font-semibold ${tone === "bad" ? "text-down" : tone === "good" ? "text-up" : tone === "warn" ? "text-warn" : "text-tx"}`}>{value}</div>
    {sub && <div className="mt-0.5 text-[11.5px] text-tx2">{sub}</div>}
  </div>
);

export const Status = ({ state, label }: { state: "ok" | "error" | "unknown" | "warn"; label: string }) => (
  <span className="inline-flex items-center gap-2 text-[12.5px] text-tx2">
    <span className={`h-2 w-2 rounded-full ${state === "ok" ? "bg-up shadow-[0_0_8px_#35D39A]" : state === "error" ? "bg-down" : state === "warn" ? "bg-warn" : "bg-tx3"}`} />{label}
  </span>
);

export const Skeleton = ({ h = 120 }: { h?: number }) => <div className="skeleton w-full" style={{ height: h }} />;
export const Empty = ({ text, action }: { text: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center gap-3 py-10 text-center text-tx2"><Inbox size={26} className="text-tx3" /><p className="max-w-sm text-[13px]">{text}</p>{action}</div>);
export const ErrorState = ({ error }: { error: unknown }) => (
  <div className="flex items-start gap-3 rounded-xl border border-down/30 bg-down/5 p-4 text-[13px] text-down"><AlertTriangle size={18} className="mt-0.5 shrink-0" />
    <div><b>Request failed.</b> <span className="text-tx2">{String((error as Error)?.message ?? error)}</span></div></div>);

export const Disclaimer = () => (
  <p className="text-[11.5px] leading-relaxed text-tx3">Conditional, model-based simulation estimates — not predictions, not real-world probabilities, not investment advice. CrashLab executes no trades.</p>);

export const PageIntro = ({ title, description }: { title: string; description: string }) => (
  <header className="mb-2">
    <p className="lbl">CRASHLAB workspace</p>
    <h2 className="mt-1 text-2xl font-semibold tracking-tight text-tx">{title}</h2>
    <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-tx2">{description}</p>
  </header>
);

export const SyntheticBanner = ({ synthetic }: { synthetic?: boolean }) => synthetic ? (
  <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-[12.5px] text-warn"><b>SYNTHETIC DEVELOPMENT DATA.</b> The market data source was unreachable when models were trained, so every number here comes from a labelled synthetic generator — not historical market observations. Re-run the training pipeline with real data access to replace it.</div>) : null;

type Toast = { id: number; msg: string; kind: "ok" | "err" };
const Ctx = createContext<(m: string, k?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(Ctx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [ts, set] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random(); set((t) => [...t, { id, msg, kind }]); setTimeout(() => set((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (<Ctx.Provider value={push}>{children}
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">{ts.map((t) => (
      <div key={t.id} className={`glass fade max-w-sm px-4 py-3 text-[13px] ${t.kind === "err" ? "!border-down/50 text-down" : "text-tx"}`}>{t.msg}</div>))}</div></Ctx.Provider>);
}

export const Tabs = <T extends string>({ items, value, onChange, labels }: { items: readonly T[]; value: T; onChange: (v: T) => void; labels?: Record<string, string> }) => (
  <div className="flex flex-wrap gap-1.5">{items.map((i) => (
    <button key={i} onClick={() => onChange(i)} className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${value === i ? "bg-blue/20 text-cyan ring-1 ring-blue/50" : "text-tx2 hover:text-tx"}`}>{labels?.[i] ?? i}</button>))}</div>
);
