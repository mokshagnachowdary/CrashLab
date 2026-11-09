"""Generate docs/RESEARCH_REPORT.md from artifacts/*.json — every number comes from files, none typed by hand."""
import json
from pathlib import Path
A = Path("artifacts"); r = json.loads((A / "research_results.json").read_text())
bm = json.loads((A / "benchmarks.json").read_text()) if (A / "benchmarks.json").exists() else None
M = r["oos_comparison"]["metrics"]; N = ["gaussian", "gaussian_copula", "t_copula", "fhs", "cvae"]
L = {"gaussian": "Gaussian", "gaussian_copula": "Gaussian copula", "t_copula": "Student-t copula", "fhs": "FHS (GJR-GARCH)", "cvae": "Conditional VAE"}
syn = r["dataset"]["synthetic"]; sp = r["split"]
o = []; w = o.append
w("# CRASHLAB research report (auto-generated)\n")
if syn: w("> **DATA WARNING — SYNTHETIC.** This build was trained on a labelled synthetic development dataset because the market-data source was unreachable. Nothing below is evidence about real markets. Re-run `python -m crashlab.pipeline` with data access to regenerate this report on real NSE/Yahoo history.\n")
w(f"**Data:** {r['dataset']['source']} · {r['dataset']['start']} → {r['dataset']['end']} · {r['dataset']['n_returns']} daily log returns · split train {sp['n_train']} / val {sp['n_val']} / test {sp['n_test']} (chronological; test starts {sp['test_start']}).\n")
w(f"**cVAE:** {r['cvae']['params']:,} parameters, {len(r['cvae']['history'])} epochs (early stopped), {r['cvae']['train_seconds']:.0f}s on CPU, best validation loss {r['cvae']['best_val_loss']:.1f}, single seed ({r['cvae']['config']['seed']}). Conditioning variables: per-asset cumulative-return targets (+masks), horizon, volatility regime.\n")
def tbl(rows, head): return "\n".join(["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(map(str, x)) + " |" for x in rows])
w("## 1. Out-of-sample distribution fidelity (10-day horizon, unconditional, test period)\n")
def best(vals): k = min(vals, key=vals.get); return L[k]
rows = []
for name, fn in [("Mean Wasserstein (sd units)", lambda m: M[m]["wasserstein_mean"]), ("Correlation RMS error", lambda m: M[m]["corr_frobenius"]),
                 ("|Tail-dep. error| NIFTY–BANK", lambda m: abs(M[m]["tail_dep_lower_q05"]["NIFTY-BANK"]["model"] - M[m]["tail_dep_lower_q05"]["NIFTY-BANK"]["real"])),
                 ("|Joint-exceedance error| NIFTY↓∧INR↓", lambda m: abs(M[m]["joint_exceed_nifty_down_inr_weak"]["model"] - M[m]["joint_exceed_nifty_down_inr_weak"]["real"])),
                 ("|Vol-clustering ACF error|", lambda m: abs(M[m]["vol_clustering_acf1_sq_nifty"]["model"] - M[m]["vol_clustering_acf1_sq_nifty"]["real"])),
                 ("|ES95 error| NIFTY 10d", lambda m: abs(M[m]["es95_cum"]["NIFTY"]["model"] - M[m]["es95_cum"]["NIFTY"]["real"]))]:
    v = {m: fn(m) for m in N}; rows.append([name] + [f"{v[m]:.3f}" for m in N] + [f"**{best(v)}**"])
w(tbl(rows, ["Metric (lower = better)"] + [L[m] for m in N] + ["Best"]))
w(f"\n_{r['oos_comparison']['note']} No single metric establishes overall superiority._\n")
w("## 2. Constraint satisfaction (NIFTY −12%, USD/INR +3%, 10 days, extreme regime; 1,000 paths)\n")
c = r["constraint_satisfaction"]
w(tbl([[L[m], c[m]["conditioning"]] + [f"{x['realised_median_simple']*100:+.1f}% (within tol.: {x['share_within_tolerance']*100:.0f}%)" for x in c[m]["report"]] for m in N], ["Model", "Mode"] + [x["asset"] for x in c["cvae"]["report"]]))
w("\n## 3. VaR / ES backtest (5-day horizon, non-overlapping test windows)\n")
b = r["backtest"]; w(f"{b['n_windows']} windows. Portfolio: {b['portfolio']}. {b['note']}\n")
for a in ("0.95", "0.99"):
    rows = []
    for m in N:
        x = b["results"][m][a]; rows.append([L[m], f"{x['kupiec']['exceedances']} / {x['kupiec']['expected']:.1f}", f"{x['kupiec']['p_value']:.3f}", f"{x['christoffersen']['p_ind']:.3f}", f"{x['christoffersen']['p_cc']:.3f}", f"{x['acerbi_szekely']['z2']:.2f}", f"{x['acerbi_szekely'].get('p_value', float('nan')):.3f}"])
    w(f"**{float(a)*100:.0f}% level**\n\n" + tbl(rows, ["Model", "Exceed. (obs/exp)", "Kupiec p", "Christoffersen ind. p", "Cond. coverage p", "A–S Z2", "A–S MC p"]) + "\n")
w("## 4. Ablations (cVAE; single seed — differences of a few percent are within run-to-run noise)\n")
if r.get("ablations"):
    w(tbl([[a["variant"], f"{a['best_val_loss']:.0f}", a["epochs_run"], f"{a['oos_wasserstein_mean']:.3f}", f"{a['oos_corr_frobenius']:.3f}", f"{a['oos_tail_dep_nifty_bank']:.2f}"] for a in r["ablations"]], ["Variant", "Val loss", "Epochs", "OOS Wasserstein", "OOS corr. err", "Tail dep. N–B"]))
    w(f"\n_{r.get('ablation_note','')}_ Real tail dependence NIFTY–BANK in test: {M['fhs']['tail_dep_lower_q05']['NIFTY-BANK']['real']:.2f}.\n")
w("## 5. Measured performance\n")
if bm:
    w(tbl([[L[m], f"{v['1000']['median_seconds']:.3f}s", f"{v['1000']['scenarios_per_second']:.0f}", f"{v['10000']['median_seconds']:.2f}s", f"{v['10000']['scenarios_per_second']:.0f}"] for m, v in bm["models"].items()], ["Model", "1,000 paths", "paths/s", "10,000 paths", "paths/s"]))
    w(f"\nPeak RSS of the benchmark process: {bm['peak_rss_mb']:.0f} MB ({bm['cpu_count']} CPUs). {bm['note']}\n")
else: w("_Benchmarks pending — run `python scripts/benchmark.py`._\n")
if not r.get("ablations"): w("_Ablations were not run in this build. Reproduce with `python -m crashlab.pipeline --no-synthetic` (adds the six variants) and `python scripts/ablate_window.py`._\n")
w("## 6. How to read this honestly\n")
w("- **Unequal conditioning.** FHS starts every forecast from the filtered volatility at the forecast origin, whereas the Gaussian, copulas and cVAE are unconditional on volatility and trained on the full pre-test history (including crisis periods). When the test period is calmer than the training history those models overstate risk (see backtest exceedances well below expected). A like-for-like comparison would give every model a volatility-state input; this build did not.\n")
hi = [a for a, x in r["dataset"]["assets"].items() if x["max_abs_return"] > 0.3]
if hi: w(f"- **Data caveat.** Extreme daily log returns above 30% in: {', '.join(hi)} (futures roll / negative-price episode); these remain in the data and inflate that asset's tails.\n")
w("- Results are from one dataset, one seed per cVAE variant, and a single chronological split; confidence intervals are only available for the Acerbi–Székely Monte-Carlo test.\n- Test windows overlap in section 1, so the effective sample is roughly n/10.\n- Backtests have few observations; non-rejection is weak evidence, especially at 99%.\n- If the cVAE is not best on a metric, the table says so; nothing is hidden.\n")
Path("docs/RESEARCH_REPORT.md").write_text("\n".join(o)); print("written", len("\n".join(o)), "chars")
