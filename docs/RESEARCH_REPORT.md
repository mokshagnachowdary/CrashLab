# CRASHLAB research report (auto-generated)

**Data:** yahoo_finance · 2008-01-03 → 2026-11-06 · 4469 daily log returns · split train 2681 / val 893 / test 895 (chronological; test starts 2023-02-06).

**cVAE:** 39,354 parameters, 58 epochs (early stopped), 406s on CPU, best validation loss 31.1, single seed (7). Conditioning variables: per-asset cumulative-return targets (+masks), horizon, volatility regime.

## 1. Out-of-sample distribution fidelity (10-day horizon, unconditional, test period)

| Metric (lower = better) | Gaussian | Gaussian copula | Student-t copula | FHS (GJR-GARCH) | Conditional VAE | Best |
|---|---|---|---|---|---|---|
| Mean Wasserstein (sd units) | 0.535 | 0.484 | 0.501 | 0.258 | 0.572 | **FHS (GJR-GARCH)** |
| Correlation RMS error | 0.191 | 0.186 | 0.183 | 0.185 | 0.178 | **Conditional VAE** |
| |Tail-dep. error| NIFTY–BANK | 0.000 | 0.019 | 0.023 | 0.088 | 0.019 | **Gaussian** |
| |Joint-exceedance error| NIFTY↓∧INR↓ | 0.001 | 0.001 | 0.001 | 0.003 | 0.002 | **Gaussian copula** |
| |Vol-clustering ACF error| | 0.074 | 0.056 | 0.060 | 0.033 | 0.088 | **FHS (GJR-GARCH)** |
| |ES95 error| NIFTY 10d | 0.042 | 0.035 | 0.046 | 0.013 | 0.039 | **FHS (GJR-GARCH)** |

_Real windows overlap (stride 1): effective sample is ~n/h. Models unconditional. No single metric establishes overall superiority._

## 2. Constraint satisfaction (NIFTY −12%, USD/INR +3%, 10 days, extreme regime; 1,000 paths)

| Model | Mode | NIFTY | USDINR |
|---|---|---|---|
| Gaussian | analog_selection | -7.4% (within tol.: 9%) | +2.0% (within tol.: 47%) |
| Gaussian copula | analog_selection | -7.4% (within tol.: 10%) | +1.8% (within tol.: 40%) |
| Student-t copula | analog_selection | -7.1% (within tol.: 11%) | +1.9% (within tol.: 42%) |
| FHS (GJR-GARCH) | analog_selection | -11.1% (within tol.: 44%) | +2.4% (within tol.: 53%) |
| Conditional VAE | native | -11.4% (within tol.: 37%) | +2.6% (within tol.: 39%) |

## 3. VaR / ES backtest (5-day horizon, non-overlapping test windows)

178 windows. Portfolio: {'NIFTY': 0.3, 'BANK': 0.2, 'IT': 0.15, 'GOLD': 0.15, 'CRUDE': 0.05, 'CASH': 0.15}. Non-overlapping windows; small samples => low power, especially at 99%.

**95% level**

| Model | Exceed. (obs/exp) | Kupiec p | Christoffersen ind. p | Cond. coverage p | A–S Z2 | A–S MC p |
|---|---|---|---|---|---|---|
| Gaussian | 1 / 8.9 | 0.001 | 0.915 | 0.003 | -0.89 | 0.999 |
| Gaussian copula | 1 / 8.9 | 0.001 | 0.915 | 0.003 | -0.90 | 1.000 |
| Student-t copula | 2 / 8.9 | 0.004 | 0.831 | 0.017 | -0.81 | 0.996 |
| FHS (GJR-GARCH) | 8 / 8.9 | 0.753 | 0.384 | 0.652 | -0.16 | 0.683 |
| Conditional VAE | 1 / 8.9 | 0.001 | 0.915 | 0.003 | -0.89 | 0.997 |

**99% level**

| Model | Exceed. (obs/exp) | Kupiec p | Christoffersen ind. p | Cond. coverage p | A–S Z2 | A–S MC p |
|---|---|---|---|---|---|---|
| Gaussian | 0 / 1.8 | 0.059 | 1.000 | 0.167 | -1.00 | 1.000 |
| Gaussian copula | 0 / 1.8 | 0.059 | 1.000 | 0.167 | -1.00 | 1.000 |
| Student-t copula | 0 / 1.8 | 0.059 | 1.000 | 0.167 | -1.00 | 1.000 |
| FHS (GJR-GARCH) | 1 / 1.8 | 0.522 | 0.915 | 0.810 | -0.52 | 0.776 |
| Conditional VAE | 0 / 1.8 | 0.059 | 1.000 | 0.167 | -1.00 | 1.000 |

## 4. Ablations (cVAE; single seed — differences of a few percent are within run-to-run noise)

## 5. Measured performance

| Model | 1,000 paths | paths/s | 10,000 paths | paths/s |
|---|---|---|---|---|
| Gaussian | 0.033s | 30285 | 0.35s | 28552 |
| Gaussian copula | 0.683s | 1465 | 6.66s | 1502 |
| Student-t copula | 0.833s | 1200 | 9.29s | 1076 |
| FHS (GJR-GARCH) | 0.037s | 26996 | 0.48s | 20846 |
| Conditional VAE | 0.011s | 94932 | 0.18s | 57097 |

Peak RSS of the benchmark process: 1273 MB (2 CPUs). Conditional generation incl. constraint report; baselines include the 20x analog pool. Measured on this machine only.

_Ablations were not run in this build. Reproduce with `python -m crashlab.pipeline --no-synthetic` (adds the six variants) and `python scripts/ablate_window.py`._

## 6. How to read this honestly

- **Unequal conditioning.** FHS starts every forecast from the filtered volatility at the forecast origin, whereas the Gaussian, copulas and cVAE are unconditional on volatility and trained on the full pre-test history (including crisis periods). When the test period is calmer than the training history those models overstate risk (see backtest exceedances well below expected). A like-for-like comparison would give every model a volatility-state input; this build did not.

- **Data caveat.** Extreme daily log returns above 30% in: CRUDE (futures roll / negative-price episode); these remain in the data and inflate that asset's tails.

- Results are from one dataset, one seed per cVAE variant, and a single chronological split; confidence intervals are only available for the Acerbi–Székely Monte-Carlo test.
- Test windows overlap in section 1, so the effective sample is roughly n/10.
- Backtests have few observations; non-rejection is weak evidence, especially at 99%.
- If the cVAE is not best on a metric, the table says so; nothing is hidden.
