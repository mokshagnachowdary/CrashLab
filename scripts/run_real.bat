@echo off
REM Windows version of run_real.sh. Run from the project root in cmd.
cd backend || exit /b 1
if exist ..\data\cache rmdir /s /q ..\data\cache
if exist ..\artifacts rmdir /s /q ..\artifacts
python -m crashlab.pipeline --no-synthetic || exit /b 1
python ..\scripts\ablate_window.py || exit /b 1
pytest -q
python ..\scripts\benchmark.py > nul
python ..\scripts\make_report.py
python ..\scripts\make_xlsx.py
findstr /c:"\"synthetic\": false" ..\artifacts\manifest.json > nul && (echo OK: trained on REAL data) || (echo ERROR: artifacts are synthetic & exit /b 1)
