"""Central configuration: paths, asset universe, constants. Overridable via environment variables."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(os.getenv("CRASHLAB_HOME", Path(__file__).resolve().parents[2]))
DATA_DIR = Path(os.getenv("CRASHLAB_DATA_DIR", ROOT / "data"))
ARTIFACT_DIR = Path(os.getenv("CRASHLAB_ARTIFACT_DIR", ROOT / "artifacts"))

# Fixed order: every array in the project uses this asset ordering.
ASSETS = ["NIFTY", "BANK", "IT", "GOLD", "CRUDE", "USDINR"]
ASSET_LABELS = {
    "NIFTY": "NIFTY 50", "BANK": "NIFTY Bank", "IT": "NIFTY IT",
    "GOLD": "Gold (futures)", "CRUDE": "Crude Oil WTI (futures)", "USDINR": "USD/INR",
}
# Yahoo Finance tickers. Gold/crude are USD futures series (continuous contracts, roll gaps possible).
TICKERS = {"NIFTY": "^NSEI", "BANK": "^NSEBANK", "IT": "^CNXIT",
           "GOLD": "GC=F", "CRUDE": "CL=F", "USDINR": "INR=X"}
# Fallback tickers tried in order if the primary returns no/too little data (history shorter than MIN_ROWS)
ALT_TICKERS = {"IT": ["NIFTYIT.NS"], "USDINR": ["USDINR=X"], "BANK": ["NIFTY_BANK.NS"]}
MIN_ROWS = 1500
# Sign convention: USDINR return > 0  <=>  rupee DEPRECIATION (USD gets more expensive in INR).

REGIMES = ["normal", "elevated", "extreme"]
TRAIN_FRAC, VAL_FRAC = 0.6, 0.2  # chronological; remaining 20% = out-of-sample test
TRADING_DAYS = 252
MAX_SCENARIOS = int(os.getenv("CRASHLAB_MAX_SCENARIOS", 50_000))
MAX_HORIZON = 20
