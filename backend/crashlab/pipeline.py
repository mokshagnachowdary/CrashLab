"""Train all models on the chronological TRAIN(+VAL) split, evaluate out-of-sample on TEST, write artifacts."""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

from . import backtest, risk
from .config import ARTIFACT_DIR, ASSETS, TRAIN_FRAC, VAL_FRAC
from .data import Dataset, load_dataset, split_indices
from .features import RegimeModel
from .models.copula import CopulaModel, GaussianModel
from .models.cvae import CVAEConfig, CVAEModel
from .models.fhs import FHSModel
from .scenarios import ScenarioSpec, constraint_report, generate

log = logging.getLogger(__name__)
H_EVAL = 10
EQ_W = {"NIFTY": .3, "BANK": .2, "IT": .15, "GOLD": .15, "CRUDE": .05, "CASH": .15}


def _lower_tail_dep(a, b, q=0.05):
    ta, tb = a <= np.quantile(a, q), b <= np.quantile(b, q)
    return float((ta & tb).sum() / max(ta.sum(), 1))


def distribution_metrics(real_paths: np.ndarray, sim: np.ndarray) -> dict:
    """real_paths/sim: (n,h,N). Cumulative-horizon and daily-pooled comparisons."""
    rc, sc = real_paths.sum(1), sim.sum(1)
    sd = rc.std(0)
    out = {"wasserstein_sd": {}, "ks": {}, "tail_dep_lower_q05": {}, "es95_cum": {}}
    for j, a in enumerate(ASSETS):
        out["wasserstein_sd"][a] = float(stats.wasserstein_distance(rc[:, j], sc[:, j]) / sd[j])
        out["ks"][a] = float(stats.ks_2samp(rc[:, j], sc[:, j]).statistic)
        out["es95_cum"][a] = {"real": float(-np.quantile(rc[:, j], .05) if False else -rc[:, j][rc[:, j] <= np.quantile(rc[:, j], .05)].mean()),
                              "model": float(-sc[:, j][sc[:, j] <= np.quantile(sc[:, j], .05)].mean())}
    Rr, Rs = np.corrcoef(rc.T), np.corrcoef(sc.T)
    out["corr_frobenius"] = float(np.linalg.norm(Rr - Rs) / np.sqrt(Rr.size))
    dr, ds = real_paths.reshape(-1, real_paths.shape[-1]), sim.reshape(-1, sim.shape[-1])
    for pair in [("NIFTY", "BANK"), ("NIFTY", "IT"), ("NIFTY", "CRUDE")]:
        i, j = ASSETS.index(pair[0]), ASSETS.index(pair[1])
        out["tail_dep_lower_q05"]["-".join(pair)] = {"real": _lower_tail_dep(dr[:, i], dr[:, j]),
                                                     "model": _lower_tail_dep(ds[:, i], ds[:, j])}
    i, k = ASSETS.index("NIFTY"), ASSETS.index("USDINR")
    jr = ((dr[:, i] <= np.quantile(dr[:, i], .05)) & (dr[:, k] >= np.quantile(dr[:, k], .95))).mean()
    js = ((ds[:, i] <= np.quantile(ds[:, i], .05)) & (ds[:, k] >= np.quantile(ds[:, k], .95))).mean()
    out["joint_exceed_nifty_down_inr_weak"] = {"real": float(jr), "model": float(js), "independence_baseline": 0.0025}
    sq = lambda x: np.mean([stats.pearsonr(p[:-1, 0] ** 2, p[1:, 0] ** 2)[0] for p in x[:300]])
    out["vol_clustering_acf1_sq_nifty"] = {"real": float(sq(real_paths)), "model": float(sq(sim))}
    out["wasserstein_mean"] = float(np.mean(list(out["wasserstein_sd"].values())))
    return out


def test_windows(R: np.ndarray, lo: int, hi: int, h: int, step: int = 1):
    return np.array([R[s:s + h] for s in range(lo, hi - h + 1, step)])


