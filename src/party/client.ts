import type { SupabaseClient } from '@supabase/supabase-js'
import type { PartyEnv, RpcClient } from './api.ts'
import type { AnswerRow, CategoryRow, ChangeKind, PartyTable, PlayerRow, RoomRow } from './state.ts'

/**
 * The supabase-js side of Party: the client (loaded with a dynamic import, so it is its own chunk fetched only when a
 * room opens, never in the game's bundle), the snapshot selects and the Realtime subscription.
 */

let loading: Promise<SupabaseClient> | null = null

/** One shared client for the page. Never called with an empty URL or key (readPartyEnv returns null for those). */
export function loadClient(env: PartyEnv): Promise<SupabaseClient> {
  loading ??= import('@supabase/supabase-js')
    .then(({ createClient }) =>
      createClient(env.url, env.key, {
        // Anonymous reads and Realtime only: no login, nothing written to localStorage.
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    )
    .catch((e) => {
      loading = null
      throw e
    })
  return loading
}

export interface Snapshot {
  room: RoomRow | null
  players: PlayerRow[]
  categories: CategoryRow[]
  answers: AnswerRow[]
}

/**
 * Most answers one round can have: a round is cleared once every player in the turn order (at most 8) has answered, so
 * the newest few answers of the room always hold the whole current round.
 */
export const SNAPSHOT_ANSWERS = 64
/** Enough decks for several games (a deck is PARTY_CONFIG.deckSize = 60 entries, at most 200), newest game first. */
export const SNAPSHOT_CATEGORIES = 1000

/**
 * Reads the room as it is now: the room row, its players, this game's deck and this round's answers. The four reads go
 * out together (one round trip, not two): the deck and the answers are read newest first and cut down to the room's
 * current game and round here, since the room row isn't known yet when they are asked for.
 */
export async function fetchSnapshot(client: SupabaseClient, roomId: string): Promise<Snapshot> {
  const [r, p, c, a] = await Promise.all([
    client.from('party_rooms').select('*').eq('id', roomId).maybeSingle(),
    client.from('party_players').select('*').eq('room_id', roomId),
    client
      .from('party_categories')
      .select('*')
      .eq('room_id', roomId)
      .order('game_no', { ascending: false })
      .order('deck_no', { ascending: true })
      .limit(SNAPSHOT_CATEGORIES),
    client.from('party_answers').select('*').eq('room_id', roomId).order('id', { ascending: false }).limit(SNAPSHOT_ANSWERS),
  ])
  const err = r.error ?? p.error ?? c.error ?? a.error
  if (err) throw new Error(err.message)
  const room = (r.data as RoomRow | null) ?? null
  let cats = (c.data ?? []) as CategoryRow[]
  let ans = (a.data ?? []) as AnswerRow[]
  // The reads ran side by side, so the room may be newer than the deck or the answers (a start or an answer landed in
  // between). When the room says rows must exist that the other reads lack, read those again for this game/round.
  if (room) {
    const stale = staleParts(room, cats, ans)
    const [c2, a2] = await Promise.all([
      stale.categories
        ? client.from('party_categories').select('*').eq('room_id', roomId).eq('game_no', room.game_no)
        : null,
      stale.answers
        ? client.from('party_answers').select('*').eq('room_id', roomId).eq('game_no', room.game_no).eq('round', room.round)
        : null,
    ])
    const err2 = c2?.error ?? a2?.error
    if (err2) throw new Error(err2.message)
    if (c2) cats = (c2.data ?? []) as CategoryRow[]
    if (a2) ans = (a2.data ?? []) as AnswerRow[]
  }
  return snapshotOf(room, (p.data ?? []) as PlayerRow[], cats, ans)
}

/**
 * The lobby re-read (resync.ts): just the room row and its players, two small selects side by side. Used while the room
 * is in the lobby to catch a join that Realtime missed; anything else (a game started) is a cue for a full snapshot.
 */
export async function fetchLobby(client: SupabaseClient, roomId: string): Promise<{ room: RoomRow | null; players: PlayerRow[] }> {
  const [r, p] = await Promise.all([
    client.from('party_rooms').select('*').eq('id', roomId).maybeSingle(),
    client.from('party_players').select('*').eq('room_id', roomId),
  ])
  const err = r.error ?? p.error
  if (err) throw new Error(err.message)
  return { room: (r.data as RoomRow | null) ?? null, players: (p.data ?? []) as PlayerRow[] }
}

/**
 * Which of the side-by-side reads are older than the room row: a game is running (or over) but none of its deck came
 * back, or the room's last event is an answer of this round that isn't among the answers.
 */
export function staleParts(room: RoomRow, categories: readonly CategoryRow[], answers: readonly AnswerRow[]) {
  const ev = room.last_event
  return {
    categories: room.status !== 'lobby' && room.game_no > 0 && !categories.some((c) => c.game_no === room.game_no),
    answers:
      ev?.kind === 'answer' &&
      ev.round === room.round &&
      !answers.some((x) => x.game_no === room.game_no && x.round === room.round && x.pokemon_id === ev.pokemon_id),
  }
}

/** Keeps the deck of the room's current game and the answers of its current round (all four empty-safe). */
export function snapshotOf(room: RoomRow | null, players: PlayerRow[], categories: CategoryRow[], answers: AnswerRow[]): Snapshot {
  if (!room) return { room: null, players, categories: [], answers: [] }
  return {
    room,
    players,
    categories: categories.filter((c) => c.game_no === room.game_no),
    answers: answers.filter((x) => x.game_no === room.game_no && x.round === room.round),
  }
}

export interface Subscription {
  close(): void
}

export type ChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'

/** Postgres Changes on the room's four tables, filtered by room id. supabase-js reconnects by itself and reports each
 * (re)subscription through onStatus; the caller refetches the snapshot on SUBSCRIBED. SUBSCRIBED can come before the
 * server streams Postgres Changes for the channel; the server's later "system" ok for postgres_changes calls
 * onChangesReady (when the server sends one), so the caller can read again (resync.ts). */
export function subscribeToRoom(
  client: SupabaseClient,
  roomId: string,
  onChange: (table: PartyTable, event: ChangeKind, row: Record<string, unknown>) => void,
  onStatus: (status: ChannelStatus) => void,
  onChangesReady?: () => void,
): Subscription {
  let channel = client.channel(`party:${roomId}:${Math.random().toString(36).slice(2, 8)}`)
  const tables: [PartyTable, string][] = [
    ['party_rooms', `id=eq.${roomId}`],
    ['party_players', `room_id=eq.${roomId}`],
    ['party_categories', `room_id=eq.${roomId}`],
    ['party_answers', `room_id=eq.${roomId}`],
  ]
  for (const [table, filter] of tables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, (payload) => {
      const event = payload.eventType as ChangeKind
      const row = (event === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>
      onChange(table, event, row ?? {})
    })
  }
  channel = channel.on('system', {}, (payload: { extension?: string; status?: string }) => {
    if (payload?.extension === 'postgres_changes' && payload.status === 'ok') onChangesReady?.()
  })
  channel.subscribe((status) => onStatus(status as ChannelStatus))
  return { close: () => void client.removeChannel(channel) }
}

/** supabase-js as the narrow RPC client the wrappers in api.ts take. */
export const asRpcClient = (client: SupabaseClient): RpcClient => client as unknown as RpcClient
