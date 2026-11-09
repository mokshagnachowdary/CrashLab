"""Data providers, cleaning, calendar alignment, log returns, data-quality report.

Alignment policy: prices are outer-joined across assets; only dates on which ALL assets have a valid
price are kept; log returns are computed between consecutive kept dates (multi-day gaps therefore
carry the true cumulative return over the gap). Nothing is forward-filled and no value is invented.
"""
from __future__ import annotations

import logging
import pickle
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from .config import ALT_TICKERS, ASSETS, DATA_DIR, MIN_ROWS, TICKERS

log = logging.getLogger(__name__)


class DataUnavailable(RuntimeError):
    pass


class DataProvider:
    name = "base"
    is_synthetic = False

    def fetch_all(self, start: str, end: str | None) -> dict[str, pd.DataFrame]:
        raise NotImplementedError


class YahooProvider(DataProvider):
    """Yahoo Finance via yfinance (unofficial; subject to Yahoo terms; auto-adjusted prices)."""
    name = "yahoo_finance"

    def fetch_all(self, start, end):
        import yfinance as yf
        out = {}
        for asset, ticker in TICKERS.items():
            df = None
            for tk in [ticker, *ALT_TICKERS.get(asset, [])]:
                try:
                    d = yf.download(tk, start=start, end=end, auto_adjust=True, progress=False)
                except Exception as e:  # network/parse failure: log and try the next ticker
                    log.warning("%s: %s failed (%s)", asset, tk, e); continue
                if d is not None and len(d) >= MIN_ROWS:
                    df = d; log.info("%s <- %s (%d rows)", asset, tk, len(d)); break
                log.warning("%s: %s returned %d rows (< %d)", asset, tk, 0 if d is None else len(d), MIN_ROWS)
            if df is None:
                raise DataUnavailable(f"{asset}: no ticker returned >= {MIN_ROWS} rows; supply data/csv/{asset}.csv (see CsvProvider)")
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df = df.rename(columns=str.lower)
            out[asset] = df[[c for c in ["open", "high", "low", "close", "volume"] if c in df.columns]]
        return out


class CsvProvider(DataProvider):
    """Load user-supplied CSVs (data/csv/<ASSET>.csv with Date,Close[,Volume]) — e.g. NSE/RBI exports."""
    name = "csv"

    def __init__(self, folder: Path):
        self.folder = Path(folder)

    def fetch_all(self, start, end):
        out = {}
        for a in ASSETS:
            p = self.folder / f"{a}.csv"
            if not p.exists():
                raise DataUnavailable(f"missing {p}")
            df = pd.read_csv(p, parse_dates=["Date"], index_col="Date").rename(columns=str.lower)
            out[a] = df.loc[start:end] if end else df.loc[start:]
        return out


class SyntheticProvider(DataProvider):
    """DEVELOPMENT ONLY. Regime-switching, GJR-GARCH, multivariate-t factor data. NOT market data."""
    name = "SYNTHETIC_DEV_DATA"
    is_synthetic = True

    def __init__(self, seed: int = 11):
        self.seed = seed

    def fetch_all(self, start, end):
        rng = np.random.default_rng(self.seed)
        idx = pd.bdate_range(start, end or "2026-10-30")
        T, N = len(idx), len(ASSETS)
        base_vol = np.array([0.0075, 0.0100, 0.0095, 0.0075, 0.0170, 0.0025])
        C = np.array([[1, .85, .70, -.05, .25, -.30], [.85, 1, .55, -.05, .22, -.28],
                      [.70, .55, 1, -.03, .15, -.35], [-.05, -.05, -.03, 1, .10, .05],
                      [.25, .22, .15, .10, 1, .02], [-.30, -.28, -.35, .05, .02, 1]])
        # hidden volatility regime chain (calm / elevated / stress) with higher correlation in stress
        P = np.array([[.985, .014, .001], [.040, .950, .010], [.060, .090, .850]])
        s = np.zeros(T, int)
        for t in range(1, T):
            s[t] = rng.choice(3, p=P[s[t - 1]])
        vol_mult, c_boost = np.array([0.8, 1.6, 3.2]), np.array([0.0, 0.15, 0.30])
        nu = 5.0
        r = np.zeros((T, N)); h = base_vol ** 2
        L_cache = {}
        for k in range(3):
            Ck = C.copy(); off = ~np.eye(N, dtype=bool)
            Ck[off] = np.sign(C[off]) * np.minimum(np.abs(C[off]) + c_boost[k] * (np.abs(C[off]) > .1), .97)
            w_, V_ = np.linalg.eigh(Ck); Ck = V_ @ np.diag(np.clip(w_, 1e-3, None)) @ V_.T
            d_ = np.sqrt(np.diag(Ck)); L_cache[k] = np.linalg.cholesky(Ck / np.outer(d_, d_))
        for t in range(T):
            z = L_cache[s[t]] @ rng.standard_normal(N)
            z *= np.sqrt((nu - 2) / rng.chisquare(nu))  # unit-variance multivariate t(5)
            eps0 = np.sqrt(h) * z                       # GARCH shock WITHOUT the regime multiplier (keeps h stationary)
            r[t] = eps0 * vol_mult[s[t]]
            h = base_vol ** 2 * .08 + (.03 + .06 * (eps0 < 0)) * eps0 ** 2 + .86 * h
        r[:, 5] += 0.0001  # tiny INR drift
        prices = 100 * np.exp(np.cumsum(r, axis=0))
        out = {}
        for j, a in enumerate(ASSETS):
            keep = rng.random(T) > 0.03  # emulate asset-specific holidays
            df = pd.DataFrame({"close": prices[:, j], "volume": rng.lognormal(15, .4, T)}, index=idx)
            out[a] = df[keep]
        return out


