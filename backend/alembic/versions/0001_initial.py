"""initial schema: portfolios, allocations, simulation_jobs, risk_metrics"""
from alembic import op
from crashlab.db import Base
revision, down_revision = "0001", None
def upgrade(): Base.metadata.create_all(op.get_bind())
def downgrade(): Base.metadata.drop_all(op.get_bind())
