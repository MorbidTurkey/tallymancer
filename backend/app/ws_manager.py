"""
ws_manager.py — WebSocket connection manager and broadcast helpers.

Architecture overview
---------------------
One `ConnectionManager` instance (the `manager` singleton at the bottom of
this file) lives for the entire application lifetime.  It holds a dict that
maps each session_id to the list of currently-connected WebSocket clients.

When a REST endpoint mutates state (score delta, rename, etc.) it adds an
async background task that calls `broadcast_session()`.  That function
rebuilds the full session state from the database and pushes it to every
client connected to that session.

Sending the *complete* state (not just the delta) on every broadcast keeps
the client simple: it replaces its local state tree with what the server
sends, and reconnecting clients get fully synced immediately without
needing a separate "resync" request.

WebSocket message format (server → client):
    {
        "type":       "sync",
        "token_type": "player" | "audience",   # the recipient's role
        "data":       { ...full session state... }
    }
    {
        "type": "pong"   # heartbeat reply
    }
    {
        "type":    "error",
        "message": "..."
    }

WebSocket message format (client → server, optional):
    {"type": "ping"}   # heartbeat
"""

import asyncio
from dataclasses import dataclass, field
from collections import defaultdict

from fastapi import WebSocket


# ---------------------------------------------------------------------------
# Per-connection metadata
# ---------------------------------------------------------------------------

@dataclass
class _ConnInfo:
    """
    Holds a live WebSocket connection plus the token_type resolved at connect
    time.  We need token_type so we can personalise each broadcast message
    with the recipient's role — every client gets the same data, but audience
    clients know they're view-only.
    """
    ws: WebSocket
    token_type: str  # "player" | "audience"


# ---------------------------------------------------------------------------
# ConnectionManager
# ---------------------------------------------------------------------------

class ConnectionManager:
    """
    Tracks all live WebSocket connections, grouped by session_id.

    This is a simple in-memory store — it lives in the server process and
    does NOT survive server restarts.  Clients must reconnect after a restart
    (their WS connection will close), which triggers the normal reconnect
    flow and a full state resync.

    Thread/async safety: FastAPI's WebSocket handling is async, so all
    methods here are called from the same event loop thread.  No locking
    needed for our single-process setup.  A future multi-process deployment
    (multiple uvicorn workers) would need a pub/sub layer like Redis here.
    """

    def __init__(self):
        # session_id → list of _ConnInfo
        self._connections: dict[str, list[_ConnInfo]] = defaultdict(list)

    async def connect(self, ws: WebSocket, session_id: str, token_type: str) -> None:
        """
        Accept the WebSocket handshake and register the connection.

        ws.accept() completes the HTTP → WebSocket upgrade.  Must be called
        before any send/receive.
        """
        await ws.accept()
        self._connections[session_id].append(_ConnInfo(ws=ws, token_type=token_type))

    def register(self, ws: WebSocket, session_id: str, token_type: str) -> None:
        """
        Register a connection that has ALREADY been accepted.

        Use this when the endpoint calls ws.accept() itself (e.g. to send a
        proper close code before token validation fails) so we don't try to
        accept twice.
        """
        self._connections[session_id].append(_ConnInfo(ws=ws, token_type=token_type))

    def disconnect(self, ws: WebSocket, session_id: str) -> None:
        """
        Remove a connection from the registry.  Safe to call even if the
        connection isn't registered (e.g. double-disconnect on error paths).
        """
        self._connections[session_id] = [
            c for c in self._connections[session_id] if c.ws is not ws
        ]
        # Clean up empty lists to avoid unbounded memory growth in long-running servers.
        if not self._connections[session_id]:
            del self._connections[session_id]

    async def broadcast(self, session_id: str, state_dict: dict) -> None:
        """
        Send the session state to every connected client for this session.

        Each client gets the same `data` payload but with their own
        `token_type` so the frontend knows what controls to render.

        Stale connections (client closed without a clean WebSocket close)
        will raise an exception on send.  We collect those and remove them
        so they don't accumulate.
        """
        if session_id not in self._connections:
            return  # No one is listening — nothing to do.

        dead: list[_ConnInfo] = []
        for conn in list(self._connections[session_id]):  # copy so we can mutate
            try:
                await conn.ws.send_json({
                    "type": "sync",
                    "token_type": conn.token_type,
                    "data": state_dict,
                })
            except Exception:
                # Connection is broken — mark for removal.
                dead.append(conn)

        for d in dead:
            self.disconnect(d.ws, session_id)

    def connection_count(self, session_id: str) -> int:
        """Return the number of live connections for a session.  Useful for debugging."""
        return len(self._connections.get(session_id, []))


# ---------------------------------------------------------------------------
# Module-level singleton — imported by routers and the WS endpoint
# ---------------------------------------------------------------------------

manager = ConnectionManager()


# ---------------------------------------------------------------------------
# Background task: broadcast updated state after a mutation
# ---------------------------------------------------------------------------

async def broadcast_session(session_id: str) -> None:
    """
    Async function intended to be used as a FastAPI BackgroundTask.

    Opens a fresh database session, builds the current session state, and
    broadcasts it to all connected WebSocket clients.

    Why a fresh DB session and not the one from the request?
    The request's DB session is closed before BackgroundTasks run (FastAPI
    closes Depends generators after sending the response).  Opening our own
    ensures we read committed data from the just-completed mutation.
    """
    # Local imports to avoid circular dependency:
    #   ws_manager → models/state is fine
    #   ws_manager → database is fine
    #   but we don't want top-level imports creating import cycles
    from app.database import SessionLocal
    from app.models import Session
    from app.state import build_session_payload

    if manager.connection_count(session_id) == 0:
        return  # No connected clients — skip the DB round-trip.

    db = SessionLocal()
    try:
        session = db.query(Session).filter(Session.id == session_id).first()
        if not session:
            return
        payload = build_session_payload(session, db)
        await manager.broadcast(session_id, payload)
    finally:
        db.close()
