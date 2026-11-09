from alembic import context
from sqlalchemy import create_engine
from crashlab.db import Base, DATABASE_URL
target_metadata = Base.metadata
def run_migrations_online():
    with create_engine(DATABASE_URL).connect() as c:
        context.configure(connection=c, target_metadata=target_metadata)
        with context.begin_transaction(): context.run_migrations()
run_migrations_online()
