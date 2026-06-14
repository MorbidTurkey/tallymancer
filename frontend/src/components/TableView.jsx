/*
 * TableView.jsx — Table / phone-flat-on-the-table mode.
 *
 * When this mode is active, one device lies flat in the middle of the table
 * and each player's panel is rotated to face toward their seat, so everyone
 * can read their own score and tap their own +/− buttons without reaching
 * across or tilting the phone.
 *
 * Layout strategy
 * ───────────────
 * We use a CSS Grid that fills the full viewport (no header in this mode —
 * screen real estate is precious).  An "Exit table view" button floats in
 * the center.
 *
 * 1 player  : full screen, 0°
 * 2 players : two rows (top 180°, bottom 0°)
 * 3 players : 2×2 grid; bottom player spans both columns (0°),
 *             top-left 90°, top-right 270°
 *             (the 3 players sit at bottom + left + right of the table)
 * 4 players : 2×2 grid; top row 180°, bottom row 0°
 *             (two players face north, two face south)
 * 5–6       : 3-row × 2-col grid, top two rows 180°, bottom row 0°
 * 7+        : same as list view (too many to arrange around a small screen)
 *
 * CSS rotation trick for 90°/270° cells
 * ──────────────────────────────────────
 * When you rotate an element 90°, its visual width/height swap but its
 * layout footprint (the space it occupies in the grid) doesn't change.
 * We fix this with CSS container queries (cqw / cqh units):
 *   - Normal cell   (0° / 180°): inner width = 100cqw, height = 100cqh
 *   - Sideways cell (90° / 270°): inner width = 100cqh, height = 100cqw
 *     (dimensions transposed so the content fills the rotated space)
 *
 * `container-type: size` on the cell enables cqw/cqh.
 */

import PlayerCard from './PlayerCard.jsx'

// ── Seat configuration per player count ────────────────────────────────────
//
// Returns an array of { gridStyle, rotation, sideways } objects, one per seat.
// gridStyle is applied to the .table-cell wrapper.
// rotation is the CSS rotate value (degrees).
// sideways=true means this cell uses the cqw/cqh swap for 90°/270°.

function seatConfigs(count) {
  switch (count) {
    case 1:
      return [{ gridStyle: {}, rotation: 0, sideways: false }]

    case 2:
      // Single column, two rows
      return [
        { gridStyle: { gridRow: 2, gridColumn: 1 }, rotation: 0,   sideways: false },
        { gridStyle: { gridRow: 1, gridColumn: 1 }, rotation: 180, sideways: false },
      ]

    case 3:
      // 2×2 grid: top row is one player spanning both columns (rotated 180° to face the
      // player sitting at the top of the table), bottom row is two players side-by-side (0°).
      // This is simpler than a sideways/wedge layout and easier to read in practice.
      return [
        { gridStyle: { gridRow: 2, gridColumn: 1        }, rotation: 0,   sideways: false }, // bottom-left
        { gridStyle: { gridRow: 2, gridColumn: 2        }, rotation: 0,   sideways: false }, // bottom-right
        { gridStyle: { gridRow: 1, gridColumn: '1 / 3'  }, rotation: 180, sideways: false }, // top (spans)
      ]

    case 4:
      // 2×2 grid: bottom row 0°, top row 180°
      // Two players face south (bottom seats), two face north (top seats)
      return [
        { gridStyle: { gridRow: 2, gridColumn: 1 }, rotation: 0,   sideways: false },
        { gridStyle: { gridRow: 2, gridColumn: 2 }, rotation: 0,   sideways: false },
        { gridStyle: { gridRow: 1, gridColumn: 1 }, rotation: 180, sideways: false },
        { gridStyle: { gridRow: 1, gridColumn: 2 }, rotation: 180, sideways: false },
      ]

    case 5:
    case 6: {
      // 3 rows × 2 cols; top two rows are 180°, bottom row is 0°
      const configs = []
      for (let i = 0; i < count; i++) {
        const col = (i % 2) + 1
        // Players 0-1 → bottom row (row 3), 2-3 → middle row (row 2), 4-5 → top row (row 1)
        const row = 3 - Math.floor(i / 2)
        const rotation = row < 3 ? 180 : 0
        configs.push({ gridStyle: { gridRow: row, gridColumn: col }, rotation, sideways: false })
      }
      return configs
    }

    default:
      // 7+ players: fall back to a simple 2-column alternating layout
      return Array.from({ length: count }, (_, i) => ({
        gridStyle: { gridRow: Math.floor(i / 2) + 1, gridColumn: (i % 2) + 1 },
        rotation: 0,
        sideways: false,
      }))
  }
}

// ── CSS grid-template for the container ──────────────────────────────────

function gridTemplate(count) {
  if (count <= 2) return { gridTemplateColumns: '1fr', gridTemplateRows: count === 1 ? '1fr' : '1fr 1fr' }
  if (count <= 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }
  return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr 1fr' }
}

// ── TableView component ───────────────────────────────────────────────────

export default function TableView({ players, token, tokenType, primaryCounter, stepSizes = [1, 5], onExit }) {
  const count = players.length
  const configs = seatConfigs(count)
  const template = gridTemplate(count)

  return (
    // Full-viewport overlay — covers the normal session layout
    <div className="table-view" style={template}>

      {players.map((player, i) => {
        const { gridStyle, rotation, sideways } = configs[i] ?? { gridStyle: {}, rotation: 0, sideways: false }
        return (
          <div key={player.id} className="table-cell" style={gridStyle}>
            {/*
             * The inner div is the rotatable content.
             * For 0°/180°: width=100cqw, height=100cqh (fills cell naturally)
             * For 90°/270°: width=100cqh, height=100cqw (dimensions swapped)
             * The translate(-50%,-50%) recenters it after top/left: 50% 50%.
             */}
            <div
              className={`table-cell__inner${sideways ? ' table-cell__inner--sideways' : ''}`}
              style={{ '--rotation': `${rotation}deg` }}
            >
              <PlayerCard
                player={player}
                token={token}
                tokenType={tokenType}
                primaryCounter={primaryCounter}
                stepSizes={stepSizes}
              />
            </div>
          </div>
        )
      })}

      {/* Exit button — floats in the center so it's always reachable */}
      <button className="table-exit-btn" onClick={onExit} aria-label="Exit table view">
        ✕ Exit table view
      </button>
    </div>
  )
}
