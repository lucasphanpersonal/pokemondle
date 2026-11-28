import { describe, expect, it, vi } from 'vitest'

// The controller module pulls in the room connection; only its pure mapping is tested here.
vi.mock('./useParty.ts', () => ({ PARTY_UNREACHABLE: 'x', useParty: () => null }))
const { toGameView } = await import('./usePartyController.ts')
import type { AnswerRow, CategoryRow, PlayerRow, RoomRow } from './state.ts'

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
