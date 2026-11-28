import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { fetchSnapshot, snapshotOf } from './client.ts'
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
