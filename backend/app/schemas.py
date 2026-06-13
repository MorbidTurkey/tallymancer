"""
schemas.py — Pydantic models for request bodies and API responses.

Pydantic validates incoming JSON automatically when FastAPI sees a type
annotation of one of these classes.  It also serialises ORM objects into
JSON for responses (via model_validate with from_attributes=True).

Naming convention:
  *Create  — body sent by the client to create something
  *Update  — body sent by the client to mutate something
  *Out     — shape returned to the client (may include computed fields)
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Shared config
# ---------------------------------------------------------------------------

class _Base(BaseModel):
    """
    All schemas inherit from this so we can toggle from_attributes in one place.
    from_attributes=True tells Pydantic it can read values from ORM object
    attributes (not just dicts), enabling `SomeSchema.model_validate(orm_obj)`.
    """
    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Presets
# ---------------------------------------------------------------------------

class CounterDefinitionOut(_Base):
    name: str
    label: str
    starting: int
    floor: int | None
    ceiling: int | None
    counts_up: bool


class PresetOut(_Base):
    slug: str
    name: str
    counters: list[CounterDefinitionOut]
    win_condition: str | None


# ---------------------------------------------------------------------------
# Session creation
# ---------------------------------------------------------------------------

class SessionCreate(_Base):
    """Body for POST /api/sessions."""
    game_preset: str = Field(
        ...,
        description="Preset slug: 'mtg', 'lorcana', 'swu', 'yugioh', 'custom'",
        examples=["mtg"],
    )
    # Optional: caller can pass a custom preset_config to override the default.
    # If omitted, the server looks up the preset from PRESETS and uses that.
    custom_config: dict[str, Any] | None = Field(
        default=None,
        description="Override preset config (only used when game_preset='custom')",
    )
    # Initial player names — convenient so the creator can name everyone upfront.
    player_names: list[str] = Field(
        default_factory=list,
        description="Optional list of player names to create immediately",
        examples=[["Alice", "Bob"]],
    )


class SessionTokenOut(_Base):
    """The two share links returned after session creation."""
    player_link: str    # full URL including token — edit rights
    audience_link: str  # full URL including token — view only


class SessionOut(_Base):
    """Full session state returned by GET /api/sessions/{token}."""
    id: str
    game_preset: str
    preset_config: dict[str, Any]
    created_at: datetime
    last_activity_at: datetime
    players: list["PlayerOut"]  # populated by the router via a join
    # token_type tells the client what role they have so the UI can show/hide controls
    token_type: str  # "player" | "audience"


# ---------------------------------------------------------------------------
# Player
# ---------------------------------------------------------------------------

class PlayerCreate(_Base):
    """Body for POST /api/sessions/{token}/players."""
    name: str = Field(..., min_length=1, max_length=100)
    color: str | None = Field(default=None, description="CSS colour string, e.g. '#e63946'")


class PlayerUpdate(_Base):
    """Body for PATCH /api/sessions/{token}/players/{player_id}."""
    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = None


class PlayerOut(_Base):
    id: str
    name: str
    color: str | None
    seat_position: int
    is_active: bool
    # Current scores keyed by counter_name, e.g. {"life": 20, "poison": 0}
    # Populated by the router, not directly from the ORM model.
    scores: dict[str, int] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Score events
# ---------------------------------------------------------------------------

class ScoreDeltaCreate(_Base):
    """Body for POST /api/sessions/{token}/players/{player_id}/score."""
    delta: int = Field(
        ...,
        description="Amount to add (positive) or subtract (negative). e.g. -3 means 'lose 3'.",
        examples=[-3, 5, 1],
    )
    counter_name: str = Field(
        default="life",
        description="Which counter to modify.  Defaults to 'life'.",
    )


class ScoreEventOut(_Base):
    id: str
    player_id: str
    counter_name: str
    delta: int
    resulting_score: int
    is_voided: bool
    created_at: datetime


# ---------------------------------------------------------------------------
# Undo
# ---------------------------------------------------------------------------

class UndoOut(_Base):
    """Returned after a successful undo operation."""
    voided_event_id: str
    player_id: str
    counter_name: str
    score_before_undo: int   # the score that was undone
    score_after_undo: int    # the score now (from the previous event, or starting value)


# Forward reference resolution (PlayerOut referenced inside SessionOut)
SessionOut.model_rebuild()
