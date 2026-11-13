"""FastAPI application."""
from __future__ import annotations

import csv
import io
import logging
import os
import re
import threading
import time
import uuid
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, text

from . import db, risk, service
from .config import ASSETS, DATA_DIR, MAX_HORIZON, MAX_SCENARIOS, REGIMES
from .parser import parse_story
from .scenarios import ScenarioSpec, generate

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format='{"t":"%(asctime)s","lvl":"%(levelname)s","m":"%(message)s"}')
log = logging.getLogger("crashlab")
app = FastAPI(title="CRASHLAB API", version="1.0.0",
              description="Generative financial stress testing. Research/education tool — not investment advice.")
DEFAULT_CORS_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://crashlab-qrqs.onrender.com",
}
configured_cors_origins = {
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
}
STATE = service.State()
MAX_CONCURRENT_SIMULATIONS = int(os.getenv("CRASHLAB_MAX_CONCURRENT_SIMULATIONS", "1"))
CONFIGURED_WORKERS = int(os.getenv("CRASHLAB_WORKERS", "1"))
MAX_QUEUED_SIMULATIONS = int(os.getenv("CRASHLAB_MAX_QUEUED_SIMULATIONS", "8"))
if MAX_CONCURRENT_SIMULATIONS < 1 or CONFIGURED_WORKERS < 1 or MAX_QUEUED_SIMULATIONS < 0:
    raise ValueError("simulation worker and concurrency limits must be positive; queue limit cannot be negative")
POOL = ThreadPoolExecutor(
    max_workers=min(CONFIGURED_WORKERS, MAX_CONCURRENT_SIMULATIONS)
)
SIMULATION_SLOTS = threading.BoundedSemaphore(
    min(CONFIGURED_WORKERS, MAX_CONCURRENT_SIMULATIONS) + MAX_QUEUED_SIMULATIONS
)
MODEL_NAMES = ["fhs", "gaussian", "gaussian_copula", "t_copula", "cvae"]
MAX_BODY = 200_000
RATE = int(os.getenv("CRASHLAB_RATE_PER_MIN", 120))


class RequestGuardMiddleware:
    def __init__(self, app, max_body: int, rate: int):
        self.app = app
        self.max_body = max_body
        self.rate = rate
        self.hits: dict[str, deque] = defaultdict(deque)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = scope.get("headers", [])
        content_length = next(
            (value for name, value in headers if name.lower() == b"content-length"),
            None,
        )
        if content_length is not None:
            try:
                declared_length = int(content_length)
            except ValueError:
                response = JSONResponse({"detail": "invalid content-length"}, status_code=400)
                await response(scope, receive, send)
                return
            if declared_length < 0:
                response = JSONResponse({"detail": "invalid content-length"}, status_code=400)
                await response(scope, receive, send)
                return
            if declared_length > self.max_body:
                response = JSONResponse({"detail": "request too large"}, status_code=413)
                await response(scope, receive, send)
                return

        client = scope.get("client")
        ip = client[0] if client else "?"
        hits = self.hits[ip]
        now = time.time()
        while hits and hits[0] < now - 60:
            hits.popleft()
        if len(hits) >= self.rate:
            response = JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
            await response(scope, receive, send)
            return
        hits.append(now)

        received = 0
        oversized = False

        async def limited_receive():
            nonlocal received, oversized
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body:
                    oversized = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def limited_send(message):
            if not oversized:
                await send(message)

        await self.app(scope, limited_receive, limited_send)
        if oversized:
            response = JSONResponse({"detail": "request too large"}, status_code=413)
            await response(scope, receive, send)


def _process_memory_mb() -> tuple[float | None, float | None]:
    try:
        with open("/proc/self/status", encoding="ascii") as status_file:
            status = status_file.read()
        values = {
            name: float(value) / 1024
            for name, value in re.findall(r"^(VmRSS|VmHWM):\s+(\d+)\s+kB$", status, re.MULTILINE)
        }
        return values.get("VmRSS"), values.get("VmHWM")
    except OSError:
        return None, None


