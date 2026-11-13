# CrashLab system validation report

**Run date:** 2026-11-13  
**Environment:** local Windows workstation; primary app at `127.0.0.1:5173` / `:8000`; performance tests on a separate API process at `127.0.0.1:8001` with temporary SQLite data. No production service or external target was load-tested.

## Executive result

The application builds and the backend suite passes, and the local GET API remained responsive through the tested 1,000-request concurrency tier. However, the evidence does **not** justify calling CrashLab production-ready. Most importantly, the 95% VaR backtest rejects nominal coverage for four of five models on the available test sample; user authentication and per-user data ownership are absent; and database/network/restart fault injection and full browser E2E coverage remain incomplete.

The run found and fixed input-boundary, queue, model-metadata, UI-error-state, and backtest-window defects. The corrected backtest result was persisted to [`artifacts/research_results.json`](../artifacts/research_results.json).

## Coverage and validation

- **Backend:** 33 tests passed in 35.56 seconds, including FHS state-propagation and calibration holdout-isolation regressions.
- **Frontend:** `tsc --noEmit` and `vite build` passed. Vite still reports a 773.55 kB minified JavaScript chunk (218.86 kB gzip).
- **Browser smoke:** Overview and Model Lab loaded against the live local app; model/backtest content appeared and the Model Lab smoke check found no visible error state. The Overview's temporary “Calculating…” state resolved after data loaded. This was a route smoke test, not exhaustive interaction or cross-browser testing.
- **Functional/API workflows exercised:** 15 endpoint patterns/operations covering health and CORS, data overview, story parsing, generation and retrieval for all five models, scenario export, portfolio creation and stress calculation, default risk calculation, historical reference windows, model comparison and metadata, backtesting, deletion rules, malformed bounds, rate limiting, queue-full behavior, oversized chunked bodies, and a failed background simulation.
- **Statistical reference checks:** portfolio path valuation and VaR/ES were compared with separately calculated scalar references; Kupiec POF was compared with an independently calculated binomial likelihood ratio and SciPy chi-square tail probability. Fixed-seed and sampling checks remain in the core suite.
- **Security/configuration checks:** inspected CORS and API/database access patterns, checked tracked filenames for `.env` files, and searched non-ignored workspace files for common AWS/GitHub token formats. The token search found no matches; it is not a comprehensive secret scanner or security assessment.

The existing browser E2E script was not run: its selectors are out of date and Playwright is not installed as a frontend dependency. Manual browser checks do not replace E2E coverage.

## Statistical validation

The loaded artifact reports 4,469 non-synthetic Yahoo Finance daily observations. Chronological splits are train **2,681**, validation **893**, and test **895** observations (test begins 2023-02-06). The 10-day distribution comparison uses **886 overlapping** test windows; the 5-day VaR backtest uses **179 non-overlapping** windows after the boundary fix.

### 95% VaR coverage

Expected exceedances are 8.95 per 179 windows. Intervals below are 95% Wilson intervals for the observed exceedance rate.

| Model | Exceedances | Observed rate (95% Wilson CI) | Kupiec POF p-value |
|---|---:|---:|---:|
| Gaussian | 1/179 | 0.56% (0.10%–3.10%) | 0.00057 |
| Gaussian copula | 1/179 | 0.56% (0.10%–3.10%) | 0.00057 |
| Student-t copula | 2/179 | 1.12% (0.31%–3.98%) | 0.00422 |
| FHS | 8/179 | 4.47% (2.28%–8.57%) | 0.74025 |
| cVAE | 1/179 | 0.56% (0.10%–3.10%) | 0.00057 |

At the 5% test level, four models reject nominal 95% VaR coverage; their observed exceedance rates are substantially below 5%, indicating conservative thresholds on this test sample. FHS does not reject coverage, but 179 windows provide limited power and do not establish general calibration.

At 99% VaR, expected exceedances are 1.79. FHS had 1/179 (Kupiec p=0.517); each other model had 0/179 (p=0.0578). The zero-exceedance Wilson interval still extends to 2.10%, so these small-sample results are not strong evidence of 99% calibration.

The 95% Acerbi–Székely result for FHS was Z2=-0.161 (Monte Carlo p=0.666, 1,000 draws); it did not indicate ES underestimation. Other models' 95% results were also non-significant in the underestimation direction. These tests are low-powered with this sample and are not a guarantee of tail accuracy.

