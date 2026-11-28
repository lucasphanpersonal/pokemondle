import { PARTY_TIERS } from '../config/partyConfig.ts'
import { categoryParts, categorySentence, checkAnswer, partLabel, speciesLeft } from '../lib/party/categories.ts'
import type { AnswerCheck, Category, Part } from '../lib/party/types.ts'
import type { Pokemon } from '../types/pokemon.ts'
import type { GameAnswer, GamePlayer, GameView } from './types.ts'

/*
 * Pure helpers for the game screen: the timer's maths, the rail and the turn's words. No React, no DOM.
 */

// ---------------------------------------------------------------------------------------------------------------
// The timer

/** The last stretch of a turn, when the fuse timer flashes and swells and the ticks come twice a second. */
export const HURRY_MS = 5000

/** How the turn's countdown stands at one moment. */
export interface TimerState {
  /** Milliseconds left, never below 0. */
  remainingMs: number
  /** Whole seconds shown on the timer: 12.3 s left reads 13, as a countdown does; 0 only once time is up. */
  seconds: number
  /** How much of the fuse is left, 1 (a fresh turn) down to 0. */
  fuse: number
  /** 'calm', then 'hurry' for the last HURRY_MS, then 'done' at the deadline. */
  phase: 'calm' | 'hurry' | 'done'
  /** In the hurry phase the timer flashes white: on for the second half of every half second (2 flashes a second). */
  flash: boolean
  /** How big the timer is drawn: 1, growing steadily to 1.25 over the hurry phase (it swells as it's about to go). */
  swell: number
}

/** The countdown at `now` for a turn ending at `deadlineAt` that lasts `seconds` in all. */
export function timerState(deadlineAt: number, seconds: number, now: number): TimerState {
  const remainingMs = Math.max(0, deadlineAt - now)
  const total = Math.max(1, seconds * 1000)
  const phase = remainingMs <= 0 ? 'done' : remainingMs <= HURRY_MS ? 'hurry' : 'calm'
  return {
    remainingMs,
    seconds: Math.ceil(remainingMs / 1000),
    fuse: Math.min(1, remainingMs / total),
    phase,
    flash: phase === 'hurry' && remainingMs % 500 >= 250,
    swell: phase === 'hurry' ? 1 + 0.25 * (1 - remainingMs / HURRY_MS) : 1,
  }
}

/** How many of `cells` fuse cells still show for a fuse `fraction` left: a cell burns away once it's fully spent. */
export const fuseCells = (fraction: number, cells: number): number => Math.max(0, Math.min(cells, Math.ceil(fraction * cells - 1e-9)))

/**
 * Which tick of the countdown `remainingMs` is in: one a second, then two a second in the hurry phase. The screen plays
 * the tick sound whenever this changes, so the ticks speed up in the last 5 s. Null once time is up.
 */
export function tickKey(remainingMs: number): string | null {
  if (remainingMs <= 0) return null
  return remainingMs <= HURRY_MS ? `h${Math.ceil(remainingMs / 500)}` : `s${Math.ceil(remainingMs / 1000)}`
}

// ---------------------------------------------------------------------------------------------------------------
// The rail

/** A player as the rail draws them. */
export interface RailPlayer extends GamePlayer {
  isTurn: boolean
  isMe: boolean
  /** Lives lost so far (empty hearts), never below 0. */
  lost: number
}

/** The rail in turn order (as `players` comes), each player marked with whose turn it is and who this browser is. */
export function railPlayers(view: Pick<GameView, 'players' | 'turnPlayerId' | 'meId' | 'startLives'>): RailPlayer[] {
  return view.players.map((p) => ({
    ...p,
    isTurn: p.id === view.turnPlayerId,
    isMe: p.id === view.meId,
    lost: Math.max(0, Math.max(view.startLives, p.lives) - p.lives),
  }))
}

/** Lives in words, for screen readers (the hearts are drawn): "2 of 3 lives", "Out". */
export const livesText = (lives: number, start: number, out: boolean): string =>
  out ? 'Out, no lives left' : `${lives} of ${Math.max(start, lives)} ${Math.max(start, lives) === 1 ? 'life' : 'lives'} left`

/**
 * Where the rail should scroll so the player whose turn it is sits in the middle (it scrolls sideways on phones):
 * the scrollLeft for a tile at `tileLeft` (offsetLeft) of width `tileWidth` in a rail `railWidth` wide whose content is
 * `scrollWidth` wide. Clamped to the scrollable range.
 */
