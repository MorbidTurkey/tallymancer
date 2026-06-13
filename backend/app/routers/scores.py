"""
routers/scores.py — Endpoints for applying score deltas and undo.

POST /api/sessions/{token}/players/{player_id}/score  → apply a delta
POST /api/sessions/{token}/undo                       → undo last change
GET  /api/sessions/{token}/history                    → full event log

After each mutation a WebSocket broadcast is queued via BackgroundTask so
all connected clients (including the requesting client) receive the new state.
This is how "optimistic UI" reconciliation works:
  1. Client locally applies the delta (optimistic update — instant feedback).
  2. Client POSTs the delta to the REST endpoint.
  3. Server applies it, then broadcasts authoritative state to everyone.
  4. Every client (including the requester) reconciles with the server state.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import desc
from sqlalchemy.orm import Session as DBSession

from app.database import get_db
from app.models import ScoreEvent, Session
from app.routers.sessions import _resolve_token
from app.routers.players import _get_active_player, _require_player_token
from app.schemas import ScoreDeltaCreate, ScoreEventOut, UndoOut
from app.ws_manager import broadcast_session

router = APIRouter(prefix="/api/sessions/{token}", tags=["scores"])


# ---------------------------------------------------------------------------
# Helper: current score for one player+counter
# ---------------------------------------------------------------------------

def _get_current_score(player_id: str, counter_name: str, session: Session, db: DBSession) -> int:
    """
    Return the live score for a given player and counter.

    Reads the `resulting_score` of the latest non-voided ScoreEvent.
    Falls back to the preset starting value if no events exist yet.
    """
    latest = (
        db.query(ScoreEvent)
        .filter(
            ScoreEvent.player_id == player_id,
            ScoreEvent.counter_name == counter_name,
            ScoreEvent.is_voided == False,
        )
        .order_by(desc(ScoreEvent.created_at))
        .first()
    )
    if latest:
        return latest.resulting_score

    # No events yet — use the preset default.
    for counter in session.preset_config.get("counters", []):
        if counter["name"] == counter_name:
            return counter["starting"]
    return 0  # counter not in preset (custom setup)


# ---------------------------------------------------------------------------
# Helper: floor/ceiling enforcement from preset
# ---------------------------------------------------------------------------

def _clamp_score(new_score: int, counter_name: str, session: Session) -> int:
    """
    Apply floor and ceiling from the preset config.

    e.g. Yu-Gi-Oh! has a floor of 0 (LP can't go negative).
    MTG life has no floor (life can go negative in some game states).
    """
    for counter in session.preset_config.get("counters", []):
        if counter["name"] == counter_name:
            floor = counter.get("floor")
            ceiling = counter.get("ceiling")
            if floor is not None and new_score < floor:
                return floor
            if ceiling is not None and new_score > ceiling:
                return ceiling
            return new_score
    return new_score


# ---------------------------------------------------------------------------
# POST /api/sessions/{token}/players/{player_id}/score
# ---------------------------------------------------------------------------

@router.post(
    "/players/{player_id}/score",
    response_model=ScoreEventOut,
    status_code=status.HTTP_201_CREATED,
)
def apply_score_delta(
    token: str,
    player_id: str,
    body: ScoreDeltaCreate,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    """
    Apply a score delta to one of a player's counters.

    delta=-3 means "subtract 3" (e.g. lose 3 life).
    delta=+5 means "add 5" (e.g. gain 5 lore in Lorcana).

    The resulting score is clamped to the preset's floor/ceiling.  If
    clamping reduces the actual change (e.g. trying to go below 0 in
    Yu-Gi-Oh!), the stored delta reflects the actual change, not the
    requested delta.  This keeps the history log accurate.

    After committing the event, a WebSocket broadcast is scheduled so all
    connected clients receive the updated session state.
    """
    session, _ = _require_player_token(token, db)
    player = _get_active_player(player_id, session.id, db)

    current_score = _get_current_score(player.id, body.counter_name, session, db)
    raw_new = current_score + body.delta
    new_score = _clamp_score(raw_new, body.counter_name, session)
    actual_delta = new_score - current_score  # may differ from body.delta due to clamping

    event = ScoreEvent(
        session_id=session.id,
        player_id=player.id,
        counter_name=body.counter_name,
        delta=actual_delta,
        resulting_score=new_score,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    # Broadcast to all WebSocket clients after the HTTP response is sent.
    background_tasks.add_task(broadcast_session, session.id)

    return ScoreEventOut.model_validate(event)


# ---------------------------------------------------------------------------
# POST /api/sessions/{token}/undo
# ---------------------------------------------------------------------------

@router.post("/undo", response_model=UndoOut)
def undo_last_score(
    token: str,
    background_tasks: BackgroundTasks,
    db: DBSession = Depends(get_db),
):
    """
    Void the most recent non-voided score event for the session.

    "Global last event" matches the mental model at a card table:
    "wait, undo that" always means the last thing that happened,
    regardless of which player it affected.

    Undo is non-destructive: the event row stays in the table with
    is_voided=True so the history log shows "this was undone".
    """
    session, _ = _require_player_token(token, db)

    last_event = (
        db.query(ScoreEvent)
        .filter(ScoreEvent.session_id == session.id, ScoreEvent.is_voided == False)
        .order_by(desc(ScoreEvent.created_at))
        .first()
    )

    if not last_event:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Nothing to undo.",
        )

    score_before_undo = last_event.resulting_score
    last_event.is_voided = True
    db.commit()

    score_after_undo = _get_current_score(
        last_event.player_id, last_event.counter_name, session, db
    )

    background_tasks.add_task(broadcast_session, session.id)

    return UndoOut(
        voided_event_id=last_event.id,
        player_id=last_event.player_id,
        counter_name=last_event.counter_name,
        score_before_undo=score_before_undo,
        score_after_undo=score_after_undo,
    )


# ---------------------------------------------------------------------------
# GET /api/sessions/{token}/history
# ---------------------------------------------------------------------------

@router.get("/history", response_model=list[ScoreEventOut])
def get_history(token: str, db: DBSession = Depends(get_db)):
    """
    Return all score events for this session in chronological order.

    Both player and audience tokens can read history.
    Voided events are included (is_voided=True) so the UI can show
    a strikethrough or "undone" badge if desired.
    """
    session, _ = _resolve_token(token, db)

    events = (
        db.query(ScoreEvent)
        .filter(ScoreEvent.session_id == session.id)
        .order_by(ScoreEvent.created_at.asc())
        .all()
    )
    return [ScoreEventOut.model_validate(e) for e in events]
