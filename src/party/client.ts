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

/** Reads the room as it is now: the room row, its players, this game's deck and this round's answers. */
export async function fetchSnapshot(client: SupabaseClient, roomId: string): Promise<Snapshot> {
  const roomRes = await client.from('party_rooms').select('*').eq('id', roomId).maybeSingle()
  if (roomRes.error) throw new Error(roomRes.error.message)
  const room = (roomRes.data as RoomRow | null) ?? null
  const players = client.from('party_players').select('*').eq('room_id', roomId)
  if (!room) {
    const p = await players
    if (p.error) throw new Error(p.error.message)
    return { room: null, players: (p.data ?? []) as PlayerRow[], categories: [], answers: [] }
  }
  const categories = client.from('party_categories').select('*').eq('room_id', roomId).eq('game_no', room.game_no)
  const answers = client
    .from('party_answers')
    .select('*')
    .eq('room_id', roomId)
    .eq('game_no', room.game_no)
    .eq('round', room.round)
  const [p, c, a] = await Promise.all([players, categories, answers])
  const err = p.error ?? c.error ?? a.error
  if (err) throw new Error(err.message)
  return {
    room,
    players: (p.data ?? []) as PlayerRow[],
    categories: (c.data ?? []) as CategoryRow[],
    answers: (a.data ?? []) as AnswerRow[],
  }
}

export interface Subscription {
  close(): void
}

export type ChannelStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'

/** Postgres Changes on the room's four tables, filtered by room id. supabase-js reconnects by itself and reports each
 * (re)subscription through onStatus; the caller refetches the snapshot on SUBSCRIBED. */
export function subscribeToRoom(
  client: SupabaseClient,
  roomId: string,
  onChange: (table: PartyTable, event: ChangeKind, row: Record<string, unknown>) => void,
  onStatus: (status: ChannelStatus) => void,
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
  channel.subscribe((status) => onStatus(status as ChannelStatus))
  return { close: () => void client.removeChannel(channel) }
}

/** supabase-js as the narrow RPC client the wrappers in api.ts take. */
export const asRpcClient = (client: SupabaseClient): RpcClient => client as unknown as RpcClient
