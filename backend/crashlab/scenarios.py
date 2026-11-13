"""Scenario generation with probabilistic conditioning and transparent diagnostics.

The CVAE uses its native target condition; unconditional baselines use an unconditional proposal pool.
Both are kernel-weighted-resampled by cumulative target proximity. Returned paths are never altered.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from .config import ASSETS, MAX_HORIZON, MAX_SCENARIOS, REGIMES

TOL_REL, TOL_ABS = 0.15, 0.01   # satisfied if |realised - target| <= max(1% abs, 15% of |target|) in log units
MAX_PROPOSALS = 20_000


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
        if not isinstance(self.seed, (int, np.integer)) or not 0 <= self.seed <= 2**32 - 1:
            errs.append("seed must be an integer in 0..4294967295")
        if self.regime not in (None, *REGIMES): errs.append(f"regime must be one of {REGIMES}")
        for a, v in self.shocks.items():
            if a not in ASSETS: errs.append(f"unknown asset {a}")
            elif not np.isfinite(v): errs.append(f"{a} shock must be finite")
            elif not (-0.95 < v < 5.0): errs.append(f"{a} shock {v} outside (-95%, +500%)")
        return errs

    def log_constraints(self): return {a: float(np.log1p(v)) for a, v in self.shocks.items()}


def _cum(sim): return sim.sum(1)


def _wilson_interval(successes: int, n: int, z: float = 1.96) -> list[float]:
    if n == 0:
        return [0.0, 1.0]
    p = successes / n
    denom = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denom
    radius = z * np.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    return [float(max(0.0, centre - radius)), float(min(1.0, centre + radius))]


def _median_confidence_interval(values: np.ndarray) -> list[float]:
    ordered = np.sort(values)
    n = len(ordered)
    radius = int(np.ceil(1.96 * np.sqrt(n) / 2))
    middle = n // 2
    return [
        float(ordered[max(0, middle - radius)]),
        float(ordered[min(n - 1, middle + radius)]),
    ]


def kernel_resample(
    pool: np.ndarray,
    targets: dict,
    n: int,
    seed: int,
) -> tuple[np.ndarray, dict]:
    """Resample intact proposal paths with a Gaussian kernel around probabilistic targets."""
    assets = list(targets)
    indices = np.array([ASSETS.index(asset) for asset in assets])
    target_values = np.array([targets[asset] for asset in assets], dtype=float)
    tolerances = np.maximum(TOL_ABS, TOL_REL * np.abs(target_values))
    residuals = (_cum(pool)[:, indices] - target_values) / tolerances

    if len(assets) == 1:
        correlation = np.ones((1, 1))
    else:
        correlation = np.corrcoef(residuals, rowvar=False)
        correlation = np.nan_to_num(correlation, nan=0.0, posinf=0.0, neginf=0.0)
        np.fill_diagonal(correlation, 1.0)
    # Shrink noisy proposal correlations to keep the target kernel well-conditioned.
    correlation = 0.8 * correlation + 0.2 * np.eye(len(assets))
    precision = np.linalg.pinv(correlation)
    distance_squared = np.einsum("bi,ij,bj->b", residuals, precision, residuals)
    log_weights = -0.5 * distance_squared
    weights = np.exp(np.clip(log_weights - log_weights.max(), -50, 0))
    weights /= weights.sum()

    rng = np.random.default_rng(seed)
    selected = rng.choice(len(pool), size=n, replace=False, p=weights)
    effective_sample_size = float(1 / np.sum(weights**2))
    return pool[selected], {
        "proposal_pool_size": int(len(pool)),
        "kernel_effective_sample_size": effective_sample_size,
        "median_selected_distance_tolerance_units": float(
            np.sqrt(np.median(distance_squared[selected]))
        ),
    }


def constraint_report(
    sim: np.ndarray,
    targets: dict,
    proposal: np.ndarray | None = None,
) -> list[dict]:
    cum = _cum(sim)
    proposal_cum = _cum(proposal) if proposal is not None else cum
    rows = []
    for a, t in targets.items():
        x = cum[:, ASSETS.index(a)]
        tol = max(TOL_ABS, TOL_REL * abs(t))
        proposal_x = proposal_cum[:, ASSETS.index(a)]
        hits = int((np.abs(x - t) <= tol).sum())
        proposal_hits = int((np.abs(proposal_x - t) <= tol).sum())
        proposal_quantiles = np.quantile(proposal_x, [.01, .05, .5, .95, .99])
        target_offset_sd = float(
            (t - np.median(proposal_x)) / max(float(np.std(proposal_x, ddof=1)), 1e-12)
        )
        if t < proposal_quantiles[0] or t > proposal_quantiles[-1]:
            target_position = "outside_proposal_1_99"
        elif t < proposal_quantiles[1] or t > proposal_quantiles[-2]:
            target_position = "proposal_tail"
        else:
            target_position = "within_proposal_5_95"

        diagnostics = []
        proposal_share = proposal_hits / len(proposal_x)
        if proposal_hits == 0:
            diagnostics.append("No proposal paths fell within the requested tolerance.")
        elif proposal_share < 0.05:
            diagnostics.append(
                f"Only {proposal_share:.1%} of proposal paths fell within tolerance."
            )
        if target_position == "outside_proposal_1_99":
            diagnostics.append(
                "The target is outside the proposal 1st–99th percentile range; "
                "the finite proposal provides weak support for this target."
            )
        elif target_position == "proposal_tail":
            diagnostics.append(
                "The target lies in a proposal tail, so few paths support it."
            )
        if hits < len(x) / 2:
            diagnostics.append(
                "Most realised paths remain outside tolerance; this is a probabilistic "
                "target, not a hard constraint."
            )
        if not diagnostics:
            diagnostics.append(
                "The proposal supports the target; residual path-to-path variation remains."
            )

        median = float(np.median(x))
        predictive_low, predictive_high = np.quantile(x, [.05, .95])
        median_low, median_high = _median_confidence_interval(x)
        rows.append({
            "asset": a,
            "target_semantics": "probabilistic",
            "target_simple": float(np.expm1(t)),
            "realised_median_simple": float(np.expm1(median)),
            "realised_median_ci95_simple": [
                float(np.expm1(median_low)),
                float(np.expm1(median_high)),
            ],
            "realised_mean_simple": float(np.expm1(x.mean())),
            "p05_simple": float(np.expm1(predictive_low)),
            "p95_simple": float(np.expm1(predictive_high)),
            "predictive_interval": "5th–95th percentile",
            "proposal_p01_simple": float(np.expm1(proposal_quantiles[0])),
            "proposal_p99_simple": float(np.expm1(proposal_quantiles[-1])),
            "proposal_share_within_tolerance": float(proposal_share),
            "proposal_target_position": target_position,
            "target_offset_proposal_sd": target_offset_sd,
            "tolerance_log": float(tol),
            "share_within_tolerance": float(hits / len(x)),
            "share_within_tolerance_ci95": _wilson_interval(hits, len(x)),
            "violation_count": int(len(x) - hits),
            "violation_rate": float((len(x) - hits) / len(x)),
            "mean_signed_error_log": float(np.mean(x - t)),
            "median_abs_error_log": float(np.median(np.abs(x - t))),
            "diagnostics": diagnostics,
        })
    return rows


def generate(
    model,
    spec: ScenarioSpec,
    ref_sd: np.ndarray | None = None,
    pool_mult: int = 20,
) -> dict:
    """Generate intact paths, keeping the prior ref_sd argument for caller compatibility."""
    errs = spec.validate()
    if errs: raise ValueError("; ".join(errs))
    t0 = time.time()
    reg = REGIMES.index(spec.regime) if spec.regime else None
    targets = spec.log_constraints()
    meta = {"model": model.name, "model_version": model.version, "seed": spec.seed, "horizon": spec.horizon,
            "n": spec.n, "regime": spec.regime, "shocks": spec.shocks,
            "mode": "conditional" if targets else "unconditional",
            "target_semantics": "probabilistic" if targets else "none",
            "hard_constraints_enforced": False}
    if targets:
        proposal_count = max(spec.n, min(spec.n * pool_mult, MAX_PROPOSALS))
        proposal = model.simulate(
            proposal_count,
            spec.horizon,
            spec.seed,
            reg,
            targets if model.supports_conditioning else None,
        )
        sim, selection_meta = kernel_resample(
            proposal, targets, spec.n, spec.seed + 104729
        )
        meta["conditioning"] = (
            "native_kernel_resampling" if model.supports_conditioning else "kernel_resampling"
        )
        meta["conditioning_details"] = (
            "Gaussian kernel over tolerance-standardized cumulative log-return targets; "
            "correlation-shrunk weights; intact paths sampled without replacement."
        )
        meta.update(selection_meta)
    else:
        sim = model.simulate(spec.n, spec.horizon, spec.seed, reg, None)
        meta["conditioning"] = "none"
    if not np.isfinite(sim).all(): raise FloatingPointError("non-finite simulated returns")
    meta["constraint_report"] = constraint_report(sim, targets, proposal if targets else None)
    meta["seconds"] = time.time() - t0
    return {"sim": sim, "meta": meta}
