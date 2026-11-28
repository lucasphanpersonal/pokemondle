import { describe, expect, it } from 'vitest'
import {
  deadlineLocalMs,
  initialPartyState,
  partyReducer,
  secondsLeft,
  selectAnswersThisRound,
  selectCurrentCategory,
  selectIsHost,
  selectLivingPlayers,
  selectMe,
  selectMyTurn,
  selectPresentPlayers,
  selectTurnPlayer,
  type AnswerRow,
  type CategoryRow,
  type PartyAction,
  type PartyState,
  type PlayerRow,
  type RoomRow,
} from './state.ts'

const ROOM = 'r1'
const room = (o: Partial<RoomRow> = {}): RoomRow => ({
  id: ROOM,
  host_id: 'p1',
  status: 'lobby',
  lives: 3,
  start_tier: 'easy',
  game_no: 0,
  round: 0,
  category_no: null,
  turn_player_id: null,
  turn_no: 0,
  turn_seconds: null,
  turn_started_at: null,
  deadline: null,
  winner_id: null,
  last_event: { kind: 'lobby' },
  last_activity: '2026-11-27T10:00:00.000Z',
  ...o,
})
const player = (id: string, o: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  room_id: ROOM,
  nickname: id.toUpperCase(),
  icon: 1,
  joined_at: '2026-11-27T10:00:00.000Z',
  seat: null,
  lives: 3,
  is_out: false,
  answers_given: 0,
  gone_at: null,
  gone_reason: null,
  ...o,
})
const cat = (game_no: number, deck_no: number, o: Partial<CategoryRow> = {}): CategoryRow => ({
  room_id: ROOM,
  game_no,
  deck_no,
  parts: [{ kind: 'type', value: 'fire' }],
  tier: 'easy',
  pool: 80,
  seconds: 20,
  result: null,
  ...o,
})
const ans = (id: number, o: Partial<AnswerRow> = {}): AnswerRow => ({
  id,
  room_id: ROOM,
  game_no: 1,
  round: 1,
  player_id: 'p1',
  pokemon_id: id,
  species: id,
  created_at: '2026-11-27T10:00:00.000Z',
  ...o,
})

const change = (table: 'party_rooms' | 'party_players' | 'party_categories' | 'party_answers', event: 'INSERT' | 'UPDATE' | 'DELETE', row: object): PartyAction => ({
  type: 'change',
  table,
  event,
  row: row as Record<string, unknown>,
})
const run = (s: PartyState, ...actions: PartyAction[]) => actions.reduce(partyReducer, s)

const playingRoom = (o: Partial<RoomRow> = {}) =>
  room({
    status: 'playing',
    game_no: 1,
    round: 1,
    category_no: 1,
    turn_player_id: 'p1',
    turn_no: 5,
    deadline: '2026-11-27T10:00:20.000Z',
    last_activity: '2026-11-27T10:00:00.000Z',
    ...o,
  })

const snap = (o: Partial<Extract<PartyAction, { type: 'snapshot' }>> = {}): PartyAction => ({
  type: 'snapshot',
  roomId: ROOM,
  room: playingRoom(),
  players: [player('p1', { seat: 0 }), player('p2', { seat: 1 })],
  categories: [cat(1, 1)],
  answers: [ans(1), ans(2)],
  ...o,
})

describe('snapshot', () => {
  it('loads the room, players, category and answers', () => {
    const s = run(initialPartyState(ROOM), snap())
    expect(s.room?.id).toBe(ROOM)
    expect(Object.keys(s.players)).toEqual(['p1', 'p2'])
    expect(selectCurrentCategory(s)?.deck_no).toBe(1)
    expect(selectAnswersThisRound(s).map((a) => a.id)).toEqual([2, 1])
  })

  it('replaces what was there and drops rows of other rooms and old games', () => {
    let s = run(initialPartyState(ROOM), snap())
    s = run(
      s,
      snap({
        room: playingRoom({ game_no: 2 }),
        players: [player('p3'), { ...player('x'), room_id: 'other' }],
        categories: [cat(1, 1), cat(2, 1, { tier: 'medium' })],
        answers: [ans(9, { game_no: 1 }), ans(10, { game_no: 2 })],
      }),
    )
    expect(Object.keys(s.players)).toEqual(['p3'])
    expect(Object.keys(s.categories)).toEqual(['2:1'])
    expect(Object.keys(s.answers)).toEqual(['10'])
  })

  it('reset clears everything', () => {
    expect(run(run(initialPartyState(ROOM), snap()), { type: 'reset', roomId: null })).toEqual(initialPartyState(null))
  })
})

