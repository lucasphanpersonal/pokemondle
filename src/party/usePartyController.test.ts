import { describe, expect, it, vi } from 'vitest'

// The controller module pulls in the room connection; only its pure mapping is tested here.
vi.mock('./useParty.ts', () => ({ PARTY_UNREACHABLE: 'x', useParty: () => null }))
const { toGameView, toLobbyView, roundEndOf, toGameOverView } = await import('./usePartyController.ts')
import { initialPartyState, type AnswerRow, type CategoryRow, type PartyState, type PlayerRow, type RoomRow } from './state.ts'

const room: RoomRow = {
  id: 'r',
  host_id: 'a',
  status: 'playing',
  lives: 3,
  start_tier: 'easy',
  game_no: 1,
  round: 2,
  category_no: 2,
  turn_player_id: 'b',
  turn_no: 5,
  turn_seconds: 20,
  turn_started_at: null,
  deadline: '2026-11-27T12:00:20Z',
  winner_id: null,
  last_event: null,
}

const player = (id: string, seat: number | null, extra: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  room_id: 'r',
  nickname: id.toUpperCase(),
  icon: 1,
  joined_at: '2026-11-27T11:00:00Z',
  seat,
  lives: 3,
  is_out: false,
  answers_given: 0,
  gone_at: null,
  gone_reason: null,
  ...extra,
})

const category: CategoryRow = { room_id: 'r', game_no: 1, deck_no: 2, parts: [{ kind: 'type', value: 'Fire' }], tier: 'easy', pool: 87, seconds: 20, result: null }
const answers: AnswerRow[] = [
  { id: 9, room_id: 'r', game_no: 1, round: 2, player_id: 'a', pokemon_id: 4, species: 4, created_at: '' },
  { id: 8, room_id: 'r', game_no: 1, round: 2, player_id: 'gone', pokemon_id: 37, species: 37, created_at: '' },
]

describe('toLobbyView', () => {
  const lobbyRoom: RoomRow = { ...room, status: 'lobby', lives: 3, start_tier: 'easy' }
  it("shows the room's settings, or the host's unconfirmed tap over them", () => {
    expect(toLobbyView('KPZW', lobbyRoom, [], 'a').settings).toEqual({ lives: 3, startTier: 'easy' })
    expect(toLobbyView('KPZW', lobbyRoom, [], 'a', { lives: 5, start_tier: 'hard' }).settings).toEqual({ lives: 5, startTier: 'hard' })
  })
})

