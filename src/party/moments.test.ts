import { describe, expect, it } from 'vitest'
import { POKEDEX, POKEDEX_BY_ID } from '../lib/pokedex.ts'
import type { Category } from '../lib/party/types.ts'
import { BURST_FRAMES, BURST_H, BURST_W, burstGrid } from './fuseArt.ts'
import {
  alsoFitIds,
  alsoFitSeed,
  clearedFrame,
  clearedText,
  CLEARED_MS,
  EARLY_WAIT_MS,
  FLASH_MS,
  hardestCleared,
  initialMoments,
  momentEndsAt,
  momentReducer,
  resultPlayers,
  TEXT_AT_MS,
  TEXT_MIN_MS,
  TIMEUP_MS,
  timeUpFrame,
  timeUpText,
  toRoundEnd,
  winnerText,
  type MomentState,
  type RoundEndSource,
} from './moments.ts'
import type { RoomEvent } from './state.ts'
import type { RoundEnd, TimeoutEnd } from './types.ts'

const FIRE: Category = [{ kind: 'type', value: 'Fire' }]
const FIRE_STAGE2: Category = [{ kind: 'type', value: 'Fire' }, { kind: 'stage', value: 2 }]

const src: RoundEndSource = {
  roomId: 'room-1',
  gameNo: 2,
  players: [
    { id: 'a', nickname: 'Ash' },
    { id: 'b', nickname: 'Brock' },
  ],
  categories: [
    { deck_no: 3, parts: FIRE, tier: 'easy' },
    { deck_no: 4, parts: FIRE_STAGE2, tier: 'medium' },
  ],
  answers: [
    { round: 3, pokemon_id: 4 },
    { round: 3, pokemon_id: 37 },
    { round: 2, pokemon_id: 1 },
  ],
  currentTier: 'medium',
}

describe('toRoundEnd', () => {
  it('maps a timeout to time up: who, lives, the failed category and what was said in that round', () => {
    const event: RoomEvent = { kind: 'timeout', round: 3, player_id: 'b', lives: 1, out: false, deck_no: 3 }
    expect(toRoundEnd(event, src)).toEqual({
      kind: 'timeout',
      key: '2|3',
      round: 3,
      playerId: 'b',
      nickname: 'Brock',
      lives: 1,
      out: false,
      category: FIRE,
      saidIds: [4, 37],
      seed: 'room-1|2|3',
    })
  })

  it('names a player it cannot find "Someone" and copes with a missing category', () => {
    const event: RoomEvent = { kind: 'timeout', round: 3, player_id: 'zz', lives: 0, out: true, deck_no: 9 }
    expect(toRoundEnd(event, src)).toMatchObject({ nickname: 'Someone', out: true, category: null })
  })

  it('maps a cleared round, with the tier it came from and the one now played', () => {
    const event: RoomEvent = { kind: 'cleared', round: 3, player_id: 'a', deck_no: 3 }
    expect(toRoundEnd(event, src)).toEqual({ kind: 'cleared', key: '2|3', round: 3, exhausted: false, fromTier: 'easy', toTier: 'medium' })
    expect(toRoundEnd({ ...event, exhausted: true }, src)).toMatchObject({ exhausted: true })
  })

  it('is null for events that do not end a round', () => {
    expect(toRoundEnd(null, src)).toBeNull()
    expect(toRoundEnd({ kind: 'start', round: 1 }, src)).toBeNull()
    expect(toRoundEnd({ kind: 'answer', round: 1, player_id: 'a', pokemon_id: 4 }, src)).toBeNull()
    expect(toRoundEnd({ kind: 'gone', round: 1, player_id: 'a', reason: 'left' }, src)).toBeNull()
    expect(toRoundEnd({ kind: 'lobby' }, src)).toBeNull()
  })
})

