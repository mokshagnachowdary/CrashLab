"""Application state (loaded artifacts) and analytics helpers used by the API."""
from __future__ import annotations

import json
import pickle
import time
from pathlib import Path

import numpy as np
import pandas as pd

from . import risk
from .config import ARTIFACT_DIR, ASSETS, REGIMES, TRADING_DAYS
from .features import RegimeModel
from .models.cvae import CVAEModel

BANDS = [1, 5, 25, 50, 75, 95, 99]


class State:
    def __init__(self, art: Path = ARTIFACT_DIR):
        self.art = art
        self.ready = False
        self.error = None

    def load(self):
        try:
            self.manifest = json.loads((self.art / "manifest.json").read_text())
            self.results = json.loads((self.art / "research_results.json").read_text())
            self.returns = pd.read_csv(self.art / "returns.csv", index_col=0, parse_dates=True)
            self.models = pickle.loads((self.art / "baselines.pkl").read_bytes())
            self.models["cvae"] = CVAEModel.load(self.art / "cvae.pt")
            r = self.manifest["regime"]
            self.regime = RegimeModel(r["q_elevated"], r["q_extreme"])
            self.ref_sd = self.returns.iloc[: self.manifest["split"]["n_train"]].std().values
            fhs = self.models["fhs"]
            model_end = getattr(fhs, "n_fitted", len(fhs.Z))
            self.fhs_state = self.models["fhs"].filter_variance(
                self.returns.values[model_end - 1:model_end],
                fhs.state_var,
            )[-1]
            self.ready = True
        except Exception as e:  # surfaced via /api/health, never swallowed
            self.error = f"{type(e).__name__}: {e}"
        return self


def sim_summary(sim: np.ndarray, weights: dict | None = None) -> dict:
    n, h, N = sim.shape
    cum = np.concatenate([np.zeros((n, 1, N)), np.cumsum(sim, 1)], 1)
    simple = np.expm1(cum)
    bands = {a: {str(q): np.quantile(simple[:, :, j], q / 100, axis=0).round(5).tolist() for q in BANDS} for j, a in enumerate(ASSETS)}
    final = simple[:, -1, :]
    hist = {}
    for j, a in enumerate(ASSETS):
        c, e = np.histogram(final[:, j], bins=40)
        hist[a] = {"counts": c.tolist(), "edges": e.round(5).tolist()}
    corr = np.corrcoef(cum[:, -1, :].T).round(4).tolist()
    # joint lower-tail exceedance: P(asset j in own worst 5% | NIFTY in worst 5%), final-horizon
    lo = final <= np.quantile(final, .05, axis=0)
    jt = {a: float((lo[:, 0] & lo[:, j]).sum() / max(lo[:, 0].sum(), 1)) for j, a in enumerate(ASSETS)}
    worst_idx = np.argsort(final[:, 0])[:15]
    k = min(n, 40)
    return {"n": n, "horizon": h, "assets": ASSETS, "bands": bands, "final_hist": hist, "corr": corr,
            "joint_tail_given_nifty": jt,
            "worst_paths_nifty": {"idx": worst_idx.tolist(), "paths": {a: simple[worst_idx, :, j].round(5).tolist() for j, a in enumerate(ASSETS)}},
            "sample_paths": {a: simple[:k, :, j].round(5).tolist() for j, a in enumerate(ASSETS)}}


def stress(sim: np.ndarray, weights: dict, v0: float) -> dict:
    vals = risk.portfolio_values(sim, weights, v0)
    m = risk.risk_metrics(vals)
    loss = (v0 - vals[:, -1]) / v0
    c, e = np.histogram(loss, bins=50)
    bands = {str(q): (np.quantile(vals, q / 100, axis=0)).round(2).tolist() for q in BANDS}
    order = np.argsort(-loss)[:10]
    return {"metrics": m, "loss_hist": {"counts": c.tolist(), "edges": e.round(5).tolist()},
            "value_bands": bands, "contributions_es95": risk.loss_contributions(sim, weights, .95),
            "contributions_es99": risk.loss_contributions(sim, weights, .99),
            "worst_scenarios": [{"index": int(i), "loss_pct": float(loss[i]), "final_value": float(vals[i, -1])} for i in order],
            "disclaimer": "Conditional, model-based simulation estimates — not real-world probabilities or predictions."}


def data_overview(S: State) -> dict:
    R = S.returns
    rv = RegimeModel.rv(R)
    labels = S.regime.label(R)
    cur = int(labels[-1])
    latest = {}
    for a in ASSETS:
        rvol = float(R[a].tail(20).std() * np.sqrt(TRADING_DAYS))
        latest[a] = {"date": str(R.index[-1].date()), "daily_return": float(np.expm1(R[a].iloc[-1])),
                     "vol_20d_ann": rvol, "vol_percentile": float((R[a].rolling(20).std().dropna() <= R[a].tail(20).std()).mean())}
    cum = R.cumsum()
    dd = cum["NIFTY"] - cum["NIFTY"].cummax()
    stress_periods, in_dd, start = [], False, None
    # top drawdown episodes of NIFTY (peak-to-trough), labelled by data, not by event names
    peaks = (dd == 0)
    grp = peaks.cumsum()
    for _, g in dd.groupby(grp):
        if g.min() < -0.10: stress_periods.append({"start": str(g.index[0].date()), "trough": str(g.idxmin().date()), "depth": float(np.expm1(g.min()))})
    stress_periods = sorted(stress_periods, key=lambda x: x["depth"])[:6]
    step = max(1, len(R) // 400)
    return {"synthetic": S.manifest["synthetic"], "source": S.manifest["source"], "start": str(R.index[0].date()), "end": str(R.index[-1].date()),
            "n_obs": len(R), "latest": latest, "current_regime": REGIMES[cur], "regime_thresholds": S.manifest["regime"],
            "vol_series": {"dates": [str(d.date()) for d in R.index[::step]], **{a: (R[a].rolling(20).std() * np.sqrt(TRADING_DAYS)).fillna(0).iloc[::step].round(4).tolist() for a in ASSETS}},
            "nifty_drawdown": {"dates": [str(d.date()) for d in R.index[::step]], "dd": np.expm1(dd).iloc[::step].round(4).tolist()},
            "corr": R.corr().round(4).values.tolist(), "corr_recent_250": R.tail(250).corr().round(4).values.tolist(),
            "stress_periods": stress_periods, "quality": S.results["dataset"], "assets": ASSETS}
