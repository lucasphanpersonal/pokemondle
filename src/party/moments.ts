import { PARTY_CONFIG, PARTY_TIERS, type TierId } from '../config/partyConfig.ts'
import { alsoFit } from '../lib/party/categories.ts'
import type { Category } from '../lib/party/types.ts'
import type { Pokemon } from '../types/pokemon.ts'
import type { RoomEvent } from './state.ts'
import type { ClearedEnd, GameOverView, ResultPlayer, RoundEnd, TimeoutEnd } from './types.ts'

/*
 * Pure helpers for the end of a round (time's up, round cleared) and the game over screen. No React, no DOM.
 *
 * The moments are driven by party_rooms.last_event, so every screen in the room shows them, not only the player whose
 * time ran out. A moment is keyed by its game and round, so an event that arrives twice (a Realtime update and a
 * snapshot) plays once, and one that arrives after the next round's first answer is simply missed (last_event only holds
 * the latest). The local countdown reaching zero starts the burst early (`early` below); the server's event then fills
 * in who lost a life.
 */

// ---------------------------------------------------------------------------------------------------------------
// Timings

/** Time's up lasts about 2.5 s from the burst. */
export const TIMEUP_MS = 2500
/** Round cleared lasts about 1.5 s. */
export const CLEARED_MS = 1500
/** The bomb flashes and swells for this long before it bursts. */
export const FLASH_MS = 300
/** Each frame of the burst (BURST_FRAMES of them, drawn in fuseArt.ts). */
export const BURST_FRAME_MS = 90
/** The typed text starts this long after the burst begins (mid-explosion), or when the server's event arrives. */
export const TEXT_AT_MS = 600
/** Milliseconds per letter as the text types out (the main game's text speed, HintPrompt). */
export const LETTER_MS = 22
/** "Also fit" shows this long after the text has typed out. */
export const ALSO_FIT_PAUSE_MS = 150
/** Once the server's event arrives, its text stays up at least this long (a late event still gets read). */
export const TEXT_MIN_MS = 1500
/** A burst started by the local countdown waits this long for the server's timeout before it gives up. */
export const EARLY_WAIT_MS = 1500

// ---------------------------------------------------------------------------------------------------------------
// Event -> round end

/** The key that names a round's end: one moment per game and round, whatever arrives. */
export const roundEndKey = (gameNo: number, round: number): string => `${gameNo}|${round}`

/** The "Also fit" seed every screen in the room shares: the room, the game and the failed round. */
export const alsoFitSeed = (roomId: string, gameNo: number, round: number): string => `${roomId}|${gameNo}|${round}`

/** What toRoundEnd reads besides the event: the room's rows, as plain data. */
export interface RoundEndSource {
  roomId: string
  gameNo: number
  /** Every player of the room, gone ones included (the one who timed out may have left on their turn). */
  players: readonly { id: string; nickname: string }[]
  /** The game's dealt categories (party_categories). */
  categories: readonly { deck_no: number; parts: Category; tier: TierId }[]
  /** The game's answers, any round (party_answers). */
  answers: readonly { round: number; pokemon_id: number }[]
  /** The tier of the round being played now. */
  currentTier: TierId
}

/**
 * Maps party_rooms.last_event to the round end the screens show, or null when the event isn't the end of a round
 * (the start, an answer, a player leaving when it wasn't their turn).
 */
export function toRoundEnd(event: RoomEvent | null | undefined, src: RoundEndSource): RoundEnd | null {
  if (!event) return null
  const categoryOf = (deckNo: number) => src.categories.find((c) => c.deck_no === deckNo) ?? null
  if (event.kind === 'timeout') {
    const category = categoryOf(event.deck_no)
    return {
      kind: 'timeout',
      key: roundEndKey(src.gameNo, event.round),
      round: event.round,
      playerId: event.player_id,
      nickname: src.players.find((p) => p.id === event.player_id)?.nickname ?? 'Someone',
      lives: event.lives,
      out: event.out,
      category: category?.parts ?? null,
      // The server's list when the event has one, so every screen excludes the same answers whatever reached it;
      // else the answers this browser received.
      saidIds: Array.isArray(event.said) ? event.said : src.answers.filter((a) => a.round === event.round).map((a) => a.pokemon_id),
      seed: alsoFitSeed(src.roomId, src.gameNo, event.round),
    }
  }
  if (event.kind === 'cleared') {
    return {
      kind: 'cleared',
      key: roundEndKey(src.gameNo, event.round),
      round: event.round,
      exhausted: event.exhausted === true,
      fromTier: categoryOf(event.deck_no)?.tier ?? null,
      toTier: src.currentTier,
    }
  }
  return null
}

/**
 * The dataset ids "Also fit" shows for a failed round: PARTY_CONFIG.alsoFitCount species that fit and nobody said,
 * picked with the round's shared seed so every screen shows the same ones.
 */
