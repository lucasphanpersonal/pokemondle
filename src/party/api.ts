import type { TierId } from '../config/partyConfig.ts'
import type { ClockSample } from './clock.ts'
import type { Part } from '../lib/party/types.ts'
import type { RoomStatus } from './state.ts'

/**
 * Typed wrappers for the party server: the `party` Edge Function (POST ${VITE_SUPABASE_URL}/functions/v1/party, one
 * call per action) and the two database functions browsers may call directly (party_timeout, party_heartbeat, through
 * supabase-js). Nothing here imports supabase-js at runtime; the client is passed in. See supabase/README.md,
 * "Party Edge Function" and "Party database".
 */

export interface PartyEnv {
  url: string
  key: string
}

/** The public project URL and publishable key from the build; null when either is empty (Party is unavailable). */
export function readPartyEnv(env: Record<string, unknown> = import.meta.env): PartyEnv | null {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim().replace(/\/+$/, '') : ''
  const key = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : ''
  return url && key ? { url, key } : null
}

// ----------------------------------------------------------------------------------------------- results ----

/** Every Edge Function reply carries the server's clock. */
export type ApiOk<T> = { ok: true; server_time: number } & T
export interface ApiError {
  ok: false
  /** The server's code (`not_your_turn`, `wrong_answer`, ...), or `network` when it couldn't be reached. */
  error: string
  /** HTTP status; 0 for `network`. */
  status: number
  server_time?: number
  /** wrong_answer: why, and the sentence to show ("Squirtle isn't a Fire type"). */
  why?: 'part' | 'used'
  reason?: string
  part?: Part
  [extra: string]: unknown
}
export type ApiResult<T> = ApiOk<T> | ApiError

export interface JoinedReply {
  room_id: string
  code: string
  player_id: string
  /** Only create and join return it: store it. */
  token: string
  nickname: string
  icon: number
  status: RoomStatus
}
export type RejoinedReply = Omit<JoinedReply, 'token'>

export interface Auth {
  room_id: string
  player_id: string
  token: string
}

export interface AnswerReply {
  result: 'passed' | 'cleared'
  round: number
  turn_player_id: string
  deadline: string
  turn_no: number
}

export interface PartyApi {
  create(p: { nickname: string; lives?: number; start_tier?: TierId }): Promise<ApiResult<JoinedReply>>
  join(p: { code: string; nickname: string }): Promise<ApiResult<JoinedReply>>
  rejoin(p: { player_id: string; token: string }): Promise<ApiResult<RejoinedReply>>
  settings(a: Auth, p: { lives: number; start_tier: TierId }): Promise<ApiResult<object>>
  start(a: Auth): Promise<ApiResult<{ game_no: number; players: number }>>
  answer(a: Auth, pokemonId: number): Promise<ApiResult<AnswerReply>>
  remove(a: Auth, targetId: string): Promise<ApiResult<object>>
  leave(a: Auth): Promise<ApiResult<object>>
  playAgain(a: Auth): Promise<ApiResult<object>>
}

export interface ApiOptions {
  /** The project URL (no trailing slash). */
  url: string
  fetch?: typeof fetch
  now?: () => number
  /** Called with every reply's server_time, for the clock offset. */
  onClockSample?: (sample: ClockSample) => void
}

/** Wording for the codes a player can run into. Falls back to a generic line. */
export function friendlyError(error: string): string {
  switch (error) {
    case 'network':
      return "Can't reach the party server right now."
    case 'rate_limited':
      return 'Too many tries from this network. Wait a bit and try again.'
    case 'bad_nickname':
      return 'Nicknames are 1 to 12 letters or numbers.'
    case 'bad_code':
    case 'no_room':
      return "That room doesn't exist. Check the code."
    case 'room_full':
      return 'That room is full (8 players).'
    case 'too_few_players':
      return 'You need at least 2 players to start.'
    case 'not_lobby':
      return 'The game has already started.'
    case 'not_host':
      return 'Only the host can do that.'
    case 'not_your_turn':
      return "It's not your turn."
    case 'too_late':
      return 'Too late!'
    case 'already_used':
      return 'Someone just said that one.'
    case 'bad_token':
      return 'You are no longer in this room.'
    default:
      return 'Something went wrong. Try again.'
  }
}