def _log_simulation_memory(job_id: str, phase: str, req: dict, started: float) -> None:
    rss_mb, peak_rss_mb = _process_memory_mb()
    log.info(
        "simulation_memory job=%s phase=%s model=%s n=%d horizon=%d "
        "rss_mb=%s process_peak_rss_mb=%s elapsed_s=%.3f",
        job_id, phase, req["model"], req["n"], req["horizon"],
        f"{rss_mb:.1f}" if rss_mb is not None else "unavailable",
        f"{peak_rss_mb:.1f}" if peak_rss_mb is not None else "unavailable",
        time.perf_counter() - started,
    )


@app.on_event("startup")
def startup():
    db.init_db(); STATE.load()
    if not STATE.ready: log.error("artifacts not loaded: %s", STATE.error)
    log.info(
        "simulation_workers=%d max_concurrent_simulations=%d inference_batch_size=%s",
        min(CONFIGURED_WORKERS, MAX_CONCURRENT_SIMULATIONS),
        MAX_CONCURRENT_SIMULATIONS,
        os.getenv("CRASHLAB_SIM_BATCH_SIZE", "256"),
    )


app.add_middleware(RequestGuardMiddleware, max_body=MAX_BODY, rate=RATE)


# Register after the HTTP guard so CORS wraps rate-limit and other middleware responses.
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(DEFAULT_CORS_ORIGINS | configured_cors_origins),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Authorization", "Content-Type", "Origin", "X-Requested-With"],
    allow_credentials=False,
)


def need_ready():
    if not STATE.ready: raise HTTPException(503, f"model artifacts unavailable: {STATE.error}")


class ParseReq(BaseModel):
    text: str = Field(min_length=3, max_length=1000)


class GenerateReq(BaseModel):
    name: str = Field("Custom scenario", max_length=160)
    model: str = "cvae"
    horizon: int = Field(10, ge=1, le=MAX_HORIZON)
    n: int = Field(1000, ge=1, le=MAX_SCENARIOS)
    regime: str | None = None
    shocks: dict[str, float] = {}
    seed: int = Field(42, ge=0, le=2**32 - 1)
    portfolio_id: int | None = None
    source: Literal["preset", "custom"] = "custom"
    preset_name: str | None = Field(None, max_length=80)


class PortfolioReq(BaseModel):
    name: str = Field("My portfolio", max_length=120)
    weights: dict[str, float]
    initial_value: float = Field(1_000_000.0, gt=0, le=1e12)
    normalize: bool = False
    allow_short: bool = False


class StressReq(BaseModel):
    simulation_id: str


def _job_dict(j: db.SimulationJob):
    return {"id": j.id, "status": j.status, "progress": j.progress, "name": j.name, "request": j.request, "meta": j.meta,
            "error": j.error, "created_at": j.created_at.isoformat(), "finished_at": j.finished_at.isoformat() if j.finished_at else None}


def _run_job(job_id: str, req: dict):
    started = time.perf_counter()
    _log_simulation_memory(job_id, "started", req, started)
    with db.SessionLocal() as s:
        job = s.get(db.SimulationJob, job_id); job.status, job.progress = "running", 0.1; s.commit()
        try:
            spec = ScenarioSpec(req["horizon"], req["n"], req["regime"], req["shocks"], req["seed"])
            model = STATE.models[req["model"]]
            kw = {}
            g = generate(model, spec, STATE.ref_sd)
            _log_simulation_memory(job_id, "generated", req, started)
            job.progress = 0.7; s.commit()
            sim = g["sim"]
            path = DATA_DIR / "simulations" / f"{job_id}.npz"
            np.savez_compressed(path, sim=sim.astype(np.float32))
            _log_simulation_memory(job_id, "saved", req, started)
            job.array_path, job.meta = str(path), g["meta"]
            job.summary = service.sim_summary(sim)
            _log_simulation_memory(job_id, "summarized", req, started)
            job.status, job.progress, job.finished_at = "completed", 1.0, db.now()
        except Exception as e:
            log.exception("job %s failed", job_id)
            job.status, job.error, job.finished_at = "failed", f"{type(e).__name__}: {e}"[:1900], db.now()
            _log_simulation_memory(job_id, "failed", req, started)
        s.commit()