export function alsoFitIds(end: Pick<TimeoutEnd, 'category' | 'saidIds' | 'seed'>, dataset: readonly Pokemon[], byId: ReadonlyMap<number, Pokemon>): number[] {
  if (!end.category) return []
  const used = new Set<number>()
  for (const id of end.saidIds) {
    const p = byId.get(id)
    if (p) used.add(p.dexNumber)
  }
  return alsoFit(end.category, dataset, used, end.seed, PARTY_CONFIG.alsoFitCount).map((p) => p.id)
}

// ---------------------------------------------------------------------------------------------------------------
// Words

/** "Time's up! Brock lost a life." / "Time's up! Brock is out!" (and "You…" for this browser's player). */
export function timeUpText(end: Pick<TimeoutEnd, 'nickname' | 'out' | 'playerId'>, meId: string): string {
  const me = end.playerId === meId
  if (end.out) return me ? "Time's up! You're out!" : `Time's up! ${end.nickname} is out!`
  return `Time's up! ${me ? 'You' : end.nickname} lost a life.`
}

/** The round cleared banner: its headline, and the new tier's name when it changed ("Now: Hard"). */
export function clearedText(end: Pick<ClearedEnd, 'exhausted' | 'fromTier' | 'toTier'>): { title: string; detail: string | null } {
  const changed = end.fromTier !== null && end.fromTier !== end.toTier
  const tierWords = changed ? `Now: ${PARTY_TIERS.find((t) => t.id === end.toTier)?.name ?? end.toTier}` : null
  const ran = end.exhausted ? 'No answers left!' : null
  return { title: 'Round cleared!', detail: [ran, tierWords].filter(Boolean).join(' ') || null }
}

// ---------------------------------------------------------------------------------------------------------------
// The moment on screen

/** The moment showing over the category card. `id` stays the same when an early burst is joined by its event. */
export interface ActiveMoment {
  id: number
  kind: 'timeout' | 'cleared'
  /** When the moment began on this screen (the burst, or the banner). */
  startedAt: number
  /** When the server's event arrived; null while an early burst waits for it. */
  eventAt: number | null
  end: RoundEnd | null
  /** The turn whose countdown reached zero on this screen (an early burst). */
  early: { round: number; playerId: string | null } | null
}

export interface MomentState {
  /** Round-end keys already shown (or skipped): an event that arrives again never replays. */
  seen: readonly string[]
  moment: ActiveMoment | null
  nextId: number
}

export type MomentAction =
  /** The server's round end changed (or arrived again). `round` is the round being played now. */
  | { type: 'event'; end: RoundEnd | null; round: number; now: number }
  /** This screen's countdown reached zero for `round`'s turn of `playerId`. */
  | { type: 'early'; round: number; playerId: string | null; now: number }
  /** The moment with this id has run its course. */
  | { type: 'done'; id: number }

/**
 * The first state for a screen opening on `end`: a round end that was already there when the screen opened (a reload,
 * a late join) is marked seen, so it doesn't play out of the blue.
 */
export const initialMoments = (end: RoundEnd | null): MomentState => ({ seen: end ? [end.key] : [], moment: null, nextId: 1 })

export function momentReducer(state: MomentState, action: MomentAction): MomentState {
  switch (action.type) {
    case 'early': {
      // A burst is already on screen (the event beat the countdown, or this is a second call): leave it.
      if (state.moment?.kind === 'timeout') return state
      const moment: ActiveMoment = {
        id: state.nextId,
        kind: 'timeout',
        startedAt: action.now,
        eventAt: null,
        end: null,
        early: { round: action.round, playerId: action.playerId },
      }
      return { ...state, moment, nextId: state.nextId + 1 }
    }
    case 'event': {
      const end = action.end
      if (!end || state.seen.includes(end.key)) return state
      const seen = [...state.seen.slice(-20), end.key]
      // Older than the round that just ended: a stale event (the screen missed rounds), skip it.
      if (end.round < action.round - 1) return { ...state, seen }
      const cur = state.moment
      if (cur && cur.eventAt === null && end.kind === 'timeout' && cur.early?.round === end.round) {
        // The early burst's own event: keep the burst going and fill in the words.
        return { ...state, seen, moment: { ...cur, end, eventAt: action.now } }
      }
      const moment: ActiveMoment = { id: state.nextId, kind: end.kind, startedAt: action.now, eventAt: action.now, end, early: null }
      return { seen, moment, nextId: state.nextId + 1 }
    }
    case 'done':
      return state.moment?.id === action.id ? { ...state, moment: null } : state
  }
}

/** When `m` leaves the screen (local ms). */
export function momentEndsAt(m: ActiveMoment): number {
  if (m.kind === 'cleared') return m.startedAt + CLEARED_MS
  if (m.eventAt === null) return m.startedAt + EARLY_WAIT_MS
  return Math.max(m.startedAt + TIMEUP_MS, m.eventAt + TEXT_MIN_MS)
}

