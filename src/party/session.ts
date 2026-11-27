import { normaliseCode } from './route.ts'

/**
 * The player's seat in a room, kept in localStorage['pokemondle:party'] so a reload rejoins. The token is this
 * player's secret; it never leaves this browser except to the party server. Every storage access is try/catch (private
 * windows and blocked storage throw), and the page works without it (a reload then means joining again).
 */
export interface PartySession {
  code: string
  room_id: string
  player_id: string
  token: string
}

export const SESSION_KEY = 'pokemondle:party'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[0-9a-f]{64}$/

/** Validates parsed JSON; null if it isn't a usable session. */
export function parseSession(raw: unknown): PartySession | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const code = typeof r.code === 'string' ? normaliseCode(r.code) : null
  if (!code) return null
  if (typeof r.room_id !== 'string' || !UUID.test(r.room_id)) return null
  if (typeof r.player_id !== 'string' || !UUID.test(r.player_id)) return null
  if (typeof r.token !== 'string' || !TOKEN.test(r.token)) return null
  return { code, room_id: r.room_id, player_id: r.player_id, token: r.token }
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readSession(storage: StorageLike | null = defaultStorage()): PartySession | null {
  try {
    const text = storage?.getItem(SESSION_KEY)
    return text ? parseSession(JSON.parse(text)) : null
  } catch {
    return null
  }
}

export function writeSession(session: PartySession, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Storage blocked or full: the session just won't survive a reload.
  }
}

export function clearSession(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

/**
 * What to do on load for the room in the address: 'rejoin' when the stored seat is for that same room code,
 * 'none' when there is no room in the address or no stored seat for it (the join form shows). A stored seat for a
 * different room is left alone until the player joins the new one.
 */
export function decideRejoin(stored: PartySession | null, routeCode: string | null): 'rejoin' | 'none' {
  return stored !== null && routeCode !== null && stored.code === routeCode ? 'rejoin' : 'none'
}
