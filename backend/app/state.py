"""
state.py — Shared helpers for building the current session state dict.

These functions were originally in routers/sessions.py but are extracted here
so they can be imported by both the HTTP routers and the WebSocket broadcast
layer without creating circular imports.

A "session state dict" is a plain Python dict matching the SessionOut schema.
It is serialised to JSON and sent to clients over both REST responses and
WebSocket broadcasts.
"""

from app.models import Player, ScoreEvent, Session
from sqlalchemy.orm import Session as DBSession


def current_scores(player: Player, db: DBSession) -> dict[str, int]:
    """
    Return {counter_name: current_score} for a player.

    Strategy:
    1. Fetch all non-voided score events for this player, newest first.
    2. For each counter_name, the first result is the current score.
    3. For any counter that has no events yet, fall back to the preset
       starting value stored in session.preset_config.
    """
    events = (
        db.query(ScoreEvent)
        .filter(ScoreEvent.player_id == player.id, ScoreEvent.is_voided == False)
        .order_by(ScoreEvent.created_at.desc())
        .all()
    )

    scores: dict[str, int] = {}
    for ev in events:
        if ev.counter_name not in scores:
            scores[ev.counter_name] = ev.resulting_score

    # Fill in any counters that don't have events yet.
    for counter in player.session.preset_config.get("counters", []):
        if counter["name"] not in scores:
            scores[counter["name"]] = counter["starting"]

    return scores


def build_player_dict(player: Player, db: DBSession) -> dict:
    """Return a plain dict matching the PlayerOut schema, with scores injected."""
    return {
        "id": player.id,
        "name": player.name,
        "color": player.color,
        "seat_position": player.seat_position,
        "is_active": player.is_active,
        "scores": current_scores(player, db),
    }


def build_session_payload(session: Session, db: DBSession) -> dict:
    """
    Return a plain dict matching the SessionOut schema (minus token_type, which
    is personalised per WebSocket connection).

    This is the canonical "full state" object sent to clients on every sync.
    Sending the complete state (rather than a delta) keeps client logic simple:
    the client just replaces its state tree with whatever the server sends.
    """
    return {
        "id": session.id,
        "game_preset": session.game_preset,
        "preset_config": session.preset_config,
        "created_at": session.created_at.isoformat(),
        "last_activity_at": session.last_activity_at.isoformat(),
        "players": [
            build_player_dict(p, db)
            for p in sorted(
                (p for p in session.players if p.is_active),
                key=lambda p: p.seat_position,
            )
        ],
    }
