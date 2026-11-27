// The party Edge Function's request handling, kept free of Deno globals and of the Supabase client so it can be
// unit-tested with fake dependencies (handler.test.ts). index.ts wires in the real ones.
// Tokens are never logged, hashed or stored here: they go straight to the SQL functions, which own all turn rules.
import { checkAnswer, dealDeck, speciesLeft } from '../_shared/party/categories.ts'
import { PARTY_CONFIG, PARTY_TIERS } from '../_shared/party/partyConfig.ts'
import type { Pokemon } from '../_shared/party/pokemon.ts'
import type { Category } from '../_shared/party/types.ts'

export const MAX_BODY_BYTES = 4 * 1024

export const ACTIONS = ['create', 'join', 'rejoin', 'settings', 'start', 'answer', 'remove', 'leave', 'play_again'] as const
export type Action = (typeof ACTIONS)[number]

/** The room columns the function reads (public data, the same rows clients get over Realtime). */
export interface RoomRow {
  status: 'lobby' | 'playing' | 'over'
  start_tier: string
  game_no: number
  round: number
  category_no: number | null
  turn_player_id: string | null
}

export interface RpcResult {
  data: unknown
  error: { code?: string } | null
}

export interface NetworkCap {
  limit: number
  /** A Postgres interval, e.g. '1 hour'. */
  window: string
}

export interface PartyDeps {
  allowedOrigins: readonly string[]
  dataset: readonly Pokemon[]
  /** Calls a public.party_* SQL function with the service role. */
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>
  getRoom(roomId: string): Promise<RoomRow | null>
  getCategory(roomId: string, gameNo: number, deckNo: number): Promise<Category | null>
  getUsedSpecies(roomId: string, gameNo: number, round: number): Promise<number[]>
  /** Players of the room with `gone_at` null. */
  countPresent(roomId: string): Promise<number>
  /** Salted daily hash of the caller's IP, or null when the request carries none (then no cap applies). */
  networkHash(): Promise<string | null>
  caps: { create: NetworkCap; join: NetworkCap }
  /** Random seed for a new deck. */
  randomSeed(): number
  /** Epoch milliseconds. */
  now(): number
}

export interface PartyRequest {
  method: string
  origin: string | null
  /** Declared Content-Length, if any. */
  contentLength: number
  bodyText: string
}

export interface PartyResult {
  status: number
  /** null for 204. */
  body: Record<string, unknown> | null
  /** Value for Access-Control-Allow-Origin, null when the origin isn't allowed. */
  allowOrigin: string | null
}

/** Suggested mapping from the SQL error codes (supabase/README.md "Party database") to HTTP statuses. */
export const ERROR_STATUS: Record<string, number> = {
  bad_token: 401,
  not_host: 403,
  not_your_turn: 403,
  no_room: 404,
  no_player: 404,
  not_lobby: 409,
  not_playing: 409,
  not_over: 409,
  room_full: 409,
  too_few_players: 409,
  already_used: 409,
  too_late: 409,
  bad_nickname: 400,
  bad_settings: 400,
  bad_deck: 400,
  bad_answer: 400,
}

// ---------------------------------------------------------------------------------------------------------------
// Validation

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[0-9a-f]{64}$/
const NICKNAME = /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/
const CODE = new RegExp(`^[${PARTY_CONFIG.roomCodeAlphabet}]{${PARTY_CONFIG.roomCodeLength}}$`)
const TIER_IDS: readonly string[] = PARTY_TIERS.map((t) => t.id)

type Fields = Record<string, unknown>
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const isRecord = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v)
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error })

/** Trims and collapses spaces (as SQL does), then enforces 1 to 12 letters, digits and single spaces. */
export function parseNickname(v: unknown): Parsed<string> {
  if (typeof v !== 'string') return bad('bad_nickname')
  const nick = v.trim().replace(/ +/g, ' ')
  if (nick.length < 1 || nick.length > 12 || !NICKNAME.test(nick)) return bad('bad_nickname')
  return { ok: true, value: nick }
}

/** Room code: 4 letters from the room code alphabet, case-insensitive. */
export function parseCode(v: unknown): Parsed<string> {
  if (typeof v !== 'string') return bad('bad_code')
  const code = v.trim().toUpperCase()
  return CODE.test(code) ? { ok: true, value: code } : bad('bad_code')
}

const parseUuid = (v: unknown, error: string): Parsed<string> =>
  typeof v === 'string' && UUID.test(v) ? { ok: true, value: v.toLowerCase() } : bad(error)

const parseToken = (v: unknown): Parsed<string> => (typeof v === 'string' && TOKEN.test(v) ? { ok: true, value: v } : bad('bad_token'))

function parseLives(v: unknown): Parsed<number> {
  return typeof v === 'number' && Number.isInteger(v) && v >= PARTY_CONFIG.livesMin && v <= PARTY_CONFIG.livesMax
    ? { ok: true, value: v }
    : bad('bad_settings')
}

