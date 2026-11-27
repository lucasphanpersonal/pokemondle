// Supabase Edge Function: POST /functions/v1/party
// One endpoint for the Party mode: JSON body with an `action` (create, join, rejoin, settings, start, answer, remove,
// leave, play_again). Request handling lives in handler.ts; this file wires in the service-role client and the
// dataset. The turn rules are in the party_* SQL functions (supabase/migrations/20261127200000_party.sql).
// The Origin check is CORS hygiene, not access control: the real defences are token checks in SQL, strict
// validation and the per-network caps on create and join. Tokens are never logged.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { clientIp, getDailySalt, sha256 } from '../_shared/network.ts'
import dataset from '../_shared/party/pokemon.json' with { type: 'json' }
import type { Pokemon } from '../_shared/party/pokemon.ts'
import type { Category } from '../_shared/party/types.ts'
import { handleParty, MAX_BODY_BYTES, type PartyDeps, type PartyResult } from './handler.ts'

const positive = (name: string, fallback: number) => Math.max(1, Math.floor(Number(Deno.env.get(name))) || fallback)

// Abuse backstops per network (salted daily IP hash). A school or office shares one IP, so these are generous.
// Override with the MAX_PARTY_CREATES_PER_HOUR / MAX_PARTY_JOINS_PER_HOUR function secrets.
const CREATES_PER_HOUR = positive('MAX_PARTY_CREATES_PER_HOUR', 20)
const JOINS_PER_HOUR = positive('MAX_PARTY_JOINS_PER_HOUR', 120)

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean)

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// The JSON import widens evolutionStage to number, so it needs a cast.
const pokemon = dataset as unknown as Pokemon[]

function makeDeps(req: Request): PartyDeps {
  return {
    allowedOrigins,
    dataset: pokemon,
    rpc: async (fn, args) => {
      const { data, error } = await supabase.rpc(fn, args)
      return { data, error }
    },
    getRoom: async (roomId) => {
      const { data, error } = await supabase
        .from('party_rooms')
        .select('status, start_tier, game_no, round, category_no, turn_player_id')
        .eq('id', roomId)
        .maybeSingle()
      if (error) throw error
      return data
    },
    getCategory: async (roomId, gameNo, deckNo) => {
      const { data, error } = await supabase
        .from('party_categories')
        .select('parts')
        .eq('room_id', roomId)
        .eq('game_no', gameNo)
        .eq('deck_no', deckNo)
        .maybeSingle()
      if (error) throw error
      return (data?.parts as Category | undefined) ?? null
    },
    getUsedSpecies: async (roomId, gameNo, round) => {
      const { data, error } = await supabase
        .from('party_answers')
        .select('species')
        .eq('room_id', roomId)
        .eq('game_no', gameNo)
        .eq('round', round)
      if (error) throw error
      return (data ?? []).map((r: { species: number }) => r.species)
    },
    countPresent: async (roomId) => {
      const { count, error } = await supabase
        .from('party_players')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', roomId)
        .is('gone_at', null)
      if (error) throw error
      return count ?? 0
    },
    networkHash: async () => {
      const ip = clientIp(req)
      if (!ip) return null // no IP: skip the cap rather than pooling everyone into one network
      const salt = await getDailySalt(supabase, new Date().toISOString().slice(0, 10))
      return sha256(`${salt}|ip|${ip}`)
    },
    caps: {
      create: { limit: CREATES_PER_HOUR, window: '1 hour' },
      join: { limit: JOINS_PER_HOUR, window: '1 hour' },
    },
    randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0],
    now: () => Date.now(),
  }
}

function toResponse(result: PartyResult): Response {
  const headers: Record<string, string> = { Vary: 'Origin', 'Cache-Control': 'no-store' }
  if (result.allowOrigin) {
    headers['Access-Control-Allow-Origin'] = result.allowOrigin
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'content-type'
    headers['Access-Control-Max-Age'] = '86400'
  }
  if (result.body === null) return new Response(null, { status: result.status, headers })
  headers['Content-Type'] = 'application/json'
  return new Response(JSON.stringify(result.body), { status: result.status, headers })
}

Deno.serve(async (req) => {
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  let bodyText = ''
  // An oversized body is refused by the handler without being read.
  if (req.method === 'POST' && contentLength <= MAX_BODY_BYTES) {
    try {
      bodyText = await req.text()
    } catch {
      bodyText = ''
    }
  }
  const result = await handleParty(
    { method: req.method, origin: req.headers.get('origin'), contentLength, bodyText },
    makeDeps(req),
  )
  return toResponse(result)
})
