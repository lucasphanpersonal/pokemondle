import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { fetchSnapshot, snapshotOf, staleParts, subscribeToRoom } from './client.ts'
import type { AnswerRow, CategoryRow, PlayerRow, RoomRow } from './state.ts'

const ROOM = 'r1'
const room = { id: ROOM, status: 'playing', game_no: 2, round: 3, turn_no: 9 } as RoomRow
const players = [{ id: 'p1', room_id: ROOM }] as PlayerRow[]
const categories = [
  { room_id: ROOM, game_no: 2, deck_no: 1 },
  { room_id: ROOM, game_no: 2, deck_no: 2 },
  { room_id: ROOM, game_no: 1, deck_no: 1 },
] as CategoryRow[]
const answers = [
  { id: 9, game_no: 2, round: 3 },
  { id: 8, game_no: 2, round: 3 },
  { id: 7, game_no: 2, round: 2 },
  { id: 6, game_no: 1, round: 3 },
] as AnswerRow[]

describe('snapshotOf', () => {
  it("keeps this game's deck and this round's answers", () => {
    const s = snapshotOf(room, players, categories, answers)
    expect(s.categories.map((c) => c.deck_no)).toEqual([1, 2])
    expect(s.answers.map((a) => a.id)).toEqual([9, 8])
    expect(s.players).toBe(players)
  })

  it('no room: only the players', () => {
    expect(snapshotOf(null, players, categories, answers)).toEqual({ room: null, players, categories: [], answers: [] })
  })
})

describe('fetchSnapshot', () => {
  it('sends all four reads before any of them answers', async () => {
    const asked: string[] = []
    const release: (() => void)[] = []
    const data: Record<string, unknown> = { party_rooms: room, party_players: players, party_categories: categories, party_answers: answers }
    // A chainable stand-in for supabase-js' query builder: each table's read resolves only when the test says so.
    const builder = (table: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order', 'limit', 'maybeSingle']) q[m] = () => q
      q.then = (resolve: (v: unknown) => void) => {
        asked.push(table)
        release.push(() => resolve({ data: data[table], error: null }))
      }
      return q
    }
    const client = { from: builder } as unknown as SupabaseClient
    const pending = fetchSnapshot(client, ROOM)
    await new Promise((r) => setTimeout(r, 0))
    expect(asked.sort()).toEqual(['party_answers', 'party_categories', 'party_players', 'party_rooms'])
    release.forEach((f) => f())
    const s = await pending
    expect(s.room).toBe(room)
    expect(s.answers.map((a) => a.id)).toEqual([9, 8])
    expect(s.categories).toHaveLength(2)
  })
})

describe('staleParts (the room row read newer than the deck or the answers)', () => {
  const answerEvent = { kind: 'answer' as const, round: 3, player_id: 'p1', pokemon_id: 9 }
  it('nothing stale when the rows match the room', () => {
    expect(staleParts({ ...room, last_event: { ...answerEvent, pokemon_id: 9 } }, categories, [{ ...answers[0], pokemon_id: 9 }])).toEqual({
      categories: false,
      answers: false,
    })
    expect(staleParts({ ...room, status: 'lobby', game_no: 0 }, [], [])).toEqual({ categories: false, answers: false })
  })
  it("a running game without its deck, or the last answer missing, is stale", () => {
    expect(staleParts({ ...room, game_no: 3 }, categories, answers).categories).toBe(true)
    expect(staleParts({ ...room, last_event: answerEvent }, categories, []).answers).toBe(true)
    // An answer event of an earlier round says nothing about this one.
    expect(staleParts({ ...room, last_event: { ...answerEvent, round: 2 } }, categories, []).answers).toBe(false)
  })
})

describe('fetchSnapshot refetch', () => {
  it('reads the deck and the answers again for the room\'s game and round when they came back older', async () => {
    const newRoom = { ...room, game_no: 3, round: 1, last_event: { kind: 'answer', round: 1, player_id: 'p1', pokemon_id: 5 } } as RoomRow
    const filters: Record<string, [string, unknown][]> = {}
    let calls = 0
    const builder = (table: string) => {
      const my: [string, unknown][] = []
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'order', 'limit', 'maybeSingle']) q[m] = () => q
      q.eq = (k: string, v: unknown) => (my.push([k, v]), q)
      q.then = (resolve: (v: unknown) => void) => {
        calls++
        filters[`${table}#${calls}`] = my
        const fresh = my.some(([k]) => k === 'game_no')
        const data =
          table === 'party_rooms' ? newRoom
          : table === 'party_players' ? players
          : table === 'party_categories' ? (fresh ? [{ room_id: ROOM, game_no: 3, deck_no: 1 }] : categories)
          : fresh ? [{ id: 20, game_no: 3, round: 1, pokemon_id: 5 }] : answers
        resolve({ data, error: null })
      }
      return q
    }
    const s = await fetchSnapshot({ from: builder } as unknown as SupabaseClient, ROOM)
    expect(calls).toBe(6)
    expect(s.categories.map((c) => c.game_no)).toEqual([3])
    expect(s.answers.map((a) => a.id)).toEqual([20])
  })
})

describe('subscribeToRoom', () => {
  it('follows rooms, players and answers live, not the deck (read with a select instead), and reports ready', () => {
    const bound: string[] = []
    let system: ((p: unknown) => void) | null = null
    const channel = {
      on(type: string, filter: { table?: string }, cb: (p: unknown) => void) {
        if (type === 'postgres_changes') bound.push(filter.table!)
        if (type === 'system') system = cb
        return channel
      },
      subscribe: () => channel,
    }
    const client = { channel: () => channel, removeChannel: () => {} } as unknown as SupabaseClient
    let ready = 0
    subscribeToRoom(client, ROOM, () => {}, () => {}, () => ready++)
    expect(bound.sort()).toEqual(['party_answers', 'party_players', 'party_rooms'])
    system!({ extension: 'postgres_changes', status: 'ok' })
    system!({ extension: 'system', status: 'ok' })
    system!({ extension: 'postgres_changes', status: 'error' })
    expect(ready).toBe(1)
  })
})
