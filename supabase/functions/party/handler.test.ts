import { describe, expect, it } from 'vitest'
import dataset from '../_shared/party/pokemon.json' with { type: 'json' }
import type { Pokemon } from '../_shared/party/pokemon.ts'
import type { Category } from '../_shared/party/types.ts'
import { handleParty, type PartyDeps, type PartyResult, type RoomRow, type RpcResult } from './handler.ts'

const POKEMON = dataset as unknown as Pokemon[]
const byName = (name: string) => POKEMON.find((p) => p.name === name)!

const ORIGIN = 'https://pokemondle.io'
const ROOM = '11111111-1111-4111-8111-111111111111'
const ME = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const TOKEN = 'ab'.repeat(32)

interface Call {
  fn: string
  args: Record<string, unknown>
}

interface Fake {
  deps: PartyDeps
  calls: Call[]
  state: { room: RoomRow | null; category: Category | null; used: number[]; players: number; hash: string | null; allowHit: boolean }
  /** Queue of replies for the next SQL calls (default: {ok:true}). */
  replies: RpcResult[]
  /** How many times the answer context was read. */
  reads: () => number
}

function fake(): Fake {
  const calls: Call[] = []
  const replies: RpcResult[] = []
  let contextReads = 0
  const state: Fake['state'] = {
    room: { status: 'playing', start_tier: 'easy', game_no: 1, round: 1, category_no: 1, turn_player_id: ME },
    category: [{ kind: 'type', value: 'Fire' }],
    used: [],
    players: 3,
    hash: 'f'.repeat(64),
    allowHit: true,
  }
  const deps: PartyDeps = {
    allowedOrigins: [ORIGIN],
    dataset: POKEMON,
    rpc: async (fn, args) => {
      calls.push({ fn, args })
      if (fn === 'party_network_hit') return { data: state.allowHit, error: null }
      return replies.shift() ?? { data: { ok: true }, error: null }
    },
    getRoom: async () => state.room,
    getAnswerContext: async () => {
      contextReads++
      const r = state.room
      if (!r) return null
      const { status, game_no, round, category_no, turn_player_id } = r
      return { status, game_no, round, category_no, turn_player_id, parts: category_no === null ? null : state.category, used: state.used }
    },
    countPresent: async () => state.players,
    networkHash: async () => state.hash,
    caps: { create: { limit: 2, window: '1 hour' }, join: { limit: 5, window: '1 hour' } },
    randomSeed: () => 42,
    now: () => 1_700_000_000_000,
  }
  return { deps, calls, state, replies, reads: () => contextReads }
}

const post = (body: unknown, origin: string | null = ORIGIN) => ({
  method: 'POST',
  origin,
  contentLength: 0,
  bodyText: typeof body === 'string' ? body : JSON.stringify(body),
})

const ok = (data: Record<string, unknown>): RpcResult => ({ data: { ok: true, ...data }, error: null })
const refuse = (error: string, extra: Record<string, unknown> = {}): RpcResult => ({ data: { ok: false, error, ...extra }, error: null })

const auth = { room_id: ROOM, player_id: ME, token: TOKEN }
const sqlCalls = (f: Fake) => f.calls.filter((c) => c.fn !== 'party_network_hit')

async function run(f: Fake, body: unknown, origin: string | null = ORIGIN): Promise<PartyResult> {
  return handleParty(post(body, origin), f.deps)
}

