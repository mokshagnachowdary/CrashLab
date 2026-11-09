import { ReactNode, createContext, useContext, useState } from "react";

export const DEFAULT_W: Record<string, number> = { NIFTY: 30, BANK: 20, IT: 15, GOLD: 15, CRUDE: 5, USDINR: 0, CASH: 15 };
type S = { simId?: string; setSimId: (s?: string) => void; weights: Record<string, number>; setWeights: (w: Record<string, number>) => void; v0: number; setV0: (v: number) => void };
const Ctx = createContext<S>(null as unknown as S);
export const useApp = () => useContext(Ctx);

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage may be blocked */ } };

export function AppProvider({ children }: { children: ReactNode }) {
  const [simId, _s] = useState<string | undefined>(() => read("cl.sim", undefined));
  const [weights, _w] = useState<Record<string, number>>(() => read("cl.w", DEFAULT_W));
  const [v0, _v] = useState<number>(() => read("cl.v0", 1_000_000));
  return <Ctx.Provider value={{ simId, setSimId: (s) => { _s(s); write("cl.sim", s); }, weights, setWeights: (w) => { _w(w); write("cl.w", w); }, v0, setV0: (v) => { _v(v); write("cl.v0", v); } }}>{children}</Ctx.Provider>;
}
