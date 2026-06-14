/*
 * PlayerCard — the core UI unit.  One card per player showing:
 *   - Editable player name
 *   - Current score (large)
 *   - Secondary counters (small badges) when the preset has more than one
 *   - Step buttons: −5  −1  +1  +5
 *   - Free-text math input for arbitrary deltas
 *   - Remove button
 *
 * Props:
 *   player        — player object from sessionData.players
 *   token         — the session token (used for API calls)
 *   tokenType     — 'player' | 'audience'
 *   primaryCounter— name of the main counter to display big (e.g. 'life')
 *   onRemove      — callback() when player is removed (triggers API + WS update)
 */

import { useState, useEffect, useRef } from 'react'
import { api } from '../api.js'

export default function PlayerCard({ player, token, tokenType, primaryCounter, onRemove, isEliminated, stepSizes = [1, 5] }) {
  const isEditor = tokenType === 'player'

  // ── Name editing ──────────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(player.name)
  const nameInputRef = useRef(null)

  // When a WS sync updates the player name externally, sync local state
  // (unless we're in the middle of editing — don't clobber what the user is typing)
  useEffect(() => {
    if (!editingName) setNameVal(player.name)
  }, [player.name, editingName])

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus()
  }, [editingName])

  async function saveName() {
    const trimmed = nameVal.trim()
    setEditingName(false)
    if (!trimmed || trimmed === player.name) {
      setNameVal(player.name)  // revert on empty / unchanged
      return
    }
    try {
      await api.updatePlayer(token, player.id, { name: trimmed })
      // WS broadcast will push the confirmed name back to us
    } catch (err) {
      console.error('Rename failed:', err.message)
      setNameVal(player.name)  // revert on error
    }
  }

  function onNameKeyDown(e) {
    if (e.key === 'Enter') saveName()
    if (e.key === 'Escape') { setNameVal(player.name); setEditingName(false) }
  }

  // ── Score delta ───────────────────────────────────────────────────────
  // Optimistic update: immediately reflect the delta locally so the UI
  // feels instant, then the WS broadcast from the server will confirm it
  // (or correct it if the server clamped the value).
  const [optimisticDelta, setOptimisticDelta] = useState(0)

  async function applyDelta(delta) {
    if (!isEditor) return
    setOptimisticDelta(d => d + delta)  // show change immediately
    try {
      await api.applyDelta(token, player.id, delta, primaryCounter)
    } catch (err) {
      setOptimisticDelta(d => d - delta)  // roll back on error
      console.error('Score update failed:', err.message)
    }
  }

  // Reset the optimistic delta when the WS sync gives us authoritative state
  useEffect(() => {
    setOptimisticDelta(0)
  }, [player.scores])

  // ── Math input ────────────────────────────────────────────────────────
  // User types "-5", "+12", or "1000" and presses Enter to apply as a delta.
  const [mathVal, setMathVal] = useState('')

  async function onMathKeyDown(e) {
    if (e.key !== 'Enter') return
    const parsed = parseFloat(mathVal.trim())
    if (isNaN(parsed)) { setMathVal(''); return }
    await applyDelta(Math.round(parsed))
    setMathVal('')
  }

  // ── Remove player ─────────────────────────────────────────────────────
  async function handleRemove() {
    if (!isEditor) return
    if (!window.confirm(`Remove ${player.name} from the session?`)) return
    try {
      await api.removePlayer(token, player.id)
      onRemove?.()
    } catch (err) {
      console.error('Remove player failed:', err.message)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  const serverScore = player.scores?.[primaryCounter] ?? 0
  const displayScore = serverScore + optimisticDelta

  // Secondary counters: everything that isn't the primary
  const secondaryEntries = Object.entries(player.scores ?? {}).filter(
    ([name]) => name !== primaryCounter
  )

  const cardStyle = player.color
    ? { '--player-color': player.color }
    : {}

  return (
    <div
      className={`player-card${isEliminated ? ' player-card--eliminated' : ''}`}
      style={cardStyle}
      data-color={!!player.color}
    >
      {/* ── Header: name + remove ── */}
      <div className="player-card__header">
        {editingName ? (
          <input
            ref={nameInputRef}
            className="player-card__name-input"
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={saveName}
            onKeyDown={onNameKeyDown}
            maxLength={100}
          />
        ) : (
          <button
            className="player-card__name"
            onClick={() => isEditor && setEditingName(true)}
            title={isEditor ? 'Tap to rename' : undefined}
            aria-label={isEditor ? `Rename ${player.name}` : player.name}
          >
            {player.name}
          </button>
        )}

        {isEliminated && (
          <span className="player-card__eliminated-badge" aria-label="Eliminated">out</span>
        )}
        {isEditor && (
          <button className="player-card__remove" onClick={handleRemove} aria-label={`Remove ${player.name}`}>
            ✕
          </button>
        )}
      </div>

      {/* ── Primary score ── */}
      <div className="player-card__score" aria-label={`${player.name} score: ${displayScore}`}>
        {displayScore}
      </div>

      {/* ── Secondary counters (e.g. poison in MTG) ── */}
      {secondaryEntries.length > 0 && (
        <div className="player-card__secondary">
          {secondaryEntries.map(([name, val]) => (
            <span key={name} className="secondary-counter">
              {name}: {val}
            </span>
          ))}
        </div>
      )}

      {/* ── Controls (player token only) ── */}
      {isEditor && (
        <div className="player-card__controls">
          <div className="step-buttons">
            <button className="step-btn step-btn--sm" onClick={() => applyDelta(-stepSizes[1])} aria-label={`-${stepSizes[1]}`}>
              −{stepSizes[1]}
            </button>
            <button className="step-btn step-btn--lg step-btn--minus" onClick={() => applyDelta(-stepSizes[0])} aria-label={`-${stepSizes[0]}`}>
              −{stepSizes[0]}
            </button>
            <button className="step-btn step-btn--lg step-btn--plus" onClick={() => applyDelta(+stepSizes[0])} aria-label={`+${stepSizes[0]}`}>
              +{stepSizes[0]}
            </button>
            <button className="step-btn step-btn--sm" onClick={() => applyDelta(+stepSizes[1])} aria-label={`+${stepSizes[1]}`}>
              +{stepSizes[1]}
            </button>
          </div>

          {/*
           * Math input: type a delta and press Enter.
           * "+12" → add 12,  "-5" → subtract 5,  "7" → add 7.
           * inputMode="text" keeps the full keyboard on mobile so users can type "-".
           */}
          <input
            className="math-input"
            type="text"
            inputMode="text"
            value={mathVal}
            onChange={e => setMathVal(e.target.value)}
            onKeyDown={onMathKeyDown}
            placeholder="±value  e.g. −5"
            aria-label="Apply custom delta (press Enter)"
          />
        </div>
      )}
    </div>
  )
}