describe('origin, method and body', () => {
  it('refuses a missing or unknown origin before anything else', async () => {
    for (const origin of [null, 'https://evil.example']) {
      const f = fake()
      const r = await run(f, { action: 'create', nickname: 'Ash' }, origin)
      expect(r.status).toBe(403)
      expect(r.allowOrigin).toBeNull()
      expect(f.calls).toHaveLength(0)
    }
  })

  it('accepts a trailing slash on the origin and answers the preflight', async () => {
    const f = fake()
    const r = await handleParty({ method: 'OPTIONS', origin: `${ORIGIN}/`, contentLength: 0, bodyText: '' }, f.deps)
    expect(r).toMatchObject({ status: 204, body: null, allowOrigin: ORIGIN })
  })

  it('refuses other methods, oversize bodies, bad JSON, non-objects and unknown actions', async () => {
    const f = fake()
    expect((await handleParty({ ...post({}), method: 'GET' }, f.deps)).status).toBe(405)
    expect((await handleParty({ ...post({ action: 'create' }), contentLength: 999_999 }, f.deps)).status).toBe(413)
    expect((await run(f, '{nope')).body).toMatchObject({ error: 'invalid_json' })
    expect((await run(f, '[1]')).body).toMatchObject({ error: 'invalid_body' })
    expect((await run(f, { action: 'drop_tables' })).body).toMatchObject({ error: 'unknown_action' })
    expect((await run(f, { nickname: 'Ash' })).status).toBe(400)
    expect(f.calls).toHaveLength(0)
  })

  it('puts server_time on every reply', async () => {
    const f = fake()
    expect((await run(f, { action: 'nope' })).body?.server_time).toBe(1_700_000_000_000)
    f.replies.push(ok({ result: 'passed' }))
    expect((await run(f, { action: 'leave', ...auth })).body?.server_time).toBe(1_700_000_000_000)
  })
})

describe('nickname and code rules', () => {
  it.each(['', '   ', 'thirteen chars', 'Ash!', 'Ash_K', 'Pokémon', 'a'.repeat(13), 5, null])('refuses nickname %j', async (nickname) => {
    const f = fake()
    const r = await run(f, { action: 'create', nickname })
    expect(r).toMatchObject({ status: 400, body: { ok: false, error: 'bad_nickname' } })
    expect(f.calls).toHaveLength(0)
  })

  it('trims and collapses spaces before calling SQL', async () => {
    const f = fake()
    f.replies.push(ok({ code: 'BCDF' }))
    await run(f, { action: 'create', nickname: '  Ash   Ketchum ' })
    expect(sqlCalls(f)[0]).toEqual({ fn: 'party_create', args: { p_nickname: 'Ash Ketchum', p_lives: 3, p_start_tier: 'easy' } })
  })

  it.each(['ABC', 'ABCDE', 'AEIO', 'BCDL', 'BC1D', '', 7, null])('refuses room code %j', async (code) => {
    const f = fake()
    const r = await run(f, { action: 'join', code, nickname: 'Ash' })
    expect(r).toMatchObject({ status: 400, body: { error: 'bad_code' } })
    expect(f.calls).toHaveLength(0)
  })

  it('upper-cases a lowercase code', async () => {
    const f = fake()
    await run(f, { action: 'join', code: ' bcdf ', nickname: 'Ash' })
    expect(sqlCalls(f)[0]).toEqual({ fn: 'party_join', args: { p_code: 'BCDF', p_nickname: 'Ash' } })
  })

  it('validates lives and starting tier on create and settings', async () => {
    const f = fake()
    for (const lives of [0, 6, 2.5, '3']) {
      expect((await run(f, { action: 'create', nickname: 'Ash', lives })).body).toMatchObject({ error: 'bad_settings' })
    }
    expect((await run(f, { action: 'create', nickname: 'Ash', start_tier: 'insane' })).body).toMatchObject({ error: 'bad_settings' })
    expect((await run(f, { action: 'settings', ...auth, lives: 3 })).body).toMatchObject({ error: 'bad_settings' })
    expect(f.calls).toHaveLength(0)
    await run(f, { action: 'settings', ...auth, lives: 5, start_tier: 'hard' })
    expect(sqlCalls(f)[0]).toEqual({
      fn: 'party_settings',
      args: { p_room_id: ROOM, p_player_id: ME, p_token: TOKEN, p_lives: 5, p_start_tier: 'hard' },
    })
  })
})

