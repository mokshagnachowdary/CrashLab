import { useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Activity, Database, FlaskConical, LayoutDashboard, Menu, PanelLeftClose, PanelLeftOpen, PenLine, Settings as Cog, ShieldAlert, Telescope, UserRound, X } from "lucide-react";
import { useHealth, useOverview } from "./api";
import { Status } from "./components/ui";
import Overview from "./pages/Overview";
import Story from "./pages/Story";
import Explorer from "./pages/Explorer";
import Portfolio from "./pages/Portfolio";
import ModelLab from "./pages/ModelLab";
import DataResearch from "./pages/DataResearch";
import Settings from "./pages/Settings";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, title: "Overview", desc: "System, data and latest simulation at a glance" },
  { to: "/story", label: "Story Mode", icon: PenLine, title: "Story Mode", desc: "Describe a hypothetical crisis and generate scenarios" },
  { to: "/explorer", label: "Scenario Explorer", icon: Telescope, title: "Scenario Explorer", desc: "Fan charts and distributions from generated simulations" },
  { to: "/portfolio", label: "Portfolio Risk", icon: ShieldAlert, title: "Portfolio Risk", desc: "Stress-test a portfolio on the generated scenarios" },
  { to: "/models", label: "Model Lab", icon: FlaskConical, title: "Model Lab", desc: "Out-of-sample benchmark of all four generators" },
  { to: "/research", label: "Data & Research", icon: Database, title: "Data & Research", desc: "Data coverage, quality, methodology and limitations" },
  { to: "/settings", label: "Settings", icon: Cog, title: "Settings", desc: "Service status and preferences" },
];

export default function App() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => { try { return localStorage.getItem("cl.collapsed") === "1"; } catch { return false; } });
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("cl.collapsed", c ? "0" : "1"); } catch { /* ignore */ } return !c; });
  const loc = useLocation();
  const cur = NAV.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to))) ?? NAV[0];
  const health = useHealth(); const ov = useOverview();
  const sidebar = (col: boolean) => (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className={`mb-4 flex items-center gap-3 px-1.5 py-2 ${col ? "justify-center" : ""}`}><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan/20 bg-cyan/5 text-cyan"><Activity size={19} /></div>
        {!col && <div className="font-semibold tracking-wide">CRASH<span className="text-cyan">LAB</span></div>}</div>
      {NAV.filter((n) => n.to !== "/settings").map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === "/"} title={n.label} onClick={() => setOpen(false)} className={({ isActive }) => `group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12px] transition ${col ? "justify-center" : ""} ${isActive ? "bg-gradient-to-r from-cyan/10 to-purple/10 text-tx ring-1 ring-cyan/15" : "text-tx2 hover:bg-white/[.03] hover:text-tx"}`}>
          {({ isActive }) => (<><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${isActive ? "bg-cyan/10 text-cyan" : "group-hover:text-cyan"}`}><n.icon size={16} /></span>{!col && n.label}</>)}
        </NavLink>))}
      <div className="mt-auto space-y-2">
        <button onClick={toggle} className={`hidden w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12px] text-tx3 transition hover:text-tx lg:flex ${col ? "justify-center" : ""}`} title={col ? "Expand sidebar" : "Collapse sidebar"}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center">{col ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</span>{!col && "Collapse"}</button>
        <NavLink to="/settings" onClick={() => setOpen(false)} title="Settings & profile" className={`flex items-center gap-2.5 rounded-lg border border-white/[.07] bg-white/[.025] p-2 transition hover:border-cyan/25 ${col ? "justify-center" : ""}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-cyan"><UserRound size={15} /></span>
          {!col && <span className="min-w-0"><span className="block truncate text-[12.5px] font-medium">Research workspace</span><span className="block truncate text-[10.5px] text-tx3">Settings · not investment advice</span></span>}</NavLink>
      </div>
    </nav>);
  return (
    <div className="flex min-h-screen">
      <aside style={{ width: collapsed ? 76 : 220 }} className="sticky top-0 hidden h-screen shrink-0 border-r border-white/[.07] bg-bg2 transition-[width] duration-200 lg:block">{sidebar(collapsed)}</aside>
      {open && <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={() => setOpen(false)}><aside className="h-full w-[250px] border-r border-white/10 bg-bg2" onClick={(e) => e.stopPropagation()}>{sidebar(false)}</aside></div>}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/[.07] bg-bg/95 px-4 py-2.5 lg:px-6">
          <button className="btn btn-ghost !p-2 lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">{open ? <X size={18} /> : <Menu size={18} />}</button>
          <div className="min-w-0 flex-1"><h1 className="truncate text-[17px] font-semibold">{cur.title}</h1><p className="hidden truncate text-[12px] text-tx3 sm:block">{cur.desc}</p></div>
          <div className="hidden flex-col items-end gap-0.5 md:flex">
            <Status state={ov.data ? (ov.data.synthetic ? "warn" : "ok") : ov.isError ? "error" : "unknown"} label={ov.data ? (ov.data.synthetic ? "Synthetic dev data" : `Data: ${ov.data.source}`) : "Data status"} />
            <span className="text-[11px] text-tx3">{ov.data ? `Last observation ${ov.data.end}` : "—"}</span></div>
          <Status state={health.data ? (health.data.models_loaded && health.data.database === "ok" ? "ok" : "warn") : health.isError ? "error" : "unknown"} label="API" />
          <NavLink to="/settings" title="Settings" className="btn btn-ghost !p-2"><Cog size={16} /></NavLink>
        </header>
        <main className="mx-auto max-w-[1440px] p-4 lg:p-6">
          <Routes><Route path="/" element={<Overview />} /><Route path="/story" element={<Story />} /><Route path="/explorer" element={<Explorer />} />
            <Route path="/portfolio" element={<Portfolio />} /><Route path="/models" element={<ModelLab />} /><Route path="/research" element={<DataResearch />} /><Route path="/settings" element={<Settings />} /></Routes>
        </main>
      </div>
    </div>);
}