Stored 10-day OOS mean Wasserstein distances are Gaussian 0.5351, Gaussian copula 0.4836, t-copula 0.5011, FHS 0.2583, and cVAE 0.5724. These are the existing single-split artifact results, not independently recomputed in this audit; no uncertainty intervals are available. They should not be read as a single overall model ranking. The training sample sizes also differ: baselines use train+validation, while CVAE weights use train and validation is used for early stopping.

### Corrected backtest boundary

The old range omitted the last complete non-overlapping five-day window, producing 178 observations. The exclusive stop now includes that window, producing 179. A focused regression test covers the exact boundary; `scripts/recompute_backtest.py --write` recomputed and persisted the corrected metrics from the existing artifacts. The API was restarted and `/api/backtesting/fhs` returned `n_windows=179`.

The FHS forecast state is now advanced only through observations after the model's actual fit endpoint. This fixes replaying historical returns from a terminal variance state and also handles a backtest that begins later than the fit endpoint. The corrected original-artifact 95% FHS result remains 8 exceedances in 179 windows (Kupiec p=0.74025); the metrics were recomputed rather than assumed unchanged.

The separate all-model VaR/ES calibration experiment and its untouched-holdout results are documented in [RISK_CALIBRATION_REPORT.md](./RISK_CALIBRATION_REPORT.md); calibration candidates were not promoted to the application artifacts.

## Load and latency results

The patched API was tested against an isolated SQLite database containing 1,000 scratch scenario rows. For each tier, the harness sent 1,000 GET requests using pooled HTTP connections and capped in-flight requests at the named concurrency. The test process used `CRASHLAB_RATE_PER_MIN=50000` to measure service capacity rather than the production default rate limit; the result therefore does not represent the default rate-limited configuration. All 1,000 responses at every tier were HTTP 200 for both endpoints.

### `/api/health`

| Concurrency | Mean ms | P50 ms | P95 ms | P99 ms | Requests/s |
|---:|---:|---:|---:|---:|---:|
| 1 | 4.80 | 4.60 | 7.95 | 9.89 | 194.35 |
| 10 | 55.49 | 47.26 | 125.39 | 160.09 | 166.50 |
| 50 | 389.40 | 284.89 | 1,141.13 | 1,709.17 | 119.73 |
| 100 | 982.69 | 540.05 | 3,207.85 | 5,576.86 | 93.31 |
| 250 | 2,376.01 | 1,766.56 | 6,743.43 | 9,934.65 | 85.85 |
| 500 | 4,146.79 | 3,008.70 | 9,476.36 | 11,327.86 | 74.48 |
| 1,000 | 6,627.59 | 7,386.61 | 7,768.07 | 8,223.06 | 112.70 |

### `/api/scenarios?limit=100`

| Concurrency | Mean ms | P50 ms | P95 ms | P99 ms | Requests/s |
|---:|---:|---:|---:|---:|---:|
| 1 | 16.64 | 16.39 | 21.54 | 26.44 | 58.69 |
| 10 | 165.94 | 164.08 | 206.82 | 269.83 | 59.25 |
| 50 | 824.02 | 825.47 | 1,256.07 | 1,448.07 | 58.24 |
| 100 | 1,714.61 | 1,758.40 | 2,233.75 | 2,653.14 | 55.08 |
| 250 | 3,920.79 | 4,313.13 | 4,704.38 | 5,076.98 | 55.28 |
| 500 | 7,657.31 | 8,855.78 | 10,856.05 | 11,517.45 | 50.07 |
| 1,000 | 12,897.08 | 14,022.46 | 18,456.47 | 18,661.76 | 49.02 |

These are local measurements, not Render capacity promises. The 1,000-request list test completed without application errors but had high tail latency. At that tier, the API process used 45.094 CPU seconds over 20.621 wall seconds for the list endpoint; observed process peak working set was **544.1 MB**. The health endpoint used 1.172 CPU seconds over 8.369 wall seconds; peak working set after that run was 479.9 MB. A post-run host sample showed 32.8%–38.2% total CPU and 3.4 GB available memory. Database query time was not isolated from endpoint serialization, and database saturation or long-running concurrent simulations were not load-tested.

## Fixes made

