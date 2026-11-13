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


def _nearest_psd(matrix: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    """Project a symmetric matrix to the nearest positive semi-definite matrix."""
    m = np.asarray(matrix, dtype=float)
    if m.ndim == 0:
        return np.array([[float(m)]])
    m = np.atleast_2d((m + m.T) / 2)
    w, v = np.linalg.eigh(m)
    w = np.clip(w, eps, None)
    A = v @ np.diag(w) @ v.T
    return (A + A.T) / 2


def _safe_covariance(X: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    X = np.asarray(X, dtype=float)
    if X.ndim == 1:
        X = X[:, None]
    mu = X.mean(0)
    centered = X - mu
    cov = np.cov(centered, rowvar=False, ddof=1)
    if np.allclose(cov, 0.0):
        return np.eye(centered.shape[1]) * eps
    cov = np.atleast_2d(np.asarray(cov, dtype=float))
    cov = _nearest_psd(cov, eps)
    cov = (cov + cov.T) / 2
    cov = cov + np.eye(cov.shape[0]) * max(eps, np.finfo(float).eps)
    return cov


def nearest_psd_corr(R: np.ndarray) -> np.ndarray:
    R = np.asarray(R, dtype=float)
    R = _nearest_psd(R)
    d = np.sqrt(np.clip(np.diag(R), 1e-8, None))
    return R / np.outer(d, d)


class GaussianModel(ScenarioModel):
    name = "gaussian"

    def fit(self, returns: pd.DataFrame, **kw):
        X = returns.values
        self.mean = X.mean(0)
        self.cov = _safe_covariance(X)
        return self

    def simulate(self, n, horizon, seed, regime=None, constraints=None):
        rng = np.random.default_rng(seed)
        return rng.multivariate_normal(self.mean, self.cov, (n, horizon))


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
