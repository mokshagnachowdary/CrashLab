"""Gaussian baseline, Gaussian copula and Student-t copula (t marginals, rank pseudo-observations).

Why t-copula: it has symmetric tail dependence lambda = 2*t_{nu+1}(-sqrt((nu+1)(1-rho)/(1+rho))) > 0, while the
Gaussian copula has lambda = 0 for |rho|<1, so it under-states joint extreme moves. All three are
i.i.d. across days (no volatility clustering) — a known limitation documented in the research notes.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from .base import ScenarioModel


class GaussianModel(ScenarioModel):
    name = "gaussian"

    def fit(self, returns: pd.DataFrame, **kw):
        self.mean, self.cov = returns.mean().values, np.cov(returns.values.T)
        return self

    def simulate(self, n, horizon, seed, regime=None, constraints=None):
        rng = np.random.default_rng(seed)
        return rng.multivariate_normal(self.mean, self.cov, (n, horizon))


def nearest_psd_corr(R: np.ndarray) -> np.ndarray:
    w, V = np.linalg.eigh((R + R.T) / 2)
    w = np.clip(w, 1e-6, None)
    A = V @ np.diag(w) @ V.T
    d = np.sqrt(np.diag(A))
    return A / np.outer(d, d)


class CopulaModel(ScenarioModel):
    def __init__(self, kind: str = "t"):
        assert kind in ("t", "gaussian")
        self.kind = kind
        self.name = "t_copula" if kind == "t" else "gaussian_copula"

    def fit(self, returns: pd.DataFrame, **kw):
        X = returns.values
        T, N = X.shape
        self.marg = []
        for j in range(N):
            df, loc, sc = stats.t.fit(X[:, j])
            self.marg.append((float(np.clip(df, 2.2, 60)), loc, sc))
        U = (stats.rankdata(X, axis=0) / (T + 1))            # pseudo-observations
        if self.kind == "gaussian":
            self.R = nearest_psd_corr(np.corrcoef(stats.norm.ppf(U).T))
            self.nu = None
        else:
            tau = np.eye(N)
            for i in range(N):
                for j in range(i + 1, N):
                    tau[i, j] = tau[j, i] = stats.kendalltau(X[:, i], X[:, j])[0]
            self.R = nearest_psd_corr(np.sin(np.pi * tau / 2))  # robust to heavy tails; PSD-repaired
            self.nu = self._fit_nu(U)
        return self

    def _fit_nu(self, U):
        best, best_ll = 30.0, -np.inf
        for nu in [2.5, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50]:
            x = stats.t.ppf(U, nu)
            ll = stats.multivariate_t(np.zeros(len(self.R)), self.R, df=nu).logpdf(x).sum() - stats.t.logpdf(x, nu).sum()
            if np.isfinite(ll) and ll > best_ll:
                best, best_ll = nu, ll
        self.nu_loglik = float(best_ll)
        return float(best)

    def simulate(self, n, horizon, seed, regime=None, constraints=None):
        rng = np.random.default_rng(seed)
        N = len(self.R)
        z = rng.standard_normal((n * horizon, N)) @ np.linalg.cholesky(self.R).T
        if self.kind == "t":
            z = z / np.sqrt(rng.chisquare(self.nu, (n * horizon, 1)) / self.nu)
            U = stats.t.cdf(z, self.nu)
        else:
            U = stats.norm.cdf(z)
        U = np.clip(U, 1e-6, 1 - 1e-6)
        out = np.column_stack([stats.t.ppf(U[:, j], df, loc, sc) for j, (df, loc, sc) in enumerate(self.marg)])
        return out.reshape(n, horizon, N)
