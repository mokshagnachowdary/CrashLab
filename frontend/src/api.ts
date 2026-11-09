import { useQuery } from "@tanstack/react-query";

export const ASSETS = ["NIFTY", "BANK", "IT", "GOLD", "CRUDE", "USDINR"] as const;
export const LABEL: Record<string, string> = { NIFTY: "NIFTY 50", BANK: "NIFTY Bank", IT: "NIFTY IT", GOLD: "Gold", CRUDE: "Crude Oil", USDINR: "USD/INR", PORTFOLIO: "Portfolio" };
export const MODEL_LABEL: Record<string, string> = { cvae: "Conditional VAE", fhs: "Filtered Hist. Sim.", t_copula: "Student-t Copula", gaussian_copula: "Gaussian Copula", gaussian: "Gaussian" };
const BASE = import.meta.env.VITE_API_URL ?? "";

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) {
    let d: any = r.statusText; try { d = (await r.json()).detail ?? d; } catch { /* non-JSON error body */ }
    throw new Error(Array.isArray(d) ? d.join("; ") : typeof d === "string" ? d : JSON.stringify(d));
  }
  return r.json();
}
export const post = <T = any,>(p: string, body: unknown) => api<T>(p, { method: "POST", body: JSON.stringify(body) });

export const useHealth = () => useQuery({ queryKey: ["health"], queryFn: () => api("/api/health"), refetchInterval: 20000 });
export const useOverview = () => useQuery({ queryKey: ["overview"], queryFn: () => api("/api/data/overview"), staleTime: 300000 });
export const useModels = () => useQuery({ queryKey: ["models"], queryFn: () => api("/api/models") });
export const useComparison = () => useQuery({ queryKey: ["cmp"], queryFn: () => api("/api/models/comparison") });
export const useResearch = () => useQuery({ queryKey: ["research"], queryFn: () => api("/api/research/metrics") });
export const useScenarios = () => useQuery({ queryKey: ["scenarios"], queryFn: () => api("/api/scenarios?limit=20"), refetchInterval: 8000 });
export const useScenario = (id?: string) => useQuery({ queryKey: ["scenario", id], queryFn: () => api(`/api/scenarios/${id}`), enabled: !!id,
  refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 600 : false) });
export const useBacktest = (m: string) => useQuery({ queryKey: ["bt", m], queryFn: () => api(`/api/backtesting/${m}`) });

export const pct = (x: number, d = 1) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";
export const pctU = (x: number, d = 1) => (x * 100).toFixed(d) + "%";
export const money = (x: number) => (Math.abs(x) >= 1e7 ? (x / 1e7).toFixed(2) + " Cr" : Math.abs(x) >= 1e5 ? (x / 1e5).toFixed(2) + " L" : x.toFixed(0));
