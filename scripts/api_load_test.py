"""Bounded, GET-only API load test for a local CrashLab instance."""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
from urllib.parse import urlparse

import httpx
import psutil

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
READ_PATHS = ("/api/health", "/api/scenarios?limit=100")
DEFAULT_LEVELS = (1, 10, 50, 100, 250, 500, 1000)


def _percentile(samples: list[float], percentile: float) -> float:
    ordered = sorted(samples)
    return ordered[max(0, math.ceil(percentile * len(ordered)) - 1)]


async def _request(
    client: httpx.AsyncClient,
    url: str,
    semaphore: asyncio.Semaphore,
) -> tuple[int | None, float, str | None]:
    async with semaphore:
        return await _send_request(client, url)


async def _send_request(
    client: httpx.AsyncClient,
    url: str,
) -> tuple[int | None, float, str | None]:
    started = time.perf_counter()
    try:
        response = await client.get(url)
        return response.status_code, (time.perf_counter() - started) * 1000, None
    except httpx.TimeoutException as error:
        return None, (time.perf_counter() - started) * 1000, type(error).__name__
    except httpx.NetworkError as error:
        return None, (time.perf_counter() - started) * 1000, type(error).__name__
    except httpx.RequestError as error:
        return None, (time.perf_counter() - started) * 1000, type(error).__name__


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--path", choices=READ_PATHS, default="/api/health")
    parser.add_argument("--levels", default=",".join(map(str, DEFAULT_LEVELS)))
    parser.add_argument("--requests-per-level", type=int, default=1000)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--pid", type=int, help="sample CPU and memory for the local API process")
    args = parser.parse_args()

    parsed = urlparse(args.url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in LOCAL_HOSTS
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        parser.error("--url must be an unauthenticated http URL on localhost")
    if not 1 <= args.requests_per_level <= 10_000 or args.timeout <= 0:
        parser.error("requests-per-level must be 1..10000 and timeout must be positive")
    try:
        levels = [int(level) for level in args.levels.split(",")]
    except ValueError:
        parser.error("--levels must be comma-separated integers")
    if not levels or any(level < 1 or level > 1000 for level in levels):
        parser.error("concurrency levels must be in 1..1000")
    process = psutil.Process(args.pid) if args.pid is not None else None

    url = args.url.rstrip("/") + args.path
    results = []
    for level in levels:
        cpu_before = process.cpu_times() if process else None
        memory_before = process.memory_info() if process else None
        started = time.perf_counter()
        async def run_level():
            limits = httpx.Limits(max_connections=level, max_keepalive_connections=level)
            async with httpx.AsyncClient(limits=limits, timeout=args.timeout, trust_env=False) as client:
                semaphore = asyncio.Semaphore(level)
                return await asyncio.gather(
                    *(_request(client, url, semaphore) for _ in range(args.requests_per_level))
                )

        responses = asyncio.run(run_level())
        elapsed = time.perf_counter() - started
        cpu_after = process.cpu_times() if process else None
        memory_after = process.memory_info() if process else None
        latencies = [latency for _, latency, _ in responses]
        status_counts: dict[str, int] = {}
        error_counts: dict[str, int] = {}
        for status, _, error_type in responses:
            key = str(status) if status is not None else "network_error"
            status_counts[key] = status_counts.get(key, 0) + 1
            if error_type:
                error_counts[error_type] = error_counts.get(error_type, 0) + 1
        results.append({
            "endpoint": args.path,
            "concurrency": level,
            "requests": len(responses),
            "duration_seconds": round(elapsed, 3),
            "requests_per_second": round(len(responses) / elapsed, 2),
            "mean_ms": round(statistics.fmean(latencies), 2),
            "p50_ms": round(_percentile(latencies, 0.50), 2),
            "p95_ms": round(_percentile(latencies, 0.95), 2),
            "p99_ms": round(_percentile(latencies, 0.99), 2),
            "non_200_rate": round(sum(status != 200 for status, _, _ in responses) / len(responses), 4),
            "status_counts": status_counts,
            "error_counts": error_counts,
        })
        if process and cpu_before and cpu_after and memory_before and memory_after:
            results[-1]["api_cpu_seconds"] = round(
                (cpu_after.user + cpu_after.system) - (cpu_before.user + cpu_before.system),
                3,
            )
            results[-1]["api_rss_start_mb"] = round(memory_before.rss / 1048576, 1)
            results[-1]["api_rss_end_mb"] = round(memory_after.rss / 1048576, 1)
            peak_working_set = getattr(memory_after, "peak_wset", memory_after.rss)
            results[-1]["api_peak_working_set_mb"] = round(peak_working_set / 1048576, 1)
    print(json.dumps(results, indent=2))
    return int(any("network_error" in result["status_counts"] for result in results))


if __name__ == "__main__":
    raise SystemExit(main())
