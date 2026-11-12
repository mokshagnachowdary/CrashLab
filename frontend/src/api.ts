import { useQuery } from "@tanstack/react-query";

export const ASSETS = ["NIFTY", "BANK", "IT", "GOLD", "CRUDE", "USDINR"] as const;
export const LABEL: Record<string, string> = { NIFTY: "NIFTY 50", BANK: "NIFTY Bank", IT: "NIFTY IT", GOLD: "Gold", CRUDE: "Crude Oil", USDINR: "USD/INR", PORTFOLIO: "Portfolio" };
export const MODEL_LABEL: Record<string, string> = { cvae: "Conditional VAE", fhs: "Filtered Hist. Sim.", t_copula: "Student-t Copula", gaussian_copula: "Gaussian Copula", gaussian: "Gaussian" };
const CONFIGURED_API_URL = (import.meta.env.VITE_API_URL ?? "").trim();
const API_ORIGIN = (CONFIGURED_API_URL || (import.meta.env.DEV ? "" : "https://crashlab-backend.onrender.com"))
  .replace(/\/+$/, "")
  .replace(/\/api$/i, "");
const REQUEST_TIMEOUT_MS = 30_000;

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_ORIGIN}${normalizedPath}`;
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) abortFromCaller();
  else init?.signal?.addEventListener("abort", abortFromCaller, { once: true });

  let r: Response;
  try {
    const headers = new Headers(init?.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    r = await fetch(apiUrl(path), { ...init, headers, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${path}`);
    if (error instanceof TypeError) {
      throw new Error(`Network error requesting ${path} at ${apiUrl(path)}. Check the API connection and CORS configuration.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abortFromCaller);
  }
  if (!r.ok) {
    const body = await r.text();
    let detail: unknown = body || r.statusText || "Request failed";
    if (body && r.headers.get("content-type")?.includes("application/json")) {
      try {
        const payload: unknown = JSON.parse(body);
        if (payload && typeof payload === "object" && "detail" in payload) {
          detail = payload.detail;
        } else if (payload && typeof payload === "object" && "message" in payload) {
          detail = payload.message;
        } else {
          detail = payload;
        }
      } catch {
        detail = body;
      }
    }
    const message = typeof detail === "string" ? detail : JSON.stringify(detail);
    const readableMessage = message.length > 500 ? `${message.slice(0, 500)}…` : message;
    throw new Error(`HTTP ${r.status}${r.statusText ? ` ${r.statusText}` : ""}: ${readableMessage}`);
  }
  return r.json();
}
export const post = <T = any,>(p: string, body: unknown) => api<T>(p, { method: "POST", body: JSON.stringify(body) });

export const useHealth = () => useQuery({ queryKey: ["health"], queryFn: () => api("/api/health"), refetchInterval: 20000 });
export const useOverview = () => useQuery({ queryKey: ["overview"], queryFn: () => api("/api/data/overview"), staleTime: 300000 });
export const useModels = () => useQuery({ queryKey: ["models"], queryFn: () => api("/api/models") });
export const useComparison = () => useQuery({ queryKey: ["cmp"], queryFn: () => api("/api/models/comparison") });
export const useResearch = () => useQuery({ queryKey: ["research"], queryFn: () => api("/api/research/metrics") });
export const useScenarios = () => useQuery({ queryKey: ["scenarios"], queryFn: () => api("/api/scenarios?limit=100"), refetchInterval: 8000 });
export const useScenario = (id?: string) => useQuery({ queryKey: ["scenario", id], queryFn: () => api(`/api/scenarios/${id}`), enabled: !!id,
  refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 600 : false) });
export const useBacktest = (m: string) => useQuery({ queryKey: ["bt", m], queryFn: () => api(`/api/backtesting/${m}`) });

export const pct = (x: number, d = 1) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";
export const pctU = (x: number, d = 1) => (x * 100).toFixed(d) + "%";
export const money = (x: number) => (Math.abs(x) >= 1e7 ? (x / 1e7).toFixed(2) + " Cr" : Math.abs(x) >= 1e5 ? (x / 1e5).toFixed(2) + " L" : x.toFixed(0));
