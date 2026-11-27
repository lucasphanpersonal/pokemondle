/*
 * Development only: a pretend room connection so the Party screens can be seen and screenshotted without a server.
 * PartyApp only uses it when import.meta.env.DEV is true and the address has ?mock, so production builds drop it.
 *
 * Query switches (all optional):
 *   ?mock                 start screen; Host makes a room with just you, Join joins a room of `players`
 *   ?mock=lobby           open the lobby straight away (room code from the address, else KPZW)
 *   &players=8            how many players the joined / opened room has, you included (default 3)
 *   &as=guest             in the opened lobby, be a guest (default host)
 *   &status=playing       the room's game is already running (late arrival)
 *   &away=1               the second player shows as away
 *   &error=Some+text      show this error on the screen
 *   &busy=1               every request stays on its way
 *
 * The game screen (also reached by Start in a mock lobby):
 *   ?mock=game            open a running game straight away
 *   &players=8            players in the game, you included (default 3)
 *   &turn=them            whose turn it is first: me (default) or them (the player after you)
 *   &parts=3              the category: 1 (Fire type, default), 2 (Fire, Stage 2), 3 (Water, Gen 1, Stage 1),
 *                         words (Blue, Over 100 kg, Levitate), pair (Bug and Flying, Gen 4) or pure (Pure Fire)
 *   &out=1                the player after the one whose turn it is is out (0 lives)
 *   &answers=4            answers already said this round (default 2)
 *   &round=5              the round number (the tier follows it)
 *   &secs=9               seconds left on the first turn (default the tier's full time)
 * Other players answer after 3 s; a turn that runs out costs a life.
 */
import { useEffect, useRef, useState } from 'react'
import { PARTY_CONFIG, tierForRound } from '../config/partyConfig.ts'
import { unusedEntries } from '../lib/party/categories.ts'
import type { Category } from '../lib/party/types.ts'
import { POKEDEX, POKEDEX_BY_ID } from '../lib/pokedex.ts'
import { checkLocally, speciesLeftFor, usedSpecies } from './game.ts'
import type { PartyRoute } from './route.ts'
import type { GameAnswer, GameView, LobbyPlayer, LobbyView, PartyController, PartySettings, PartyStatus } from './types.ts'

const NAMES = ['Misty', 'Brock', 'May', 'Dawn', 'Cynthia', 'Gary', 'Ash 2', 'Serena']
const STARTERS = [1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393]

export const mockEnabled = (): boolean => import.meta.env.DEV && new URLSearchParams(location.search).has('mock')

function roomFor(code: string, me: LobbyPlayer, count: number, meIsHost: boolean, q: URLSearchParams): LobbyView {
  const others = Array.from({ length: Math.max(0, Math.min(PARTY_CONFIG.maxPlayers, count) - 1) }, (_, i) => ({
    id: `p${i + 2}`,
    nickname: NAMES[i],
    icon: STARTERS[(i + 1) % STARTERS.length],
    online: !(q.get('away') && i === 0),
  }))
  // A guest joined last; a host was first in.
  const players = meIsHost ? [me, ...others] : [...others, me]
  return {
    code,
    status: (q.get('status') as PartyStatus | null) ?? 'lobby',
    players,
    meId: me.id,
    hostId: players[0].id,
    settings: { lives: PARTY_CONFIG.livesDefault, startTier: 'easy' },
  }
}

const CATEGORIES: Record<string, Category> = {
  '1': [{ kind: 'type', value: 'Fire' }],
  '2': [{ kind: 'type', value: 'Fire' }, { kind: 'stage', value: 2 }],
  '3': [{ kind: 'type', value: 'Water' }, { kind: 'gen', value: 1 }, { kind: 'stage', value: 1 }],
  words: [{ kind: 'color', value: 'Blue' }, { kind: 'size', value: 'heavy' }, { kind: 'ability', value: 'Levitate' }],
  pair: [{ kind: 'pair', value: ['Bug', 'Flying'] }, { kind: 'gen', value: 4 }],
  pure: [{ kind: 'pure', value: 'Fire' }],
}

/** A pretend running game for `lobby`'s players. */
function gameFor(lobby: LobbyView, q: URLSearchParams): GameView {
  const round = Number(q.get('round') ?? 1)
  const tier = tierForRound(round)
  const category = CATEGORIES[q.get('parts') ?? '1'] ?? CATEGORIES['1']
  const players = lobby.players.map((p) => ({ ...p, lives: lobby.settings.lives, out: false }))
  const meAt = Math.max(0, players.findIndex((p) => p.id === lobby.meId))
  const turnAt = q.get('turn') === 'them' ? (meAt + 1) % players.length : meAt
  if (q.get('out') === '1' && players.length > 2) {
    const o = players[(turnAt + 1) % players.length]
    o.lives = 0
    o.out = true
  }
  // A life already lost somewhere, so the rail shows an empty heart too.
  if (players.length > 3) players[players.length - 1].lives = Math.max(1, lobby.settings.lives - 1)
  const fits = unusedEntries(category, POKEDEX, new Set())
  const answers: GameAnswer[] = fits.slice(0, Math.min(players.length - 1, Number(q.get('answers') ?? 2))).map((p, i) => {
    const by = players[(((turnAt - 1 - i) % players.length) + players.length) % players.length]
    return { id: `a${i}`, pokemonId: p.id, playerId: by.id, nickname: by.nickname }
  })
  const secs = Number(q.get('secs') ?? tier.seconds)
  return {
    code: lobby.code,
    round,
    tier: tier.id,
    category,
    left: speciesLeftFor(category, answers, POKEDEX, POKEDEX_BY_ID),
    players,
    meId: lobby.meId,
    turnPlayerId: players[turnAt].id,
    deadlineAt: Date.now() + secs * 1000,
    seconds: tier.seconds,
    startLives: lobby.settings.lives,
    answers,
  }
}