describe('alsoFit with a shared seed', () => {
  const end = toRoundEnd({ kind: 'timeout', round: 3, player_id: 'b', lives: 1, out: false, deck_no: 3 }, src) as TimeoutEnd

  it('seeds by room, game and round, so every screen agrees', () => {
    expect(alsoFitSeed('room-1', 2, 3)).toBe('room-1|2|3')
    expect(alsoFitIds(end, POKEDEX, POKEDEX_BY_ID)).toEqual(alsoFitIds({ ...end }, [...POKEDEX], POKEDEX_BY_ID))
  })

  it('gives three that fit and that nobody said (no species said in the round)', () => {
    const ids = alsoFitIds(end, POKEDEX, POKEDEX_BY_ID)
    expect(ids).toHaveLength(3)
    const said = new Set(end.saidIds.map((id) => POKEDEX_BY_ID.get(id)!.dexNumber))
    for (const id of ids) {
      const p = POKEDEX_BY_ID.get(id)!
      expect([p.type1, p.type2]).toContain('Fire')
      expect(said.has(p.dexNumber)).toBe(false)
    }
  })

  it('differs from round to round, and is empty without a category', () => {
    const other = alsoFitIds({ ...end, seed: alsoFitSeed('room-1', 2, 4) }, POKEDEX, POKEDEX_BY_ID)
    expect(other).not.toEqual(alsoFitIds(end, POKEDEX, POKEDEX_BY_ID))
    expect(alsoFitIds({ ...end, category: null }, POKEDEX, POKEDEX_BY_ID)).toEqual([])
  })
})

describe('words', () => {
  it('says who lost a life or is out, and "You" on their own screen', () => {
    expect(timeUpText({ nickname: 'Brock', out: false, playerId: 'b' }, 'a')).toBe("Time's up! Brock lost a life.")
    expect(timeUpText({ nickname: 'Brock', out: true, playerId: 'b' }, 'a')).toBe("Time's up! Brock is out!")
    expect(timeUpText({ nickname: 'Brock', out: false, playerId: 'b' }, 'b')).toBe("Time's up! You lost a life.")
    expect(timeUpText({ nickname: 'Brock', out: true, playerId: 'b' }, 'b')).toBe("Time's up! You're out!")
  })

  it('names the new tier only when it changed', () => {
    expect(clearedText({ exhausted: false, fromTier: 'easy', toTier: 'easy' })).toEqual({ title: 'Round cleared!', detail: null })
    expect(clearedText({ exhausted: false, fromTier: 'medium', toTier: 'hard' })).toEqual({ title: 'Round cleared!', detail: 'Now: Hard' })
    expect(clearedText({ exhausted: true, fromTier: 'hard', toTier: 'hard' }).detail).toBe('No answers left!')
    expect(clearedText({ exhausted: false, fromTier: null, toTier: 'hard' }).detail).toBeNull()
  })

  it('names the winner', () => {
    expect(winnerText({ id: 'b', nickname: 'Brock', icon: 4 }, 'a')).toBe('Brock wins!')
    expect(winnerText({ id: 'a', nickname: 'Ash', icon: 1 }, 'a')).toBe('You win!')
    expect(winnerText(null, 'a')).toBe('No winner this time.')
  })
})

