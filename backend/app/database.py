"""
database.py — SQLAlchemy engine and session factory.

We use SQLAlchemy 2.x with synchronous I/O for now.  FastAPI works fine
with sync SQLAlchemy when using a thread-pool executor (the default for
synchronous path-operation functions).  Switching to async SQLAlchemy
later (asyncpg for Postgres) is possible without changing the models —
only this file and the Depends() injection need updating.
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from dotenv import load_dotenv

load_dotenv()  # reads .env if it exists; no-op in production where vars come from Docker

# Pull the URL from the environment so we never hardcode a connection string.
# Defaults to a local SQLite file so `uvicorn app.main:app --reload` just works.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tallymancer.db")

# SQLite needs connect_args={"check_same_thread": False} because FastAPI
# handles each request in a different thread.  This flag is SQLite-only;
# other databases ignore it.
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    # echo=True would log every SQL statement — useful for debugging but noisy
    echo=False,
)

# SessionLocal is a *factory* — call it to create a new database session.
# autocommit=False means we must call session.commit() explicitly.
# autoflush=False prevents SQLAlchemy from silently flushing before queries
# (easier to reason about in a web context).
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """
    All ORM models inherit from this Base so SQLAlchemy can discover them
    and create the corresponding tables via Base.metadata.create_all(engine).
    """
    pass


def get_db():
    """
    FastAPI dependency that yields a database session and guarantees cleanup.

    Usage in a router:
        @router.get("/example")
        def example(db: Session = Depends(get_db)):
            ...

    The `finally` block ensures the session is closed even if the handler
    raises an exception, preventing connection leaks.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