/** The next player still in, after `id`. */
function nextLiving(game: Pick<GameView, 'players'>, id: string | null): string | null {
  const at = game.players.findIndex((p) => p.id === id)
  for (let i = 1; i <= game.players.length; i++) {
    const p = game.players[(at + i) % game.players.length]
    if (!p.out) return p.id
  }
  return null
}

/** The turn passes after an answer: the next living player gets a fresh timer. */
function passTurn(game: GameView, by: string, pokemonId: number, n: number): GameView {
  const player = game.players.find((p) => p.id === by)
  const answers = [{ id: `m${n}`, pokemonId, playerId: by, nickname: player?.nickname ?? '?' }, ...game.answers]
  return {
    ...game,
    answers,
    left: speciesLeftFor(game.category, answers, POKEDEX, POKEDEX_BY_ID),
    turnPlayerId: nextLiving(game, by),
    deadlineAt: Date.now() + game.seconds * 1000,
  }
}

/** The pretend PartyController. `route` seeds ?mock=lobby and ?mock=game with the address's room code. */
export function useMockParty(route: PartyRoute): PartyController & { inGame: boolean } {
  const q = new URLSearchParams(location.search)
  const count = Number(q.get('players') ?? 3)
  const busy = q.get('busy') === '1'
  const [error, setError] = useState<string | undefined>(q.get('error') ?? undefined)
  const [lobby, setLobby] = useState<LobbyView | null>(() =>
    q.get('mock') === 'lobby' || q.get('mock') === 'game'
      ? roomFor(route.screen === 'room' ? route.code : 'KPZW', { id: 'me', nickname: 'Ash', icon: 1, online: true }, count, q.get('as') !== 'guest', q)
      : null,
  )
  const [game, setGame] = useState<GameView | null>(() => (q.get('mock') === 'game' && lobby ? gameFor(lobby, q) : null))
  const update = (f: (l: LobbyView) => LobbyView) => setLobby((l) => (l ? f(l) : l))
  const counter = useRef(0)

  // The other players each answer after 3 s with something that fits (not with &freeze=1). A turn that runs out costs
  // a life and starts a new round, which the player who failed starts.
  const turn = game?.turnPlayerId
  const deadline = game?.deadlineAt
  const meId = game?.meId
  const freeze = q.get('freeze') === '1'
  useEffect(() => {
    if (!turn || deadline == null || freeze) return
    const timers: ReturnType<typeof setTimeout>[] = []
    if (turn !== meId) {
      timers.push(
        setTimeout(() => {
          setGame((g) => {
            if (!g || g.turnPlayerId !== turn) return g
            const pick = unusedEntries(g.category, POKEDEX, usedSpecies(g.answers, POKEDEX_BY_ID))[0]
            return pick ? passTurn(g, turn, pick.id, ++counter.current) : g
          })
        }, 3000),
      )
    }
    timers.push(
      setTimeout(
        () =>
          setGame((g) => {
            if (!g || g.turnPlayerId !== turn || g.deadlineAt !== deadline) return g
            const players = g.players.map((p) => (p.id === turn ? { ...p, lives: p.lives - 1, out: p.lives <= 1 } : p))
            const failedOut = players.find((p) => p.id === turn)?.out
            const next = { ...g, players, answers: [], round: g.round + 1 }
            return {
              ...next,
              left: speciesLeftFor(g.category, [], POKEDEX, POKEDEX_BY_ID),
              turnPlayerId: failedOut ? nextLiving(next, turn) : turn,
              deadlineAt: Date.now() + g.seconds * 1000,
            }
          }),
        Math.max(0, deadline - Date.now()) + 1500,
      ),
    )
    return () => timers.forEach(clearTimeout)
  }, [turn, deadline, meId, freeze])

  return {
    lobby,
    game,
    inGame: game !== null,
    busy,
    error,
    host: (nickname) => {
      setError(undefined)
      setLobby(roomFor('KPZW', { id: 'me', nickname, icon: 4, online: true }, 1, true, q))
    },
    join: (code, nickname) => {
      setError(undefined)
      setLobby(roomFor(code, { id: 'me', nickname, icon: 7, online: true }, count, false, q))
    },
    changeSettings: (settings: PartySettings) => update((l) => ({ ...l, settings })),
    start: () => {
      if (!lobby) return
      setError(undefined)
      setGame(gameFor(lobby, q))
    },
    remove: (id) => update((l) => ({ ...l, players: l.players.filter((p) => p.id !== id) })),
    leave: () => {
      setGame(null)
      setLobby(null)
    },
    answer: async (pokemonId) => {
      await new Promise((r) => setTimeout(r, 150))
      const g = game
      const p = POKEDEX_BY_ID.get(pokemonId)
      if (!g || !p || g.turnPlayerId !== g.meId) return { ok: false, reason: "It's not your turn." }
      if (g.deadlineAt !== null && Date.now() > g.deadlineAt + PARTY_CONFIG.graceMs) return { ok: false, reason: 'Too late!' }
      const check = checkLocally(g.category, p, g.answers, POKEDEX_BY_ID)
      if (!check.ok) return { ok: false, reason: check.reason }
      setGame((cur) => (cur ? passTurn(cur, cur.meId, pokemonId, ++counter.current) : cur))
      return { ok: true }
    },
  }
}