describe('room events', () => {
  it('applies updates and ignores other rooms', () => {
    let s = run(initialPartyState(ROOM), snap())
    s = run(s, change('party_rooms', 'UPDATE', playingRoom({ turn_no: 6, turn_player_id: 'p2', last_activity: '2026-11-27T10:00:01.000Z' })))
    expect(s.room?.turn_no).toBe(6)
    const same = run(s, change('party_rooms', 'UPDATE', { ...playingRoom({ turn_no: 99 }), id: 'other' }))
    expect(same).toBe(s)
  })

  it('is idempotent: the same event twice gives the same state', () => {
    const s = run(initialPartyState(ROOM), snap())
    const ev = change('party_rooms', 'UPDATE', playingRoom({ turn_no: 6, last_activity: '2026-11-27T10:00:01.000Z' }))
    expect(run(s, ev, ev)).toEqual(run(s, ev))
  })

  it('ignores a late, older room row (out of order)', () => {
    let s = run(initialPartyState(ROOM), snap({ room: playingRoom({ turn_no: 7, last_activity: '2026-11-27T10:00:05.000Z' }) }))
    s = run(s, change('party_rooms', 'UPDATE', playingRoom({ turn_no: 6, last_activity: '2026-11-27T10:00:03.000Z' })))
    expect(s.room?.turn_no).toBe(7)
  })

  it('falls back to turn_no when there is no timestamp', () => {
    let s = run(initialPartyState(ROOM), snap({ room: playingRoom({ turn_no: 7, last_activity: undefined }) }))
    s = run(s, change('party_rooms', 'UPDATE', playingRoom({ turn_no: 6, last_activity: undefined })))
    expect(s.room?.turn_no).toBe(7)
  })

  it('INSERT sets the room when none is loaded; garbage rows are ignored', () => {
    let s = run(initialPartyState(ROOM), change('party_rooms', 'INSERT', room()))
    expect(s.room?.status).toBe('lobby')
    const before = s
    s = run(s, change('party_rooms', 'UPDATE', { id: ROOM }))
    expect(s).toBe(before)
  })

  it('a new game drops the old game rows, even if the room update arrives last', () => {
    let s = run(initialPartyState(ROOM), snap())
    // The new game's category and answer arrive before the room row.
    s = run(s, change('party_categories', 'INSERT', cat(2, 1)), change('party_answers', 'INSERT', ans(30, { game_no: 2 })))
    expect(Object.keys(s.categories).sort()).toEqual(['1:1', '2:1'])
    s = run(s, change('party_rooms', 'UPDATE', playingRoom({ game_no: 2, last_activity: '2026-11-27T10:05:00.000Z' })))
    expect(Object.keys(s.categories)).toEqual(['2:1'])
    expect(Object.keys(s.answers)).toEqual(['30'])
    // A late row of the finished game is ignored, and so is a late older room row of game 1.
    const after = run(s, change('party_answers', 'INSERT', ans(3, { game_no: 1 })), change('party_rooms', 'UPDATE', playingRoom({ game_no: 1, turn_no: 99 })))
    expect(after).toEqual(s)
  })

  it('a room delete empties the room', () => {
    const s = run(run(initialPartyState(ROOM), snap()), change('party_rooms', 'DELETE', { id: ROOM }))
    expect(s.room).toBeNull()
  })
})

