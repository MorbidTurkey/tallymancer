"""
routers/sessions.py — Endpoints for creating and reading sessions.

POST /api/sessions         → create a new session, return share links
GET  /api/sessions/{token} → return full session state for the token's role
GET  /api/presets          → list available game presets
"""

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.models import Player, Session, SessionToken
from app.presets import get_preset, list_presets, PLAYER_COLOR_PALETTE
from app.schemas import (
    PresetOut,
    SessionCreate,
    SessionConfigUpdate,
    SessionOut,
    SessionTokenOut,
)
from app.ws_manager import broadcast_session
from app.state import build_player_dict, build_session_payload

router = APIRouter(prefix="/api", tags=["sessions"])

# Base URL for generating share links — never hardcoded, always from env.
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")

# Sessions older than this many hours (since last activity) are considered expired.
# After expiry the tokens stop working — the session is effectively archived.
_SESSION_EXPIRY_HOURS = int(os.getenv("SESSION_EXPIRY_HOURS", "48"))


# ---------------------------------------------------------------------------
# Helper: resolve a token to (session, token_type) or raise 404
# ---------------------------------------------------------------------------

def _resolve_token(token: str, db: DBSession) -> tuple[Session, str]:
    """
    Look up a SessionToken row and return the associated Session + token type.

    This is the single point of access-control for all token-gated endpoints.
    Role is always determined server-side — the client cannot claim a role.

    Raises 404 for unknown tokens AND for sessions that have been inactive
    longer than SESSION_EXPIRY_HOURS.  Both cases look the same to the client
    so a bad actor can't distinguish "never existed" from "expired".
    """
    token_row = db.query(SessionToken).filter(SessionToken.token == token).first()
    if not token_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    session = token_row.session

    # --- Session expiry check ---
    # SQLite stores datetimes as UTC strings; SQLAlchemy may return them
    # as naive (no tzinfo) datetimes when DateTime(timezone=True) is used
    # with the SQLite dialect.  Normalise to UTC-aware before comparing.
    now = datetime.now(timezone.utc)
    last_act = session.last_activity_at
    if last_act.tzinfo is None:
        last_act = last_act.replace(tzinfo=timezone.utc)

    if now - last_act > timedelta(hours=_SESSION_EXPIRY_HOURS):
        # Return the same 404 as "not found" — don't leak session existence.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    session.last_activity_at = now
    db.commit()

    return session, token_row.token_type


# ---------------------------------------------------------------------------
# GET /api/presets
# ---------------------------------------------------------------------------

@router.get("/presets", response_model=list[PresetOut])
def get_presets():
    """Return all available game presets.  Used by the frontend setup menu."""
    return list_presets()


# ---------------------------------------------------------------------------
# POST /api/sessions
# ---------------------------------------------------------------------------

@router.post("/sessions", response_model=SessionTokenOut, status_code=status.HTTP_201_CREATED)
def create_session(body: SessionCreate, db: DBSession = Depends(get_db)):
    """
    Create a new game session.

    Steps:
    1. Validate the game preset (or accept a custom config).
    2. Create the Session row.
    3. Create two SessionToken rows: "player" (edit) and "audience" (view).
    4. Create any initial players the caller provided.
    5. Return both share links.
    """
    # --- 1. Resolve preset config ---
    # If a custom_config is provided it takes priority (future: user-defined presets).
    # Otherwise look up the slug from the built-in PRESETS dict — including "custom".
    if body.custom_config:
        preset_config = body.custom_config
    else:
        preset = get_preset(body.game_preset)
        if not preset:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unknown preset '{body.game_preset}'.",
            )
        preset_config = preset

    # --- 2. Create session ---
    session = Session(game_preset=body.game_preset, preset_config=preset_config)
    db.add(session)
    db.flush()  # populate session.id before referencing it in foreign keys

    # --- 3. Create tokens ---
    player_token = SessionToken(session_id=session.id, token_type="player")
    audience_token = SessionToken(session_id=session.id, token_type="audience")
    db.add(player_token)
    db.add(audience_token)
    db.flush()

    # --- 4. Create initial players ---
    # Auto-assign a distinct color from the palette by seat index so every
    # player card has a unique accent even without an explicit color choice.
    for i, name in enumerate(body.player_names):
        color = PLAYER_COLOR_PALETTE[i % len(PLAYER_COLOR_PALETTE)]
        db.add(Player(session_id=session.id, name=name, seat_position=i, color=color))

    db.commit()

    # --- 5. Return share links ---
    return SessionTokenOut(
        player_link=f"{PUBLIC_BASE_URL}/session/{player_token.token}",
        audience_link=f"{PUBLIC_BASE_URL}/session/{audience_token.token}",
    )


# ---------------------------------------------------------------------------
# PATCH /api/sessions/{token}/config
# ---------------------------------------------------------------------------

@router.patch("/sessions/{token}/config", status_code=status.HTTP_200_OK)
def update_session_config(
    token: str,
    body: SessionConfigUpdate,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    """
    Update mutable parts of a session's preset_config.

    Currently only `victory_threshold` is editable mid-game.  Changing it
    does not retroactively alter any score events — it only shifts the
    threshold the frontend checks against live scores.

    SQLAlchemy can't track nested mutations in JSON columns, so we must
    build a new dict and reassign the whole column (flag_modified forces
    the ORM to mark it dirty so it's written on commit).
    """
    session, token_type = _resolve_token(token, db)
    if token_type != "player":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only player tokens can edit session config.",
        )

    if body.victory_threshold is not None:
        victory = session.preset_config.get("victory")
        if not victory:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="This session has no victory condition to edit.",
            )
        # Build a new top-level dict so SQLAlchemy detects the change.
        new_config = {
            **session.preset_config,
            "victory": {**victory, "threshold": body.victory_threshold},
        }
        session.preset_config = new_config
        flag_modified(session, "preset_config")

    db.commit()
    background_tasks.add_task(broadcast_session, session.id)
    return session.preset_config


# ---------------------------------------------------------------------------
# GET /api/sessions/{token}
# ---------------------------------------------------------------------------

@router.get("/sessions/{token}", response_model=SessionOut)
def get_session(token: str, db: DBSession = Depends(get_db)):
    """
    Return the current state of a session.

    The token encodes both the session identity and the caller's role.
    The response includes full player data with current scores.
    """
    session, token_type = _resolve_token(token, db)

    state = build_session_payload(session, db)
    state["token_type"] = token_type  # inject role for REST callers

    return SessionOut(**state)