describe('momentReducer', () => {
  const timeout = (round: number, game = 1): RoundEnd => ({
    kind: 'timeout',
    key: `${game}|${round}`,
    round,
    playerId: 'b',
    nickname: 'Brock',
    lives: 2,
    out: false,
    category: FIRE,
    saidIds: [],
    seed: 's',
  })
  const cleared = (round: number): RoundEnd => ({ kind: 'cleared', key: `1|${round}`, round, exhausted: false, fromTier: 'easy', toTier: 'easy' })

  it('does not replay the round end that was there when the screen opened', () => {
    const s = initialMoments(timeout(2))
    expect(momentReducer(s, { type: 'event', end: timeout(2), round: 3, now: 100 })).toBe(s)
  })

  it('plays a new round end once, however often it arrives', () => {
    let s = initialMoments(null)
    s = momentReducer(s, { type: 'event', end: timeout(2), round: 3, now: 100 })
    expect(s.moment).toMatchObject({ kind: 'timeout', startedAt: 100, eventAt: 100 })
    const again = momentReducer(s, { type: 'event', end: timeout(2), round: 3, now: 400 })
    expect(again).toBe(s)
    // Even after the moment is done, the same key never comes back.
    const done = momentReducer(s, { type: 'done', id: s.moment!.id })
    expect(done.moment).toBeNull()
    expect(momentReducer(done, { type: 'event', end: timeout(2), round: 3, now: 5000 }).moment).toBeNull()
  })

  it('skips a stale round end (older than the round that just ended)', () => {
    const s = momentReducer(initialMoments(null), { type: 'event', end: cleared(2), round: 5, now: 100 })
    expect(s.moment).toBeNull()
    expect(s.seen).toContain('1|2')
  })

  it('joins an early burst to its own event, keeping when it started', () => {
    let s: MomentState = momentReducer(initialMoments(null), { type: 'early', round: 2, playerId: 'b', now: 1000 })
    expect(s.moment).toMatchObject({ kind: 'timeout', startedAt: 1000, eventAt: null, end: null })
    const id = s.moment!.id
    // A second local zero (or a re-render) changes nothing.
    expect(momentReducer(s, { type: 'early', round: 2, playerId: 'b', now: 1100 })).toBe(s)
    s = momentReducer(s, { type: 'event', end: timeout(2), round: 3, now: 1250 })
    expect(s.moment).toMatchObject({ id, startedAt: 1000, eventAt: 1250 })
    expect(s.moment!.end).toMatchObject({ kind: 'timeout', round: 2 })
  })

  it('replaces an early burst when the round was cleared after all (an answer inside the grace)', () => {
    let s = momentReducer(initialMoments(null), { type: 'early', round: 2, playerId: 'b', now: 1000 })
    s = momentReducer(s, { type: 'event', end: cleared(2), round: 3, now: 1100 })
    expect(s.moment).toMatchObject({ kind: 'cleared', startedAt: 1100 })
  })

  it('ignores a done for a moment that has already been replaced', () => {
    let s = momentReducer(initialMoments(null), { type: 'event', end: cleared(2), round: 3, now: 0 })
    const first = s.moment!.id
    s = momentReducer(s, { type: 'event', end: timeout(3), round: 4, now: 10 })
    expect(momentReducer(s, { type: 'done', id: first })).toBe(s)
  })

  it('times each moment: ~2.5 s for time up (longer when the event is late), ~1.5 s for cleared, a bounded early wait', () => {
    const base = { id: 1, end: null, early: null }
    expect(momentEndsAt({ ...base, kind: 'cleared', startedAt: 0, eventAt: 0 })).toBe(CLEARED_MS)
    expect(momentEndsAt({ ...base, kind: 'timeout', startedAt: 0, eventAt: 0 })).toBe(TIMEUP_MS)
    expect(momentEndsAt({ ...base, kind: 'timeout', startedAt: 0, eventAt: 2000 })).toBe(2000 + TEXT_MIN_MS)
    expect(momentEndsAt({ ...base, kind: 'timeout', startedAt: 0, eventAt: null })).toBe(EARLY_WAIT_MS)
  })
})