describe('player events', () => {
  it('inserts, updates and deletes by id', () => {
    let s = run(initialPartyState(ROOM), change('party_players', 'INSERT', player('p1')))
    s = run(s, change('party_players', 'UPDATE', player('p1', { lives: 2 })))
    expect(s.players.p1.lives).toBe(2)
    s = run(s, change('party_players', 'DELETE', { id: 'p1' }))
    expect(s.players).toEqual({})
    expect(run(s, change('party_players', 'DELETE', { id: 'p1' }))).toBe(s)
  })

  it('ignores players of another room', () => {
    const s = initialPartyState(ROOM)
    expect(run(s, change('party_players', 'INSERT', { ...player('z'), room_id: 'other' }))).toBe(s)
  })

  it('a player update before the snapshot is not lost by order: update then insert keeps the latest seen', () => {
    const s = run(initialPartyState(ROOM), change('party_players', 'UPDATE', player('p1', { lives: 1 })))
    expect(s.players.p1.lives).toBe(1)
  })
})

describe('category and answer events', () => {
  it('upserts categories by game and deck number (result arrives as an update)', () => {
    let s = run(initialPartyState(ROOM), snap())
    s = run(s, change('party_categories', 'UPDATE', cat(1, 1, { result: 'failed' })), change('party_categories', 'INSERT', cat(1, 2)))
    expect(s.categories['1:1'].result).toBe('failed')
    expect(Object.keys(s.categories).sort()).toEqual(['1:1', '1:2'])
    s = run(s, change('party_categories', 'DELETE', { room_id: ROOM, game_no: 1, deck_no: 2 }))
    expect(Object.keys(s.categories)).toEqual(['1:1'])
  })

  it('adds an answer once however many times it arrives', () => {
    const s = run(initialPartyState(ROOM), snap())
    const ev = change('party_answers', 'INSERT', ans(3))
    expect(Object.keys(run(s, ev, ev, ev).answers)).toHaveLength(3)
  })

  it('answers arriving out of order still list newest first, and only this round', () => {
    let s = run(initialPartyState(ROOM), snap({ answers: [] }))
    s = run(
      s,
      change('party_answers', 'INSERT', ans(5)),
      change('party_answers', 'INSERT', ans(3)),
      change('party_answers', 'INSERT', ans(4)),
      change('party_answers', 'INSERT', ans(2, { round: 2 })),
    )
    expect(selectAnswersThisRound(s).map((a) => a.id)).toEqual([5, 4, 3])
    s = run(s, change('party_rooms', 'UPDATE', playingRoom({ round: 2, last_activity: '2026-11-27T10:01:00.000Z' })))
    expect(selectAnswersThisRound(s).map((a) => a.id)).toEqual([2])
  })

  it('ignores another room', () => {
    const s = run(initialPartyState(ROOM), snap())
    expect(run(s, change('party_answers', 'INSERT', ans(8, { room_id: 'other' })))).toBe(s)
    expect(run(s, change('party_categories', 'INSERT', { ...cat(1, 9), room_id: 'other' }))).toBe(s)
  })
})

