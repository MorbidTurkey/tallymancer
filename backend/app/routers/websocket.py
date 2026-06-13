"""
routers/websocket.py — The WebSocket endpoint for real-time session sync.

Endpoint: ws://host/ws/{token}
  - token is the same UUID used for the REST API (player or audience).
  - The server resolves the token to a session + role, then:
    1. Accepts the connection.
    2. Validates the token — if invalid, sends close code 4004.
    3. Registers the connection and sends full state (initial sync).
    4. Waits for client messages (ping→pong heartbeat).
    5. Cleans up on disconnect.

Why accept BEFORE validating the token?
----------------------------------------
If we reject the WS upgrade at the HTTP layer (403), the browser's WebSocket
API fires onerror then onclose with code 1006 (abnormal closure) — the same
code it uses for network drops.  The client can't tell "bad token" from
"wifi blipped" and retries forever.

By accepting first and then closing with code 4004 (application-defined),
the client receives a proper WebSocket close frame and can stop retrying.

Reconnect / resync flow
------------------------
On disconnect (network drop, phone lock screen, etc.) the client should:
  1. Catch the `close` event.
  2. If code === 4004, show an error — do NOT retry.
  3. Otherwise: wait (exponential backoff), re-open the WS connection.
  4. Server sends full state on connect — client is fully synced.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.database import SessionLocal
from app.routers.sessions import _resolve_token
from app.state import build_session_payload
from app.ws_manager import manager

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/{token}")
async def websocket_endpoint(token: str, websocket: WebSocket):
    """
    WebSocket connection handler.

    A note on database access in async endpoints:
    We open synchronous SQLAlchemy sessions directly from async code.
    For SQLite at our scale this is fine.  For Postgres with many workers,
    switch to asyncpg + async SQLAlchemy and call DB operations via
    asyncio.to_thread().
    """

    # --- 1. Accept the WS upgrade FIRST ---
    # Accepting before we validate the token lets us send a proper
    # close code (4004) instead of letting FastAPI return HTTP 403.
    # See module docstring for the full rationale.
    await websocket.accept()

    # --- 2. Validate token ---
    db = SessionLocal()
    try:
        try:
            session, token_type = _resolve_token(token, db)
        except Exception:
            # Unguessable token not found in DB — permanent error.
            # Close code 4004 signals to the client: "stop retrying".
            await websocket.close(code=4004, reason="Invalid or expired session token")
            return

        session_id = session.id
        state_dict = build_session_payload(session, db)
    finally:
        db.close()

    # --- 3. Register connection (accept was called above, use register()) ---
    manager.register(websocket, session_id, token_type)

    # --- 4. Send initial full state ---
    # Every client gets the complete session state on connect.
    # On reconnect this acts as a full resync — no separate resync endpoint needed.
    await websocket.send_json({
        "type": "sync",
        "token_type": token_type,
        "data": state_dict,
    })

    # --- 5. Main receive loop ---
    try:
        while True:
            try:
                msg = await websocket.receive_json()
            except ValueError:
                continue  # non-JSON message — ignore

            if isinstance(msg, dict):
                if msg.get("type") == "ping":
                    # Heartbeat reply — keeps the connection alive through proxies
                    # and mobile OS networking stacks that kill idle TCP connections.
                    await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        manager.disconnect(websocket, session_id)

    except Exception:
        manager.disconnect(websocket, session_id)