export function railScrollFor(tileLeft: number, tileWidth: number, railWidth: number, scrollWidth: number): number {
  const target = tileLeft - (railWidth - tileWidth) / 2
  return Math.round(Math.max(0, Math.min(scrollWidth - railWidth, target)))
}

// ---------------------------------------------------------------------------------------------------------------
// The turn

/** The parts in the engine's display order (the order of categoryParts and categorySentence: typing first). */
export function sortedParts(category: Category): Part[] {
  const order = categoryParts(category)
  return [...category].sort((a, b) => order.indexOf(partLabel(a)) - order.indexOf(partLabel(b)))
}

export const tierName = (id: string): string => PARTY_TIERS.find((t) => t.id === id)?.name ?? id

/** What the screen says about the turn, for this browser. */
export interface TurnText {
  /** It's this browser's turn: the search box is live. */
  mine: boolean
  /** The text box over the search box. */
  prompt: string
  /** The disabled search box's words on someone else's turn. */
  waiting: string
}

/** The turn's words: "Your turn! Name a Fire type, Stage 2!", or "Misty's turn: a Fire type, Stage 2." and "Misty is thinking…". */
export function turnText(view: Pick<GameView, 'players' | 'turnPlayerId' | 'meId' | 'category'>): TurnText {
  const sentence = categorySentence(view.category)
  const turn = view.players.find((p) => p.id === view.turnPlayerId)
  const me = view.players.find((p) => p.id === view.meId)
  if (turn && turn.id === view.meId) return { mine: true, prompt: `Your turn! Name ${sentence}!`, waiting: '' }
  const watching = !me ? "You're watching this game. " : me.out ? "You're out, so you're watching. " : ''
  if (!turn) return { mine: false, prompt: `${watching}Next up: ${sentence}.`, waiting: 'Get ready…' }
  return { mine: false, prompt: `${watching}${turn.nickname}'s turn: ${sentence}.`, waiting: `${turn.nickname} is thinking…` }
}

/** The species (dex numbers) said this round, from the answers and the dataset. */
export function usedSpecies(answers: readonly Pick<GameAnswer, 'pokemonId'>[], byId: ReadonlyMap<number, Pokemon>): Set<number> {
  const used = new Set<number>()
  for (const a of answers) {
    const p = byId.get(a.pokemonId)
    if (p) used.add(p.dexNumber)
  }
  return used
}

/** GameView.left for the room connection: species that fit `category` and weren't said in `answers`. */
export const speciesLeftFor = (
  category: Category,
  answers: readonly Pick<GameAnswer, 'pokemonId'>[],
  dataset: readonly Pokemon[],
  byId: ReadonlyMap<number, Pokemon>,
): number => speciesLeft(category, dataset, usedSpecies(answers, byId))

/** Checks an answer on this browser before it's sent: the same check the server makes, so a wrong one needs no request. */
export const checkLocally = (
  category: Category,
  pokemon: Pokemon,
  answers: readonly Pick<GameAnswer, 'pokemonId'>[],
  byId: ReadonlyMap<number, Pokemon>,
): AnswerCheck => checkAnswer(category, pokemon, usedSpecies(answers, byId))

/** How long a wrong answer's reason stays under the search box. */
export const WRONG_MS = 1500

// ---------------------------------------------------------------------------------------------------------------
// Turn identity and the countdown's events

/**
 * One turn's identity: the round, the server's turn number and whose turn it is. It leaves out the deadline, which
 * shifts by a few ms whenever the room connection re-estimates the server clock.
 */
export const turnKeyOf = (view: Pick<GameView, 'round' | 'turnNo' | 'turnPlayerId'>): string =>
  `${view.round}|${view.turnNo}|${view.turnPlayerId ?? ''}`

/** What the tick sound remembers between draws: the turn and its last tick. */
export interface TickMemory {
  turn: string
  tick: string | null
}

/**
 * Whether to play a tick now, and what to remember. A tick plays when the countdown moves into a new tick of the same
 * turn; the first draw of a turn (a new turn, or the screen opening mid-turn) only remembers where it is.
 */
export function nextTick(prev: TickMemory | null, turn: string, tick: string | null): { play: 'tick' | 'tock' | null; memory: TickMemory } {
  const memory = { turn, tick }
  if (!prev || prev.turn !== turn || tick === null || tick === prev.tick) return { play: null, memory }
  return { play: tick.startsWith('h') ? 'tock' : 'tick', memory }
}

/** Whether time's up should be announced for `turn`: once per turn, the first time its countdown reads done. */
export const timeUpDue = (announcedFor: string | null, turn: string, done: boolean): boolean => done && announcedFor !== turn
