import { useCallback, useMemo, useState } from 'react'
import { POKEDEX, POKEDEX_BY_ID } from '../lib/pokedex.ts'
import { friendlyError } from './api.ts'
import { speciesLeftFor } from './game.ts'
import { hardestCleared, resultPlayers, toRoundEnd } from './moments.ts'
import { shownSettings, type SettingsDraft } from './optimistic.ts'
import type { AnswerRow, CategoryRow, PartyState, PlayerRow, RoomRow } from './state.ts'
import type { AnswerResult, GameOverView, GameView, LobbyPlayer, LobbyView, PartyController, PartySettings, RoundEnd } from './types.ts'
import { PARTY_UNREACHABLE, useParty } from './useParty.ts'

/** Words for a start-screen or lobby problem that isn't a server refusal. */
export const UNAVAILABLE_TEXT = "Party isn't available right now."
export const LOST_SEAT_TEXT = 'You are no longer in this room.'

/** Maps the room rows to what the lobby shows: present players only, longest-joined first. */
export function toLobbyView(
  code: string,
  room: RoomRow,
  players: readonly PlayerRow[],
  meId: string,
  draft: SettingsDraft | null = null,
): LobbyView {
  const present: LobbyPlayer[] = players.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    icon: p.icon,
    // There is no presence channel; a player who drops is removed by the server after 60 s.
    online: true,
  }))
  return {
    code,
    status: room.status,
    players: present,
    meId,
    hostId: room.host_id,
    settings: settingsView(shownSettings(room, draft)),
  }
}

const settingsView = (s: SettingsDraft): PartySettings => ({ lives: s.lives, startTier: s.start_tier })

/**
 * Maps the room rows to what the game screen shows, or null when no game is running (or its category hasn't arrived).
 * `players` are the present players; `answers` this round's, newest first; `deadlineAt` already in local time.
 */
export function toGameView(
  code: string,
  room: RoomRow,
  players: readonly PlayerRow[],
  category: CategoryRow | null,
  answers: readonly AnswerRow[],
  meId: string,
  deadlineAt: number | null,
  roundEnd: RoundEnd | null = null,
): GameView | null {
  if (room.status !== 'playing' || !category) return null
  const byId = new Map(players.map((p) => [p.id, p]))
  const seated = players.filter((p) => p.seat !== null && p.gone_at === null).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0))
  const said = answers.map((a) => ({
    id: String(a.id),
    pokemonId: a.pokemon_id,
    playerId: a.player_id,
    nickname: byId.get(a.player_id)?.nickname ?? 'Someone',
  }))
  return {
    code,
    round: room.round,
    tier: category.tier,
    category: category.parts,
    left: speciesLeftFor(category.parts, said, POKEDEX, POKEDEX_BY_ID),
    // TODO(presence): there is no presence channel yet, so everyone shows as online; a player who drops is removed by the
    // server after 60 s. The rail already draws "Away" for online: false.
    players: seated.map((p) => ({ id: p.id, nickname: p.nickname, icon: p.icon, lives: p.lives, out: p.is_out, online: true })),
    meId,
    turnPlayerId: room.turn_player_id,
    turnNo: room.turn_no,
    deadlineAt,
    seconds: room.turn_seconds ?? category.seconds,
    startLives: room.lives,
    answers: said,
    roundEnd,
  }
}

/** The rows of the room's current game, as plain arrays (the reducer keys them by id). */
function gameRows(state: PartyState) {
  const gameNo = state.room?.game_no ?? 0
  return {
    players: Object.values(state.players),
    categories: Object.values(state.categories).filter((c) => c.game_no === gameNo),
    answers: Object.values(state.answers).filter((a) => a.game_no === gameNo),
  }
}

/** How the last round ended (party_rooms.last_event), for the moments; `current` is the round being played now. */
export function roundEndOf(state: PartyState, current: CategoryRow | null): RoundEnd | null {
  const room = state.room
  if (!room || !current) return null
  const rows = gameRows(state)
  return toRoundEnd(room.last_event, { roomId: room.id, gameNo: room.game_no, ...rows, currentTier: current.tier })
}

