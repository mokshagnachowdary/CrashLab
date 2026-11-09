"""VaR and ES backtests.

Kupiec POF (unconditional coverage), Christoffersen independence + conditional coverage, and the
Acerbi-Szekely Z2 test for Expected Shortfall.

Acerbi-Szekely Z2 (loss convention, L_t>0 is a loss): I_t = 1{L_t >= VaR_t},
    Z2 = sum_t L_t * I_t / (T * (1-alpha) * ES_t) - 1,     E[Z2]=0 under H0, Z2>0 => ES under-estimated.
Significance: Monte-Carlo under H0 by drawing, for each t, one loss from the model's own predictive sample
(one-sided p = P(Z2* >= Z2_obs)). Variant: Z2 (tail-magnitude test, conditional on exceedances being
sample-scaled by T*(1-alpha)); needs predictive samples per day, which our simulation models provide.
"""
from __future__ import annotations

import numpy as np
from scipy import stats


def _xlogy(x, y): return 0.0 if x == 0 else x * np.log(y)


def kupiec_pof(exceed: np.ndarray, p: float) -> dict:
    T, x = len(exceed), int(exceed.sum())
    ll0 = _xlogy(T - x, 1 - p) + _xlogy(x, p)
    pi = x / T
    ll1 = _xlogy(T - x, 1 - pi) + _xlogy(x, pi)
    lr = max(0.0, -2 * (ll0 - ll1))
    return {"T": T, "exceedances": x, "expected": T * p, "lr": float(lr), "p_value": float(1 - stats.chi2.cdf(lr, 1))}


def christoffersen(exceed: np.ndarray, p: float) -> dict:
    e = exceed.astype(int)
    n00 = n01 = n10 = n11 = 0
    for a, b in zip(e[:-1], e[1:]):
        n00 += (a == 0 and b == 0); n01 += (a == 0 and b == 1); n10 += (a == 1 and b == 0); n11 += (a == 1 and b == 1)
    pi01 = n01 / max(n00 + n01, 1); pi11 = n11 / max(n10 + n11, 1); pi = (n01 + n11) / max(n00 + n01 + n10 + n11, 1)
    ll_ind = _xlogy(n00 + n10, 1 - pi) + _xlogy(n01 + n11, pi)
    ll_dep = _xlogy(n00, 1 - pi01) + _xlogy(n01, pi01) + _xlogy(n10, 1 - pi11) + _xlogy(n11, pi11)
    lr_ind = max(0.0, -2 * (ll_ind - ll_dep))
    pof = kupiec_pof(exceed, p)
    lr_cc = pof["lr"] + lr_ind
    return {"lr_ind": float(lr_ind), "p_ind": float(1 - stats.chi2.cdf(lr_ind, 1)),
            "lr_cc": float(lr_cc), "p_cc": float(1 - stats.chi2.cdf(lr_cc, 2)),
            "transitions": {"n00": n00, "n01": n01, "n10": n10, "n11": n11}}


def acerbi_szekely_z2(loss: np.ndarray, var: np.ndarray, es: np.ndarray, alpha: float,
                      pred_samples: np.ndarray | None = None, n_mc: int = 2000, seed: int = 0) -> dict:
    """loss, var, es: (T,); pred_samples: (T,S) predictive loss samples per day for the MC p-value."""
    T = len(loss)
    def z2(l): return float(((l * (l >= var)) / (T * (1 - alpha) * es)).sum() - 1)
    z_obs = z2(loss)
    out = {"T": T, "z2": z_obs, "expected_exceedances": T * (1 - alpha)}
    if pred_samples is not None:
        rng = np.random.default_rng(seed)
        draws = pred_samples[np.arange(T)[None, :], rng.integers(0, pred_samples.shape[1], (n_mc, T))]
        sims = np.array([z2(d) for d in draws])
        out.update({"p_value": float((sims >= z_obs).mean()), "mc_ci95": [float(np.quantile(sims, .025)), float(np.quantile(sims, .975))]})
    return out
