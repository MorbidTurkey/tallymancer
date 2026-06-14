/*
 * api.js — Thin wrapper around the Tallymancer REST API.
 *
 * All functions return Promises.  On a non-2xx response they throw an Error
 * with a `status` property and `message` set to the server's detail string,
 * so callers can check `err.status === 403` etc.
 *
 * Base URL strategy:
 *   - If VITE_API_URL is set (e.g. production Netlify deploy), use that.
 *   - Otherwise use an empty string so all requests go to the same origin.
 *     In dev, Vite's proxy forwards /api/* and /ws/* to localhost:8000.
 *     In production (same-origin), the requests hit the server directly.
 */

const BASE = import.meta.env.VITE_API_URL ?? ''

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.detail ?? `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }

  // 204 No Content has no body
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // ── Presets ───────────────────────────────────────────────────────────
  getPresets: () =>
    request('/api/presets'),

  // ── Sessions ──────────────────────────────────────────────────────────
  createSession: (body) =>
    request('/api/sessions', { method: 'POST', body: JSON.stringify(body) }),

  getSession: (token) =>
    request(`/api/sessions/${token}`),

  // ── Players ───────────────────────────────────────────────────────────
  addPlayer: (token, body) =>
    request(`/api/sessions/${token}/players`, { method: 'POST', body: JSON.stringify(body) }),

  updatePlayer: (token, playerId, body) =>
    request(`/api/sessions/${token}/players/${playerId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  removePlayer: (token, playerId) =>
    request(`/api/sessions/${token}/players/${playerId}`, { method: 'DELETE' }),

  // ── Scores ────────────────────────────────────────────────────────────
  //  delta: positive = add, negative = subtract
  //  counterName: defaults to 'life'; pass 'poison', 'lore', etc. for other counters
  applyDelta: (token, playerId, delta, counterName = 'life') =>
    request(`/api/sessions/${token}/players/${playerId}/score`, {
      method: 'POST',
      body: JSON.stringify({ delta, counter_name: counterName }),
    }),

  undo: (token) =>
    request(`/api/sessions/${token}/undo`, { method: 'POST' }),

  resetScores: (token) =>
    request(`/api/sessions/${token}/reset`, { method: 'POST' }),

  updateConfig: (token, body) =>
    request(`/api/sessions/${token}/config`, { method: 'PATCH', body: JSON.stringify(body) }),

  getHistory: (token) =>
    request(`/api/sessions/${token}/history`),
}
