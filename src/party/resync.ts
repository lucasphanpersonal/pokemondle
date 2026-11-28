/**
 * Extra reads that close the gap between "the channel is subscribed" and "Postgres Changes are delivered".
 *
 * supabase-js reports SUBSCRIBED when the channel is joined, but the server may need a moment longer before it streams
 * Postgres Changes for it. A row written in that gap (typically a friend joining right after the room was made) is in
 * neither the first snapshot nor the live stream, so the host's lobby would miss them until a reload. Realtime stays
 * the main path; these reads only catch what it missed, and are cheap on the free plan:
 *
 * - one snapshot read when the server says Postgres Changes are ready for the channel, or, if it hasn't said so by
 *   then, SETTLE_REFRESH_MS after SUBSCRIBED (never both for one subscribe);
 * - while the room is in the lobby, the room row and its players (two small selects) every LOBBY_POLL_MS, skipped while
 *   the page is hidden, and once at once when the page becomes visible again. Nothing is polled during a game.
 */

export const SETTLE_REFRESH_MS = 1500
export const LOBBY_POLL_MS = 5000

export interface ResyncDeps {
  /** Reads the whole snapshot again. */
  refresh: () => void
  /** Reads the room row and the players again (only called in the lobby). */
  pollLobby: () => void
  /** True while the room is in the lobby. */
  inLobby: () => boolean
  /** True while the page is hidden (no polling then). Defaults to document.hidden. */
  hidden?: () => boolean
  /** Calls `fn` whenever the page's visibility changes; returns the unsubscribe. Defaults to document's visibilitychange. */
  onVisibility?: (fn: () => void) => () => void
}

export interface Resync {
  /** The channel reported SUBSCRIBED (first time or after a reconnect). */
  subscribed: () => void
  /** The server said Postgres Changes are now streaming for this channel. */
  changesReady: () => void
  close: () => void
}

const documentHidden = () => typeof document !== 'undefined' && document.hidden
function documentVisibility(fn: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  document.addEventListener('visibilitychange', fn)
  return () => document.removeEventListener('visibilitychange', fn)
}

export function createResync(deps: ResyncDeps): Resync {
  const hidden = deps.hidden ?? documentHidden
  let settle: ReturnType<typeof setTimeout> | undefined
  let poll: ReturnType<typeof setInterval> | undefined
  let closed = false
  /** changesReady came before this subscribe's SUBSCRIBED: that subscribe needs no settle read. */
  let readyEarly = false
  const stopVisibility = (deps.onVisibility ?? documentVisibility)(() => {
    if (!closed && poll !== undefined && !hidden() && deps.inLobby()) deps.pollLobby()
  })
  return {
    subscribed() {
      if (closed) return
      clearTimeout(settle)
      settle = undefined
      if (readyEarly) readyEarly = false
      else settle = setTimeout(() => !closed && deps.refresh(), SETTLE_REFRESH_MS)
      poll ??= setInterval(() => {
        if (!closed && deps.inLobby() && !hidden()) deps.pollLobby()
      }, LOBBY_POLL_MS)
    },
    changesReady() {
      if (closed) return
      // The settle read is only a fallback for this message: skip it.
      if (settle !== undefined) clearTimeout(settle)
      else readyEarly = true
      settle = undefined
      deps.refresh()
    },
    close() {
      closed = true
      clearTimeout(settle)
      clearInterval(poll)
      stopVisibility()
    },
  }
}
