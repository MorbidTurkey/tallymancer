# Tallymancer — Visual Design & UX Addendum

This document captures design decisions from a UI review of the current v1 build (screenshots reviewed: home/setup screen, default scoreboard view, table view, share links menu, win state). These are refinements to visual styling and interaction polish — the existing layout, information hierarchy, and core logic are good and should NOT be restructured. This is a skin + interaction pass, not a rebuild.

## Context: why this pass
Current v1 reads as a clean utility/dashboard app (flat dark slate, single accent purple, system sans-serif, no motion). The goal is to push it toward a "gaming app" feel — distinctive, satisfying to use, and visually tied to the TCG being played — without touching the underlying architecture.

## 1. Player card visual identity
- Each player gets an accent color (see theming below), applied as:
  - A `border-left: 4px solid <accent>` on the player card (or `border-top` in table view — see below).
  - A subtle low-opacity radial gradient/glow in the same accent color, positioned in a corner of the card (e.g. top-right), opacity ~8-12%.
- Player cards should feel like distinct "zones," not floating boxes on a flat background.

## 2. Score display & change animation
- Switch the large score number to a monospace/display font (`var(--font-mono)` or similar) — reads as "scoreboard" rather than "dashboard."
- On every score change (button press or free-text input), animate the number:
  - Scale up briefly (~1.15x) then back to 1x, over ~150-200ms.
  - Flash the text color: green-ish for increases, red-ish for decreases, then fade back to the default white/neutral.
- This single animation is the highest-impact, lowest-effort change for "satisfying" feel — prioritize it.

## 3. Button styling
- The -1/+1/-5/+5 (or game-appropriate equivalents) buttons should have tinted backgrounds matching their semantic meaning:
  - Negative buttons: dark red-tinted background, red text.
  - Positive buttons: dark green-tinted background, green text.
  - Keep these subtle/dark-tinted, not bright — should sit comfortably in the dark UI.
- The free-text input (`±value e.g. -5`) should remain but with a clearer placeholder that signals it's a feature, not a label — consider a small icon (e.g. calculator/edit icon) or slightly larger text.

## 4. Table view layouts (rotation for "phone in the middle")
Current rotation logic for 2 players works — extend the pattern:
- **2 players:** existing behavior (one panel rotated 180°, one normal), keep as-is.
- **3 players:** one panel full-width at top, rotated 180°; remaining two panels side-by-side below, normal orientation. (Explicitly NOT a triangle/wedge layout — too complex for the payoff.)
- **4 players:** 2x2 grid. Top row (2 panels) rotated 180°, bottom row (2 panels) normal orientation. Each panel faces its corner of the table.
- **5+ players:** table view is unavailable; fall back to standard list view (current default view). Consider disabling/hiding the "Table" button when player count > 4, or showing a brief message if tapped.
- Players can rename themselves freely; no fixed seat assignment needed — players are assigned to table-view positions in join/list order. (No drag-to-rearrange needed for v1.)

## 5. Per-game theming
Each built-in game preset gets a **2-color accent pair** (primary accent for borders/highlights, secondary accent for glows/secondary elements). Custom games get a default neutral pair, with an option for the user to pick from a small palette at setup (nice-to-have, not blocking).

Preset accent pairs (initial proposal — adjust to taste during implementation):
- **Disney Lorcana:** warm gold primary (`#FAC775`-ish) + ink-purple secondary (`#AFA9EC`-ish).
- **Yu-Gi-Oh!:** saturated magenta primary (`#D4537E`-ish) + amber secondary (`#FAC775`-ish). Must look visually distinct from Lorcana — avoid reusing the same lavender/gold pairing.
- **Magic: The Gathering:** deep black primary (`#2C2C2A`-ish, near-black gray) + mythic gold secondary (`#FAC775`-ish) — evokes classic card frame/rarity styling without favoring one of the five color identities.
- **Star Wars Unlimited:** cyan/blue primary (`#85B7EB`-ish, lightsaber/holo-display feel) + warm amber secondary (`#FAC775`-ish) — sci-fi interface coding rather than a literal flat Rebel/Empire red-blue split.
- **Custom:** neutral blue-gray default pair (`#85B7EB`-ish + complementary gray), or user-selectable.

Theme accent pairs should be stored as data alongside other preset properties (already planned as data-driven per the main project brief), not hardcoded per-component.

Note: gold/amber tones appear as the *secondary* accent in Lorcana, MTG, and Star Wars Unlimited, while being the *primary* in Yu-Gi-Oh!. This overlap is acceptable — each theme's primary accent (border, dominant highlight) differs, so the overall feel stays distinct even with a shared warm secondary tone. If during implementation the themes feel too similar in practice, revisit MTG's secondary first (e.g. shift toward a deeper bronze/copper) since it has the most overlap.

## 6. Game-appropriate step values
Step button values (-1/+1/-5/+5 equivalents) should be configurable per preset, not fixed at ±1/±5:
- **Lorcana / MTG:** ±1 / ±5 (current values work — life totals are small, 20-40 range).
- **Yu-Gi-Oh!:** ±100 / ±500 (life totals are in the thousands, typically 8000 starting).
- **Star Wars Unlimited:** ±1 / ±5 (life total starts at 30, similar scale to Lorcana/MTG — current default values work).
- The free-text input remains available for any custom value regardless of preset step buttons.

## Implementation order suggestion
1. Score change animation (#2) — highest impact, isolated, low risk.
2. Button tinting (#3) — small CSS change, pairs naturally with #2.
3. Player card accent borders/glow (#1) — needs the accent-color data structure, which then unlocks...
4. Per-game theming (#5) and step values (#6) — extend the preset data structure with accent pairs and step values.
5. Table view 3/4-player layouts (#4) — independent of the above, can be done in parallel or separately.

## Explicitly out of scope for this pass
- No new features (this is styling/interaction only).
- No changes to the share-link system, win detection logic, or data model beyond adding accent-color/step-value fields to preset definitions.
- No illustration/asset work (icons, artwork) — color and typography only for now.
