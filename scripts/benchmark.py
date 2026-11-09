"""Measure real latency/throughput/memory. Usage: python scripts/benchmark.py  (run from backend/)  -> artifacts/benchmarks.json"""
import json, sys, time
from pathlib import Path
sys.path.insert(0, ".")
import numpy as np, psutil
from crashlab import service
from crashlab.scenarios import ScenarioSpec, generate
S = service.State().load(); assert S.ready, S.error
out = {"cpu_count": psutil.cpu_count(), "models": {}}
for name, m in S.models.items():
    row = {}
    for n in (1000, 10000):
        spec = ScenarioSpec(10, n, "extreme", {"NIFTY": -0.15, "USDINR": 0.04}, 1)
        ts = []
        for _ in range(3):
            t = time.perf_counter(); generate(m, spec, S.ref_sd); ts.append(time.perf_counter() - t)
        row[str(n)] = {"median_seconds": float(np.median(ts)), "scenarios_per_second": float(n / np.median(ts))}
    out["models"][name] = row
def _peak_mb():
    try:
        import resource  # Linux/macOS only
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    except ImportError:  # Windows
        mi = psutil.Process().memory_info()
        return getattr(mi, "peak_wset", mi.rss) / 1048576
out["peak_rss_mb"] = _peak_mb()
out["note"] = "Conditional generation incl. constraint report; baselines include the 20x analog pool. Measured on this machine only."
Path("../artifacts/benchmarks.json").write_text(json.dumps(out, indent=1)); print(json.dumps(out, indent=1))
