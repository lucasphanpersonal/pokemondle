import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createResync, LOBBY_POLL_MS, SETTLE_REFRESH_MS } from './resync.ts'
import { initialPartyState, partyReducer, selectPresentPlayers, type PartyAction, type PlayerRow, type RoomRow } from './state.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(lobby = true, isHidden = false) {
  const calls = { refresh: 0, poll: 0 }
  let inLobby = lobby
  let hidden = isHidden
  let visibility: (() => void) | null = null
  const r = createResync({
    refresh: () => calls.refresh++,
    pollLobby: () => calls.poll++,
    inLobby: () => inLobby,
    hidden: () => hidden,
    onVisibility: (fn) => {
      visibility = fn
      return () => (visibility = null)
    },
  })
  const setHidden = (v: boolean) => {
    hidden = v
    visibility?.()
  }
  return { r, calls, setLobby: (v: boolean) => (inLobby = v), setHidden, listening: () => visibility !== null }
}

describe('createResync', () => {
  it('reads the snapshot again once, a moment after SUBSCRIBED', () => {
    const { r, calls } = setup(false)
    r.subscribed()
    vi.advanceTimersByTime(SETTLE_REFRESH_MS - 1)
    expect(calls.refresh).toBe(0)
    vi.advanceTimersByTime(1)
    expect(calls.refresh).toBe(1)
    vi.advanceTimersByTime(60_000)
    expect(calls.refresh).toBe(1)
  })

  it('a quick resubscribe leaves one settle read, not two', () => {
    const { r, calls } = setup(false)
    r.subscribed()
    vi.advanceTimersByTime(500)
    r.subscribed()
    vi.advanceTimersByTime(SETTLE_REFRESH_MS)
    expect(calls.refresh).toBe(1)
  })

  it('reads again when the server says Postgres Changes are ready, and then skips the settle read', () => {
    const { r, calls } = setup(false)
    r.subscribed()
    vi.advanceTimersByTime(300)
    r.changesReady()
    expect(calls.refresh).toBe(1)
    vi.advanceTimersByTime(SETTLE_REFRESH_MS * 2)
    expect(calls.refresh).toBe(1)
  })

  it('a ready message before SUBSCRIBED also covers that subscribe; the next one gets its settle read again', () => {
    const { r, calls } = setup(false)
    r.changesReady()
    r.subscribed()
    vi.advanceTimersByTime(SETTLE_REFRESH_MS * 2)
    expect(calls.refresh).toBe(1)
    r.subscribed() // a reconnect with no ready message
    vi.advanceTimersByTime(SETTLE_REFRESH_MS)
    expect(calls.refresh).toBe(2)
  })

  it('polls at once when the page comes back into view in the lobby, not during a game', () => {
    const { r, calls, setHidden, setLobby } = setup(true, true)
    r.subscribed()
    setHidden(false)
    expect(calls.poll).toBe(1)
    setHidden(true)
    expect(calls.poll).toBe(1)
    setLobby(false)
    setHidden(false)
    expect(calls.poll).toBe(1)
  })

  it('polls the players on a slow interval only while in the lobby and visible', () => {
    const { r, calls, setLobby, setHidden } = setup(true)
    r.subscribed()
    vi.advanceTimersByTime(LOBBY_POLL_MS * 3)
    expect(calls.poll).toBe(3)
    setHidden(true)
    vi.advanceTimersByTime(LOBBY_POLL_MS * 2)
    expect(calls.poll).toBe(3)
    setLobby(false) // the game started: Realtime only
    setHidden(false)
    vi.advanceTimersByTime(LOBBY_POLL_MS * 5)
    expect(calls.poll).toBe(3)
    // Resubscribing doesn't start a second interval.
    setLobby(true)
    r.subscribed()
    vi.advanceTimersByTime(LOBBY_POLL_MS)
    expect(calls.poll).toBe(4)
  })

  it('does nothing after close', () => {
    const { r, calls, listening } = setup(true)
    r.subscribed()
    r.close()
    expect(listening()).toBe(false)
    r.changesReady()
    vi.advanceTimersByTime(LOBBY_POLL_MS * 4)
    expect(calls).toEqual({ refresh: 0, poll: 0 })
  })

  it('is cheap: at most one lobby poll every few seconds', () => {
    expect(LOBBY_POLL_MS).toBeGreaterThanOrEqual(3000)
    expect(SETTLE_REFRESH_MS).toBeGreaterThanOrEqual(1000)
    expect(SETTLE_REFRESH_MS).toBeLessThanOrEqual(3000)
  })
})

// The bug the playtest found: the host's first snapshot was read before Postgres Changes were delivered, so a guest
// who joined in that gap never showed up. The lobby re-read brings them in, without touching the deck or answers.
describe("the lobby re-read ('lobby' action)", () => {
  const ROOM = 'r1'
  const room = { id: ROOM, host_id: 'p1', status: 'lobby', lives: 3, game_no: 1, round: 0, turn_no: 0,
    last_activity: '2026-11-28T10:00:00.000Z' } as unknown as RoomRow
  const player = (id: string, joined: string) =>
    ({ id, room_id: ROOM, nickname: id, seat: null, lives: 3, gone_at: null, joined_at: joined }) as unknown as PlayerRow
  const host = player('p1', '2026-11-28T10:00:00.000Z')
  const guest = player('p2', '2026-11-28T10:00:01.000Z')

  it('adds the guest the first snapshot missed', () => {
    const first: PartyAction = { type: 'snapshot', roomId: ROOM, room, players: [host], categories: [], answers: [] }
    let s = partyReducer(initialPartyState(ROOM), first)
    expect(selectPresentPlayers(s).map((p) => p.id)).toEqual(['p1'])
    s = partyReducer(s, { type: 'lobby', roomId: ROOM, room, players: [host, guest] })
    expect(selectPresentPlayers(s).map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('keeps the deck and answers it already has, and ignores another room', () => {
    const cat = { room_id: ROOM, game_no: 1, deck_no: 1, parts: [], tier: 'easy', pool: 10, seconds: 20 }
    let s = partyReducer(initialPartyState(ROOM), {
      type: 'snapshot', roomId: ROOM, room, players: [host], categories: [cat as never], answers: [],
    })
    s = partyReducer(s, { type: 'lobby', roomId: ROOM, room, players: [host, guest] })
    expect(Object.keys(s.categories)).toEqual(['1:1'])
    expect(partyReducer(s, { type: 'lobby', roomId: 'other', room, players: [] })).toBe(s)
  })
})