/** What the time's up panel draws at `now`. */
export interface TimeUpFrame {
  /** The bomb's state: flashing before it goes, a burst frame (0 to frames - 1), or spent (only smoke left). */
  art: { kind: 'flash'; on: boolean; swell: number } | { kind: 'burst'; frame: number } | { kind: 'spent' }
  /** Letters of the text typed so far (0 before the event arrives). */
  letters: number
  /** "Also fit" has been revealed. */
  alsoFit: boolean
  /** The pop sound is due (the bomb has burst). */
  popped: boolean
}

/**
 * The time's up timeline: the bomb flashes for FLASH_MS, bursts over `frames` frames, then the text types out (from
 * TEXT_AT_MS, or when the event arrives) and "Also fit" follows. With reduced motion there is no flash or burst and the
 * text shows whole.
 */
export function timeUpFrame(m: Pick<ActiveMoment, 'startedAt' | 'eventAt'>, textLength: number, now: number, frames: number, reduceMotion: boolean): TimeUpFrame {
  const t = now - m.startedAt
  if (reduceMotion) {
    const has = m.eventAt !== null
    return { art: { kind: 'spent' }, letters: has ? textLength : 0, alsoFit: has, popped: true }
  }
  let art: TimeUpFrame['art']
  if (t < FLASH_MS) art = { kind: 'flash', on: Math.floor(t / 75) % 2 === 0, swell: 1.25 + 0.15 * (t / FLASH_MS) }
  else if (t < FLASH_MS + frames * BURST_FRAME_MS) art = { kind: 'burst', frame: Math.floor((t - FLASH_MS) / BURST_FRAME_MS) }
  else art = { kind: 'spent' }
  if (m.eventAt === null) return { art, letters: 0, alsoFit: false, popped: t >= FLASH_MS }
  const textAt = Math.max(m.startedAt + TEXT_AT_MS, m.eventAt)
  const letters = Math.max(0, Math.min(textLength, Math.floor((now - textAt) / LETTER_MS)))
  const alsoFitAt = textAt + textLength * LETTER_MS + ALSO_FIT_PAUSE_MS
  return { art, letters, alsoFit: now >= alsoFitAt, popped: t >= FLASH_MS }
}

/** The round cleared banner at `now`: letters of the headline typed, and whether the tier line shows yet. */
export function clearedFrame(startedAt: number, titleLength: number, now: number, reduceMotion: boolean): { letters: number; detail: boolean } {
  if (reduceMotion) return { letters: titleLength, detail: true }
  const t = now - startedAt
  const letters = Math.max(0, Math.min(titleLength, Math.floor(t / LETTER_MS)))
  return { letters, detail: t >= titleLength * LETTER_MS + ALSO_FIT_PAUSE_MS }
}

// ---------------------------------------------------------------------------------------------------------------
// Game over

const tierRank = (tier: TierId) => PARTY_TIERS.findIndex((t) => t.id === tier)

/**
 * The hardest category anyone cleared: among the game's categories with result 'cleared', the highest tier, then the
 * latest one dealt. Null when no round was cleared.
 */
export function hardestCleared<C extends { deck_no: number; tier: TierId; result: 'cleared' | 'failed' | null }>(categories: readonly C[]): C | null {
  let best: C | null = null
  for (const c of categories) {
    if (c.result !== 'cleared') continue
    if (!best || tierRank(c.tier) > tierRank(best.tier) || (tierRank(c.tier) === tierRank(best.tier) && c.deck_no > best.deck_no)) best = c
  }
  return best
}

/** The seated player rows of the game over table, as the database has them. */
export interface ResultSource {
  id: string
  nickname: string
  icon: number
  seat: number | null
  lives: number
  is_out: boolean
  answers_given: number
  gone_at: string | null
}

/**
 * The game over table: everyone who had a seat in the game (gone players too, marked), the winner first, then by lives
 * left, answers given and seat.
 */
export function resultPlayers(players: readonly ResultSource[], startLives: number, winnerId: string | null, meId: string): ResultPlayer[] {
  return players
    .filter((p) => p.seat !== null)
    .map((p) => ({
      row: {
        id: p.id,
        nickname: p.nickname,
        icon: p.icon,
        answers: p.answers_given,
        livesLost: Math.max(0, startLives - p.lives),
        lives: p.lives,
        out: p.is_out,
        gone: p.gone_at !== null,
        isWinner: p.id === winnerId,
        isMe: p.id === meId,
      },
      seat: p.seat ?? 0,
    }))
    .sort(
      (a, b) =>
        Number(b.row.isWinner) - Number(a.row.isWinner) ||
        Number(a.row.gone) - Number(b.row.gone) ||
        b.row.lives - a.row.lives ||
        b.row.answers - a.row.answers ||
        a.seat - b.seat,
    )
    .map((x) => x.row)
}

/** The game over screen's words for the winner: "You win!", "Misty wins!", or nobody. */
export function winnerText(winner: GameOverView['winner'], meId: string): string {
  if (!winner) return 'No winner this time.'
  return winner.id === meId ? 'You win!' : `${winner.nickname} wins!`
}
