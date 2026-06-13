/*
 * SessionPage — the main game view.
 *
 * Role model:
 *   The :token in the URL is either a player token (edit access) or an
 *   audience token (view-only).  The server tells us which via the first
 *   WebSocket sync message.  We NEVER trust a client-side flag for this —
 *   the server enforces it on every REST request too.
 *
 *   tokenType === 'player'   → full controls visible
 *   tokenType === 'audience' → scoreboard only, no controls
 *
 * Share link UX:
 *   The session creator's browser stores both links (player + audience) in
 *   localStorage, keyed by the player token.  The share panel reads from
 *   there.  Audience visitors don't have this data, so the share panel
 *   never appears for them.
 */

import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useWebSocket } from '../hooks/useWebSocket.js'
import { api } from '../api.js'
import PlayerCard from '../components/PlayerCard.jsx'
import ConnectionStatus from '../components/ConnectionStatus.jsx'
import TableView from '../components/TableView.jsx'
import HistoryPanel from '../components/HistoryPanel.jsx'

export default function SessionPage() {
  const { token } = useParams()
  const { sessionData, tokenType, wsStatus, wsError } = useWebSocket(token)
  const isEditor = tokenType === 'player'

  // ── History panel ─────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false)
  const [historyKey, setHistoryKey]   = useState(0)

  // Bump historyKey every time a WS sync delivers new sessionData.
  // HistoryPanel watches this prop and re-fetches from the server when it changes,
  // so the history stays current while the panel is open.
  // This useEffect is placed BEFORE conditional returns to satisfy Rules of Hooks.
  useEffect(() => {
    if (sessionData && showHistory) setHistoryKey(k => k + 1)
  }, [sessionData]) // eslint-disable-line react-hooks/exhaustive-deps



  // ── Table view mode ───────────────────────────────────────────────────
  // When active, a full-screen overlay shows each player's panel rotated
  // to face their seat on a phone lying flat in the middle of the table.
  const [tableMode, setTableMode] = useState(false)

  // ── Share links ───────────────────────────────────────────────────────
  // Loaded from localStorage (written by HomePage at creation time).
  // Audience visitors won't have this data — that's intentional.
  const storedLinks = (() => {
    try { return JSON.parse(localStorage.getItem(`tallymancer_links_${token}`) ?? 'null') }
    catch { return null }
  })()

  // Auto-open the share panel the first time the creator visits.
  // sessionStorage tracks "has seen" per browser session so it doesn't
  // pop open again on every page refresh.
  const seenKey = `tallymancer_share_seen_${token}`
  const [showShare, setShowShare] = useState(
    Boolean(storedLinks) && sessionStorage.getItem(seenKey) !== 'true'
  )
  function closeShare() {
    setShowShare(false)
    sessionStorage.setItem(seenKey, 'true')
  }

  // ── Copy-to-clipboard with "Copied!" feedback ─────────────────────────
  const [copiedLink, setCopiedLink] = useState(null)  // 'player' | 'audience' | null
  function copyLink(url, which) {
    navigator.clipboard.writeText(url).then(
      () => { setCopiedLink(which); setTimeout(() => setCopiedLink(null), 2000) },
      () => alert(`Could not copy. Link:\n${url}`)
    )
  }

  // ── Undo ──────────────────────────────────────────────────────────────
  const [undoMsg, setUndoMsg] = useState(null)
  async function handleUndo() {
    try {
      const r = await api.undo(token)
      setUndoMsg(`Undone: ${r.counter_name} ${r.score_before_undo} → ${r.score_after_undo}`)
    } catch (err) {
      setUndoMsg(err.status === 409 ? 'Nothing to undo' : 'Undo failed')
    }
    setTimeout(() => setUndoMsg(null), 2500)
  }

  // ── Add player ────────────────────────────────────────────────────────
  const [addingPlayer, setAddingPlayer] = useState(false)
  const [newName, setNewName] = useState('')
  async function handleAddPlayer(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    try {
      await api.addPlayer(token, { name })
      setNewName('')
      setAddingPlayer(false)
    } catch (err) { console.error('Add player failed:', err.message) }
  }

  // ── Error state (bad/expired token) ───────────────────────────────────
  if (wsError === 'invalid_token') {
    return (
      <div className="error-screen">
        <div className="error-screen__icon">🃏</div>
        <h1 className="error-screen__title">Session not found</h1>
        <p className="error-screen__body">
          This link is invalid or the session has expired. Check with the session creator for a fresh link.
        </p>
        <Link to="/" className="btn btn--primary">Start a new game</Link>
      </div>
    )
  }

  // ── Loading state ─────────────────────────────────────────────────────
  if (!sessionData) {
    return (
      <div className="loading-screen">
        <div className="spinner" aria-label="Loading" />
        <p>{wsStatus === 'reconnecting' ? 'Reconnecting…' : 'Connecting to session…'}</p>
      </div>
    )
  }

  const primaryCounter = sessionData.preset_config?.counters?.[0]?.name ?? 'life'
  const gameName = sessionData.preset_config?.name ?? sessionData.game_preset

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="session-page">

      {/* ── Header ── */}
      <header className="session-header">
        <div className="session-header__left">
          <span className="session-header__game" title={gameName}>{gameName}</span>
          <ConnectionStatus status={wsStatus} />
        </div>

        <div className="session-header__right">
          {/* Role badge — always shown once we know the role */}
          {tokenType && (
            <span className={`role-badge role-badge--${tokenType}`}>
              {tokenType === 'player' ? 'Player' : 'Audience'}
            </span>
          )}
          {/* History log toggle */}
          <button
            className={`btn btn--ghost btn--sm${showHistory ? ' btn--active' : ''}`}
            onClick={() => {
              const next = !showHistory
              setShowHistory(next)
              if (next) setHistoryKey(k => k + 1)  // trigger fetch when opening
            }}
            title="Score history"
          >
            ≡ Log
          </button>

          {/* Table view toggle — only useful when there are players */}
          {sessionData.players.length > 0 && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setTableMode(m => !m)}
              title="Switch to table view — phone lies flat, each player faces their panel"
            >
              ⊞ Table
            </button>
          )}
          {isEditor && (
            <button className="btn btn--ghost btn--sm" onClick={handleUndo} title="Undo last score change">
              ↩ Undo
            </button>
          )}
          {storedLinks && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => showShare ? closeShare() : setShowShare(true)}
              title="Share session links"
            >
              Share
            </button>
          )}
        </div>
      </header>

      {/* ── Undo toast ── */}
      {undoMsg && (
        <div className="toast" role="status" aria-live="polite">{undoMsg}</div>
      )}

      {/* ── Share panel ── */}
      {showShare && storedLinks && (
        <div className="share-panel">
          <div className="share-panel__header">
            <span className="share-panel__heading">Share this session</span>
            <button className="share-panel__close" onClick={closeShare} aria-label="Close share panel">✕</button>
          </div>

          <ShareRow
            label="Players link"
            desc="Full edit access — tap +/− to change scores"
            url={storedLinks.player_link}
            which="player"
            copied={copiedLink === 'player'}
            onCopy={() => copyLink(storedLinks.player_link, 'player')}
          />
          <ShareRow
            label="Audience link"
            desc="View only — live scoreboard, no controls"
            url={storedLinks.audience_link}
            which="audience"
            copied={copiedLink === 'audience'}
            onCopy={() => copyLink(storedLinks.audience_link, 'audience')}
          />
        </div>
      )}

      {/* ── History panel ── */}
      {showHistory && (
        <HistoryPanel
          token={token}
          players={sessionData.players}
          onClose={() => setShowHistory(false)}
          refreshKey={historyKey}
        />
      )}

      {/* ── Audience view banner ── */}
      {tokenType === 'audience' && (
        <div className="audience-banner">Watching live · scores update automatically</div>
      )}

      {/* ── Player grid ── */}
      <main className="player-grid">
        {sessionData.players.map(player => (
          <PlayerCard
            key={player.id}
            player={player}
            token={token}
            tokenType={tokenType}
            primaryCounter={primaryCounter}
          />
        ))}

        {sessionData.players.length === 0 && isEditor && (
          <div className="empty-state">
            <p>No players yet — add one below</p>
          </div>
        )}
      </main>

      {/* ── Add player footer ── */}
      {isEditor && (
        <footer className="session-footer">
          {addingPlayer ? (
            <form className="add-player-form" onSubmit={handleAddPlayer}>
              <input
                className="name-input"
                autoFocus
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="New player name"
                maxLength={100}
                onKeyDown={e => e.key === 'Escape' && setAddingPlayer(false)}
              />
              <button type="submit" className="btn btn--primary btn--sm">Add</button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => { setAddingPlayer(false); setNewName('') }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button className="btn btn--ghost" onClick={() => setAddingPlayer(true)}>
              + Add Player
            </button>
          )}
        </footer>
      )}

      {/* ── Table view overlay ── */}
      {/* Rendered as position:fixed so it covers the entire screen.
          The exit button floats in the center so it's reachable from any seat. */}
      {tableMode && (
        <TableView
          players={sessionData.players}
          token={token}
          tokenType={tokenType}
          primaryCounter={primaryCounter}
          onExit={() => setTableMode(false)}
        />
      )}
    </div>
  )
}

// ── Share row sub-component ────────────────────────────────────────────────
function ShareRow({ label, desc, url, copied, onCopy }) {
  return (
    <div className="share-row">
      <div className="share-row__info">
        <span className="share-row__label">{label}</span>
        <span className="share-row__desc">{desc}</span>
        <span className="share-row__url">{url}</span>
      </div>
      <div className="share-row__actions">
        <button
          className={`btn btn--sm ${copied ? 'btn--copied' : 'btn--primary'}`}
          onClick={onCopy}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn--ghost btn--sm"
          title="Open in new tab"
        >
          Open ↗
        </a>
      </div>
    </div>
  )
}