describe('selectors', () => {
  const s = run(
    initialPartyState(ROOM),
    snap({
      players: [
        player('p1', { seat: 0, joined_at: '2026-11-27T10:00:00.000Z' }),
        player('p2', { seat: 1, joined_at: '2026-11-27T10:00:01.000Z' }),
        player('p3', { seat: 2, is_out: true, lives: 0, joined_at: '2026-11-27T10:00:02.000Z' }),
        player('p4', { seat: 3, gone_at: '2026-11-27T10:01:00.000Z', gone_reason: 'left', joined_at: '2026-11-27T10:00:03.000Z' }),
        player('p5', { seat: null, joined_at: '2026-11-27T09:59:00.000Z' }),
      ],
    }),
  )

  it('finds me, the host and whose turn it is', () => {
    expect(selectMe(s, 'p2')?.nickname).toBe('P2')
    expect(selectMe(s, null)).toBeNull()
    expect(selectMe(s, 'nobody')).toBeNull()
    expect(selectIsHost(s, 'p1')).toBe(true)
    expect(selectIsHost(s, 'p2')).toBe(false)
    expect(selectMyTurn(s, 'p1')).toBe(true)
    expect(selectMyTurn(s, 'p2')).toBe(false)
    expect(selectTurnPlayer(s)?.id).toBe('p1')
  })

  it('it is nobody\'s turn outside a game', () => {
    const lobby = run(s, change('party_rooms', 'UPDATE', room({ game_no: 1, turn_player_id: 'p1', last_activity: '2026-11-27T10:09:00.000Z' })))
    expect(selectMyTurn(lobby, 'p1')).toBe(false)
  })

  it('lists living players in seat order and present players by join time', () => {
    expect(selectLivingPlayers(s).map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(selectPresentPlayers(s).map((p) => p.id)).toEqual(['p5', 'p1', 'p2', 'p3'])
  })

  it('has no current category before it is dealt', () => {
    expect(selectCurrentCategory(initialPartyState(ROOM))).toBeNull()
    expect(selectCurrentCategory(run(s, change('party_rooms', 'UPDATE', playingRoom({ category_no: 7, last_activity: '2026-11-27T10:09:00.000Z' }))))).toBeNull()
  })

  it('turns the server deadline into local time with the clock offset', () => {
    const r = playingRoom()
    const server = Date.parse('2026-11-27T10:00:20.000Z')
    // Server clock 2 s ahead of ours: the deadline is 2 s earlier on our clock.
    expect(deadlineLocalMs(r, 2000)).toBe(server - 2000)
    expect(deadlineLocalMs(r, -500)).toBe(server + 500)
    expect(deadlineLocalMs(room(), 0)).toBeNull()
    expect(deadlineLocalMs(null, 0)).toBeNull()
  })

  it('counts whole seconds left, never below zero', () => {
    const r = playingRoom()
    const dl = Date.parse('2026-11-27T10:00:20.000Z')
    expect(secondsLeft(r, 0, dl - 12_001)).toBe(13)
    expect(secondsLeft(r, 0, dl - 1000)).toBe(1)
    expect(secondsLeft(r, 0, dl + 5000)).toBe(0)
    expect(secondsLeft(room(), 0, 0)).toBeNull()
  })
})

describe("snapshot vs newer events", () => {
  it("keeps a newer room row that arrived before an older snapshot", () => {
    const old = playingRoom({ turn_no: 5, last_activity: "2026-11-27T10:00:00.000Z" })
    let s = run(initialPartyState(ROOM), snap({ room: old }))
    s = run(s, change("party_rooms", "UPDATE", playingRoom({ turn_no: 6, last_activity: "2026-11-27T10:00:09.000Z" })))
    s = run(s, snap({ room: old }))
    expect(s.room?.turn_no).toBe(6)
  })
})

describe('rows from a server reply (ahead of Realtime)', () => {
  // One answer transaction: the turn passes (UPDATE 1), then last_event is set (UPDATE 2). Realtime sends both;
  // the reply carries only the end state.
  const before = playingRoom({ turn_no: 5, last_activity: '2026-11-27T10:00:00.000Z' })
  const step1 = playingRoom({ turn_no: 6, turn_player_id: 'p2', last_activity: '2026-11-27T10:00:03.000Z' })
  const final = playingRoom({
    turn_no: 6,
    turn_player_id: 'p2',
    last_activity: '2026-11-27T10:00:03.000Z',
    last_event: { kind: 'answer', round: 1, player_id: 'p1', pokemon_id: 4 },
  })
  // The same row with the timestamps formatted differently (Realtime vs Postgres' to_jsonb in the reply).
  const finalRealtime = { ...final, last_activity: '2026-11-27T10:00:03+00:00', deadline: '2026-11-27T10:00:20+00:00' }
  const reply = (o: Partial<Extract<PartyAction, { type: 'reply' }>> = {}): PartyAction => ({ type: 'reply', room: final, ...o })

  it('applies the reply room at once', () => {
    const s = run(initialPartyState(ROOM), snap({ room: before }), reply())
    expect(s.room).toEqual(final)
    expect(s.replyRoom).toEqual(final)
  })

  it('ignores the in-between Realtime version of the same transaction, then settles on the Realtime copy', () => {
    let s = run(initialPartyState(ROOM), snap({ room: before }), reply())
    s = run(s, change('party_rooms', 'UPDATE', step1))
    expect(s.room).toEqual(final)
    s = run(s, change('party_rooms', 'UPDATE', finalRealtime))
    expect(s.room?.turn_player_id).toBe('p2')
    expect(s.room?.last_event).toEqual(final.last_event)
    expect(s.replyRoom).toBeNull()
  })

  it('after settling, later room changes apply as usual (a tie included)', () => {
    let s = run(initialPartyState(ROOM), snap({ room: before }), reply(), change('party_rooms', 'UPDATE', final))
    expect(s.replyRoom).toBeNull()
    s = run(s, change('party_rooms', 'UPDATE', { ...final, host_id: 'p2' }))
    expect(s.room?.host_id).toBe('p2')
  })

  it('a reply older than what Realtime already brought is dropped', () => {
    const later = playingRoom({ turn_no: 7, turn_player_id: 'p1', last_activity: '2026-11-27T10:00:05.000Z' })
    const s = run(initialPartyState(ROOM), snap({ room: before }), change('party_rooms', 'UPDATE', later), reply())
    expect(s.room).toEqual(later)
    expect(s.replyRoom).toBeNull()
  })

  it('a reply whose row Realtime already brought changes nothing', () => {
    const s0 = run(initialPartyState(ROOM), snap({ room: before }), change('party_rooms', 'UPDATE', step1), change('party_rooms', 'UPDATE', final))
    expect(run(s0, reply())).toBe(s0)
  })

  it('a reply replaces an in-between version Realtime brought first', () => {
    let s = run(initialPartyState(ROOM), snap({ room: before }), change('party_rooms', 'UPDATE', step1), reply())
    expect(s.room).toEqual(final)
    s = run(s, change('party_rooms', 'UPDATE', final))
    expect(s.room).toEqual(final)
    expect(s.replyRoom).toBeNull()
  })

  it('a newer Realtime row replaces a held reply row', () => {
    const later = playingRoom({ turn_no: 7, turn_player_id: 'p1', last_activity: '2026-11-27T10:00:05.000Z' })
    const s = run(initialPartyState(ROOM), snap({ room: before }), reply(), change('party_rooms', 'UPDATE', later))
    expect(s.room).toEqual(later)
    expect(s.replyRoom).toBeNull()
  })

  it('adds the reply answer once, however often Realtime repeats it', () => {
    const mine = ans(3, { player_id: 'p1' })
    let s = run(initialPartyState(ROOM), snap({ room: before }), reply({ answers: [mine] }))
    expect(selectAnswersThisRound(s).map((a) => a.id)).toEqual([3, 2, 1])
    s = run(s, change('party_answers', 'INSERT', mine), change('party_answers', 'INSERT', mine))
    expect(selectAnswersThisRound(s).map((a) => a.id)).toEqual([3, 2, 1])
  })

  it('ignores junk and rows of another room', () => {
    const s0 = run(initialPartyState(ROOM), snap({ room: before }))
    expect(run(s0, { type: 'reply', room: { id: ROOM } })).toBe(s0)
    expect(run(s0, { type: 'reply', room: null, answers: [null, 'x'] })).toBe(s0)
    expect(run(s0, { type: 'reply', room: { ...final, id: 'other' } })).toBe(s0)
    expect(run(s0, { type: 'reply', answers: [ans(9, { room_id: 'other' })] })).toBe(s0)
  })

  it('a cleared round: the reply shows the new round and its event, and the in-between version never takes it away', () => {
    const cleared = playingRoom({
      round: 2,
      category_no: 2,
      turn_no: 6,
      turn_player_id: 'p2',
      last_activity: '2026-11-27T10:00:03.000Z',
      last_event: { kind: 'cleared', round: 1, player_id: 'p1', deck_no: 1, exhausted: false },
    })
    const between = { ...cleared, last_event: before.last_event }
    let s = run(initialPartyState(ROOM), snap({ room: before }), { type: 'reply', room: cleared })
    const events: unknown[] = [s.room?.last_event]
    s = run(s, change('party_rooms', 'UPDATE', between))
    events.push(s.room?.last_event)
    s = run(s, change('party_rooms', 'UPDATE', cleared))
    events.push(s.room?.last_event)
    expect(events).toEqual([cleared.last_event, cleared.last_event, cleared.last_event])
  })

  it('a snapshot settles a held reply row', () => {
    let s = run(initialPartyState(ROOM), snap({ room: before }), reply())
    s = run(s, snap({ room: final }))
    expect(s.replyRoom).toBeNull()
    expect(s.room).toEqual(final)
  })
})

// party_categories is not in Realtime (migration 20261128160000): the deck comes from a select, results from last_event.
describe('the deck without Realtime', () => {
  const lobbySnap = (): PartyAction => ({
    type: 'snapshot',
    roomId: ROOM,
    room: room({ game_no: 1, status: 'lobby' }),
    players: [player('p1')],
    categories: [],
    answers: [],
  })

  it('a Start shows the category once the deck read lands (merged; other rooms and old games ignored)', () => {
    let s = run(
      initialPartyState(ROOM),
      lobbySnap(),
      change('party_rooms', 'UPDATE', playingRoom({ game_no: 2, last_activity: '2026-11-27T10:00:01.000Z' })),
    )
    expect(selectCurrentCategory(s)).toBeNull()
    s = run(s, { type: 'deck', roomId: ROOM, categories: [cat(2, 1), cat(2, 2), { ...cat(2, 3), room_id: 'other' }, cat(1, 1)] })
    expect(Object.keys(s.categories).sort()).toEqual(['2:1', '2:2'])
    expect(selectCurrentCategory(s)?.deck_no).toBe(1)
    expect(run(s, { type: 'deck', roomId: 'other', categories: [cat(2, 9)] })).toBe(s)
  })

  it("marks a round's category cleared or failed from the room's last_event", () => {
    let s = run(initialPartyState(ROOM), snap({ categories: [cat(1, 1), cat(1, 2)] }))
    s = run(
      s,
      change('party_rooms', 'UPDATE', playingRoom({
        round: 2, category_no: 2, turn_no: 6, last_activity: '2026-11-27T10:00:02.000Z',
        last_event: { kind: 'cleared', round: 1, player_id: 'p2', deck_no: 1 },
      })),
    )
    expect(s.categories['1:1'].result).toBe('cleared')
    s = run(
      s,
      change('party_rooms', 'UPDATE', playingRoom({
        round: 3, category_no: 3, turn_no: 7, last_activity: '2026-11-27T10:00:03.000Z',
        last_event: { kind: 'timeout', round: 2, player_id: 'p1', lives: 2, out: false, deck_no: 2 },
      })),
    )
    expect(s.categories['1:2'].result).toBe('failed')
    expect(s.categories['1:1'].result).toBe('cleared')
  })

  it('a deck read that lands after the event is marked too, and a stale read never clears a marked result', () => {
    const ended = playingRoom({
      round: 2, category_no: 2, turn_no: 6, last_activity: '2026-11-27T10:00:02.000Z',
      last_event: { kind: 'cleared', round: 1, player_id: 'p2', deck_no: 1 },
    })
    let s = run(initialPartyState(ROOM), snap({ room: ended, categories: [] }))
    s = run(s, { type: 'deck', roomId: ROOM, categories: [cat(1, 1), cat(1, 2)] })
    expect(s.categories['1:1'].result).toBe('cleared')
    s = run(s, { type: 'deck', roomId: ROOM, categories: [cat(1, 1)] })
    expect(s.categories['1:1'].result).toBe('cleared')
  })
})
