import type { Category, TierId } from '../lib/party/types.ts'

/**
 * Pure room state for the Party page: what the four public tables say about one room, kept up to date from a snapshot
 * (selects) plus Realtime row events. No React, no network. Reducing is idempotent (the same event twice changes
 * nothing) and order tolerant (an old room row never replaces a newer one, rows of a finished game are dropped).
 */

export type RoomStatus = 'lobby' | 'playing' | 'over'

/** The room's last_event: what just happened, for the banners. */
export type RoomEvent =
  | { kind: 'lobby' }
  | { kind: 'start'; round: number }
  | { kind: 'answer'; round: number; player_id: string; pokemon_id: number }
  | { kind: 'cleared'; round: number; player_id: string; deck_no: number; exhausted?: boolean; over?: boolean; winner_id?: string }
  | {
      kind: 'timeout'
      round: number
      player_id: string
      lives: number
      out: boolean
      deck_no: number
      /** The pokemon ids answered in that round, oldest first (from migration 20261128120000; older events lack it). */
      said?: number[]
      over?: boolean
      winner_id?: string
    }
  | { kind: 'gone'; round: number; player_id: string; reason: string; over?: boolean; winner_id?: string }

export interface RoomRow {
  id: string
  host_id: string | null
  status: RoomStatus
  lives: number
  start_tier: TierId
  game_no: number
  round: number
  category_no: number | null
  turn_player_id: string | null
  turn_no: number
  turn_seconds: number | null
  turn_started_at: string | null
  /** Postgres timestamp (ISO string) in SERVER time; see deadlineLocalMs. */
  deadline: string | null
  winner_id: string | null
  last_event: RoomEvent | null
  created_at?: string
  last_activity?: string
}

export interface PlayerRow {
  id: string
  room_id: string
  nickname: string
  /** A starter's dex number. */
  icon: number
  joined_at: string
  /** Turn order position; null while watching or in the lobby. */
  seat: number | null
  lives: number
  is_out: boolean
  answers_given: number
  gone_at: string | null
  gone_reason: 'left' | 'removed' | 'dropped' | null
}

export interface CategoryRow {
  room_id: string
  game_no: number
  deck_no: number
  parts: Category
  tier: TierId
  pool: number
  seconds: number
  result: 'cleared' | 'failed' | null
}

export interface AnswerRow {
  id: number
  room_id: string
  game_no: number
  round: number
  player_id: string
  pokemon_id: number
  species: number
  created_at: string
}

export type PartyTable = 'party_rooms' | 'party_players' | 'party_categories' | 'party_answers'
export type ChangeKind = 'INSERT' | 'UPDATE' | 'DELETE'

export interface PartyState {
  /** The room this state belongs to; rows of any other room are ignored. */
  roomId: string | null
  room: RoomRow | null
  players: Readonly<Record<string, PlayerRow>>
  categories: Readonly<Record<string, CategoryRow>>
  answers: Readonly<Record<string, AnswerRow>>
}

export type PartyAction =
  | { type: 'reset'; roomId: string | null }
  | {
      type: 'snapshot'
      roomId: string
      room: RoomRow | null
      players: readonly PlayerRow[]
      categories: readonly CategoryRow[]
      answers: readonly AnswerRow[]
    }
  | { type: 'change'; table: PartyTable; event: ChangeKind; row: Record<string, unknown> }

export const initialPartyState = (roomId: string | null = null): PartyState => ({
  roomId,
  room: null,
  players: {},
  categories: {},
  answers: {},
})

const categoryKey = (c: { game_no: number; deck_no: number }) => `${c.game_no}:${c.deck_no}`
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): v is string => typeof v === 'string' && v !== ''

const isRoom = (r: Record<string, unknown>): r is Record<string, unknown> & RoomRow =>
  str(r.id) && str(r.status) && num(r.game_no) && num(r.round) && num(r.turn_no)
const isPlayer = (r: Record<string, unknown>): r is Record<string, unknown> & PlayerRow =>
  str(r.id) && str(r.room_id) && str(r.nickname) && num(r.lives)
const isCategory = (r: Record<string, unknown>): r is Record<string, unknown> & CategoryRow =>
  str(r.room_id) && num(r.game_no) && num(r.deck_no) && Array.isArray(r.parts)
const isAnswer = (r: Record<string, unknown>): r is Record<string, unknown> & AnswerRow =>
  num(r.id) && str(r.room_id) && num(r.game_no) && num(r.round) && str(r.player_id) && num(r.species)

const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN)

/** True when `next` is an older version of the room than `cur` (a late event). Ties are accepted (idempotent). */
function isStaleRoom(cur: RoomRow, next: RoomRow): boolean {
  if (next.game_no !== cur.game_no) return next.game_no < cur.game_no
  const a = ms(cur.last_activity)
  const b = ms(next.last_activity)
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return b < a
  return next.turn_no < cur.turn_no
}

/** Rows of games before the room's current one are of no use; drop them. */
function prune(state: PartyState): PartyState {
  const game = state.room?.game_no
  if (game === undefined) return state
  const keep = <T extends { game_no: number }>(rows: Readonly<Record<string, T>>) => {
    const out: Record<string, T> = {}
    let dropped = false
    for (const [k, v] of Object.entries(rows)) {
      if (v.game_no >= game) out[k] = v
      else dropped = true
    }
    return dropped ? out : rows
  }
  const categories = keep(state.categories)
  const answers = keep(state.answers)
  return categories === state.categories && answers === state.answers ? state : { ...state, categories, answers }
}

function without<T>(rows: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  const out = { ...rows }
  delete out[key]
  return out
}

