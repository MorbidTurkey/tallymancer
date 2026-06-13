"""
models.py — SQLAlchemy ORM table definitions.

These classes map directly to database tables.  SQLAlchemy reads them and
can auto-create the tables via Base.metadata.create_all(engine).

Design notes
------------
* UUIDs as primary keys: they're unguessable, which lets us use them
  directly as share tokens without a separate token table.
* score_events is append-only: we never UPDATE or DELETE rows in it.
  The current score is always the `resulting_score` of the most-recent
  event for a given (player_id, counter_name) pair.  This gives us a
  free audit log and makes undo trivial (soft-delete the last event).
* owner_id is nullable — null means anonymous session.  When we add auth
  in a later phase we simply populate this column; no migration needed.
* token_type on SessionToken allows future link types (overlay, admin,
  tournament-admin) without schema changes.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _now() -> datetime:
    """Return current UTC time.  Using a function avoids a shared mutable default."""
    return datetime.now(timezone.utc)


def _uuid() -> str:
    """Generate a new UUID4 string.  Stored as TEXT in SQLite, CHAR(36) in Postgres."""
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

class Session(Base):
    """
    A game session.  One session = one game being tracked.

    Tokens are the mechanism for access control:
      - player_token  → edit rights (apply score changes, rename players, etc.)
      - audience_token → view-only rights (live scoreboard, no controls)
    Both tokens are UUIDs generated at creation and never change.
    """

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)

    # game_preset is a slug string like "mtg", "lorcana", etc.
    # preset_config stores the full preset dict as JSON so the session is
    # self-contained even if we later change the preset definitions.
    game_preset: Mapped[str] = mapped_column(String(50), nullable=False)
    preset_config: Mapped[dict] = mapped_column(JSON, nullable=False)

    # Nullable owner_id: null = anonymous.  Populated only when accounts exist.
    owner_id: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    # Relationships — SQLAlchemy populates these automatically via foreign keys.
    tokens: Mapped[list["SessionToken"]] = relationship(
        "SessionToken", back_populates="session", cascade="all, delete-orphan"
    )
    players: Mapped[list["Player"]] = relationship(
        "Player", back_populates="session", cascade="all, delete-orphan"
    )
    score_events: Mapped[list["ScoreEvent"]] = relationship(
        "ScoreEvent", back_populates="session", cascade="all, delete-orphan"
    )


# ---------------------------------------------------------------------------
# SessionToken
# ---------------------------------------------------------------------------

class SessionToken(Base):
    """
    Maps an unguessable token string to a session + role.

    Why a separate table instead of columns on Session?
    - We can add new token *types* (overlay, tournament-admin, etc.) by
      inserting rows, not by adding columns.
    - Revocation is a single DELETE.
    - Future: we can attach metadata (label, created_by) per token.

    token_type values (v1):
      "player"   — full edit rights
      "audience" — view-only
    """

    __tablename__ = "session_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sessions.id"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, default=_uuid)
    token_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "player" | "audience"

    session: Mapped["Session"] = relationship("Session", back_populates="tokens")


# ---------------------------------------------------------------------------
# Player
# ---------------------------------------------------------------------------

class Player(Base):
    """
    A player within a session.

    seat_position is used by the table-view UI to rotate panels outward
    toward each player's seat.  Assigned sequentially (0, 1, 2 …) when a
    player is added; can be reordered later without affecting score history.

    is_active: False means the player was removed mid-session.  We keep the
    row (and their score history) so the log stays coherent.
    """

    __tablename__ = "players"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sessions.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)  # CSS color string
    seat_position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    session: Mapped["Session"] = relationship("Session", back_populates="players")
    score_events: Mapped[list["ScoreEvent"]] = relationship(
        "ScoreEvent", back_populates="player"
    )


# ---------------------------------------------------------------------------
# ScoreEvent (append-only log)
# ---------------------------------------------------------------------------

class ScoreEvent(Base):
    """
    Every score change is recorded as a new row here — we never update or
    delete rows.  This is the foundation for:
      - Current score (latest resulting_score per player+counter)
      - Full history / audit log
      - Undo (soft-delete via is_voided flag)
      - Future: paid match-history stats

    counter_name defaults to "life" so single-counter games work without
    the UI knowing anything about multi-counter support.  When MTG poison
    or commander-damage counters are added they use their own counter_name.

    delta: the change applied, e.g. -3 means "lost 3 life".
    resulting_score: the player's score *after* this delta.  Cached here
    so reading current scores is a simple MAX(id)/last-row query, not a SUM.
    """

    __tablename__ = "score_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sessions.id"), nullable=False
    )
    player_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("players.id"), nullable=False
    )
    counter_name: Mapped[str] = mapped_column(String(50), nullable=False, default="life")
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    resulting_score: Mapped[int] = mapped_column(Integer, nullable=False)
    is_voided: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    session: Mapped["Session"] = relationship("Session", back_populates="score_events")
    player: Mapped["Player"] = relationship("Player", back_populates="score_events")
