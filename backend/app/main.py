"""
main.py — FastAPI application entry point.

Run locally with:
    uvicorn app.main:app --reload --port 8000

Interactive API docs:
    http://localhost:8000/docs   (Swagger UI)
    http://localhost:8000/redoc  (ReDoc)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import sessions, players, scores, websocket

# ---------------------------------------------------------------------------
# Create database tables
# ---------------------------------------------------------------------------
# SQLAlchemy inspects all models that have been imported (via their Base
# inheritance) and creates any missing tables.  Safe to call on every
# startup — it won't drop existing tables.
Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------------------------
# App instance
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Tallymancer API",
    description="Real-time TCG score tracker — backend API",
    version="0.1.0",
)

# ---------------------------------------------------------------------------
# CORS (Cross-Origin Resource Sharing)
# ---------------------------------------------------------------------------
# During local development the React dev server runs on a different port
# (e.g. :5173) from the API (:8000), so the browser blocks requests without
# CORS headers.  In production, frontend and API may share a domain via
# Traefik path routing, but it's safe to keep CORS permissive and restrict
# it via Traefik/firewall if needed.
#
# allow_origins=["*"] is fine for a v1 with no auth cookies.  If we add
# session cookies later, switch to an explicit origin list and set
# allow_credentials=True.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(sessions.router)
app.include_router(players.router)
app.include_router(scores.router)
app.include_router(websocket.router)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health", tags=["meta"])
def health():
    """Simple liveness check — used by Traefik / Docker health checks."""
    return {"status": "ok"}
