# VaR/ES calibration study

**Run date:** 2026-11-13  
**Status:** Calibration did not meet the all-model objective. No candidate weights or offsets were promoted to the live application.

## Result

An additive 95% VaR residual correction improved the VaR coverage p-value for some candidates, but **four of five models still reject nominal 95% coverage** on the untouched chronological test segment at the 5% level. FHS is the only candidate for which Kupiec's test does not reject after calibration; that is not proof of correct calibration. The requested “perfect” results were not achieved, and the study does not justify claiming that they were.

The correction is an empirical location adjustment, not a change to the scenario generator. It is specific to the fixed reference portfolio and five-day horizon below; it must not be applied to arbitrary user portfolios or treated as a general model improvement. The same fitted offset is added to both VaR and ES, so ES was not independently calibrated.

## Protocol and sample

The study used 4,469 non-synthetic Yahoo Finance observations and a fixed chronological split:

| Segment | Rows | Endpoint |
|---|---:|---|
| cVAE fitting | 2,457 (55%) | 2018-06-04 |
| Model selection / cVAE early stopping | next 223 | 2019-05-15 |
| Baseline candidate fit ends | 2,680 rows (60%) | 2019-05-15 |
| Calibration | 178 non-overlapping five-day windows | through 2023-02-03 |
| Final test | 179 non-overlapping five-day windows | 2023-02-06–2026-11-06 |

Baseline candidate models were fit through row 2,680. The cVAE used 2,457 training rows and 223 early-stopping rows; its fixed configuration ran 120 epochs (best validation loss 1.7126). The calibration segment was not used for fitting, and the final test segment was not used for fitting or offset selection. Candidate weights were not saved or promoted.

For each model, the calibration offset is the “higher” empirical 95th percentile of `realized portfolio loss − raw VaR95` on calibration windows. That offset is added to both VaR95 and ES95. The test VaR/ES forecasts use 1,500 Monte Carlo paths per window; Acerbi–Székely p-values use 1,000 Monte Carlo draws.

The reference portfolio is NIFTY 30%, BANK 20%, IT 15%, GOLD 15%, CRUDE 5%, CASH 15%. Offsets are percentage points of portfolio value. The final holdout is now a one-time evaluation set; do not use its results to choose another offset or model configuration.

## Final-holdout results

Expected exceedances under 95% VaR are 8.95 in 179 windows. Intervals are exact Clopper–Pearson 95% intervals for exceedance probability **under an independent Bernoulli assumption**; market windows may be dependent, so these intervals can understate uncertainty.

| Candidate | Offset (pp) | Raw VaR95 exceedances | Raw Kupiec p | Adjusted VaR95 exceedances | Adjusted Kupiec p | Adjusted ES Z2 / MC p |
|---|---:|---:|---:|---:|---:|---:|
| Gaussian | -0.591 | 1/179 (0.56%; CI 0.01–3.07%) | 0.00057 | 2/179 (1.12%; CI 0.14–3.98%) | 0.00422 | -0.778 / 0.996 |
| Gaussian copula | -0.366 | 2/179 (1.12%; CI 0.14–3.98%) | 0.00422 | 3/179 (1.68%; CI 0.35–4.82%) | 0.01851 | -0.730 / 1.000 |
| Student-t copula | -0.408 | 2/179 (1.12%; CI 0.14–3.98%) | 0.00422 | 2/179 (1.12%; CI 0.14–3.98%) | 0.00422 | -0.805 / 0.998 |
| FHS | +0.231 | 9/179 (5.03%; CI 2.32–9.33%) | 0.98633 | 7/179 (3.91%; CI 1.59–7.89%) | 0.48758 | -0.318 / 0.840 |
| cVAE | -0.378 | 1/179 (0.56%; CI 0.01–3.07%) | 0.00057 | 2/179 (1.12%; CI 0.14–3.98%) | 0.00422 | -0.780 / 0.998 |

After adjustment, Gaussian, Gaussian copula, Student-t copula, and cVAE still reject 95% VaR coverage. Their realized exceedance rates remain substantially below the nominal 5%; the corrections reduce but do not remove that conservatism. FHS does not reject, but its adjusted count is 7 rather than the expected 8.95 and the sample is small. A non-significant p-value is not evidence that the model is exactly calibrated.

The calibration windows show 9 adjusted exceedances per model (expected 8.9), by construction of the fitted quantile. Those in-sample counts are **not** independent validation.

No offset was fitted for 99% VaR. On this test segment, the candidate Gaussian, Gaussian-copula, t-copula, and cVAE forecasts each had 0/179 exceedances (Kupiec p=0.05785); FHS had 1/179 (p=0.51739). This tail sample is too small to establish 99% accuracy.

The adjusted Acerbi–Székely results do not reject ES underestimation, but their high p-values do not establish exact ES calibration. The location shift is shared with VaR rather than fitted as an independent ES correction.

## FHS state correction

The study exposed a second edge case in FHS backtesting: candidate models are fit through row 2,680, while the test starts at row 3,574. A one-row initialization skipped the observed calibration-period returns. FHS state advancement now begins at the model's actual fit endpoint and filters every subsequent observed return before the forecast date. Legacy pickles without an explicit fit-row count use the stored residual-history length. A regression test verifies both the post-fit gap and subsequent five-day state updates.

The original saved model artifact is fit through row 3,574, so its corrected 179-window baseline does not have this gap. It still yields 95% VaR counts of 1, 1, 2, 8, and 1 for Gaussian, Gaussian copula, Student-t copula, FHS, and cVAE, respectively; the four non-FHS Kupiec tests reject at 5%.

## Reproduction and artifacts

```powershell
Set-Location B:\crashlab
.\.venv\Scripts\python.exe scripts\tune_var_es.py --paths 1500 --output artifacts\risk_calibration_study.json

Set-Location B:\crashlab\backend
..\.venv\Scripts\python.exe -m pytest -q
```

The complete machine-readable results, offsets, split dates, and cVAE training metadata are in [`artifacts/risk_calibration_study.json`](../artifacts/risk_calibration_study.json). The backend regression suite passed **33 tests** after the FHS state fix. This study is local research evidence, not a production-readiness certification.