export function partyReducer(state: PartyState, action: PartyAction): PartyState {
  switch (action.type) {
    case 'reset':
      return initialPartyState(action.roomId)
    case 'snapshot': {
      const players: Record<string, PlayerRow> = {}
      for (const p of action.players) if (p.room_id === action.roomId) players[p.id] = p
      const categories: Record<string, CategoryRow> = {}
      for (const c of action.categories) if (c.room_id === action.roomId) categories[categoryKey(c)] = c
      const answers: Record<string, AnswerRow> = {}
      for (const a of action.answers) if (a.room_id === action.roomId) answers[String(a.id)] = a
      // A room event that already arrived may be newer than a snapshot read just before it.
      const room = state.roomId === action.roomId && state.room && action.room && isStaleRoom(state.room, action.room) ? state.room : action.room
      return prune({ roomId: action.roomId, room, players, categories, answers })
    }
    case 'change':
      return applyChange(state, action)
  }
}

function applyChange(state: PartyState, { table, event, row }: Extract<PartyAction, { type: 'change' }>): PartyState {
  const del = event === 'DELETE'
  switch (table) {
    case 'party_rooms': {
      if (state.roomId !== null && row.id !== state.roomId) return state
      if (del) return state.room ? prune({ ...state, room: null }) : state
      if (!isRoom(row)) return state
      if (state.room && isStaleRoom(state.room, row)) return state
      return prune({ ...state, room: row })
    }
    case 'party_players': {
      if (del) {
        return str(row.id) && row.id in state.players ? { ...state, players: without(state.players, row.id) } : state
      }
      if (!isPlayer(row) || (state.roomId !== null && row.room_id !== state.roomId)) return state
      return { ...state, players: { ...state.players, [row.id]: row } }
    }
    case 'party_categories': {
      if (state.roomId !== null && row.room_id !== state.roomId) return state
      if (del) {
        if (!num(row.game_no) || !num(row.deck_no)) return state
        const key = categoryKey({ game_no: row.game_no, deck_no: row.deck_no })
        return key in state.categories ? { ...state, categories: without(state.categories, key) } : state
      }
      if (!isCategory(row)) return state
      if (state.room && row.game_no < state.room.game_no) return state
      return { ...state, categories: { ...state.categories, [categoryKey(row)]: row } }
    }
    case 'party_answers': {
      if (state.roomId !== null && row.room_id !== state.roomId) return state
      if (del) {
        const key = String(row.id)
        return key in state.answers ? { ...state, answers: without(state.answers, key) } : state
      }
      if (!isAnswer(row)) return state
      if (state.room && row.game_no < state.room.game_no) return state
      return { ...state, answers: { ...state.answers, [String(row.id)]: row } }
    }
  }
}

// ----------------------------------------------------------------------------------------------- selectors ----

export const selectMe = (s: PartyState, myId: string | null): PlayerRow | null => (myId ? (s.players[myId] ?? null) : null)

export const selectIsHost = (s: PartyState, myId: string | null): boolean => !!myId && s.room?.host_id === myId

/** Players who haven't left, were removed or dropped; longest-joined first (the lobby list). */
export function selectPresentPlayers(s: PartyState): PlayerRow[] {
  return Object.values(s.players)
    .filter((p) => p.gone_at === null)
    .sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at) || a.id.localeCompare(b.id))
}

/** Players still in the turn order of the running game, in seat order. */
export function selectLivingPlayers(s: PartyState): PlayerRow[] {
  return Object.values(s.players)
    .filter((p) => p.seat !== null && !p.is_out && p.gone_at === null)
    .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0))
}

export const selectTurnPlayer = (s: PartyState): PlayerRow | null =>
  s.room?.turn_player_id ? (s.players[s.room.turn_player_id] ?? null) : null

export const selectMyTurn = (s: PartyState, myId: string | null): boolean =>
  !!myId && s.room?.status === 'playing' && s.room.turn_player_id === myId

/** A dealt category of the current game by deck number (use it to show a finished round's "Also fit"). */
export function selectCategoryByNo(s: PartyState, deckNo: number | null): CategoryRow | null {
  if (!s.room || deckNo === null) return null
  return s.categories[categoryKey({ game_no: s.room.game_no, deck_no: deckNo })] ?? null
}

export const selectCurrentCategory = (s: PartyState): CategoryRow | null => selectCategoryByNo(s, s.room?.category_no ?? null)

/** This round's answers, newest first. */
export function selectAnswersThisRound(s: PartyState): AnswerRow[] {
  const room = s.room
  if (!room) return []
  return Object.values(s.answers)
    .filter((a) => a.game_no === room.game_no && a.round === room.round)
    .sort((a, b) => b.id - a.id)
}

/**
 * The deadline in this browser's clock, in epoch ms, or null. `clockOffsetMs` is serverNow - localNow (see clock.ts),
 * so a deadline in server time becomes local time by subtracting it.
 */
export function deadlineLocalMs(room: RoomRow | null, clockOffsetMs: number): number | null {
  if (!room?.deadline || room.status !== 'playing') return null
  const t = Date.parse(room.deadline)
  return Number.isFinite(t) ? t - clockOffsetMs : null
}

/** Whole seconds left on the turn timer (rounded up, never below 0), or null when no turn is running. */
export function secondsLeft(room: RoomRow | null, clockOffsetMs: number, localNowMs: number): number | null {
  const at = deadlineLocalMs(room, clockOffsetMs)
  return at === null ? null : Math.max(0, Math.ceil((at - localNowMs) / 1000))
}
