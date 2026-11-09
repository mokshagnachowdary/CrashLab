"""Common interface for all scenario generators."""
from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np
import pandas as pd


class ScenarioModel(ABC):
    name: str = "base"
    supports_conditioning = False  # native constraint conditioning (only the cVAE)
    version = "1.0"

    @abstractmethod
    def fit(self, returns: pd.DataFrame, **kw) -> "ScenarioModel": ...

    @abstractmethod
    def simulate(self, n: int, horizon: int, seed: int, regime: int | None = None,
                 constraints: dict | None = None) -> np.ndarray:
        """Return log-return paths, shape (n, horizon, n_assets), asset order = config.ASSETS."""