/** Maps a finished game's rows to the game over screen, or null while the room isn't 'over'. */
export function toGameOverView(code: string, state: PartyState, meId: string): GameOverView | null {
  const room = state.room
  if (!room || room.status !== 'over') return null
  const rows = gameRows(state)
  const winner = room.winner_id ? (state.players[room.winner_id] ?? null) : null
  const hardest = hardestCleared(rows.categories)
  const final = toRoundEnd(room.last_event, { roomId: room.id, gameNo: room.game_no, ...rows, currentTier: hardest?.tier ?? 'easy' })
  return {
    code,
    meId,
    isHost: room.host_id === meId,
    winner: winner ? { id: winner.id, nickname: winner.nickname, icon: winner.icon } : null,
    players: resultPlayers(rows.players, room.lives, room.winner_id, meId),
    hardest: hardest ? { category: hardest.parts, tier: hardest.tier } : null,
    rounds: room.round,
    finalTimeout: final?.kind === 'timeout' ? final : null,
  }
}

export interface PartyScreenController extends PartyController {
  /** This player is in the running (or finished) game's turn order: the game screen belongs here, not the lobby. */
  inGame: boolean
}

/** The room connection (useParty) as the PartyController the start screen and lobby are written against. */
export function usePartyController(routeCode: string | null): PartyScreenController {
  const party = useParty(routeCode)
  const [actionError, setActionError] = useState<string | undefined>()
  const [pending, setPending] = useState(0)

  const run = useCallback(async (task: () => Promise<{ ok: boolean; error?: string }>) => {
    setActionError(undefined)
    setPending((n) => n + 1)
    try {
      const res = await task()
      if (!res.ok) setActionError(friendlyError(res.error ?? ''))
    } finally {
      setPending((n) => n - 1)
    }
  }, [])

  const { status, session, room, players, me } = party
  const unavailable = status === 'unavailable'
  const guard = (task: () => Promise<{ ok: boolean; error?: string }>) => {
    if (unavailable) setActionError(UNAVAILABLE_TEXT)
    else void run(task)
  }

  const lobby = session && room ? toLobbyView(session.code, room, players, session.player_id, party.settingsDraft) : null
  const error = actionError ?? (status === 'error' ? `${PARTY_UNREACHABLE}.` : party.lost ? LOST_SEAT_TEXT : undefined)

  const roundEnd = useMemo(() => roundEndOf(party.state, party.category), [party.state, party.category])
  const game =
    session && room && me?.seat != null
      ? toGameView(session.code, room, players, party.category, party.answers, session.player_id, party.deadlineAt, roundEnd)
      : null
  const over = useMemo(
    () => (session && me?.seat != null ? toGameOverView(session.code, party.state, session.player_id) : null),
    [session, me?.seat, party.state],
  )

  // The game screen checks answers itself first, so a refusal here is the server's: too late, a race, a lost seat.
  const partyAnswer = party.answer
  const answer = useCallback(
    async (pokemonId: number): Promise<AnswerResult> => {
      const res = await partyAnswer(pokemonId)
      if (res.ok) return { ok: true }
      return { ok: false, reason: res.error === 'wrong_answer' && res.reason ? res.reason : friendlyError(res.error) }
    },
    [partyAnswer],
  )

  return {
    lobby,
    game,
    over,
    answer,
    busy: pending > 0 || status === 'connecting',
    error,
    inGame: !!lobby && lobby.status !== 'lobby' && me?.seat != null,
    host: (nickname) => guard(() => party.host(nickname)),
    join: (code, nickname) => guard(() => party.join(code, nickname)),
    // Not counted as busy: the tap shows at once and the toggles stay usable (useParty sends only the latest tap).
    changeSettings: (s: PartySettings) => {
      if (unavailable) return setActionError(UNAVAILABLE_TEXT)
      setActionError(undefined)
      void party.settings(s.lives, s.startTier).then((res) => {
        if (!res.ok) setActionError(friendlyError(res.error))
      })
    },
    start: () => guard(party.start),
    remove: (id) => guard(() => party.remove(id)),
    playAgain: () => guard(party.playAgain),
    leave: () => {
      setActionError(undefined)
      void party.leave()
    },
  }
}