describe('toGameView', () => {
  it('maps the rows to the game screen: seated players by seat, answers newest first', () => {
    const players = [player('c', 2, { lives: 0, is_out: true }), player('a', 0), player('watcher', null), player('b', 1)]
    const view = toGameView('KPZW', room, players, category, answers, 'a', 123)!
    expect(view.players.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(view.players[2]).toMatchObject({ out: true, lives: 0 })
    expect(view).toMatchObject({ code: 'KPZW', round: 2, tier: 'easy', turnPlayerId: 'b', turnNo: 5, deadlineAt: 123, seconds: 20, startLives: 3, meId: 'a' })
    expect(view.answers).toEqual([
      { id: '9', pokemonId: 4, playerId: 'a', nickname: 'A' },
      { id: '8', pokemonId: 37, playerId: 'gone', nickname: 'Someone' },
    ])
    expect(view.left).toBeGreaterThan(0)
  })

  it('is null outside a running game or before its category arrives', () => {
    expect(toGameView('KPZW', { ...room, status: 'lobby' }, [], category, [], 'a', null)).toBeNull()
    expect(toGameView('KPZW', room, [], null, [], 'a', null)).toBeNull()
  })
})

const stateOf = (r: RoomRow, players: PlayerRow[], categories: CategoryRow[], ans: AnswerRow[]): PartyState => ({
  ...initialPartyState('r'),
  room: r,
  players: Object.fromEntries(players.map((p) => [p.id, p])),
  categories: Object.fromEntries(categories.map((c) => [`${c.game_no}:${c.deck_no}`, c])),
  answers: Object.fromEntries(ans.map((a) => [String(a.id), a])),
})

describe('roundEndOf', () => {
  const round1: CategoryRow = { ...category, deck_no: 1, result: 'failed' }
  const oldAnswer: AnswerRow = { ...answers[0], id: 3, round: 1, pokemon_id: 6, species: 6 }

  it('reads a timeout from last_event with the failed round\'s category and answers (a gone player still named)', () => {
    const r = { ...room, last_event: { kind: 'timeout' as const, round: 1, player_id: 'gone', lives: 0, out: true, deck_no: 1 } }
    const end = roundEndOf(stateOf(r, [player('a', 0), player('gone', 1, { gone_at: '2026-11-27T11:30:00Z', nickname: 'Brock' })], [round1, category], [oldAnswer, ...answers]), category)
    expect(end).toMatchObject({ kind: 'timeout', key: '1|1', nickname: 'Brock', out: true, category: round1.parts, saidIds: [6], seed: 'r|1|1' })
  })

  it('reads a cleared round and the tier it led to; null for other events', () => {
    const next: CategoryRow = { ...category, tier: 'medium' }
    const r = { ...room, last_event: { kind: 'cleared' as const, round: 1, player_id: 'a', deck_no: 1 } }
    expect(roundEndOf(stateOf(r, [], [{ ...round1, result: 'cleared' }, next], []), next)).toMatchObject({ kind: 'cleared', fromTier: 'easy', toTier: 'medium' })
    expect(roundEndOf(stateOf({ ...room, last_event: { kind: 'start', round: 1 } }, [], [], []), category)).toBeNull()
  })
})

describe('toGameOverView', () => {
  const over: RoomRow = {
    ...room,
    status: 'over',
    round: 9,
    winner_id: 'b',
    turn_player_id: null,
    deadline: null,
    last_event: { kind: 'timeout', round: 9, player_id: 'a', lives: 0, out: true, deck_no: 9, over: true, winner_id: 'b' },
  }
  const deck: CategoryRow[] = [
    { ...category, deck_no: 4, tier: 'medium', result: 'cleared', parts: [{ kind: 'type', value: 'Fire' }, { kind: 'stage', value: 2 }] },
    { ...category, deck_no: 7, tier: 'hard', result: 'cleared', parts: [{ kind: 'pair', value: ['Bug', 'Flying'] }] },
    { ...category, deck_no: 9, tier: 'hard', result: 'failed' },
    { ...category, deck_no: 2, game_no: 0, tier: 'expert', result: 'cleared' },
  ]
  const players = [player('a', 0, { lives: 0, is_out: true, answers_given: 6 }), player('b', 1, { lives: 2, answers_given: 7 }), player('w', null)]

  it('builds the results: winner, table, hardest cleared category of this game, the final time up', () => {
    const view = toGameOverView('KPZW', stateOf(over, players, deck, []), 'a')!
    expect(view.winner).toEqual({ id: 'b', nickname: 'B', icon: 1 })
    expect(view.players.map((p) => [p.id, p.answers, p.livesLost])).toEqual([
      ['b', 7, 1],
      ['a', 6, 3],
    ])
    expect(view.hardest).toEqual({ category: deck[1].parts, tier: 'hard' })
    expect(view).toMatchObject({ isHost: true, rounds: 9, meId: 'a' })
    expect(view.finalTimeout).toMatchObject({ kind: 'timeout', playerId: 'a', out: true })
  })

  it('is null while the game runs; a guest is not the host; a game ended by a leaver has no final time up', () => {
    expect(toGameOverView('KPZW', stateOf(room, players, deck, []), 'a')).toBeNull()
    const gone = { ...over, last_event: { kind: 'gone' as const, round: 9, player_id: 'a', reason: 'left', over: true, winner_id: 'b' } }
    const view = toGameOverView('KPZW', stateOf(gone, players, deck, []), 'b')!
    expect(view.isHost).toBe(false)
    expect(view.finalTimeout).toBeNull()
  })
})
