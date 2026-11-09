"""SQLAlchemy models. Large arrays (simulated paths) are NOT stored in rows: they are written as compressed .npz
files (float32) under DATA_DIR/simulations/<id>.npz and referenced by path; rows hold metadata + summary JSON."""
from __future__ import annotations

import os
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import DATA_DIR

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR}/crashlab.db")
_kw = {"connect_args": {"check_same_thread": False}} if DATABASE_URL.startswith("sqlite") else {"pool_pre_ping": True}
engine = create_engine(DATABASE_URL, **_kw)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def now(): return datetime.now(timezone.utc)


class Base(DeclarativeBase): pass


class Portfolio(Base):
    __tablename__ = "portfolios"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    initial_value: Mapped[float] = mapped_column(Float)
    allow_short: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    allocations: Mapped[list["Allocation"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class Allocation(Base):
    __tablename__ = "portfolio_allocations"
    id: Mapped[int] = mapped_column(primary_key=True)
    portfolio_id: Mapped[int] = mapped_column(ForeignKey("portfolios.id"))
    asset: Mapped[str] = mapped_column(String(16))
    weight: Mapped[float] = mapped_column(Float)


class SimulationJob(Base):
    __tablename__ = "simulation_jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued|running|completed|failed
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    name: Mapped[str] = mapped_column(String(160), default="")
    request: Mapped[dict] = mapped_column(JSON, default=dict)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)          # model, seed, version, constraint report...
    summary: Mapped[dict] = mapped_column(JSON, default=dict)       # per-asset quantile bands etc.
    error: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    array_path: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    risk: Mapped[list["RiskResult"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class RiskResult(Base):
    __tablename__ = "risk_metrics"
    id: Mapped[int] = mapped_column(primary_key=True)
    simulation_id: Mapped[str] = mapped_column(ForeignKey("simulation_jobs.id"))
    portfolio_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "simulations").mkdir(exist_ok=True)
    Base.metadata.create_all(engine)  # Alembic is the production path (see alembic/); this is the dev fallback