def _load_sim(job: db.SimulationJob) -> np.ndarray:
    if job.status != "completed" or not job.array_path: raise HTTPException(409, f"simulation is {job.status}")
    return np.load(job.array_path)["sim"].astype(np.float64)


@app.get("/api/health")
def health():
    try:
        with db.engine.connect() as c: c.execute(text("select 1")); dbok = True
    except Exception as e:
        log.error("db check failed: %s", e); dbok = False
    return {"api": "ok", "database": "ok" if dbok else "error", "models_loaded": STATE.ready, "models_error": STATE.error,
            "data_synthetic": STATE.manifest["synthetic"] if STATE.ready else None,
            "simulation_engine": "ok" if STATE.ready else "unavailable", "checked_at": time.time()}


@app.get("/api/data/status")
def data_status():
    need_ready(); o = service.data_overview(STATE)
    return {k: o[k] for k in ("synthetic", "source", "start", "end", "n_obs", "quality")}


@app.get("/api/data/overview")
def data_overview():
    need_ready(); return service.data_overview(STATE)


@app.get("/api/data/history-ref")
def history_ref(asset: str, horizon: int = 10):
    """Worst historical window of `horizon` days for the asset (max for USDINR = worst rupee depreciation), cumulative simple return path."""
    need_ready()
    if asset not in ASSETS: raise HTTPException(422, f"unknown asset {asset}")
    if not 1 <= horizon <= MAX_HORIZON: raise HTTPException(422, f"horizon must be 1..{MAX_HORIZON}")
    x = STATE.returns[asset].values; c = np.concatenate([[0.0], np.cumsum(x)])
    fin = c[horizon:] - c[:-horizon]; i = int(np.argmax(fin) if asset == "USDINR" else np.argmin(fin))
    idx = STATE.returns.index
    return {"asset": asset, "horizon": horizon, "start": str(idx[i].date()), "end": str(idx[i + horizon - 1].date()),
            "path": np.expm1(c[i:i + horizon + 1] - c[i]).round(5).tolist()}


def _trained_at():
    return time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime((STATE.art / "cvae.pt").stat().st_mtime))


@app.get("/api/models")
def models():
    need_ready(); r = STATE.results
    out = []
    for n in MODEL_NAMES:
        m = STATE.models[n]
        split = r["split"]
        trained_rows = split["n_train"] if n == "cvae" else split["n_train"] + split["n_val"]
        training_period = "train only; validation used for early stopping" if n == "cvae" else "train+validation"
        out.append({"id": n, "type": {"cvae": "deep generative (conditional VAE, GRU)", "fhs": "GJR-GARCH filtered historical simulation",
                                      "t_copula": "Student-t copula + t marginals", "gaussian_copula": "Gaussian copula + t marginals",
                                      "gaussian": "multivariate Gaussian"}[n], "version": m.version, "trained": True, "trained_at": _trained_at(),
                    "validation": (f"early-stopped, best val loss {r['cvae']['best_val_loss']:.1f}" if n == "cvae" else "evaluated out-of-sample (test period)"),
                    "supports_native_conditioning": m.supports_conditioning,
                    "trained_on": f"{trained_rows} daily returns ({training_period}); test from {split['test_start']}",
                    "train_seconds": r["cvae"]["train_seconds"] if n == "cvae" else None,
                    "params": r["cvae"]["params"] if n == "cvae" else None})
    return {"models": out, "cvae_history": r["cvae"]["history"], "cvae_config": r["cvae"]["config"],
            "fhs_diagnostics": r["fhs_diagnostics"], "t_copula_nu": r["t_copula_nu"]}


@app.get("/api/models/comparison")
def comparison():
    need_ready(); r = STATE.results
    return {"oos": r["oos_comparison"], "constraints": r["constraint_satisfaction"], "split": r["split"],
            "synthetic": STATE.manifest["synthetic"], "ablations": r.get("ablations"), "ablation_note": r.get("ablation_note")}


