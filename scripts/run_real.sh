#!/usr/bin/env bash
# One command, run on a machine WITH internet: real-data training -> tests -> benchmarks -> report + workbook.
set -euo pipefail
cd "$(dirname "$0")/../backend"
rm -rf ../data/cache ../artifacts/*          # never reuse stale/synthetic caches
python -m crashlab.pipeline --no-synthetic   # fails loudly instead of silently falling back to synthetic data
python ../scripts/ablate_window.py
pytest -q
python ../scripts/benchmark.py >/dev/null
python ../scripts/make_report.py
python ../scripts/make_xlsx.py
grep -q '"synthetic": false' ../artifacts/manifest.json && echo "OK: trained on REAL data" || { echo "ERROR: artifacts are synthetic"; exit 1; }
