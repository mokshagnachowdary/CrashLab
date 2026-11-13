"""Recompute the non-overlapping VaR/ES backtest from existing model artifacts."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from crashlab.data import Dataset
from crashlab.pipeline import var_backtest
from crashlab.service import State


def _json_value(value):
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    raise TypeError(f"unsupported JSON value: {type(value).__name__}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="replace only the saved backtest result")
    parser.add_argument("--paths", type=int, default=1500, help="Monte Carlo paths per forecast window")
    args = parser.parse_args()
    if args.paths < 400:
        parser.error("--paths must be at least 400 for the saved Acerbi-Szekely samples")

    state = State().load()
    if not state.ready:
        raise RuntimeError(f"model artifacts unavailable: {state.error}")
    split = state.manifest["split"]
    prices = pd.DataFrame(np.ones_like(state.returns), index=state.returns.index, columns=state.returns.columns)
    dataset = Dataset(prices, state.returns, state.manifest["source"], state.manifest["synthetic"])
    regimes = state.regime.label(state.returns)
    result = var_backtest(
        state.models,
        dataset,
        regimes,
        split["n_train"] + split["n_val"],
        h=5,
        n_paths=args.paths,
    )

    if args.write:
        results_path = Path(state.art) / "research_results.json"
        report = json.loads(results_path.read_text(encoding="utf-8"))
        report["backtest"] = result
        temporary_path = results_path.with_suffix(".tmp")
        try:
            temporary_path.write_text(
                json.dumps(report, indent=1, default=_json_value),
                encoding="utf-8",
            )
            os.replace(temporary_path, results_path)
        finally:
            temporary_path.unlink(missing_ok=True)
    print(json.dumps(result, indent=2, default=_json_value))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
