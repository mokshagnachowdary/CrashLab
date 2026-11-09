"""Filtered Historical Simulation with per-asset GJR-GARCH(1,1)-t and synchronised residual bootstrap."""
from __future__ import annotations

import numpy as np
import pandas as pd
from arch import arch_model
from statsmodels.stats.diagnostic import acorr_ljungbox

from .base import ScenarioModel


class FHSModel(ScenarioModel):
    name = "fhs"

    def fit(self, returns: pd.DataFrame, regimes: np.ndarray | None = None, **kw):
        self.assets = list(returns.columns)
        N, T = len(self.assets), len(returns)
        self.mu, self.omega, self.alpha, self.gamma, self.beta = (np.zeros(N) for _ in range(5))
        Z, cond, self.diagnostics = np.zeros((T, N)), np.zeros((T, N)), {}
        for j, a in enumerate(self.assets):
            res = arch_model(returns[a].values * 100, mean="Constant", vol="GARCH", p=1, o=1, q=1,
                             dist="t").fit(disp="off", show_warning=False)
            p = res.params
            self.mu[j], self.omega[j] = p["mu"], p["omega"]
            self.alpha[j], self.gamma[j], self.beta[j] = p["alpha[1]"], p["gamma[1]"], p["beta[1]"]
            pers = self.alpha[j] + self.gamma[j] / 2 + self.beta[j]
            if pers >= 0.9995:  # keep the simulated variance process stationary
                self.beta[j] -= pers - 0.9995
            Z[:, j], cond[:, j] = res.std_resid, res.conditional_volatility
            lb = acorr_ljungbox(Z[:, j] ** 2, lags=[10], return_df=True)["lb_pvalue"].iloc[0]
            self.diagnostics[a] = {"persistence": float(pers), "alpha": float(self.alpha[j]),
                                   "gamma": float(self.gamma[j]), "beta": float(self.beta[j]),
                                   "t_df": float(p.get("nu", np.nan)), "ljungbox_sq_resid_p10": float(lb)}
        Z = (Z - Z.mean(0)) / Z.std(0)       # re-standardise: rows are synchronised across assets
        self.Z = Z
        self.cond_var = cond ** 2
        self.longrun = self.omega / (1 - self.alpha - self.gamma / 2 - self.beta)
        self.state_var = self.cond_var[-1]    # variance state at end of training data (%^2)
        self.regime_var = {}
        for k in range(3):
            m = (regimes == k) if regimes is not None else np.zeros(T, bool)
            self.regime_var[k] = self.cond_var[m].mean(0) if m.sum() > 20 else self.longrun
        return self

    def filter_variance(self, returns: np.ndarray, start_var: np.ndarray | None = None) -> np.ndarray:
        """One-step-ahead variance (%^2) after each observed row; out[t] is the forecast for day t+1."""
        s2 = self.state_var.copy() if start_var is None else start_var.copy()
        out = np.zeros((len(returns), len(self.mu)))
        for t, r in enumerate(returns * 100):
            eps = r - self.mu
            s2 = self.omega + (self.alpha + self.gamma * (eps < 0)) * eps ** 2 + self.beta * s2
            out[t] = s2
        return out

    def simulate(self, n, horizon, seed, regime=None, constraints=None, init_var=None):
        rng = np.random.default_rng(seed)
        idx = rng.integers(0, len(self.Z), (n, horizon))  # whole residual ROW resampled -> dependence kept
        z = self.Z[idx]
        if init_var is not None: s2 = np.tile(init_var, (n, 1))
        elif regime is not None: s2 = np.tile(self.regime_var[regime], (n, 1))
        else: s2 = np.tile(self.longrun, (n, 1))
        out = np.zeros((n, horizon, len(self.mu)))
        for t in range(horizon):
            eps = np.sqrt(s2) * z[:, t]
            out[:, t] = (self.mu + eps) / 100
            s2 = self.omega + (self.alpha + self.gamma * (eps < 0)) * eps ** 2 + self.beta * s2
        return out