describe('timelines', () => {
  it('flashes, bursts, then types the text and reveals Also fit', () => {
    const m = { startedAt: 0, eventAt: 0 }
    expect(timeUpFrame(m, 20, 100, BURST_FRAMES, false)).toMatchObject({ art: { kind: 'flash' }, letters: 0, alsoFit: false, popped: false })
    expect(timeUpFrame(m, 20, FLASH_MS + 10, BURST_FRAMES, false)).toMatchObject({ art: { kind: 'burst', frame: 0 }, popped: true })
    const mid = timeUpFrame(m, 20, TEXT_AT_MS + 220, BURST_FRAMES, false)
    expect(mid.art).toEqual({ kind: 'burst', frame: 5 })
    expect(timeUpFrame(m, 20, 1000, BURST_FRAMES, false).art.kind).toBe('spent')
    expect(mid.letters).toBe(10)
    expect(mid.alsoFit).toBe(false)
    expect(timeUpFrame(m, 20, 2000, BURST_FRAMES, false)).toMatchObject({ letters: 20, alsoFit: true })
  })

  it('waits for the event before typing (an early burst)', () => {
    expect(timeUpFrame({ startedAt: 0, eventAt: null }, 0, 1200, BURST_FRAMES, false)).toMatchObject({ letters: 0, alsoFit: false })
    // A late event types from when it arrived.
    expect(timeUpFrame({ startedAt: 0, eventAt: 1500 }, 20, 1500 + 110, BURST_FRAMES, false).letters).toBe(5)
  })

  it('shows the whole text at once with reduced motion', () => {
    expect(timeUpFrame({ startedAt: 0, eventAt: 0 }, 20, 0, BURST_FRAMES, true)).toEqual({ art: { kind: 'spent' }, letters: 20, alsoFit: true, popped: true })
    expect(clearedFrame(0, 14, 0, true)).toEqual({ letters: 14, detail: true })
    expect(clearedFrame(0, 14, 0, false)).toEqual({ letters: 0, detail: false })
    expect(clearedFrame(0, 14, 1000, false)).toEqual({ letters: 14, detail: true })
  })
})

describe('the burst art', () => {
  it('draws every frame on its grid in the palette letters', () => {
    for (let f = 0; f < BURST_FRAMES; f++) {
      const g = burstGrid(f)
      expect(g).toHaveLength(BURST_H)
      for (const row of g) expect(row).toMatch(new RegExp(`^[.kWSORMm]{${BURST_W}}$`))
      expect(g.join('').replace(/\./g, '').length).toBeGreaterThan(20)
    }
  })
})

describe('game over', () => {
  const cat = (deck_no: number, tier: 'easy' | 'medium' | 'hard' | 'expert', result: 'cleared' | 'failed' | null) => ({ deck_no, tier, result })

  it('picks the hardest cleared category: highest tier, then the latest', () => {
    expect(hardestCleared([cat(1, 'easy', 'cleared'), cat(5, 'medium', 'cleared'), cat(8, 'hard', 'failed'), cat(4, 'medium', 'cleared')])).toMatchObject({ deck_no: 5 })
    expect(hardestCleared([cat(12, 'expert', 'failed'), cat(2, 'easy', 'cleared'), cat(3, 'easy', 'cleared')])).toMatchObject({ deck_no: 3 })
    expect(hardestCleared([cat(1, 'easy', 'failed'), cat(2, 'easy', null)])).toBeNull()
  })

  it('lists answers given and lives lost per seated player, the winner first and gone players last', () => {
    const p = (id: string, seat: number | null, lives: number, answers: number, extra = {}) => ({
      id,
      nickname: id.toUpperCase(),
      icon: 1,
      seat,
      lives,
      is_out: lives === 0,
      answers_given: answers,
      gone_at: null as string | null,
      ...extra,
    })
    const rows = resultPlayers(
      [p('a', 0, 0, 9), p('b', 1, 2, 3), p('c', 2, 0, 4), p('d', 3, 1, 1, { gone_at: '2026-11-28T10:00:00Z' }), p('w', null, 3, 0)],
      3,
      'b',
      'a',
    )
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(rows[0]).toMatchObject({ isWinner: true, answers: 3, livesLost: 1, lives: 2 })
    expect(rows[1]).toMatchObject({ isMe: true, out: true, livesLost: 3, answers: 9 })
    expect(rows[3]).toMatchObject({ gone: true, livesLost: 2 })
  })
})
