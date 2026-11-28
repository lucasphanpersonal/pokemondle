import { PARTY_CONFIG, type TierId } from '../config/partyConfig.ts'
import type { Category } from '../lib/party/types.ts'

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
  /** party_rooms.status. 'playing' in the lobby means this player arrived late and waits for the next game. */
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

/** One player on the game screen's rail (a party_players row with a seat). */
export interface GamePlayer {
  /** party_players.id */
  id: string
  /** party_players.nickname */
  nickname: string
  /** party_players.icon: the starter's dex number shown as the player's picture. */
  icon: number
  /** party_players.lives: lives left (0 once out). */
  lives: number
  /** party_players.is_out: no lives left, watching the rest of the game. */
  out: boolean
  /** Connected right now (as LobbyPlayer.online). */
  online: boolean
}

/** One valid answer of this round (a party_answers row of the room's current game_no and round). */
export interface GameAnswer {
  /** party_answers.id, as a string: a stable key, and a new one at the top makes the screen chime. */
  id: string
  /** party_answers.pokemon_id: the dataset entry said (a form counts as itself: "Vulpix (Alola)"). */
  pokemonId: number
  /** party_answers.player_id */
  playerId: string
  /** Who said it, as the list shows it: the player's nickname, kept here so an answer still names a player who left. */
  nickname: string
}

/**
 * Everything the game screen shows while party_rooms.status is 'playing'. Times are local epoch milliseconds: the room
 * connection turns the server's deadline into this browser's clock (its estimated server-clock offset applied).
 */
export interface GameView {
  /** The room code, 4 letters. */
  code: string
  /** party_rooms.round, from 1. */
  round: number
  /** The current category's tier (party_categories.tier of party_rooms.category_no). */
  tier: TierId
  /** The current category's parts (party_categories.parts), in any order: the screen sorts them for display. */
  category: Category
  /** Species that still fit and weren't said this round ("14 left"): `speciesLeftFor(category, answers)` in game.ts. */
  left: number
  /**
   * Seated players (party_players.seat not null, gone_at null) in turn order (by seat), out players included: the rail
   * greys them.
   */
  players: GamePlayer[]
  /** This browser's player id. A late arrival who only watches has an id that isn't in `players`. */
  meId: string
  /** party_rooms.turn_player_id: whose turn it is, or null when no turn is running. */
  turnPlayerId: string | null
  /**
   * party_rooms.turn_no: the server's turn counter. With round and turnPlayerId it names the turn, so a wrong answer's
   * reason, the ticks and time's up belong to one turn even when deadlineAt shifts with a new clock estimate.
   */
  turnNo: number
  /** party_rooms.deadline in local epoch ms (the Date.now() scale), or null when no turn is running. */
  deadlineAt: number | null
  /** party_rooms.turn_seconds: the whole length of this turn, so the fuse burns from full down to nothing. */
  seconds: number
  /** party_rooms.lives: the lives everyone started with, so the rail draws the lost ones as empty. */
  startLives: number
  /** This round's valid answers (party_answers of the current game_no and round), newest first. */
  answers: GameAnswer[]
  /**
   * How the last round ended (party_rooms.last_event), for the time's up and round cleared moments, or null when the
   * last event wasn't the end of a round (the game's start, an answer, a player leaving).
   */
  roundEnd: RoundEnd | null
}

/**
 * The end of a round, as every screen in the room shows it. Mapped from party_rooms.last_event by toRoundEnd (moments.ts).
 * `key` names the round (game and round number), so the moment plays once however often or late the event arrives.
 */
export type RoundEnd = TimeoutEnd | ClearedEnd

/** A player's time ran out (or they left on their turn): they lost a life, or are out. */
export interface TimeoutEnd {
  kind: 'timeout'
  key: string
  /** The round that ended. */
  round: number
  playerId: string
  nickname: string
  /** Lives left after the loss (0 when out). */
  lives: number
  out: boolean
  /** The failed round's category (party_categories.parts of the event's deck_no), or null if it hasn't arrived. */
  category: Category | null
  /** Dataset ids said in the failed round, so "Also fit" never shows one of them. */
  saidIds: number[]
  /** The "Also fit" seed: the same on every screen (room id, game and round), so everyone sees the same three. */
  seed: string
}

/** Every living player answered (or the answers ran out): no life lost, the next category is one step harder. */
export interface ClearedEnd {
  kind: 'cleared'
  key: string
  round: number
  /** The pool ran out before the lap ended. */
  exhausted: boolean
  /** The cleared round's tier and the new round's: "Now: Hard" shows when they differ. */
  fromTier: TierId | null
  toTier: TierId
}

/** One row of the game over table. */
export interface ResultPlayer {
  id: string
  nickname: string
  icon: number
  /** party_players.answers_given: valid answers in the whole game. */
  answers: number
  /** Lives lost in the game (party_rooms.lives minus party_players.lives). */
  livesLost: number
  lives: number
  out: boolean
  /** Left, removed or dropped during the game (party_players.gone_at). */
  gone: boolean
  isWinner: boolean
  isMe: boolean
}

/** Everything the game over screen shows (party_rooms.status 'over'). */
export interface GameOverView {
  code: string
  meId: string
  /** This browser is the host: Play again is theirs. */
  isHost: boolean
  /** party_rooms.winner_id's player, or null when nobody was left. */
  winner: Pick<ResultPlayer, 'id' | 'nickname' | 'icon'> | null
  /** The seated players: the winner first, then by lives left, then answers given. */
  players: ResultPlayer[]
  /** The hardest category anyone cleared (highest tier, then the latest round), or null when no round was cleared. */
  hardest: { category: Category; tier: TierId } | null
  /** Rounds played (party_rooms.round). */
  rounds: number
  /** The time's up that ended the game, shown once more at the top of the screen, or null. */
  finalTimeout: TimeoutEnd | null
}

/** The reply to an answer: accepted, or refused with a reason in words ("Too late!", "Vulpix was already said"). */
export type AnswerResult = { ok: true } | { ok: false; reason: string }

/**
 * What the Party page needs from the room connection. useParty (task 6) implements it against the party Edge Function
 * and Realtime; src/party/mock.ts implements it locally for development and screenshots.
 */
export interface PartyController {
  /** The room this browser is in, or null on the start screen (not in a room, or still reconnecting). */
  lobby: LobbyView | null
  /**
   * The running game, or null when there is none (lobby, game over, or a late arrival waiting for the next game). While
   * it is set, the game screen shows instead of the lobby.
   */
  game: GameView | null
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
  /**
   * On this player's turn: say `pokemonId` (a dataset entry id). The game screen checks the answer against the category
   * first (checkAnswer), so a plainly wrong answer never gets here; the server checks again and may still refuse ("Too
   * late!", or another player's answer arrived first). Resolves with the outcome, never rejects: a refusal's reason
   * shows under the search box. An accepted answer also arrives as a new first entry of `game.answers`, and the turn
   * moves on screen when `game.turnPlayerId` changes.
   */
  answer(pokemonId: number): Promise<AnswerResult>
  /**
   * The finished game (party_rooms.status 'over') for everyone in the room (late arrivals too), or null. While it is set,
   * the game over screen shows.
   */
  over: GameOverView | null
  /** Host only, on the game over screen: back to the lobby with the same room and players (then Start deals a new game). */
  playAgain(): void
}
