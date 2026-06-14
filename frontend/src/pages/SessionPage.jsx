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
 *
 * Victory detection:
 *   Each preset can declare a `victory` config:
 *     { counter, threshold, direction: "gte"|"lte", event: "win"|"eliminate" }
 *   "win"     — the player who hits the threshold wins immediately (Lorcana).
 *   "eliminate" — hitting the threshold eliminates that player; last one
 *                 standing wins (MTG, SWU, Yu-Gi-Oh!).
 *   Victory state is recomputed from live scores on every WS sync, so it
 *   auto-updates on undo or any score change.
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useWebSocket } from '../hooks/useWebSocket.js'
import { api } from '../api.js'
import PlayerCard from '../components/PlayerCard.jsx'
import ConnectionStatus from '../components/ConnectionStatus.jsx'
import TableView from '../components/TableView.jsx'
import HistoryPanel from '../components/HistoryPanel.jsx'

export default function SessionPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { sessionData, tokenType, wsStatus, wsError } = useWebSocket(token)
  const isEditor = tokenType === 'player'

  // ── History panel ─────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false)
  const [historyKey, setHistoryKey]   = useState(0)

  useEffect(() => {
    if (sessionData && showHistory) setHistoryKey(k => k + 1)
  }, [sessionData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Table view mode ───────────────────────────────────────────────────
  const [tableMode, setTableMode] = useState(false)

  // ── Share links ───────────────────────────────────────────────────────
  const storedLinks = (() => {
    try { return JSON.parse(localStorage.getItem(`tallymancer_links_${token}`) ?? 'null') }
    catch { return null }
  })()

  // Share panel starts closed — user opens it deliberately via the Share button.
  const [showShare, setShowShare] = useState(false)

  const [copiedLink, setCopiedLink] = useState(null)
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

  // ── Menu (home / clear scores) ────────────────────────────────────────
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef(null)

  // Close the menu when clicking outside it
  useEffect(() => {
    if (!showMenu) return
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [showMenu])

  async function handleClearScores() {
    setShowMenu(false)
    if (!window.confirm('Reset all scores back to starting values?')) return
    try {
      await api.resetScores(token)
    } catch (err) {
      alert('Could not reset scores: ' + err.message)
    }
  }

  function handleGoHome() {
    navigate('/')
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

  // ── Victory detection ─────────────────────────────────────────────────
  // Recomputed from live scores on every WS sync.  No server round-trip needed
  // because we already have all scores in sessionData.
  const { winner, eliminated } = useMemo(() => {
    const vic = sessionData?.preset_config?.victory
    const players = sessionData?.players ?? []
    if (!vic || players.length === 0) return { winner: null, eliminated: [] }

    const { counter, threshold, direction, event } = vic
    // Check whether a given score satisfies the victory/elimination condition.
    const triggered = score => direction === 'gte' ? score >= threshold : score <= threshold

    if (event === 'win') {
      // First player to hit the threshold wins outright.
      const w = players.find(p => triggered(p.scores?.[counter] ?? 0))
      return { winner: w ?? null, eliminated: [] }
    } else {
      // "eliminate" mode: players who hit the threshold are out.
      // Last player standing wins (only declared if ≥2 players total).
      const elim = players.filter(p => triggered(p.scores?.[counter] ?? 0))
      const remaining = players.filter(p => !triggered(p.scores?.[counter] ?? 0))
      const w = players.length > 1 && remaining.length === 1 ? remaining[0] : null
      return { winner: w, eliminated: elim }
    }
  }, [sessionData])

  // Victory banner visibility — dismissed per winner so undo re-shows it.
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const prevWinnerIdRef = useRef(null)
  useEffect(() => {
    const id = winner?.id ?? null
    if (id !== prevWinnerIdRef.current) {
      prevWinnerIdRef.current = id
      if (id !== null) setBannerDismissed(false)  // new winner → reveal banner
    }
  }, [winner])

  const showVictoryBanner = winner && !bannerDismissed

  const eliminatedIds = new Set(eliminated.map(p => p.id))

  // ── Error state (bad/expired token) ───────────────────────────────────
  if (wsError === 'invalid_token') {
    return (
      <div className="error-screen">
        <div className="error-screen__icon">🃏</div>
        <h1 className="error-screen__title">Session not found</h1>
        <p className="error-screen__body">
          This link is invalid or the session has expired. Check with the session creator for a fresh link.
        </p>
        <button className="btn btn--primary" onClick={() => navigate('/')}>Start a new game</button>
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
  const victoryConfig = sessionData.preset_config?.victory

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
          {tokenType && (
            <span className={`role-badge role-badge--${tokenType}`}>
              {tokenType === 'player' ? 'Player' : 'Audience'}
            </span>
          )}
          <button
            className={`btn btn--ghost btn--sm${showHistory ? ' btn--active' : ''}`}
            onClick={() => {
              const next = !showHistory
              setShowHistory(next)
              if (next) setHistoryKey(k => k + 1)
            }}
            title="Score history"
          >
            ≡ Log
          </button>

          {sessionData.players.length > 0 && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setTableMode(m => !m)}
              title="Switch to table view"
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
              onClick={() => setShowShare(s => !s)}
              title="Share session links"
            >
              Share
            </button>
          )}

          {/* ── Menu button ── */}
          <div className="session-menu" ref={menuRef}>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setShowMenu(m => !m)}
              title="Menu"
              aria-haspopup="true"
              aria-expanded={showMenu}
            >
              ⋮
            </button>
            {showMenu && (
              <div className="session-menu__dropdown" role="menu">
                <button
                  className="session-menu__item"
                  role="menuitem"
                  onClick={handleGoHome}
                >
                  🏠 Main Menu
                </button>
                {isEditor && (
                  <button
                    className="session-menu__item"
                    role="menuitem"
                    onClick={handleClearScores}
                  >
                    ↺ Clear Scores
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Undo toast ── */}
      {undoMsg && (
        <div className="toast" role="status" aria-live="polite">{undoMsg}</div>
      )}

      {/* ── Victory banner ── */}
      {showVictoryBanner && (
        <div className="victory-banner" role="status" aria-live="polite">
          <div className="victory-banner__inner">
            <span className="victory-banner__emoji">🎉</span>
            <div className="victory-banner__text">
              <span className="victory-banner__name">{winner.name}</span>
              <span className="victory-banner__label"> wins!</span>
            </div>
            <button
              className="victory-banner__dismiss"
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Share panel ── */}
      {showShare && storedLinks && (
        <div className="share-panel">
          <div className="share-panel__header">
            <span className="share-panel__heading">Share this session</span>
            <button className="share-panel__close" onClick={() => setShowShare(false)} aria-label="Close share panel">✕</button>
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

      {/* ── Victory condition hint ── */}
      {victoryConfig && (
        <div className="victory-hint">
          {sessionData.preset_config?.win_condition}
        </div>
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
            isEliminated={eliminatedIds.has(player.id)}
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
