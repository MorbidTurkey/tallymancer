/*
 * HistoryPanel — collapsible score-event log.
 *
 * Shows all score events for the session in reverse-chronological order
 * (most recent first, since that's what you want at the table).
 *
 * Props:
 *   token       — session token (for the API call)
 *   players     — sessionData.players array, used to resolve player IDs → names
 *   onClose     — callback to hide the panel
 *   refreshKey  — increment this (e.g. on every WS sync) to re-fetch history
 *
 * Each event shows:
 *   - Player name
 *   - Counter name (omitted if "life" — that's the usual case)
 *   - Delta: green "+5", red "-3", muted "0"
 *   - Resulting score
 *   - Relative timestamp ("just now", "2 min ago", etc.)
 *   - Voided events: strikethrough + "undone" badge
 */

import { useState, useEffect } from 'react'
import { api } from '../api.js'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a {playerId: playerName} lookup map. */
function buildNameMap(players) {
  const map = {}
  for (const p of players) map[p.id] = p.name
  return map
}

/** Human-readable relative time: "just now", "3 min ago", "2 hr ago", "4 days ago" */
function timeAgo(isoString) {
  const then = new Date(isoString)
  const secs = Math.floor((Date.now() - then) / 1000)
  if (secs < 10)  return 'just now'
  if (secs < 60)  return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60)  return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs} hr ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

/** Format delta with sign: "+5", "-3" */
function fmtDelta(delta) {
  return delta >= 0 ? `+${delta}` : `${delta}`
}

// ── Component ──────────────────────────────────────────────────────────────

export default function HistoryPanel({ token, players, onClose, refreshKey }) {
  const [events, setEvents] = useState(null)   // null = loading, [] = loaded (empty)
  const [error, setError]   = useState(null)

  // Fetch history whenever refreshKey changes (set by parent on each WS sync)
  useEffect(() => {
    let cancelled = false
    setError(null)
    api.getHistory(token)
      .then(data => {
        if (!cancelled) setEvents([...data].reverse())  // newest first
      })
      .catch(err => {
        if (!cancelled) setError(err.message)
      })
    return () => { cancelled = true }
  }, [token, refreshKey])

  // Rebuild name map whenever player list changes (rename, add, remove)
  const nameMap = buildNameMap(players)

  return (
    <div className="history-panel">
      <div className="history-panel__header">
        <span className="history-panel__title">Score history</span>
        <button className="history-panel__close" onClick={onClose} aria-label="Close history">✕</button>
      </div>

      {error && (
        <p className="history-panel__error">{error}</p>
      )}

      {events === null && !error && (
        <p className="history-panel__loading">Loading…</p>
      )}

      {events !== null && events.length === 0 && (
        <p className="history-panel__empty">No score changes yet.</p>
      )}

      {events !== null && events.length > 0 && (
        <ol className="history-list">
          {events.map(ev => {
            const name = nameMap[ev.player_id] ?? 'Unknown'
            const deltaClass = ev.delta > 0 ? 'delta--plus' : ev.delta < 0 ? 'delta--minus' : 'delta--zero'

            return (
              <li key={ev.id} className={`history-entry${ev.is_voided ? ' history-entry--voided' : ''}`}>
                <span className="history-entry__player">{name}</span>

                {/* Counter name — hidden for "life" to reduce noise */}
                {ev.counter_name !== 'life' && (
                  <span className="history-entry__counter">{ev.counter_name}</span>
                )}

                <span className={`history-entry__delta ${deltaClass}`}>
                  {fmtDelta(ev.delta)}
                </span>

                <span className="history-entry__score">→ {ev.resulting_score}</span>

                <span className="history-entry__time">{timeAgo(ev.created_at)}</span>

                {ev.is_voided && (
                  <span className="history-entry__voided-badge">undone</span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
