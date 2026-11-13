"""Fit 95% VaR/ES residual offsets on a chronological calibration slice."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from crashlab.data import Dataset, split_indices
from crashlab.features import RegimeModel
from crashlab.models.copula import CopulaModel, GaussianModel
from crashlab.models.cvae import CVAEConfig, CVAEModel
from crashlab.models.fhs import FHSModel
from crashlab.pipeline import calibrate_var_es
from crashlab.service import State


def _json_value(value):
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    raise TypeError(f"unsupported JSON value: {type(value).__name__}")


def run(paths: int = 1500) -> dict:
    if paths < 400:
        raise ValueError("paths must be at least 400 for the saved Acerbi-Szekely samples")
    state = State().load()
    if not state.ready:
        raise RuntimeError(f"model artifacts unavailable: {state.error}")

    returns = state.returns
    n = len(returns)
    n_train, n_model_end = split_indices(n, 0.55, 0.05)
    _, n_cal_end = split_indices(n, 0.60, 0.20)
    if n_model_end >= n_cal_end:
        raise ValueError("dataset is too short for disjoint fit, calibration, and test slices")

    regime_model = RegimeModel.fit(returns.iloc[:n_train])
    regimes = regime_model.label(returns)
    models = {
        "gaussian": GaussianModel().fit(returns.iloc[:n_model_end]),
        "gaussian_copula": CopulaModel("gaussian").fit(returns.iloc[:n_model_end]),
        "t_copula": CopulaModel("t").fit(returns.iloc[:n_model_end]),
        "fhs": FHSModel().fit(returns.iloc[:n_model_end], regimes=regimes[:n_model_end]),
    }
    config = CVAEConfig(**state.models["cvae"].cfg.__dict__)
    models["cvae"] = CVAEModel(config, "cpu").fit(
        returns, regimes, n_train, n_model_end
    )

    prices = pd.DataFrame(
        np.ones_like(returns), index=returns.index, columns=returns.columns
    )
    dataset = Dataset(prices, returns, state.manifest["source"], state.manifest["synthetic"])
    study = calibrate_var_es(
        models, dataset, regimes, n_model_end, n_cal_end, h=5, n_paths=paths
    )
    cvae = models["cvae"]
    study["candidate_training"] = {
        "baseline_fit_rows": n_model_end,
        "cvae_train_rows": n_train,
        "cvae_early_stopping_rows": n_model_end - n_train,
        "cvae_epochs_max": config.epochs,
        "cvae_epochs_run": len(cvae.history),
        "cvae_best_validation_loss": cvae.best_val_loss,
        "cvae_train_seconds": cvae.train_seconds,
        "cvae_windows": cvae.n_windows,
        "cvae_config": {
            **config.__dict__,
            "horizons": list(config.horizons),
        },
        "candidate_weights_saved": False,
    }
    study["protocol"] = {
        "dataset_source": state.manifest["source"],
        "synthetic": state.manifest["synthetic"],
        "observations": n,
        "fit_end_index": n_train,
        "model_selection_end_index": n_model_end,
        "calibration_start_index": n_model_end,
        "calibration_end_index": n_cal_end,
        "test_start_index": n_cal_end,
        "test_end_index": n,
        "fit_end_date": str(returns.index[n_train - 1].date()),
        "model_selection_end_date": str(returns.index[n_model_end - 1].date()),
        "calibration_end_date": str(returns.index[n_cal_end - 1].date()),
        "test_start_date": str(returns.index[n_cal_end].date()),
        "test_end_date": str(returns.index[-1].date()),
        "baseline_fit_end_index": n_model_end,
        "cvae_train_end_index": n_train,
        "cvae_early_stopping_end_index": n_model_end,
        "test_used_for_fitting_or_calibration": False,
    }
    return study


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paths", type=int, default=1500, help="Monte Carlo paths per forecast")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="optional JSON destination; writes only this study, never model artifacts",
    )
    args = parser.parse_args()
    result = run(args.paths)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = args.output.with_suffix(args.output.suffix + ".tmp")
        try:
            temporary_path.write_text(
                json.dumps(result, indent=2, default=_json_value),
                encoding="utf-8",
            )
            os.replace(temporary_path, args.output)
        finally:
            temporary_path.unlink(missing_ok=True)
    print(json.dumps(result, indent=2, default=_json_value))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
