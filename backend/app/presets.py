"""
presets.py — Game preset definitions stored as data, not code.

Storing presets as a dict (and later in the DB) means:
  - New games can be added without touching router logic.
  - Users can create custom presets that slot into the same structure.
  - The frontend can fetch available presets from /api/presets without any
    hardcoding.

Each preset dict describes how a game session should be initialised.
"""

from typing import Any

# ---------------------------------------------------------------------------
# Preset schema (informal — enforced by Pydantic in schemas.py)
# ---------------------------------------------------------------------------
# slug          : machine-readable identifier used in DB / URLs
# name          : human-readable display name
# counters      : list of counter definitions; every player starts with these
#   name        : machine name (e.g. "life", "poison")
#   label       : display label
#   starting    : integer starting value
#   floor       : minimum allowed value (None = no floor)
#   ceiling     : maximum allowed value (None = no ceiling)
#   counts_up   : True if winning means reaching a target, False if losing means
#                 hitting zero (purely informational for the UI)
# win_condition : optional human-readable string shown in the UI
# ---------------------------------------------------------------------------

PRESETS: dict[str, dict[str, Any]] = {
    "mtg": {
        "slug": "mtg",
        "name": "Magic: The Gathering",
        "step_sizes": [1, 5],
        "counters": [
            {
                "name": "life",
                "label": "Life",
                "starting": 20,
                "floor": None,   # life can go negative in MTG
                "ceiling": None,
                "counts_up": False,
            },
            # Poison and commander-damage counters are defined here so the
            # data model already supports them.  The v1 UI only surfaces
            # "life"; additional counters will appear in a later phase.
            {
                "name": "poison",
                "label": "Poison",
                "starting": 0,
                "floor": 0,
                "ceiling": None,
                "counts_up": True,
            },
        ],
        "win_condition": "Last player with life > 0 wins (or opponent reaches 10 poison)",
        # victory: when life hits 0 the player is eliminated; last remaining wins.
        # direction "lte" means the condition triggers when score <= threshold.
        # event "eliminate" means hitting the threshold removes that player from
        # contention; "win" means that player immediately wins.
        "victory": {"counter": "life", "threshold": 0, "direction": "lte", "event": "eliminate"},
    },
    "mtg40": {
        "slug": "mtg40",
        "name": "Magic: The Gathering (Commander / 40 life)",
        "step_sizes": [1, 5],
        "counters": [
            {
                "name": "life",
                "label": "Life",
                "starting": 40,
                "floor": None,
                "ceiling": None,
                "counts_up": False,
            },
            {
                "name": "poison",
                "label": "Poison",
                "starting": 0,
                "floor": 0,
                "ceiling": None,
                "counts_up": True,
            },
        ],
        "win_condition": "Last player with life > 0 wins (or opponent reaches 10 poison)",
        "victory": {"counter": "life", "threshold": 0, "direction": "lte", "event": "eliminate"},
    },
    "lorcana": {
        "slug": "lorcana",
        "name": "Disney Lorcana",
        "step_sizes": [1, 5],
        "counters": [
            {
                "name": "lore",
                "label": "Lore",
                "starting": 0,
                "floor": 0,
                "ceiling": None,
                "counts_up": True,
            }
        ],
        "win_condition": "First to 20 lore wins",
        # direction "gte" means the condition triggers when score >= threshold.
        # event "win" means that player immediately wins.
        "victory": {"counter": "lore", "threshold": 20, "direction": "gte", "event": "win"},
    },
    "swu": {
        "slug": "swu",
        "name": "Star Wars Unlimited",
        "step_sizes": [1, 5],
        "counters": [
            {
                "name": "base",
                "label": "Base HP",
                "starting": 30,
                "floor": 0,
                "ceiling": None,
                "counts_up": False,
            }
        ],
        "win_condition": "Reduce opponent's base to 0",
        "victory": {"counter": "base", "threshold": 0, "direction": "lte", "event": "eliminate"},
    },
    "yugioh": {
        "slug": "yugioh",
        "name": "Yu-Gi-Oh!",
        "step_sizes": [100, 500],
        "counters": [
            {
                "name": "lp",
                "label": "Life Points",
                "starting": 8000,
                "floor": 0,
                "ceiling": None,
                "counts_up": False,
            }
        ],
        "win_condition": "Reduce opponent's LP to 0",
        "victory": {"counter": "lp", "threshold": 0, "direction": "lte", "event": "eliminate"},
    },
    "custom": {
        "slug": "custom",
        "name": "Custom",
        "step_sizes": [1, 5],
        "counters": [
            {
                "name": "score",
                "label": "Score",
                "starting": 0,
                "floor": None,
                "ceiling": None,
                "counts_up": True,
            }
        ],
        "win_condition": None,
        "victory": None,  # no automatic victory condition for custom games
    },
}


def get_preset(slug: str) -> dict[str, Any] | None:
    """Return a preset by slug, or None if not found."""
    return PRESETS.get(slug)


def list_presets() -> list[dict[str, Any]]:
    """Return all available presets as a list (for the /api/presets endpoint)."""
    return list(PRESETS.values())