@app.get("/api/backtesting/{model_id}")
def backtesting(model_id: str):
    need_ready(); r = STATE.results["backtest"]
    if model_id not in r["results"]: raise HTTPException(404, "unknown model")
    return {"model": model_id, **{k: v for k, v in r.items() if k != "results"}, "results": r["results"][model_id]}


@app.get("/api/research/metrics")
def research_metrics():
    need_ready(); return STATE.results


@app.post("/api/scenarios/parse")
def parse(req: ParseReq):
    p = parse_story(req.text)
    spec = ScenarioSpec(horizon=p["horizon"] or 10, shocks=p["shocks"], regime=p["regime"])
    return {**p, "validation_errors": spec.validate(), "defaults_applied": {"horizon": p["horizon"] is None}}


@app.post("/api/scenarios/generate", status_code=202)
def generate_scenarios(req: GenerateReq):
    need_ready()
    errs = ScenarioSpec(req.horizon, req.n, req.regime, req.shocks, req.seed).validate()
    if req.model not in MODEL_NAMES: errs.append(f"model must be one of {MODEL_NAMES}")
    if req.source == "preset" and not req.preset_name:
        errs.append("preset_name is required for built-in preset scenarios")
    if req.source == "custom" and req.preset_name:
        errs.append("preset_name is only valid for built-in preset scenarios")
    if errs: raise HTTPException(422, errs)
    if not SIMULATION_SLOTS.acquire(blocking=False):
        raise HTTPException(429, "simulation queue is full; retry after a running job completes")
    jid = uuid.uuid4().hex[:16]
    submitted = False
    try:
        with db.SessionLocal() as s:
            s.add(db.SimulationJob(id=jid, name=req.name, request=req.model_dump()))
            s.commit()
        try:
            future = POOL.submit(_run_job, jid, req.model_dump())
        except RuntimeError as exc:
            with db.SessionLocal() as s:
                job = s.get(db.SimulationJob, jid)
                if job:
                    job.status, job.error, job.finished_at = "failed", "simulation executor unavailable", db.now()
                    s.commit()
            raise HTTPException(503, "simulation executor is unavailable") from exc
        submitted = True
        future.add_done_callback(lambda _: SIMULATION_SLOTS.release())
    finally:
        if not submitted:
            SIMULATION_SLOTS.release()
    return {"id": jid, "status": "queued"}


@app.get("/api/scenarios")
def list_scenarios(limit: int = Query(default=20, ge=1)):
    with db.SessionLocal() as s:
        jobs = s.scalars(select(db.SimulationJob).order_by(db.SimulationJob.created_at.desc()).limit(min(limit, 100))).all()
        return [_job_dict(j) for j in jobs]


@app.get("/api/scenarios/{sid}")
def get_scenario(sid: str, full: bool = True):
    with db.SessionLocal() as s:
        j = s.get(db.SimulationJob, sid)
        if not j: raise HTTPException(404, "not found")
        d = _job_dict(j)
        if full and j.status == "completed": d["summary"] = j.summary
        return d


@app.delete("/api/scenarios/{sid}")
def delete_scenario(sid: str):
    with db.SessionLocal() as s:
        j = s.get(db.SimulationJob, sid)
        if not j: raise HTTPException(404, "scenario not found")
        if j.request.get("source") != "custom":
            raise HTTPException(403, "only custom Story Mode scenarios can be deleted; built-in and older runs are protected")
        if j.status in ("queued", "running"):
            raise HTTPException(409, f"cannot delete a scenario while it is {j.status}")

        artifact = None
        if j.array_path:
            simulations_dir = (DATA_DIR / "simulations").resolve()
            artifact = Path(j.array_path).resolve()
            try:
                artifact.relative_to(simulations_dir)
            except ValueError:
                log.error("refusing to delete scenario artifact outside simulations directory: %s", artifact)
                raise HTTPException(500, "scenario artifact path is invalid")
            try:
                artifact.unlink(missing_ok=True)
            except OSError as e:
                log.exception("failed to remove scenario artifact %s", artifact)
                raise HTTPException(500, "could not remove scenario data; scenario was not deleted") from e

        s.delete(j)
        s.commit()
        return {"deleted": sid}


