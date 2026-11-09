"""Portfolio valuation and risk metrics computed from simulated paths.

Conventions: buy-and-hold (no rebalancing) over the horizon. Asset i value_t = V0*w_i*exp(cumulative log return).
CASH earns 0. Weights sum to 1 (net); negatives are short exposures and require allow_short=True
(a short's simple P&L is -(exp(cum)-1), losses are unbounded). GOLD/CRUDE are futures-return proxies, not
cash-equity holdings; USDINR exposure is a long-USD position in INR terms (gains when the rupee depreciates).
Loss = (V0 - V_T)/V0.  VaR_a = a-quantile of loss; ES_a = mean loss given loss >= VaR_a.
"""
from __future__ import annotations

import numpy as np

from .config import ASSETS


def validate_weights(w: dict[str, float], normalize: bool = False, allow_short: bool = False) -> dict[str, float]:
    allowed = set(ASSETS) | {"CASH"}
    unknown = set(w) - allowed
    if unknown: raise ValueError(f"unknown assets: {sorted(unknown)}")
    if not all(np.isfinite(v) for v in w.values()): raise ValueError("weights must be finite")
    if not allow_short and any(v < 0 for v in w.values()): raise ValueError("negative weights require allow_short=true")
    total = sum(w.values())
    if total <= 0: raise ValueError("weights must sum to a positive number")
    if normalize: return {k: v / total for k, v in w.items()}
    if abs(total - 1) > 1e-6: raise ValueError(f"weights sum to {total:.6f}, expected 1 (or set normalize=true)")
    return dict(w)


def portfolio_values(sim: np.ndarray, weights: dict[str, float], v0: float = 1_000_000.0) -> np.ndarray:
    """sim: (n,h,N) log returns -> (n,h+1) portfolio value paths including t=0."""
    cum = np.cumsum(sim, axis=1)
    w = np.array([weights.get(a, 0.0) for a in ASSETS])
    risky = np.einsum("nhk,k->nh", np.exp(cum), w)
    vals = v0 * (risky + weights.get("CASH", 0.0))
    return np.concatenate([np.full((len(sim), 1), v0), vals], axis=1)


def var_es(loss: np.ndarray, alpha: float) -> tuple[float, float]:
    var = float(np.quantile(loss, alpha))
    tail = loss[loss >= var]
    return var, float(tail.mean())


def risk_metrics(values: np.ndarray) -> dict:
    v0 = values[0, 0]
    loss = (v0 - values[:, -1]) / v0
    out = {"v0": float(v0), "n_scenarios": int(len(loss)), "horizon_days": int(values.shape[1] - 1)}
    for a in (0.95, 0.99):
        var, es = var_es(loss, a)
        out[f"var_{int(a*100)}"], out[f"es_{int(a*100)}"] = var, es
        out[f"var_{int(a*100)}_amount"], out[f"es_{int(a*100)}_amount"] = var * v0, es * v0
    peak = np.maximum.accumulate(values, axis=1)
    mdd = ((peak - values) / peak).max(1)
    ret = values[:, -1] / v0 - 1
    out.update({"median_return": float(np.median(ret)), "mean_return": float(ret.mean()),
                "worst_return": float(ret.min()), "best_return": float(ret.max()),
                "max_drawdown_mean": float(mdd.mean()), "max_drawdown_p95": float(np.quantile(mdd, .95)),
                "max_drawdown_worst": float(mdd.max()),
                "prob_loss_gt_5": float((loss > .05).mean()), "prob_loss_gt_10": float((loss > .10).mean()),
                "prob_loss_gt_20": float((loss > .20).mean())})
    return out


def loss_contributions(sim: np.ndarray, weights: dict[str, float], alpha: float = 0.95) -> dict[str, float]:
    """Mean per-asset loss (fraction of V0) over the paths in the alpha-tail; sums to ES_alpha (cash contributes 0)."""
    cum = sim.sum(1)
    w = np.array([weights.get(a, 0.0) for a in ASSETS])
    asset_loss = -(w * (np.exp(cum) - 1))                 # (n,N) positive = loss
    total = asset_loss.sum(1)
    tail = total >= np.quantile(total, alpha)
    return {a: float(asset_loss[tail, j].mean()) for j, a in enumerate(ASSETS)}
