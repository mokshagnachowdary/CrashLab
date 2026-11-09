"""Feature engineering (all features at time t use information up to t only) and volatility regimes."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .config import ASSETS, REGIMES, TRADING_DAYS


def build_features(returns: pd.DataFrame) -> pd.DataFrame:
    f = {}
    cum = returns.cumsum()
    for a in returns.columns:
        r = returns[a]
        f[f"{a}_lag1"], f[f"{a}_lag2"] = r.shift(1), r.shift(2)
        f[f"{a}_rv20"] = r.rolling(20).std() * np.sqrt(TRADING_DAYS)
        f[f"{a}_ewv"] = np.sqrt((r ** 2).ewm(alpha=0.06, adjust=False).mean()) * np.sqrt(TRADING_DAYS)  # RiskMetrics 0.94
        f[f"{a}_dd"] = cum[a] - cum[a].cummax()
        thr = 3 * r.rolling(250).std().shift(1)
        f[f"{a}_extreme"] = (r.abs() > thr).astype(float)
        f[f"{a}_volclust"] = (r ** 2).rolling(20).apply(lambda x: pd.Series(x).autocorr(1), raw=True)
        if a != "NIFTY":
            f[f"NIFTY_{a}_corr60"] = returns["NIFTY"].rolling(60).corr(r)
    return pd.DataFrame(f, index=returns.index)


@dataclass
class Scaler:
    mean: np.ndarray
    std: np.ndarray

    @classmethod
    def fit(cls, train: np.ndarray) -> "Scaler":  # fitted on TRAIN only
        return cls(train.mean(0), np.maximum(train.std(0), 1e-12))

    def transform(self, x): return (x - self.mean) / self.std
    def inverse(self, z): return z * self.std + self.mean

    def save(self, p: Path): Path(p).write_text(json.dumps({"mean": self.mean.tolist(), "std": self.std.tolist()}))

    @classmethod
    def load(cls, p: Path):
        d = json.loads(Path(p).read_text()); return cls(np.array(d["mean"]), np.array(d["std"]))


@dataclass
class RegimeModel:
    """Transparent percentile-threshold volatility regimes on NIFTY 20d realised vol (annualised).
    Thresholds come from TRAIN data only. Labels describe volatility level, not 'crises'."""
    q_elevated: float
    q_extreme: float

    @staticmethod
    def rv(returns: pd.DataFrame) -> pd.Series:
        return returns["NIFTY"].rolling(20).std() * np.sqrt(TRADING_DAYS)

    @classmethod
    def fit(cls, train_returns: pd.DataFrame, p_elev=0.75, p_ext=0.95) -> "RegimeModel":
        rv = cls.rv(train_returns).dropna()
        return cls(float(rv.quantile(p_elev)), float(rv.quantile(p_ext)))

    def label(self, returns: pd.DataFrame) -> np.ndarray:
        """Regime known at the END of day t (uses returns up to t). NaN warm-up -> 0 (normal)."""
        rv = self.rv(returns).fillna(0).values
        return np.where(rv >= self.q_extreme, 2, np.where(rv >= self.q_elevated, 1, 0)).astype(int)

    def to_dict(self): return {"q_elevated": self.q_elevated, "q_extreme": self.q_extreme, "names": REGIMES}