def var_backtest(models: dict, ds: Dataset, regimes, n_val_end: int, h=5, alpha=(0.95, 0.99), n_paths=1500):
    """Non-overlapping h-day-horizon backtest of an exposure-weighted portfolio on the TEST period."""
    R = ds.returns.values
    w = EQ_W
    res = {}
    starts = list(range(n_val_end, len(R) - h, h))
    real_loss = np.array([-(risk.portfolio_values(R[s:s + h][None], w)[0, -1] / 1e6 - 1) for s in starts])
    for name, m in models.items():
        var = {a: [] for a in alpha}; es = {a: [] for a in alpha}; samples = []
        fhs_state = None
        if name == "fhs": fhs_state = m.filter_variance(R[:n_val_end])  # variance filtered through train+val
        for k, s in enumerate(starts):
            kw = {}
            if name == "fhs":
                if k > 0: fhs_state = m.filter_variance(R[starts[k - 1]:s], fhs_state[-1] if len(fhs_state) else None)
                else: fhs_state = fhs_state
                kw["init_var"] = fhs_state[-1]
            reg = int(regimes[s - 1]) if name == "cvae" else None
            sim = m.simulate(n_paths, h, 1000 + k, reg, None, **kw)
            loss = -(risk.portfolio_values(sim, w)[:, -1] / 1e6 - 1)
            samples.append(loss[:400])
            for a in alpha:
                v, e = risk.var_es(loss, a); var[a].append(v); es[a].append(e)
        res[name] = {}
        for a in alpha:
            v, e = np.array(var[a]), np.array(es[a])
            exc = real_loss >= v
            res[name][str(a)] = {"kupiec": backtest.kupiec_pof(exc, 1 - a), "christoffersen": backtest.christoffersen(exc, 1 - a),
                                 "acerbi_szekely": backtest.acerbi_szekely_z2(real_loss, v, e, a, np.array(samples), n_mc=1000)}
    return {"horizon_days": h, "n_windows": len(starts), "portfolio": w,
            "note": "Non-overlapping windows; small samples => low power, especially at 99%.", "results": res}


def constraint_test(models: dict, ref_sd, h=H_EVAL, n=1000):
    spec = ScenarioSpec(horizon=h, n=n, regime="extreme", shocks={"NIFTY": -0.12, "USDINR": 0.03}, seed=5)
    out = {}
    for name, m in models.items():
        g = generate(m, spec, ref_sd)
        out[name] = {"conditioning": g["meta"]["conditioning"], "report": g["meta"]["constraint_report"]}
    return out