export function createPartyApi(opts: ApiOptions): PartyApi {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const now = opts.now ?? Date.now
  const endpoint = `${opts.url.replace(/\/+$/, '')}/functions/v1/party`

  async function call<T>(action: string, body: Record<string, unknown>): Promise<ApiResult<T>> {
    const sentAt = now()
    let res: Response
    try {
      // text/plain is accepted by the function and keeps this a "simple" request (no CORS preflight round trip).
      res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action, ...body }),
        cache: 'no-store',
      })
    } catch {
      return { ok: false, error: 'network', status: 0 }
    }
    const receivedAt = now()
    let data: unknown
    try {
      data = await res.json()
    } catch {
      return { ok: false, error: res.ok ? 'bad_reply' : 'server_error', status: res.status }
    }
    if (typeof data !== 'object' || data === null) return { ok: false, error: 'bad_reply', status: res.status }
    const r = data as Record<string, unknown>
    if (typeof r.server_time === 'number') opts.onClockSample?.({ sentAt, receivedAt, serverTime: r.server_time })
    if (res.ok && r.ok === true) return r as ApiOk<T>
    return { ...r, ok: false, error: typeof r.error === 'string' ? r.error : 'server_error', status: res.status } as ApiError
  }

  const auth = (a: Auth) => ({ room_id: a.room_id, player_id: a.player_id, token: a.token })
  return {
    create: (p) => call('create', p),
    join: (p) => call('join', p),
    rejoin: (p) => call('rejoin', p),
    settings: (a, p) => call('settings', { ...auth(a), ...p }),
    start: (a) => call('start', auth(a)),
    answer: (a, pokemonId) => call('answer', { ...auth(a), pokemon_id: pokemonId }),
    remove: (a, targetId) => call('remove', { ...auth(a), target_id: targetId }),
    leave: (a) => call('leave', auth(a)),
    playAgain: (a) => call('play_again', auth(a)),
  }
}

// ------------------------------------------------------------------------------- direct database calls ----

/** The one supabase-js method the RPC wrappers use (so tests can pass a fake). */
export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export type HeartbeatResult =
  | { ok: true; server_time: number; present: boolean }
  | { ok: false; error: string }

export type TimeoutResult = { ok: true; acted: boolean } | { ok: false; error: string }

export interface PartyRpc {
  heartbeat(playerId: string, token: string): Promise<HeartbeatResult>
  /** Ends the turn if the server's clock says time is up; `acted: false` is normal (grace not over, or someone was first). */
  timeout(roomId: string, turnNo: number): Promise<TimeoutResult>
}

export function createPartyRpc(
  client: RpcClient,
  opts: { now?: () => number; onClockSample?: (sample: ClockSample) => void } = {},
): PartyRpc {
  const now = opts.now ?? Date.now
  const run = async (name: string, args: Record<string, unknown>) => {
    const sentAt = now()
    try {
      const { data, error } = await client.rpc(name, args)
      const receivedAt = now()
      if (error || typeof data !== 'object' || data === null) return { ok: false as const, error: 'network' }
      const r = data as Record<string, unknown>
      if (typeof r.server_time === 'number') opts.onClockSample?.({ sentAt, receivedAt, serverTime: r.server_time })
      return { ...r, ok: r.ok === true }
    } catch {
      return { ok: false as const, error: 'network' }
    }
  }
  return {
    async heartbeat(playerId, token) {
      const r = await run('party_heartbeat', { p_player_id: playerId, p_token: token })
      if (!r.ok) return { ok: false, error: String((r as Record<string, unknown>).error ?? 'network') }
      return { ok: true, server_time: Number((r as Record<string, unknown>).server_time), present: (r as Record<string, unknown>).present !== false }
    },
    async timeout(roomId, turnNo) {
      const r = await run('party_timeout', { p_room_id: roomId, p_turn_no: turnNo })
      if (!r.ok) return { ok: false, error: String((r as Record<string, unknown>).error ?? 'network') }
      return { ok: true, acted: (r as Record<string, unknown>).acted === true }
    },
  }
}
