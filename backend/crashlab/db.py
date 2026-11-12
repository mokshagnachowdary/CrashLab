
"""
CRASHLAB database models and connection configuration.

SQLite database and simulation files are stored under DATA_DIR.
Directories are created before SQLAlchemy or Alembic attempts
to connect.
"""

from __future__ import annotations

import os
from pathlib import Path
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    create_engine,
)
from sqlalchemy.engine import make_url
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
    sessionmaker,
)

from .config import DATA_DIR


# ============================================================
# STORAGE INITIALIZATION
# ============================================================

# Ensure the main data directory exists before Alembic connects.
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Simulation output directory.
SIMULATIONS_DIR = DATA_DIR / "simulations"
SIMULATIONS_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# DATABASE CONFIGURATION
# ============================================================

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DATA_DIR / 'crashlab.db'}",
)

# Normalize the URL for SQLAlchemy.
database_url = make_url(DATABASE_URL)

# If SQLite is configured with a custom path, ensure its
# parent directory exists as well.
if database_url.get_backend_name() == "sqlite":
    database_path = database_url.database

    if database_path and database_path != ":memory:":
        Path(database_path).expanduser().parent.mkdir(
            parents=True,
            exist_ok=True,
        )

    engine_kwargs = {
        "connect_args": {
            "check_same_thread": False,
        }
    }
else:
    engine_kwargs = {
        "pool_pre_ping": True,
    }


# Create SQLAlchemy engine.
engine = create_engine(
    database_url,
    **engine_kwargs,
)

# Session factory.
SessionLocal = sessionmaker(
    bind=engine,
    expire_on_commit=False,
)


# ============================================================
# BASE MODEL
# ============================================================

def now():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


# ============================================================
# PORTFOLIO MODELS
# ============================================================

class Portfolio(Base):
    __tablename__ = "portfolios"

    id: Mapped[int] = mapped_column(primary_key=True)

    name: Mapped[str] = mapped_column(
        String(120)
    )

    initial_value: Mapped[float] = mapped_column(
        Float
    )

    allow_short: Mapped[bool] = mapped_column(
        default=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=now,
    )

    allocations: Mapped[list["Allocation"]] = relationship(
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class Allocation(Base):
    __tablename__ = "portfolio_allocations"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    portfolio_id: Mapped[int] = mapped_column(
        ForeignKey("portfolios.id")
    )

    asset: Mapped[str] = mapped_column(
        String(16)
    )

    weight: Mapped[float] = mapped_column(
        Float
    )


# ============================================================
# SIMULATION MODELS
# ============================================================

class SimulationJob(Base):
    __tablename__ = "simulation_jobs"

    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
    )

    status: Mapped[str] = mapped_column(
        String(16),
        default="queued",
    )

    progress: Mapped[float] = mapped_column(
        Float,
        default=0.0,
    )

    name: Mapped[str] = mapped_column(
        String(160),
        default="",
    )

    request: Mapped[dict] = mapped_column(
        JSON,
        default=dict,
    )

    meta: Mapped[dict] = mapped_column(
        JSON,
        default=dict,
    )

    summary: Mapped[dict] = mapped_column(
        JSON,
        default=dict,
    )

    error: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )

    array_path: Mapped[str | None] = mapped_column(
        String(300),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=now,
    )

    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    risk: Mapped[list["RiskResult"]] = relationship(
        cascade="all, delete-orphan",
        lazy="selectin",
    )


# ============================================================
# RISK MODELS
# ============================================================

class RiskResult(Base):
    __tablename__ = "risk_metrics"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    simulation_id: Mapped[str] = mapped_column(
        ForeignKey("simulation_jobs.id")
    )

    portfolio_id: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    metrics: Mapped[dict] = mapped_column(
        JSON,
        default=dict,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=now,
    )


# ============================================================
# DATABASE INITIALIZATION
# ============================================================

def init_db():
    """
    Initialize database storage and create missing tables.

    Alembic remains the production migration mechanism.
    This function also supports local development.
    """

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SIMULATIONS_DIR.mkdir(parents=True, exist_ok=True)

    Base.metadata.create_all(engine)