@dataclass
class Dataset:
    prices: pd.DataFrame
    returns: pd.DataFrame
    source: str
    synthetic: bool
    quality: dict = field(default_factory=dict)


def build_dataset(raw: dict[str, pd.DataFrame], source: str, synthetic: bool) -> Dataset:
    closes, assets_q = {}, {}
    for a in ASSETS:
        df = raw[a].copy()
        df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
        n0 = len(df)
        dups = int(df.index.duplicated().sum())
        df = df[~df.index.duplicated(keep="last")].sort_index()
        bad = ~(np.isfinite(df["close"]) & (df["close"] > 0))
        df = df[~bad]
        closes[a] = df["close"]
        assets_q[a] = {"raw_rows": n0, "duplicates_removed": dups, "invalid_removed": int(bad.sum()),
                       "first_date": str(df.index.min().date()), "last_date": str(df.index.max().date())}
    prices = pd.DataFrame(closes)
    union_n = len(prices)
    for a in ASSETS:
        assets_q[a]["missing_share_vs_union_calendar"] = float(prices[a].isna().mean())
    common = prices.dropna()
    returns = np.log(common).diff().dropna()
    for a in ASSETS:
        r = returns[a]
        assets_q[a]["extreme_obs_gt5sd"] = int((np.abs(r - r.mean()) > 5 * r.std()).sum())
        assets_q[a]["max_abs_return"] = float(np.abs(r).max())
    gaps = common.index.to_series().diff().dt.days.dropna()
    quality = {"source": source, "synthetic": synthetic, "union_calendar_days": union_n,
               "common_days": len(common), "rows_dropped_for_alignment": union_n - len(common),
               "max_calendar_gap_days": int(gaps.max()), "n_returns": len(returns),
               "start": str(returns.index.min().date()), "end": str(returns.index.max().date()),
               "assets": assets_q,
               "notes": ["Returns are log returns between consecutive common trading dates; no forward-fill.",
                         "USDINR > 0 means rupee depreciation.",
                         "GOLD/CRUDE are USD futures proxies; continuous-contract roll gaps may appear.",
                         "SYNTHETIC data is for development only and is not market history." if synthetic
                         else "Yahoo data is unofficial and subject to provider terms."]}
    return Dataset(prices.loc[common.index], returns, source, synthetic, quality)


def load_dataset(provider: DataProvider | None = None, start: str = "2008-01-01", end: str | None = None,
                 use_cache: bool = True, allow_synthetic: bool = True, cache_dir: Path = DATA_DIR / "cache") -> Dataset:
    cache_dir.mkdir(parents=True, exist_ok=True)
    providers = [provider] if provider else [YahooProvider()]
    if allow_synthetic and not provider:
        providers.append(SyntheticProvider())
    last_err = None
    for p in providers:
        cache = cache_dir / f"{p.name}_{start}_{end or 'latest'}.pkl"
        try:
            if use_cache and cache.exists():
                raw = pickle.loads(cache.read_bytes())
            else:
                raw = p.fetch_all(start, end)
                cache.write_bytes(pickle.dumps(raw))
            ds = build_dataset(raw, p.name, p.is_synthetic)
            if p.is_synthetic:
                log.warning("USING SYNTHETIC DEVELOPMENT DATA — not historical market observations (%s)", last_err)
            return ds
        except Exception as e:  # noqa: BLE001 - logged and surfaced, never swallowed silently
            last_err = e
            log.error("provider %s failed: %s", p.name, e)
    raise DataUnavailable(f"all providers failed: {last_err}")


def split_indices(n: int, train_frac: float, val_frac: float) -> tuple[int, int]:
    """Chronological split points (n_train, n_train+n_val)."""
    a = int(n * train_frac)
    return a, a + int(n * val_frac)
