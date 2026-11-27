import { describe, expect, it } from 'vitest'
import { createPartyApi, createPartyRpc, friendlyError, readPartyEnv, type RpcClient } from './api.ts'
import type { ClockSample } from './clock.ts'

const URL_ = 'https://x.supabase.co'
const auth = { room_id: 'r', player_id: 'p', token: 't' }

function fakeFetch(reply: (body: Record<string, unknown>) => { status?: number; json: unknown } | 'throw' | 'badjson') {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = []
  const f = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    calls.push({ url, init, body })
    const r = reply(body)
    if (r === 'throw') throw new TypeError('offline')
    if (r === 'badjson') return new Response('<html>', { status: 502 })
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 })
  }) as unknown as typeof fetch
  return { f, calls }
}

describe('readPartyEnv', () => {
  it('is null when the URL or the key is empty or missing', () => {
    expect(readPartyEnv({})).toBeNull()
    expect(readPartyEnv({ VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: '' })).toBeNull()
    expect(readPartyEnv({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull()
    expect(readPartyEnv({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull()
  })
  it('returns both, without a trailing slash', () => {
    expect(readPartyEnv({ VITE_SUPABASE_URL: `${URL_}/`, VITE_SUPABASE_ANON_KEY: ' k ' })).toEqual({ url: URL_, key: 'k' })
  })
})

describe('createPartyApi', () => {
  it('posts each action to the party function with the auth fields', async () => {
    const { f, calls } = fakeFetch(() => ({ json: { ok: true, server_time: 1 } }))
    const api = createPartyApi({ url: `${URL_}/`, fetch: f })
    await api.create({ nickname: 'Ash', lives: 4, start_tier: 'hard' })
    await api.join({ code: 'KPZW', nickname: 'Misty' })
    await api.rejoin({ player_id: 'p', token: 't' })
    await api.settings(auth, { lives: 2, start_tier: 'easy' })
    await api.start(auth)
    await api.answer(auth, 25)
    await api.remove(auth, 'x')
    await api.leave(auth)
    await api.playAgain(auth)
    expect(calls.every((c) => c.url === `${URL_}/functions/v1/party` && c.init.method === 'POST')).toBe(true)
    expect(calls.map((c) => c.body)).toEqual([
      { action: 'create', nickname: 'Ash', lives: 4, start_tier: 'hard' },
      { action: 'join', code: 'KPZW', nickname: 'Misty' },
      { action: 'rejoin', player_id: 'p', token: 't' },
      { action: 'settings', ...auth, lives: 2, start_tier: 'easy' },
      { action: 'start', ...auth },
      { action: 'answer', ...auth, pokemon_id: 25 },
      { action: 'remove', ...auth, target_id: 'x' },
      { action: 'leave', ...auth },
      { action: 'play_again', ...auth },
    ])
  })

  it('returns success replies as they are and reports the clock sample', async () => {
    const samples: ClockSample[] = []
    let t = 1000
    const { f } = fakeFetch(() => {
      t += 120
      return { json: { ok: true, server_time: 9000, room_id: 'r' } }
    })
    const api = createPartyApi({ url: URL_, fetch: f, now: () => t, onClockSample: (s) => samples.push(s) })
    const res = await api.rejoin({ player_id: 'p', token: 't' })
    expect(res).toMatchObject({ ok: true, room_id: 'r' })
    expect(samples).toEqual([{ sentAt: 1000, receivedAt: 1120, serverTime: 9000 }])
  })

  it('turns refusals into typed errors with the status', async () => {
    const { f } = fakeFetch(() => ({ status: 403, json: { ok: false, error: 'not_your_turn', server_time: 5 } }))
    const res = await createPartyApi({ url: URL_, fetch: f }).answer(auth, 1)
    expect(res).toMatchObject({ ok: false, error: 'not_your_turn', status: 403 })
  })

  it('passes a wrong answer through with its reason (HTTP 200, ok false)', async () => {
    const { f } = fakeFetch(() => ({ json: { ok: false, error: 'wrong_answer', why: 'part', reason: "Squirtle isn't a Fire type", server_time: 5 } }))
    const res = await createPartyApi({ url: URL_, fetch: f }).answer(auth, 7)
    expect(res).toMatchObject({ ok: false, error: 'wrong_answer', why: 'part', reason: "Squirtle isn't a Fire type", status: 200 })
  })

  it('maps a dropped connection and a non-JSON reply to errors, never throwing', async () => {
    expect(await createPartyApi({ url: URL_, fetch: fakeFetch(() => 'throw').f }).start(auth)).toEqual({ ok: false, error: 'network', status: 0 })
    expect(await createPartyApi({ url: URL_, fetch: fakeFetch(() => 'badjson').f }).start(auth)).toMatchObject({ ok: false, error: 'server_error', status: 502 })
  })
})

describe('createPartyRpc', () => {
  const rpcClient = (data: unknown, error: { message: string } | null = null) => {
    const calls: { name: string; args: Record<string, unknown> }[] = []
    const client: RpcClient = {
      rpc: async (name, args) => {
        calls.push({ name, args })
        return { data, error }
      },
    }
    return { client, calls }
  }

  it('calls party_heartbeat and returns the server clock sample', async () => {
    const { client, calls } = rpcClient({ ok: true, server_time: 777, present: true })
    const samples: ClockSample[] = []
    let t = 0
    const rpc = createPartyRpc(client, { now: () => (t += 50), onClockSample: (s) => samples.push(s) })
    expect(await rpc.heartbeat('p', 'tok')).toEqual({ ok: true, server_time: 777, present: true })
    expect(calls).toEqual([{ name: 'party_heartbeat', args: { p_player_id: 'p', p_token: 'tok' } }])
    expect(samples).toEqual([{ sentAt: 50, receivedAt: 100, serverTime: 777 }])
  })

  it('reports bad_token from heartbeat', async () => {
    expect(await createPartyRpc(rpcClient({ ok: false, error: 'bad_token' }).client).heartbeat('p', 't')).toEqual({ ok: false, error: 'bad_token' })
  })

  it('calls party_timeout with the turn number; acted false is a normal result', async () => {
    const { client, calls } = rpcClient({ ok: true, acted: false })
    expect(await createPartyRpc(client).timeout('room', 9)).toEqual({ ok: true, acted: false })
    expect(calls).toEqual([{ name: 'party_timeout', args: { p_room_id: 'room', p_turn_no: 9 } }])
    expect(await createPartyRpc(rpcClient({ ok: true, acted: true, kind: 'timeout' }).client).timeout('room', 9)).toEqual({ ok: true, acted: true })
  })

  it('maps transport errors and thrown errors to network', async () => {
    expect(await createPartyRpc(rpcClient(null, { message: 'x' }).client).timeout('r', 1)).toEqual({ ok: false, error: 'network' })
    const throwing: RpcClient = { rpc: () => Promise.reject(new Error('down')) }
    expect(await createPartyRpc(throwing).heartbeat('p', 't')).toEqual({ ok: false, error: 'network' })
  })
})

describe('friendlyError', () => {
  it('says the agreed sentence for a network failure and has a fallback', () => {
    expect(friendlyError('network')).toBe("Can't reach the party server right now.")
    expect(friendlyError('weird')).toMatch(/Something went wrong/)
  })
})
