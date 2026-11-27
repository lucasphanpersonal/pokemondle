import { PARTY_CONFIG, type TierId } from '../config/partyConfig.ts'

/*
 * View models for the Party screens. They stay close to the database rows (supabase/migrations/20261127200000_party.sql,
 * documented in supabase/README.md "Party database") so the room connection (useParty) maps to them field by field.
 */

/** party_rooms.status */
export type PartyStatus = 'lobby' | 'playing' | 'over'

/** The host's settings: party_rooms.lives (1-5) and party_rooms.start_tier. */
export interface PartySettings {
  lives: number
  startTier: TierId
}

/** One party_players row, as the lobby shows it. */
export interface LobbyPlayer {
  /** party_players.id */
  id: string
  /** party_players.nickname (already made unique in the room by the server: "Ash", "Ash 2"). */
  nickname: string
  /** party_players.icon: the dex number of the starter Pokémon shown as the player's picture. */
  icon: number
  /**
   * Connected right now (Realtime presence or a recent heartbeat). A player who drops stays listed as away until the
   * server marks them gone (party_players.gone_at) after 60 s.
   */
  online: boolean
}

/** Everything the lobby screen shows. */
export interface LobbyView {
  /** The room code, 4 letters (party_room_codes.code). */
  code: string
  /** party_rooms.status. 'playing' or 'over' in the lobby means this player arrived late and waits for the next game. */
  status: PartyStatus
  /** Present players only (party_players.gone_at is null), in join order (party_players.joined_at). */
  players: LobbyPlayer[]
  /** This browser's player id (from localStorage['pokemondle:party']). */
  meId: string
  /** party_rooms.host_id */
  hostId: string | null
  settings: PartySettings
}

/**
 * Why Start can't be pressed yet, or null when it can. The server checks the same (party_start refuses with
 * too_few_players), so this only spares a pointless request.
 */
export function startBlockedReason(view: Pick<LobbyView, 'players' | 'status'>): string | null {
  if (view.status !== 'lobby') return 'Wait for this game to end.'
  const missing = PARTY_CONFIG.minPlayers - view.players.length
  if (missing > 0) return `Waiting for ${missing === 1 ? '1 more player' : `${missing} more players`} to join.`
  return null
}

/**
 * What the Party page needs from the room connection. useParty (task 6) implements it against the party Edge Function
 * and Realtime; src/party/mock.ts implements it locally for development and screenshots.
 */
export interface PartyController {
  /** The room this browser is in, or null on the start screen (not in a room, or still reconnecting). */
  lobby: LobbyView | null
  /** A request is on its way (host, join, settings, start, remove or leave): the screens disable their buttons. */
  busy: boolean
  /** The last refusal or network failure, in words for the player ("That room is full."), cleared by the next action. */
  error?: string
  /** Create a room as its host with this (valid, normalised) nickname. */
  host(nickname: string): void
  /** Join room `code` (4 valid letters) with this (valid, normalised) nickname. */
  join(code: string, nickname: string): void
  /** Host only: change the starting lives or tier. */
  changeSettings(settings: PartySettings): void
  /** Host only: deal the deck and start the game. */
  start(): void
  /** Host only: remove another player from the room. */
  remove(playerId: string): void
  /** Leave the room (back to the start screen). */
  leave(): void
}
