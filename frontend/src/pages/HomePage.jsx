/*
 * HomePage — Session creation screen.
 *
 * Flow:
 *   1. Page loads and fetches the list of game presets from the API.
 *   2. User picks a preset (defaults to MTG).
 *   3. Game settings section shows editable options for the selected preset:
 *      - Victory threshold (any preset with a victory condition)
 *      - Starting score, direction, and optional win condition (custom only)
 *   4. User adds player names (blank slots default to "Player N").
 *   5. "Start Game" POSTs to /api/sessions with a custom_config when the user
 *      has changed any defaults.
 *   6. User is navigated to /session/{player_token}.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'

const DEFAULT_NAMES = ['', '']

export default function HomePage() {
  const navigate = useNavigate()
  const [presets, setPresets]       = useState([])
  const [selectedPreset, setSelectedPreset] = useState('mtg')
  const [playerNames, setPlayerNames] = useState(DEFAULT_NAMES)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  // ── Game settings state ───────────────────────────────────────────────
  // These mirror the selected preset's defaults and are updated when the
  // user edits them.  On submit they're used to build a custom_config if
  // any value differs from the preset default.

  const [victoryThreshold, setVictoryThreshold] = useState(null)  // null = use preset default

  // Custom-game-only fields
  const [customStarting,          setCustomStarting]          = useState(0)
  const [customCountsUp,          setCustomCountsUp]          = useState(true)
  const [customHasVictory,        setCustomHasVictory]        = useState(false)
  const [customVictoryThreshold,  setCustomVictoryThreshold]  = useState(10)

  const selectedPresetData = presets.find(p => p.slug === selectedPreset)

  // Reset settings whenever the preset changes
  useEffect(() => {
    if (!selectedPresetData) return
    setVictoryThreshold(selectedPresetData.victory?.threshold ?? null)
    if (selectedPreset === 'custom') {
      setCustomStarting(selectedPresetData.counters[0]?.starting ?? 0)
      setCustomCountsUp(selectedPresetData.counters[0]?.counts_up ?? true)
      setCustomHasVictory(false)
      setCustomVictoryThreshold(10)
    }
  }, [selectedPreset, presets]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.getPresets()
      .then(setPresets)
      .catch(() => setError('Could not reach the server. Is the backend running?'))
  }, [])

  // ── Player name list management ───────────────────────────────────────

  function setName(index, value) {
    setPlayerNames(prev => prev.map((n, i) => i === index ? value : n))
  }
  function addNameSlot() { setPlayerNames(prev => [...prev, '']) }
  function removeName(index) { setPlayerNames(prev => prev.filter((_, i) => i !== index)) }
  function onNameKeyDown(e, index) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (index === playerNames.length - 1) addNameSlot()
    }
  }

  // ── Session creation ──────────────────────────────────────────────────

  async function handleStart(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Blank slots fall back to "Player N"
    const names = playerNames.map((n, i) => n.trim() || `Player ${i + 1}`)

    // Build a custom_config only when settings differ from the preset default.
    let custom_config = null

    if (selectedPreset === 'custom' && selectedPresetData) {
      // Always send custom_config for "custom" so the user's settings are stored.
      custom_config = {
        ...selectedPresetData,
        counters: [{
          ...selectedPresetData.counters[0],
          starting:   customStarting,
          counts_up:  customCountsUp,
          floor:      customCountsUp ? 0 : null,
        }],
        victory: customHasVictory ? {
          counter:   selectedPresetData.counters[0]?.name ?? 'score',
          threshold: customVictoryThreshold,
          direction: customCountsUp ? 'gte' : 'lte',
          event:     'win',
        } : null,
      }
    } else if (
      selectedPresetData?.victory &&
      victoryThreshold !== null &&
      victoryThreshold !== selectedPresetData.victory.threshold
    ) {
      // User changed the win threshold — send the whole preset with the override baked in.
      custom_config = {
        ...selectedPresetData,
        victory: { ...selectedPresetData.victory, threshold: victoryThreshold },
      }
    }

    try {
      const { player_link, audience_link } = await api.createSession({
        game_preset:   selectedPreset,
        player_names:  names,
        custom_config,
      })

      const playerToken = player_link.split('/').pop()
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

  const presetVictory = selectedPresetData?.victory

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

        {/* ── Game settings ── */}
        {selectedPresetData && (
          <section className="form-section">
            <h2 className="form-section__label">Game Settings</h2>

            {selectedPreset === 'custom' ? (
              <div className="settings-grid">
                {/* Starting score */}
                <label className="setting-row">
                  <span className="setting-row__label">Starting score</span>
                  <input
                    className="setting-input"
                    type="number"
                    value={customStarting}
                    onChange={e => setCustomStarting(Number(e.target.value))}
                  />
                </label>

                {/* Direction */}
                <label className="setting-row">
                  <span className="setting-row__label">Scores</span>
                  <select
                    className="setting-select"
                    value={customCountsUp ? 'up' : 'down'}
                    onChange={e => setCustomCountsUp(e.target.value === 'up')}
                  >
                    <option value="up">Count up (towards a goal)</option>
                    <option value="down">Count down (avoid zero)</option>
                  </select>
                </label>

                {/* Optional win condition */}
                <div className="setting-row setting-row--toggle">
                  <span className="setting-row__label">Win condition</span>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={customHasVictory}
                      onChange={e => setCustomHasVictory(e.target.checked)}
                    />
                    <span className="toggle-label__text">Enable</span>
                  </label>
                  {customHasVictory && (
                    <input
                      className="setting-input setting-input--inline"
                      type="number"
                      value={customVictoryThreshold}
                      onChange={e => setCustomVictoryThreshold(Number(e.target.value))}
                      title={customCountsUp ? 'Win when score reaches this' : 'Player is eliminated at this score'}
                      min={0}
                    />
                  )}
                </div>
              </div>
            ) : presetVictory ? (
              /* Non-custom presets: only the victory threshold is editable */
              <div className="settings-grid">
                <label className="setting-row">
                  <span className="setting-row__label">
                    {presetVictory.event === 'win' ? 'Win at' : 'Eliminated at'}
                  </span>
                  <input
                    className="setting-input"
                    type="number"
                    value={victoryThreshold ?? presetVictory.threshold}
                    onChange={e => setVictoryThreshold(Number(e.target.value))}
                    min={0}
                  />
                  <span className="setting-row__unit">
                    {selectedPresetData.counters.find(c => c.name === presetVictory.counter)?.label ?? presetVictory.counter}
                  </span>
                </label>
              </div>
            ) : (
              <p className="setting-note">No victory condition for this game.</p>
            )}
          </section>
        )}

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
