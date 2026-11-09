"""Scenario generation service: specs, conditional generation, constraint-satisfaction report.

cVAE conditions natively. The unconditional baselines (FHS, copulas, Gaussian) are conditioned by ANALOG
SELECTION: simulate a large pool and keep the n paths closest to the constraints. No path is altered, and the
realised mismatch is reported — for extreme targets the pool may contain no close analogs, and that shows up.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from .config import ASSETS, MAX_HORIZON, MAX_SCENARIOS, REGIMES

TOL_REL, TOL_ABS = 0.15, 0.01   # satisfied if |realised - target| <= max(1% abs, 15% of |target|) in log units


@dataclass
class ScenarioSpec:
    horizon: int = 10
    n: int = 1000
    regime: str | None = None                       # 'normal'|'elevated'|'extreme'|None
    shocks: dict = field(default_factory=dict)       # asset -> cumulative SIMPLE return, e.g. NIFTY: -0.15
    seed: int = 42

    def validate(self):
        errs = []
        if not 1 <= self.horizon <= MAX_HORIZON: errs.append(f"horizon must be 1..{MAX_HORIZON}")
        if not 1 <= self.n <= MAX_SCENARIOS: errs.append(f"n must be 1..{MAX_SCENARIOS}")
        if self.regime not in (None, *REGIMES): errs.append(f"regime must be one of {REGIMES}")
        for a, v in self.shocks.items():
            if a not in ASSETS: errs.append(f"unknown asset {a}")
            elif not (-0.95 < v < 5.0): errs.append(f"{a} shock {v} outside (-95%, +500%)")
        return errs

    def log_constraints(self): return {a: float(np.log1p(v)) for a, v in self.shocks.items()}


def _cum(sim): return sim.sum(1)


def analog_select(pool: np.ndarray, targets: dict, sds: np.ndarray, n: int):
    cum = _cum(pool)
    d = np.zeros(len(pool))
    for a, t in targets.items():
        j = ASSETS.index(a); d += ((cum[:, j] - t) / (sds[j] * np.sqrt(pool.shape[1]))) ** 2
    idx = np.argsort(d)[:n]
    return pool[idx], float(np.sqrt(np.median(d[idx])))


def constraint_report(sim: np.ndarray, targets: dict) -> list[dict]:
    cum = _cum(sim)
    rows = []
    for a, t in targets.items():
        x = cum[:, ASSETS.index(a)]
        tol = max(TOL_ABS, TOL_REL * abs(t))
        rows.append({"asset": a, "target_simple": float(np.expm1(t)), "realised_median_simple": float(np.expm1(np.median(x))),
                     "realised_mean_simple": float(np.expm1(x.mean())), "p05_simple": float(np.expm1(np.quantile(x, .05))),
                     "p95_simple": float(np.expm1(np.quantile(x, .95))), "tolerance_log": float(tol),
                     "share_within_tolerance": float((np.abs(x - t) <= tol).mean()),
                     "median_abs_error_log": float(np.median(np.abs(x - t)))})
    return rows


def generate(model, spec: ScenarioSpec, ref_sd: np.ndarray, pool_mult: int = 20) -> dict:
    errs = spec.validate()
    if errs: raise ValueError("; ".join(errs))
    t0 = time.time()
    reg = REGIMES.index(spec.regime) if spec.regime else None
    targets = spec.log_constraints()
    meta = {"model": model.name, "model_version": model.version, "seed": spec.seed, "horizon": spec.horizon,
            "n": spec.n, "regime": spec.regime, "shocks": spec.shocks,
            "mode": "conditional" if targets else "unconditional"}
    if targets and model.supports_conditioning:
        sim = model.simulate(spec.n, spec.horizon, spec.seed, reg, targets)
        meta["conditioning"] = "native"
    elif targets:
        pool = model.simulate(spec.n * pool_mult, spec.horizon, spec.seed, reg, None)
        sim, dist = analog_select(pool, targets, ref_sd, spec.n)
        meta.update({"conditioning": "analog_selection", "pool_size": len(pool), "median_selected_distance_sd": dist})
    else:
        sim = model.simulate(spec.n, spec.horizon, spec.seed, reg, None)
        meta["conditioning"] = "none"
    if not np.isfinite(sim).all(): raise FloatingPointError("non-finite simulated returns")
    meta["constraint_report"] = constraint_report(sim, targets)
    meta["seconds"] = time.time() - t0
    return {"sim": sim, "meta": meta}
