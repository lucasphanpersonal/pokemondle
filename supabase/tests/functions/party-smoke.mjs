// Smoke test for the party Edge Function against a local Supabase stack (run by .github/workflows/supabase-test.yml
// after `supabase functions serve`). No dependencies. Plays create -> join -> start -> answer.
// Env: FUNCTION_URL, API_URL, ANON_KEY (or PUBLISHABLE_KEY), ORIGIN (one of the function's ALLOWED_ORIGINS).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const FUNCTION_URL = process.env.FUNCTION_URL ?? 'http://127.0.0.1:54321/functions/v1/party'
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:54321'
const KEY = process.env.ANON_KEY ?? process.env.PUBLISHABLE_KEY
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5173'
assert(KEY, 'ANON_KEY or PUBLISHABLE_KEY is required')

const dataset = JSON.parse(readFileSync(new URL('../../functions/_shared/party/pokemon.json', import.meta.url), 'utf8'))

async function call(body, origin = ORIGIN) {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: KEY, ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

async function rest(path) {
  const res = await fetch(`${API_URL}/rest/v1/${path}`, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } })
  assert.equal(res.status, 200, `GET ${path}`)
  return res.json()
}

// Refusals that never reach the database.
assert.equal((await call({ action: 'create', nickname: 'Ash' }, 'https://evil.example')).status, 403)
assert.equal((await call({ action: 'create', nickname: 'Ash!' })).body?.error, 'bad_nickname')
assert.equal((await call({ action: 'join', code: 'AEIO', nickname: 'Ash' })).body?.error, 'bad_code')

const created = await call({ action: 'create', nickname: 'Ash', lives: 2 })
assert.equal(created.status, 200, JSON.stringify(created.body))
const host = created.body
assert.match(host.token, /^[0-9a-f]{64}$/)
assert.match(host.code, /^[BCDFGHJKMNPQRSTVWXYZ]{4}$/)
assert.equal(typeof host.server_time, 'number')

const joined = await call({ action: 'join', code: host.code.toLowerCase(), nickname: 'Ash' })
assert.equal(joined.status, 200, JSON.stringify(joined.body))
assert.equal(joined.body.nickname, 'Ash 2')
const guest = joined.body

const otherCode = (host.code[0] === 'B' ? 'C' : 'B') + host.code.slice(1)
assert.equal((await call({ action: 'join', code: otherCode, nickname: 'X' })).body?.error, 'no_room')

assert.equal((await call({ action: 'rejoin', player_id: guest.player_id, token: guest.token })).status, 200)
assert.equal((await call({ action: 'rejoin', player_id: guest.player_id, token: '0'.repeat(64) })).status, 401)

// Settings: the reply carries the room row it wrote (the page shows it before Realtime brings it).
const settings = await call({ action: 'settings', room_id: host.room_id, player_id: host.player_id, token: host.token, lives: 3, start_tier: 'easy' })
assert.equal(settings.status, 200, JSON.stringify(settings.body))
assert.equal(settings.body.room?.id, host.room_id)
assert.equal(settings.body.room?.lives, 3)

// Timings on the local stack (no network between the function and the database): how long each kind of call takes
// when the database is next door. Printed for the PR record, not asserted.
async function median(label, n, body) {
  const times = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    await call(typeof body === 'function' ? body(i) : body)
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  const ms = times[Math.floor(n / 2)]
  console.log(`timing ${label}: median ${ms.toFixed(1)} ms over ${n}`)
  return ms
}
await median('rejoin with a wrong token (one read rpc)', 15, { action: 'rejoin', player_id: guest.player_id, token: '0'.repeat(64) })
await median('settings (one write rpc)', 15, (i) => ({
  action: 'settings', room_id: host.room_id, player_id: host.player_id, token: host.token, lives: 1 + (i % 5), start_tier: 'easy',
}))
await call({ action: 'settings', room_id: host.room_id, player_id: host.player_id, token: host.token, lives: 3, start_tier: 'easy' })

// Guests can't start; the host can.
assert.equal((await call({ action: 'start', room_id: host.room_id, player_id: guest.player_id, token: guest.token })).status, 403)
const started = await call({ action: 'start', room_id: host.room_id, player_id: host.player_id, token: host.token })
assert.equal(started.status, 200, JSON.stringify(started.body))

const [room] = await rest(`party_rooms?id=eq.${host.room_id}&select=status,turn_player_id,round`)
assert.equal(room.status, 'playing')
const players = { [host.player_id]: host, [guest.player_id]: guest }
const turn = players[room.turn_player_id]
const waiting = turn === host ? guest : host

// Out of turn.
const early = await call({ action: 'answer', room_id: host.room_id, player_id: waiting.player_id, token: waiting.token, pokemon_id: 25 })
assert.equal(early.status, 403)
assert.equal(early.body.error, 'not_your_turn')

// Wrong answers are free: keep trying until one fits the category.
let passed
for (const p of dataset) {
  const r = await call({ action: 'answer', room_id: host.room_id, player_id: turn.player_id, token: turn.token, pokemon_id: p.id })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  if (r.body.ok) {
    passed = r.body
    break
  }
  assert.equal(r.body.error, 'wrong_answer')
}
assert(passed, 'no Pokémon fit the first category')
assert.equal(passed.result, 'passed')
assert.equal(passed.turn_player_id, waiting.player_id)
// The reply carries the rows it wrote: the room after the answer and the answer itself.
assert.equal(passed.room?.turn_player_id, waiting.player_id)
assert.equal(passed.room?.turn_no, passed.turn_no)
assert.equal(passed.answer?.player_id, turn.player_id)

// An already-said Pokémon is refused after one read (party_answer_context), with no write.
await median('answer, refused by the category check (one read rpc)', 15, {
  action: 'answer', room_id: host.room_id, player_id: waiting.player_id, token: waiting.token, pokemon_id: passed.answer.pokemon_id,
})

const answers = await rest(`party_answers?room_id=eq.${host.room_id}&select=player_id`)
assert.equal(answers.length, 1)
console.log('party smoke test passed')
