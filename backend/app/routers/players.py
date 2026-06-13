"""
routers/players.py — Endpoints for managing players within a session.

POST   /api/sessions/{token}/players                → add a player
PATCH  /api/sessions/{token}/players/{player_id}    → rename / recolour
DELETE /api/sessions/{token}/players/{player_id}    → remove (soft-delete)

All write endpoints require a "player" token.  After each mutation a
WebSocket broadcast is queued as a BackgroundTask so all connected clients
receive the updated state.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.database import get_db
from app.models import Player
from app.routers.sessions import _resolve_token
from app.schemas import PlayerCreate, PlayerOut, PlayerUpdate
from app.state import build_player_dict
from app.ws_manager import broadcast_session

router = APIRouter(prefix="/api/sessions/{token}/players", tags=["players"])


# ---------------------------------------------------------------------------
# Shared guards
# ---------------------------------------------------------------------------

def _require_player_token(token: str, db: DBSession):
    """Resolve token and assert it has edit (player) rights.  Raises 403 otherwise."""
    session, token_type = _resolve_token(token, db)
    if token_type != "player":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This link is view-only. Use the player link to make changes.",
        )
    return session, token_type


def _get_active_player(player_id: str, session_id: str, db: DBSession) -> Player:
    """Fetch an active player belonging to this session, or raise 404."""
    player = (
        db.query(Player)
        .filter(
            Player.id == player_id,
            Player.session_id == session_id,
            Player.is_active == True,
        )
        .first()
    )
    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")
    return player


# ---------------------------------------------------------------------------
# POST /api/sessions/{token}/players
# ---------------------------------------------------------------------------

@router.post("", response_model=PlayerOut, status_code=status.HTTP_201_CREATED)
def add_player(
    token: str,
    body: PlayerCreate,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    """
    Add a new player to the session.

    The new player's seat_position is set to (max existing + 1) so they
    always appear at the end of the list.
    """
    session, _ = _require_player_token(token, db)

    existing = db.query(Player).filter(Player.session_id == session.id).all()
    next_seat = max((p.seat_position for p in existing), default=-1) + 1

    player = Player(
        session_id=session.id,
        name=body.name,
        color=body.color,
        seat_position=next_seat,
    )
    db.add(player)
    db.commit()
    db.refresh(player)

    # Broadcast updated session state to all connected WebSocket clients.
    background_tasks.add_task(broadcast_session, session.id)

    return PlayerOut(**build_player_dict(player, db))


# ---------------------------------------------------------------------------
# PATCH /api/sessions/{token}/players/{player_id}
# ---------------------------------------------------------------------------

@router.patch("/{player_id}", response_model=PlayerOut)
def update_player(
    token: str,
    player_id: str,
    body: PlayerUpdate,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    """
    Rename a player and/or change their colour (partial update).

    Only fields present in the request body are updated — sending
    {"name": "Alice"} leaves colour unchanged.
    """
    session, _ = _require_player_token(token, db)
    player = _get_active_player(player_id, session.id, db)

    if body.name is not None:
        player.name = body.name
    if body.color is not None:
        player.color = body.color

    db.commit()
    db.refresh(player)

    background_tasks.add_task(broadcast_session, session.id)

    return PlayerOut(**build_player_dict(player, db))


# ---------------------------------------------------------------------------
# DELETE /api/sessions/{token}/players/{player_id}
# ---------------------------------------------------------------------------

@router.delete("/{player_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_player(
    token: str,
    player_id: str,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    """
    Soft-remove a player (sets is_active=False).

    We never hard-delete players because their score history must remain
    coherent — the log should show every event including those by players
    who left mid-session.
    """
    session, _ = _require_player_token(token, db)
    player = _get_active_player(player_id, session.id, db)

    player.is_active = False
    db.commit()

    background_tasks.add_task(broadcast_session, session.id)