1. Replaced the request-body length-only protection with a streaming ASGI byte limit; chunked bodies over 200,000 bytes now return 413. CORS wraps the guard responses.
2. Bounded scenario list/export parameters, rejected unsupported formats and negative seeds, and rejected non-positive portfolio IDs rather than falling back to default risk data.
3. Bounded active-plus-queued simulation admission (one active plus eight queued by default); full queues return 429. Added the setting to the Render blueprint and deployment documentation.
4. Corrected the last-window omission in the VaR backtest and refreshed the generated backtest artifact.
5. Corrected per-model training-row metadata and documented the unequal fitting samples.
6. Added an explicit Model Lab error state for backtest failures instead of leaving a skeleton.
7. Isolated API tests from the user's data directory and added independent risk/backtest and controlled failure regressions.
8. Added `scripts/api_load_test.py`, a GET-only harness restricted to loopback targets, and `scripts/recompute_backtest.py` for repeatable artifact backtest refreshes.

The separate copula covariance-stability change already present before this audit was preserved and covered by the passing suite. The independent portfolio reference did not find a portfolio valuation defect.

## Security, reliability, and unresolved items

- **Production blocker — no authentication or user-level authorization/ownership.** Scenarios and portfolios are service-wide. Any client that can reach the API can list/read/export shared scenarios, create portfolios and simulations, and delete eligible custom scenarios. CORS is not authorization. Do not expose this service as a multi-user production application until an authentication and ownership model is implemented and tested.
- The in-memory per-IP rate limiter is process-local and is not a distributed abuse-control boundary. The API rate limit is not a substitute for authentication, proxy-aware client identity, or infrastructure-level controls.
- Database outage, invalid database credentials, abrupt process termination/restart, interrupted job recovery, network partition, and persistent-store loss were not injected. A queued/running job may remain stale after a process restart; recovery semantics need a design and regression test.
- No production database saturation benchmark or repeated simulation-worker concurrency test was performed. Queue-full behavior was tested deterministically; the configured nine-slot queue was not filled with nine expensive live jobs.
- The frontend was not exhaustively tested for every button/form, responsive layout, browser console issue, or all loading/error/empty states. Existing E2E selectors need repair.
- SQL injection, XSS, and CSRF received code/configuration inspection only, not a full fuzz or penetration test. The app has no upload route in the exercised workflows. The limited credential-pattern search is not a comprehensive secrets audit.
- Only the locally available single market dataset and existing model artifact were evaluated. Distribution metrics are single-split, overlapping-window values; the VaR backtest has only 179 non-overlapping windows and especially weak 99% power. Results do not establish general statistical accuracy.
- The frontend bundle-size warning remains. No deployment was performed or validated against production infrastructure.

## Reproduction commands

Run backend tests in an isolated data directory:

```powershell
Set-Location B:\crashlab\backend
$env:CRASHLAB_DATA_DIR = Join-Path $env:TEMP 'crashlab-validation-test'
..\.venv\Scripts\python.exe -m pytest -q
```

Build the frontend:

```powershell
Set-Location B:\crashlab\frontend
npm run build
```

Recompute backtest results from the existing model artifacts (no model retraining):

```powershell
Set-Location B:\crashlab\backend
..\.venv\Scripts\python.exe ..\scripts\recompute_backtest.py
..\.venv\Scripts\python.exe ..\scripts\recompute_backtest.py --write
```

For load tests, start a separate local API with a temporary data directory and a test-only high rate limit. Do not use the primary user database for this run:

```powershell
Set-Location B:\crashlab\backend
$env:CRASHLAB_DATA_DIR = Join-Path $env:TEMP 'crashlab-load-test'
$env:CRASHLAB_ARTIFACT_DIR = 'B:\crashlab\artifacts'
$env:DATABASE_URL = "sqlite:///$($env:CRASHLAB_DATA_DIR)\crashlab.db"
$env:CRASHLAB_RATE_PER_MIN = '50000'
..\.venv\Scripts\python.exe -m uvicorn crashlab.api:app --host 127.0.0.1 --port 8001
```

In another PowerShell window, use the API PID returned by `Get-NetTCPConnection` if CPU/memory sampling is desired:

```powershell
Set-Location B:\crashlab
.venv\Scripts\python.exe scripts\api_load_test.py --url http://127.0.0.1:8001 --path /api/health --levels 1,10,50,100,250,500,1000 --requests-per-level 1000 --pid <API_PID>
.venv\Scripts\python.exe scripts\api_load_test.py --url http://127.0.0.1:8001 --path '/api/scenarios?limit=100' --levels 1,10,50,100,250,500,1000 --requests-per-level 1000 --pid <API_PID>
```

The measured scenario-list run used a scratch database with 1,000 scenario rows; a fresh database will have different list-endpoint timings. The load harness only allows loopback HTTP URLs and only issues GETs.