function parseTier(v: unknown): Parsed<string> {
  return typeof v === 'string' && TIER_IDS.includes(v) ? { ok: true, value: v } : bad('bad_settings')
}

/** Reads several fields at once and reports the first failure. */
function collect<T extends Fields>(body: Fields, spec: { [K in keyof T]: (v: unknown) => Parsed<T[K]> }): Parsed<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(spec) as (keyof T & string)[]) {
    const r = spec[key](body[key])
    if (!r.ok) return r
    out[key] = r.value
  }
  return { ok: true, value: out as T }
}

const playerAuth = {
  room_id: (v: unknown) => parseUuid(v, 'bad_room'),
  player_id: (v: unknown) => parseUuid(v, 'bad_player'),
  token: parseToken,
}

// ---------------------------------------------------------------------------------------------------------------
// Handler

export async function handleParty(req: PartyRequest, deps: PartyDeps): Promise<PartyResult> {
  const origin = req.origin?.replace(/\/$/, '') ?? null
  if (!origin || !deps.allowedOrigins.includes(origin)) return { status: 403, body: { error: 'forbidden' }, allowOrigin: null }
  const reply = (status: number, body: Record<string, unknown> | null): PartyResult => ({ status, body, allowOrigin: origin })
  const fail = (error: string, extra: Fields = {}) =>
    reply(ERROR_STATUS[error] ?? statusFor(error), { ...extra, ok: false, error, server_time: deps.now() })

  if (req.method === 'OPTIONS') return reply(204, null)
  if (req.method !== 'POST') return fail('method_not_allowed')
  if (req.contentLength > MAX_BODY_BYTES || req.bodyText.length > MAX_BODY_BYTES) return fail('too_large')

  let body: unknown
  try {
    body = JSON.parse(req.bodyText)
  } catch {
    return fail('invalid_json')
  }
  if (!isRecord(body)) return fail('invalid_body')
  const action = body.action
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) return fail('unknown_action')

  // SQL results: pass through, adding the server clock; refusals map to a status.
  const finish = (res: RpcResult): PartyResult => {
    if (res.error) {
      // The code only: never the message, which could echo arguments (tokens).
      console.error('party sql failed', res.error.code ?? 'unknown')
      return reply(500, { ok: false, error: 'server_error', server_time: deps.now() })
    }
    const data = isRecord(res.data) ? res.data : null
    if (!data) {
      console.error('party sql returned no object')
      return reply(500, { ok: false, error: 'server_error', server_time: deps.now() })
    }
    if (data.ok !== true) {
      const { ok: _ok, error, ...rest } = data
      return fail(typeof error === 'string' ? error : 'server_error', rest)
    }
    return reply(200, { server_time: deps.now(), ...data })
  }

  const capped = async (kind: 'create' | 'join'): Promise<PartyResult | null> => {
    const hash = await deps.networkHash()
    if (!hash) return null
    const { limit, window } = deps.caps[kind]
    const res = await deps.rpc('party_network_hit', { p_ip_hash: hash, p_action: kind, p_limit: limit, p_window: window })
    if (res.error) throw new Error(`party_network_hit failed: ${res.error.code ?? 'unknown'}`)
    return res.data === true ? null : fail('rate_limited')
  }

  try {
    switch (action as Action) {
      case 'create': {
        const nick = parseNickname(body.nickname)
        if (!nick.ok) return fail(nick.error)
        const lives = body.lives === undefined ? { ok: true as const, value: PARTY_CONFIG.livesDefault } : parseLives(body.lives)
        if (!lives.ok) return fail(lives.error)
        const tier = body.start_tier === undefined ? { ok: true as const, value: 'easy' } : parseTier(body.start_tier)
        if (!tier.ok) return fail(tier.error)
        const limited = await capped('create')
        if (limited) return limited
        return finish(await deps.rpc('party_create', { p_nickname: nick.value, p_lives: lives.value, p_start_tier: tier.value }))
      }
      case 'join': {
        const f = collect<{ code: string; nickname: string }>(body, { code: parseCode, nickname: parseNickname })
        if (!f.ok) return fail(f.error)
        const limited = await capped('join')
        if (limited) return limited
        return finish(await deps.rpc('party_join', { p_code: f.value.code, p_nickname: f.value.nickname }))
      }
      case 'rejoin': {
        const f = collect<{ player_id: string; token: string }>(body, { player_id: playerAuth.player_id, token: playerAuth.token })
        if (!f.ok) return fail(f.error)
        return finish(await deps.rpc('party_rejoin', { p_player_id: f.value.player_id, p_token: f.value.token }))
      }
      case 'settings': {
        const f = collect<{ room_id: string; player_id: string; token: string; lives: number; start_tier: string }>(body, {
          ...playerAuth,
          lives: parseLives,
          start_tier: parseTier,
        })
        if (!f.ok) return fail(f.error)
        const v = f.value
        return finish(
          await deps.rpc('party_settings', {
            p_room_id: v.room_id,
            p_player_id: v.player_id,
            p_token: v.token,
            p_lives: v.lives,
            p_start_tier: v.start_tier,
          }),
        )
      }
      case 'start': {
        const f = collect<{ room_id: string; player_id: string; token: string }>(body, playerAuth)
        if (!f.ok) return fail(f.error)
        const v = f.value
        // Authenticate before the (CPU-heavy) deal, so a bad token can't make the function work.
        const who = await deps.rpc('party_rejoin', { p_player_id: v.player_id, p_token: v.token })
        if (who.error) return finish(who)
        if (!isRecord(who.data) || who.data.ok !== true || who.data.room_id !== v.room_id) return fail('bad_token')
        const room = await deps.getRoom(v.room_id)
        if (!room) return fail('no_room')
        const present = Math.min(PARTY_CONFIG.maxPlayers, Math.max(PARTY_CONFIG.minPlayers, await deps.countPresent(v.room_id)))
        const tier = TIER_IDS.includes(room.start_tier) ? (room.start_tier as (typeof PARTY_TIERS)[number]['id']) : 'easy'
        const deck = dealDeck(deps.randomSeed(), present, deps.dataset, { startTier: tier }).map((e) => ({
          parts: e.category,
          tier: e.tier,
          pool: e.pool,
          seconds: PARTY_TIERS.find((t) => t.id === e.tier)?.seconds ?? 20,
        }))
        return finish(await deps.rpc('party_start', { p_room_id: v.room_id, p_player_id: v.player_id, p_token: v.token, p_deck: deck }))
      }
      case 'answer': {
        const f = collect<{ room_id: string; player_id: string; token: string; pokemon_id: number }>(body, {
          ...playerAuth,
          pokemon_id: (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? { ok: true, value: v } : bad('bad_answer')),
        })
        if (!f.ok) return fail(f.error)
        const v = f.value
        const pokemon = deps.dataset.find((p) => p.id === v.pokemon_id)
        if (!pokemon) return fail('bad_answer')
        const room = await deps.getRoom(v.room_id)
        if (!room) return fail('no_room')
        if (room.status !== 'playing') return fail('not_playing')
        // Not your turn: refuse without touching anything (SQL also checks the token and the turn).
        if (room.turn_player_id !== v.player_id) return fail('not_your_turn')
        const category = room.category_no === null ? null : await deps.getCategory(v.room_id, room.game_no, room.category_no)
        if (!category) return fail('not_playing')
        const used = new Set(await deps.getUsedSpecies(v.room_id, room.game_no, room.round))
        const check = checkAnswer(category, pokemon, used)
        if (!check.ok) {
          // A wrong answer costs time, not a life: reply, write nothing.
          return reply(200, {
            ok: false,
            error: 'wrong_answer',
            why: check.why,
            reason: check.reason,
            ...(check.why === 'part' ? { part: check.part } : {}),
            server_time: deps.now(),
          })
        }
        const exhausted = speciesLeft(category, deps.dataset, new Set([...used, pokemon.dexNumber])) === 0
        return finish(
          await deps.rpc('party_apply_answer', {
            p_room_id: v.room_id,
            p_player_id: v.player_id,
            p_token: v.token,
            p_pokemon_id: pokemon.id,
            p_species: pokemon.dexNumber,
            p_pool_exhausted: exhausted,
          }),
        )
      }
      case 'remove': {
        const f = collect<{ room_id: string; player_id: string; token: string; target_id: string }>(body, {
          ...playerAuth,
          target_id: (v) => parseUuid(v, 'bad_target'),
        })
        if (!f.ok) return fail(f.error)
        const v = f.value
        return finish(
          await deps.rpc('party_remove', { p_room_id: v.room_id, p_player_id: v.player_id, p_token: v.token, p_target_id: v.target_id }),
        )
      }
      case 'leave':
      case 'play_again': {
        const f = collect<{ room_id: string; player_id: string; token: string }>(body, playerAuth)
        if (!f.ok) return fail(f.error)
        const v = f.value
        const fn = action === 'leave' ? 'party_leave' : 'party_play_again'
        return finish(await deps.rpc(fn, { p_room_id: v.room_id, p_player_id: v.player_id, p_token: v.token }))
      }
    }
  } catch (err) {
    console.error('party failed', err instanceof Error ? err.message : 'unknown')
    return reply(500, { ok: false, error: 'server_error', server_time: deps.now() })
  }
}

/** Statuses for the function's own errors (the SQL ones are in ERROR_STATUS). */
function statusFor(error: string): number {
  switch (error) {
    case 'method_not_allowed':
      return 405
    case 'too_large':
      return 413
    case 'rate_limited':
      return 429
    case 'server_error':
      return 500
    default:
      return 400 // invalid_json, invalid_body, unknown_action, bad_code, bad_room, bad_player, bad_target, ...
  }
}
