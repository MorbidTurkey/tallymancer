/*
 * ConnectionStatus — small dot + label showing the WebSocket connection state.
 *
 * Props:
 *   status — 'connecting' | 'connected' | 'reconnecting'
 */
export default function ConnectionStatus({ status }) {
  const labels = {
    connecting:   'Connecting…',
    connected:    'Live',
    reconnecting: 'Reconnecting…',
  }

  return (
    <span className={`conn-status conn-status--${status}`} aria-live="polite">
      <span className="conn-status__dot" aria-hidden="true" />
      {labels[status] ?? status}
    </span>
  )
}
