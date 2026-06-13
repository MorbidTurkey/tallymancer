/*
 * HomePage — Session creation screen.
 *
 * Flow:
 *   1. Page loads and fetches the list of game presets from the API.
 *   2. User picks a preset (defaults to MTG).
 *   3. User adds player names (at least one recommended but not required).
 *   4. "Start Game" POSTs to /api/sessions → receives player + audience links.
 *   5. Both links are stored in localStorage so they survive page refresh.
 *   6. User is navigated to /session/{player_token}.
 *   7. The session page can retrieve the audience link from localStorage
 *      and display it in the share panel.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'

// Default player slots shown before the user has typed anything
const DEFAULT_NAMES = ['', '']

export default function HomePage() {
  const navigate = useNavigate()
  const [presets, setPresets] = useState([])
  const [selectedPreset, setSelectedPreset] = useState('mtg')
  const [playerNames, setPlayerNames] = useState(DEFAULT_NAMES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Load presets on mount
  useEffect(() => {
    api.getPresets()
      .then(setPresets)
      .catch(err => setError('Could not reach the server. Is the backend running?'))
  }, [])

  // ── Player name list management ───────────────────────────────────────

  function setName(index, value) {
    setPlayerNames(prev => prev.map((n, i) => i === index ? value : n))
  }

  function addNameSlot() {
    setPlayerNames(prev => [...prev, ''])
  }

  function removeName(index) {
    setPlayerNames(prev => prev.filter((_, i) => i !== index))
  }

  // Pressing Enter in a name input adds a new slot and focuses it
  function onNameKeyDown(e, index) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (index === playerNames.length - 1) {
        addNameSlot()
        // Focus happens via useEffect on the new input (below)
      }
    }
  }

  // ── Session creation ──────────────────────────────────────────────────

  async function handleStart(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Filter out empty name inputs
    const names = playerNames.map(n => n.trim()).filter(Boolean)

    try {
      const { player_link, audience_link } = await api.createSession({
        game_preset: selectedPreset,
        player_names: names,
      })

      // Extract just the token from the URL: "http://host/session/{token}" → token
      const playerToken = player_link.split('/').pop()

      // Store both links in localStorage so the session page can show them.
      // Key by player token so multiple sessions don't collide.
      localStorage.setItem(
        `tallymancer_links_${playerToken}`,
        JSON.stringify({ player_link, audience_link })
      )

      navigate(`/session/${playerToken}`)
    } catch (err) {
      setError(err.message ?? 'Failed to create session')
      setLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="home-page">
      <header className="home-header">
        <h1 className="home-header__title">
          <span className="home-header__wand">🃏</span>
          Tallymancer
        </h1>
        <p className="home-header__tagline">One scorecard to rule them all</p>
      </header>

      <form className="home-form" onSubmit={handleStart}>

        {/* ── Preset picker ── */}
        <section className="form-section">
          <h2 className="form-section__label">Game</h2>
          <div className="preset-grid">
            {presets.map(preset => (
              <button
                key={preset.slug}
                type="button"
                className={`preset-card ${selectedPreset === preset.slug ? 'preset-card--selected' : ''}`}
                onClick={() => setSelectedPreset(preset.slug)}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </section>

        {/* ── Player names ── */}
        <section className="form-section">
          <h2 className="form-section__label">Players</h2>
          <div className="name-list">
            {playerNames.map((name, i) => (
              <div key={i} className="name-row">
                <input
                  className="name-input"
                  type="text"
                  value={name}
                  onChange={e => setName(i, e.target.value)}
                  onKeyDown={e => onNameKeyDown(e, i)}
                  placeholder={`Player ${i + 1}`}
                  maxLength={100}
                  autoFocus={i === playerNames.length - 1 && i > 1}
                />
                {playerNames.length > 1 && (
                  <button
                    type="button"
                    className="name-remove"
                    onClick={() => removeName(i)}
                    aria-label={`Remove player ${i + 1}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="btn btn--ghost btn--full" onClick={addNameSlot}>
              + Add player
            </button>
          </div>
        </section>

        {error && <p className="form-error">{error}</p>}

        <button
          type="submit"
          className="btn btn--primary btn--full btn--large"
          disabled={loading || presets.length === 0}
        >
          {loading ? 'Creating…' : 'Start Game'}
        </button>
      </form>
    </div>
  )
}