describe('ids and tokens', () => {
  it('refuses malformed room, player, target ids and tokens without calling SQL', async () => {
    const f = fake()
    expect((await run(f, { action: 'leave', ...auth, room_id: 'nope' })).body).toMatchObject({ error: 'bad_room' })
    expect((await run(f, { action: 'leave', ...auth, player_id: 5 })).body).toMatchObject({ error: 'bad_player' })
    expect((await run(f, { action: 'remove', ...auth, target_id: 'x' })).body).toMatchObject({ error: 'bad_target' })
    const r = await run(f, { action: 'leave', ...auth, token: 'short' })
    expect(r).toMatchObject({ status: 401, body: { error: 'bad_token' } })
    expect(f.calls).toHaveLength(0)
  })

  it('passes the raw token straight through and never echoes it back', async () => {
    const f = fake()
    f.replies.push(ok({}))
    const r = await run(f, { action: 'leave', ...auth })
    expect(sqlCalls(f)[0].args.p_token).toBe(TOKEN)
    expect(JSON.stringify(r.body)).not.toContain(TOKEN)
  })

  it('sends rejoin, remove, leave and play_again to their functions', async () => {
    const f = fake()
    await run(f, { action: 'rejoin', player_id: ME, token: TOKEN })
    await run(f, { action: 'remove', ...auth, target_id: OTHER })
    await run(f, { action: 'leave', ...auth })
    await run(f, { action: 'play_again', ...auth })
    expect(sqlCalls(f).map((c) => c.fn)).toEqual(['party_rejoin', 'party_remove', 'party_leave', 'party_play_again'])
    expect(sqlCalls(f)[1].args).toMatchObject({ p_target_id: OTHER })
  })
})

describe('network caps', () => {
  it('create and join call party_network_hit with the hash and their own cap', async () => {
    const f = fake()
    await run(f, { action: 'create', nickname: 'Ash' })
    await run(f, { action: 'join', code: 'BCDF', nickname: 'Ash' })
    expect(f.calls.filter((c) => c.fn === 'party_network_hit').map((c) => c.args)).toEqual([
      { p_ip_hash: 'f'.repeat(64), p_action: 'create', p_limit: 2, p_window: '1 hour' },
      { p_ip_hash: 'f'.repeat(64), p_action: 'join', p_limit: 5, p_window: '1 hour' },
    ])
  })

  it('answers 429 and does not create or join when over the cap', async () => {
    const f = fake()
    f.state.allowHit = false
    for (const body of [
      { action: 'create', nickname: 'Ash' },
      { action: 'join', code: 'BCDF', nickname: 'Ash' },
    ]) {
      expect(await run(f, body)).toMatchObject({ status: 429, body: { ok: false, error: 'rate_limited' } })
    }
    expect(sqlCalls(f)).toHaveLength(0)
  })

  it('skips the cap when the request carries no IP', async () => {
    const f = fake()
    f.state.hash = null
    await run(f, { action: 'create', nickname: 'Ash' })
    expect(f.calls.map((c) => c.fn)).toEqual(['party_create'])
  })

  it('does not cap other actions', async () => {
    const f = fake()
    await run(f, { action: 'leave', ...auth })
    expect(f.calls.map((c) => c.fn)).toEqual(['party_leave'])
  })
})

describe('SQL results', () => {
  it('passes a success through with the server clock', async () => {
    const f = fake()
    f.replies.push(ok({ room_id: ROOM, code: 'BCDF', player_id: ME, token: TOKEN }))
    const r = await run(f, { action: 'create', nickname: 'Ash' })
    expect(r).toMatchObject({ status: 200, body: { ok: true, code: 'BCDF', token: TOKEN, server_time: 1_700_000_000_000 } })
  })

  it.each([
    ['bad_token', 401],
    ['not_host', 403],
    ['not_your_turn', 403],
    ['no_room', 404],
    ['no_player', 404],
    ['not_lobby', 409],
    ['not_playing', 409],
    ['not_over', 409],
    ['room_full', 409],
    ['too_few_players', 409],
    ['already_used', 409],
    ['too_late', 409],
    ['bad_nickname', 400],
    ['bad_settings', 400],
    ['bad_deck', 400],
    ['bad_answer', 400],
  ])('maps %s to %i', async (code, status) => {
    const f = fake()
    f.replies.push(refuse(code))
    const r = await run(f, { action: 'leave', ...auth })
    expect(r).toMatchObject({ status, body: { ok: false, error: code } })
  })

  it('a thrown SQL error is a 500 that leaks nothing', async () => {
    const f = fake()
    f.replies.push({ data: null, error: { code: '42501' } })
    const r = await run(f, { action: 'leave', ...auth })
    expect(r).toMatchObject({ status: 500, body: { ok: false, error: 'server_error' } })
    const throwing = fake()
    throwing.deps.rpc = () => Promise.reject(new Error('boom'))
    expect((await run(throwing, { action: 'leave', ...auth })).status).toBe(500)
  })
})