@app.get("/api/scenarios/{sid}/export")
def export(
    sid: str,
    format: Literal["json", "csv"] = "json",
    max_paths: int = Query(default=1000, ge=1, le=MAX_SCENARIOS),
):
    with db.SessionLocal() as s:
        j = s.get(db.SimulationJob, sid)
        if not j: raise HTTPException(404, "not found")
        sim = _load_sim(j)[:max_paths]
    if format == "json":
        return {"meta": j.meta, "assets": ASSETS, "log_returns": sim.round(6).tolist()}
    buf = io.StringIO(); w = csv.writer(buf); w.writerow(["scenario", "day", *ASSETS])
    for i, p in enumerate(sim):
        for t, row in enumerate(p, 1): w.writerow([i, t, *np.round(row, 6)])
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={sid}.csv"})


@app.post("/api/portfolios", status_code=201)
def create_portfolio(req: PortfolioReq):
    try: w = risk.validate_weights(req.weights, req.normalize, req.allow_short)
    except ValueError as e: raise HTTPException(422, str(e))
    with db.SessionLocal() as s:
        p = db.Portfolio(name=req.name, initial_value=req.initial_value, allow_short=req.allow_short,
                         allocations=[db.Allocation(asset=k, weight=v) for k, v in w.items()])
        s.add(p); s.commit()
        return {"id": p.id, "name": p.name, "weights": w, "initial_value": p.initial_value}


def _pf(s, pid):
    p = s.get(db.Portfolio, pid)
    if not p: raise HTTPException(404, "portfolio not found")
    return p, {a.asset: a.weight for a in p.allocations}


@app.get("/api/portfolios/{pid}")
def get_portfolio(pid: int):
    with db.SessionLocal() as s:
        p, w = _pf(s, pid); return {"id": p.id, "name": p.name, "weights": w, "initial_value": p.initial_value}


@app.post("/api/portfolios/{pid}/stress-test")
def stress_test(pid: int, req: StressReq):
    with db.SessionLocal() as s:
        p, w = _pf(s, pid); j = s.get(db.SimulationJob, req.simulation_id)
        if not j: raise HTTPException(404, "simulation not found")
        out = service.stress(_load_sim(j), w, p.initial_value)
        s.add(db.RiskResult(simulation_id=j.id, portfolio_id=pid, metrics=out["metrics"])); s.commit()
        return {"portfolio": {"id": pid, "name": p.name, "weights": w, "initial_value": p.initial_value}, "simulation_id": j.id, **out}


@app.get("/api/risk/{simulation_id}")
def get_risk(simulation_id: str, portfolio_id: int | None = Query(default=None, ge=1)):
    with db.SessionLocal() as s:
        j = s.get(db.SimulationJob, simulation_id)
        if not j: raise HTTPException(404, "simulation not found")
        if portfolio_id: p, w = _pf(s, portfolio_id); v0 = p.initial_value
        else: w, v0 = {"NIFTY": .3, "BANK": .2, "IT": .15, "GOLD": .15, "CRUDE": .05, "CASH": .15}, 1_000_000.0
        out = service.stress(_load_sim(j), w, v0)
        return {"portfolio": {"id": portfolio_id, "weights": w, "initial_value": v0, "is_default": portfolio_id is None}, **out}


# Optional single-service deployment: serve the built frontend (set CRASHLAB_STATIC_DIR=/path/to/frontend/dist)
_static = os.getenv("CRASHLAB_STATIC_DIR")
if _static and os.path.isdir(_static):
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=os.path.join(_static, "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"): raise HTTPException(404, "not found")
        f = os.path.join(_static, path)
        return FileResponse(f if path and os.path.isfile(f) else os.path.join(_static, "index.html"))