def run(quick: bool = False, out_dir: Path = ARTIFACT_DIR, allow_synthetic: bool = True, skip_ablations: bool = False) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    t_all = time.time()
    ds = load_dataset(allow_synthetic=allow_synthetic)
    R = ds.returns
    n_tr, n_va = split_indices(len(R), TRAIN_FRAC, VAL_FRAC)
    reg_model = RegimeModel.fit(R.iloc[:n_tr])
    regimes = reg_model.label(R)
    train_end = n_va  # baselines and final models use TRAIN+VAL; test untouched
    ref_sd = R.iloc[:n_tr].std().values
    epochs = 25 if quick else 120
    cfg = CVAEConfig(epochs=epochs, warmup=min(30, epochs // 3))

    meta = {"dataset": ds.quality, "split": {"n_train": n_tr, "n_val": n_va - n_tr, "n_test": len(R) - n_va,
            "test_start": str(R.index[n_va].date())}, "regime_model": reg_model.to_dict()}
    models = {"gaussian": GaussianModel().fit(R.iloc[:n_va]),
              "gaussian_copula": CopulaModel("gaussian").fit(R.iloc[:n_va]),
              "t_copula": CopulaModel("t").fit(R.iloc[:n_va]),
              "fhs": FHSModel().fit(R.iloc[:n_va], regimes=regimes[:n_va])}
    meta["t_copula_nu"] = models["t_copula"].nu
    meta["fhs_diagnostics"] = models["fhs"].diagnostics
    log.info("baselines fitted")

    # cVAE: early stopping on VAL (train only on TRAIN); the final model keeps the VAL-selected checkpoint
    cv = CVAEModel(cfg).fit(R, regimes, n_tr, n_va)
    cv.save(out_dir / "cvae.pt")
    models["cvae"] = cv
    meta["cvae"] = {"config": cfg.__dict__ | {"horizons": list(cfg.horizons)}, "history": cv.history, "train_seconds": cv.train_seconds,
                    "best_val_loss": cv.best_val_loss, "n_windows": cv.n_windows, "params": sum(p.numel() for p in cv.net.parameters())}
    log.info("cvae trained in %.0fs", cv.train_seconds)

    # out-of-sample distribution comparison (TEST windows only)
    real = test_windows(R.values, n_va, len(R), H_EVAL)
    comp = {}
    for name, m in models.items():
        init = {"init_var": m.filter_variance(R.values[:n_va])[-1]} if name == "fhs" else {}
        sim = m.simulate(len(real), H_EVAL, 99, None, None, **init)
        comp[name] = distribution_metrics(real, sim)
    meta["oos_comparison"] = {"horizon_days": H_EVAL, "n_real_windows_overlapping": len(real),
                              "note": "Real windows overlap (stride 1): effective sample is ~n/h. Models unconditional.", "metrics": comp}
    meta["constraint_satisfaction"] = constraint_test(models, ref_sd)
    log.info("running constraint test + VaR backtests (a few minutes) ...")
    meta["backtest"] = var_backtest(models, ds, regimes, n_va, h=5, n_paths=800 if quick else 1500)

    import pickle

    def save():
        meta["runtime_seconds"] = time.time() - t_all
        (out_dir / "research_results.json").write_text(json.dumps(meta, indent=1, default=float))
        ds.returns.to_csv(out_dir / "returns.csv")
        json.dump({"regime": reg_model.to_dict(), "split": meta["split"], "source": ds.source, "synthetic": ds.synthetic},
                  open(out_dir / "manifest.json", "w"), indent=1)
        pickle.dump({k: v for k, v in models.items() if k != "cvae"}, open(out_dir / "baselines.pkl", "wb"))

    save()  # everything except ablations is now on disk, so a later interruption loses nothing
    log.info("core results saved to %s", out_dir)

    if not quick and not skip_ablations:  # ablations (validation loss + OOS Wasserstein); saved after EACH variant
        abl = meta["ablations"] = []
        meta["ablation_note"] = ("Validation losses are not comparable between tail_aware and the Gaussian-likelihood variants "
                                 "(different objectives); compare OOS metrics.")
        variants = [("cVAE (reference)", {}), ("standard VAE (no conditioning)", {"conditional": False}),
                    ("tail-aware (Student-t likelihood)", {"tail_aware": True})] + [(f"latent={L}", {"latent": L}) for L in (2, 4, 16)]
        for i, (label, kw) in enumerate(variants, 1):
            log.info("ablation %d/%d: %s ...", i, len(variants), label)
            c = CVAEConfig(**{**cfg.__dict__, **kw})
            m = CVAEModel(c).fit(R, regimes, n_tr, n_va)
            dm = distribution_metrics(real, m.simulate(len(real), H_EVAL, 99))
            abl.append({"variant": label, "best_val_loss": m.best_val_loss, "epochs_run": len(m.history),
                        "oos_wasserstein_mean": dm["wasserstein_mean"], "oos_corr_frobenius": dm["corr_frobenius"],
                        "oos_tail_dep_nifty_bank": dm["tail_dep_lower_q05"]["NIFTY-BANK"]["model"], "train_seconds": m.train_seconds})
            save(); log.info("ablation %d/%d done in %.0fs", i, len(variants), m.train_seconds)
    return meta


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser(); ap.add_argument("--quick", action="store_true")
    ap.add_argument("--no-synthetic", action="store_true")
    ap.add_argument("--skip-ablations", action="store_true")
    a = ap.parse_args()
    m = run(a.quick, allow_synthetic=not a.no_synthetic, skip_ablations=a.skip_ablations)
    print("done", m["runtime_seconds"])