describe('start', () => {
  it('deals a deck for the present players and the room start tier, then calls party_start', async () => {
    const f = fake()
    f.state.room = { status: 'lobby', start_tier: 'hard', game_no: 0, round: 0, category_no: null, turn_player_id: null }
    f.state.players = 4
    f.replies.push(ok({ room_id: ROOM })) // party_rejoin
    f.replies.push(ok({ game_no: 1, players: 4 }))
    const r = await run(f, { action: 'start', ...auth })
    expect(r).toMatchObject({ status: 200, body: { ok: true, game_no: 1 } })
    const [who, start] = sqlCalls(f)
    expect(who.fn).toBe('party_rejoin')
    expect(start.fn).toBe('party_start')
    const deck = start.args.p_deck as { parts: unknown[]; tier: string; pool: number; seconds: number }[]
    expect(deck).toHaveLength(60) // PARTY_CONFIG.deckSize; party_start takes 1 to 200
    expect(deck[0].tier).toBe('hard')
    expect(deck[0].seconds).toBe(14)
    expect(deck.every((e) => e.parts.length >= 1 && e.pool >= 6 && e.seconds >= 3)).toBe(true)
    expect(start.args).toMatchObject({ p_room_id: ROOM, p_player_id: ME, p_token: TOKEN })
  })

  it('refuses a bad token before dealing, and a token for another room', async () => {
    const f = fake()
    f.replies.push(refuse('bad_token'))
    expect((await run(f, { action: 'start', ...auth })).status).toBe(401)
    f.replies.push(ok({ room_id: OTHER }))
    expect((await run(f, { action: 'start', ...auth })).status).toBe(401)
    expect(sqlCalls(f).every((c) => c.fn === 'party_rejoin')).toBe(true)
  })

  it('404s an unknown room', async () => {
    const f = fake()
    f.state.room = null
    f.replies.push(ok({ room_id: ROOM }))
    expect((await run(f, { action: 'start', ...auth })).status).toBe(404)
  })
})

