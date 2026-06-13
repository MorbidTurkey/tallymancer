/*
 * useWebSocket.js — React hook that manages a live WebSocket connection.
 *
 * Usage:
 *   const { sessionData, tokenType, wsStatus, wsError } = useWebSocket(token)
 *
 * Returns:
 *   sessionData  — full session state (players, scores, preset) — null until first sync
 *   tokenType    — 'player' | 'audience' — role resolved server-side
 *   wsStatus     — 'connecting' | 'connected' | 'reconnecting' | 'error'
 *   wsError      — null | 'invalid_token'
 *
 * Error handling:
 *   Close code 4004 = the token is invalid (unknown or expired session).
 *   On 4004 we set wsError='invalid_token' and STOP retrying — the token
 *   won't become valid on its own, so retrying would just spam the server.
 *   All other close codes (1001 going away, 1006 abnormal) trigger the
 *   exponential-backoff reconnect loop.
 *
 * Reconnect / resync:
 *   After any reconnect the server immediately sends a full 'sync' message,
 *   so the client is always up to date after the connection is re-established.
 */

import { useState, useEffect, useRef } from 'react'

function getWsBase() {
  const apiUrl = import.meta.env.VITE_API_URL
  if (apiUrl) {
    return apiUrl.replace(/^http/, 'ws')
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}`
}

export function useWebSocket(token) {
  const [sessionData, setSessionData] = useState(null)
  const [tokenType, setTokenType]     = useState(null)
  const [wsStatus, setWsStatus]       = useState('connecting')
  const [wsError, setWsError]         = useState(null)   // null | 'invalid_token'

  const wsRef       = useRef(null)
  const isMounted   = useRef(true)
  const retryCount  = useRef(0)
  const pingTimer   = useRef(null)

  useEffect(() => {
    isMounted.current = true
    if (!token) return

    function connect() {
      if (!isMounted.current) return

      setWsStatus('connecting')
      const ws = new WebSocket(`${getWsBase()}/ws/${token}`)
      wsRef.current = ws

      ws.onopen = () => {
        if (!isMounted.current) { ws.close(); return }
        setWsStatus('connected')
        retryCount.current = 0

        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }))
          }
        }, 20_000)
      }

      ws.onmessage = (event) => {
        let msg
        try { msg = JSON.parse(event.data) } catch { return }
        if (msg.type === 'sync') {
          setTokenType(msg.token_type)
          setSessionData(msg.data)
        }
      }

      ws.onclose = (event) => {
        clearInterval(pingTimer.current)
        if (!isMounted.current) return

        if (event.code === 4004) {
          // Permanent error — bad token.  Show error UI, don't reconnect.
          setWsStatus('error')
          setWsError('invalid_token')
          return
        }

        // Transient close (network drop, server restart, etc.) → reconnect.
        setWsStatus('reconnecting')
        const delay = Math.min(1000 * 2 ** retryCount.current, 30_000)
        retryCount.current += 1
        setTimeout(connect, delay)
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      isMounted.current = false
      clearInterval(pingTimer.current)
      if (wsRef.current) {
        wsRef.current.onclose = null  // prevent reconnect on unmount
        wsRef.current.close()
      }
    }
  }, [token])

  return { sessionData, tokenType, wsStatus, wsError }
}