describe('answer', () => {
  it('refuses a malformed or unknown Pokémon id', async () => {
    const f = fake()
    for (const pokemon_id of ['25', 0, -1, 1.5, null, 99_999_999]) {
      const r = await run(f, { action: 'answer', ...auth, pokemon_id })
      expect(r).toMatchObject({ status: 400, body: { error: 'bad_answer' } })
    }
    expect(f.calls).toHaveLength(0)
  })

  it('refuses when it is not your turn, without writing', async () => {
    const f = fake()
    f.state.room!.turn_player_id = OTHER
    const r = await run(f, { action: 'answer', ...auth, pokemon_id: byName('Charmander').id })
    expect(r).toMatchObject({ status: 403, body: { ok: false, error: 'not_your_turn' } })
    expect(f.calls).toHaveLength(0)
  })

  it('refuses when no game is running or the room is missing', async () => {
    const f = fake()
    f.state.room!.status = 'lobby'
    expect((await run(f, { action: 'answer', ...auth, pokemon_id: 4 })).body).toMatchObject({ error: 'not_playing' })
    f.state.room = null
    expect((await run(f, { action: 'answer', ...auth, pokemon_id: 4 })).status).toBe(404)
  })

  it('a wrong part answers 200 with the reason and part, and makes no SQL call', async () => {
    const f = fake()
    const r = await run(f, { action: 'answer', ...auth, pokemon_id: byName('Squirtle').id })
    expect(r).toMatchObject({
      status: 200,
      body: { ok: false, error: 'wrong_answer', why: 'part', reason: "Squirtle isn't a Fire type", part: { kind: 'type', value: 'Fire' } },
    })
    expect(f.calls).toHaveLength(0)
  })

  it('an already used species answers 200 with why: used, and makes no SQL call', async () => {
    const f = fake()
    const charmander = byName('Charmander')
    f.state.used = [charmander.dexNumber]
    const r = await run(f, { action: 'answer', ...auth, pokemon_id: charmander.id })
    expect(r).toMatchObject({ status: 200, body: { ok: false, error: 'wrong_answer', why: 'used', reason: 'Charmander was already said' } })
    expect(r.body).not.toHaveProperty('part')
    expect(f.calls).toHaveLength(0)
  })

  it('a valid answer calls party_apply_answer with the species and returns its result', async () => {
    const f = fake()
    const charmander = byName('Charmander')
    f.replies.push(ok({ result: 'passed', round: 1, turn_player_id: OTHER, deadline: '2026-11-27T12:00:20Z', turn_no: 3 }))
    const r = await run(f, { action: 'answer', ...auth, pokemon_id: charmander.id })
    expect(r).toMatchObject({ status: 200, body: { ok: true, result: 'passed', turn_no: 3, server_time: 1_700_000_000_000 } })
    expect(sqlCalls(f)).toEqual([
      {
        fn: 'party_apply_answer',
        args: {
          p_room_id: ROOM,
          p_player_id: ME,
          p_token: TOKEN,
          p_pokemon_id: charmander.id,
          p_species: charmander.dexNumber,
          p_pool_exhausted: false,
        },
      },
    ])
  })

  it('checks an answer with one read and one write, and passes the returned rows through', async () => {
    const f = fake()
    const room = { id: ROOM, turn_no: 3, last_activity: '2026-11-27T12:00:00Z' }
    const answer = { id: 7, room_id: ROOM, player_id: ME, pokemon_id: 4, species: 4 }
    f.replies.push(ok({ result: 'passed', round: 1, turn_player_id: OTHER, deadline: '2026-11-27T12:00:20Z', turn_no: 3, room, answer }))
    const r = await run(f, { action: 'answer', ...auth, pokemon_id: byName('Charmander').id })
    expect(f.reads()).toBe(1)
    expect(sqlCalls(f)).toHaveLength(1)
    expect(r.body).toMatchObject({ ok: true, room, answer })
  })

  it('a wrong answer costs one read and no write', async () => {
    const f = fake()
    await run(f, { action: 'answer', ...auth, pokemon_id: byName('Squirtle').id })
    expect(f.reads()).toBe(1)
    expect(f.calls).toHaveLength(0)
  })

  it('sets p_pool_exhausted when this answer uses up the last species', async () => {
    const f = fake()
    f.state.category = [{ kind: 'form', value: 'gmax' }, { kind: 'type', value: 'Fire' }]
    const fits = POKEMON.filter((p) => p.formCategory === 'gmax' && (p.type1 === 'Fire' || p.type2 === 'Fire'))
    expect(fits.length).toBeGreaterThan(1)
    const last = fits[fits.length - 1]
    f.state.used = [...new Set(fits.map((p) => p.dexNumber))].filter((d) => d !== last.dexNumber)
    await run(f, { action: 'answer', ...auth, pokemon_id: last.id })
    expect(sqlCalls(f)[0].args.p_pool_exhausted).toBe(true)
  })

  it('passes too_late through as a 409 with the timeout the SQL applied', async () => {
    const f = fake()
    f.replies.push(refuse('too_late', { timeout: { ok: true, acted: true, kind: 'timeout', lives: 2 } }))
    const r = await run(f, { action: 'answer', ...auth, pokemon_id: byName('Charmander').id })
    expect(r).toMatchObject({ status: 409, body: { ok: false, error: 'too_late', timeout: { lives: 2 }, server_time: 1_700_000_000_000 } })
  })

  it('passes a SQL already_used race through as a 409', async () => {
    const f = fake()
    f.replies.push(refuse('already_used'))
    const r = await run(f, { action: 'answer', ...auth, pokemon_id: byName('Charmander').id })
    expect(r.status).toBe(409)
  })
})
