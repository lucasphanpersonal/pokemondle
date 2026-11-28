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
 *   &lives=3              everyone's starting lives
 *   &think=3000           how long the other players take to answer, in ms
 *   &seconds=6            every turn lasts this long (default the tier's time)
 *   &freeze=1             nobody answers and no turn runs out on its own (for screenshots)
 * Other players answer after 3 s; a turn that runs out costs a life (time's up, "Also fit"), a full lap clears the round
 * (the next category comes from the next round's tier), and the last player with lives wins (the game over screen).
 *
 * The end-of-round moments, 300 ms after the screen opens (they work with &freeze=1):
 *   &moment=timeout       the player whose turn it is runs out of time and loses a life
 *   &moment=out           ...and is out (they had 1 life left; needs 3 or more players)
 *   &moment=cleared       the round is cleared, same tier next
 *   &moment=tier          the round is cleared and the tier changes (round 3 -> 4: "Now: Medium")
 *   &early=1              with timeout/out: the local countdown reaches zero first (the burst starts before the event)
 *
 * The game over screen:
 *   ?mock=over            open it straight away (with &players=2..8, &as=guest, &winner=me, &hardest=none, &end=gone)
 */
import { useEffect, useRef, useState } from 'react'
import { PARTY_CONFIG, tierForRound, type TierId } from '../config/partyConfig.ts'
import { unusedEntries } from '../lib/party/categories.ts'
import type { Category } from '../lib/party/types.ts'
import { POKEDEX, POKEDEX_BY_ID } from '../lib/pokedex.ts'
import { checkLocally, speciesLeftFor, usedSpecies } from './game.ts'
import { alsoFitSeed, roundEndKey } from './moments.ts'
import type { PartyRoute } from './route.ts'
import type {
  GameAnswer,
  GameOverView,
  GameView,
  LobbyPlayer,
  LobbyView,
  PartyController,
  PartySettings,
  PartyStatus,
  ResultPlayer,
  TimeoutEnd,
} from './types.ts'

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
    settings: { lives: Number(q.get('lives') ?? PARTY_CONFIG.livesDefault), startTier: 'easy' },
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

/** The categories later rounds deal, by tier (round 1 uses &parts). */
const DECK: Record<TierId, Category[]> = {
  easy: [[{ kind: 'type', value: 'Water' }], [{ kind: 'gen', value: 4 }], [{ kind: 'color', value: 'Pink' }]],
  medium: [[{ kind: 'type', value: 'Fire' }, { kind: 'stage', value: 2 }], [{ kind: 'ability', value: 'Levitate' }]],
  hard: [[{ kind: 'pair', value: ['Bug', 'Flying'] }], [{ kind: 'type', value: 'Fire' }, { kind: 'gen', value: 1 }]],
  expert: [[{ kind: 'type', value: 'Water' }, { kind: 'gen', value: 1 }, { kind: 'stage', value: 1 }]],
}
const categoryForRound = (round: number): Category => {
  const list = DECK[tierForRound(round).id]
  return list[round % list.length]
}

/** Every turn's length: &seconds=N, or the tier's. */
const turnSecondsFor = (q: URLSearchParams, tierSeconds: number): number => Number(q.get('seconds') ?? tierSeconds)

/** A pretend running game for `lobby`'s players. */
function gameFor(lobby: LobbyView, q: URLSearchParams): GameView {
  const round = Number(q.get('round') ?? (q.get('moment') === 'tier' ? 3 : 1))
  const tier = tierForRound(round)
  const category = CATEGORIES[q.get('parts') ?? '1'] ?? CATEGORIES['1']
  const players = lobby.players.map((p) => ({ ...p, lives: lobby.settings.lives, out: false }))
  const meAt = Math.max(0, players.findIndex((p) => p.id === lobby.meId))
  const turnAt = q.get('turn') === 'them' ? (meAt + 1) % players.length : meAt
  if (q.get('moment') === 'out') players[turnAt].lives = 1
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
  const turnSecs = turnSecondsFor(q, tier.seconds)
  const secs = Number(q.get('secs') ?? turnSecs)
  return {
    code: lobby.code,
    round,
    tier: tier.id,
    category,
    left: speciesLeftFor(category, answers, POKEDEX, POKEDEX_BY_ID),
    players,
    meId: lobby.meId,
    turnPlayerId: players[turnAt].id,
    turnNo: 1,
    deadlineAt: Date.now() + secs * 1000,
    seconds: turnSecs,
    startLives: lobby.settings.lives,
    answers,
    roundEnd: null,
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

/** A new round starting with `starter`: the next category, from the new round's tier. */
function nextRound(game: GameView, starter: string | null): GameView {
  const round = game.round + 1
  const tier = tierForRound(round)
  const category = categoryForRound(round)
  return {
    ...game,
    round,
    tier: tier.id,
    category,
    answers: [],
    left: speciesLeftFor(category, [], POKEDEX, POKEDEX_BY_ID),
    turnPlayerId: starter,
    turnNo: game.turnNo + 1,
    seconds: turnSecondsFor(new URLSearchParams(location.search), tier.seconds),
    deadlineAt: Date.now() + turnSecondsFor(new URLSearchParams(location.search), tier.seconds) * 1000,
  }
}

/** The round is cleared (a full lap, or the pool ran out): no life lost, the next player starts a harder category. */
function clearRound(game: GameView, by: string, exhausted: boolean): GameView {
  const next = nextRound(game, nextLiving(game, by))
  return { ...next, roundEnd: { kind: 'cleared', key: roundEndKey(1, game.round), round: game.round, exhausted, fromTier: game.tier, toTier: next.tier } }
}

/**
 * The turn passes after an answer: the next living player gets a fresh timer. When every living player has answered
 * this round (or no answers are left), the round is cleared.
 */
function passTurn(game: GameView, by: string, pokemonId: number, n: number): GameView {
  const player = game.players.find((p) => p.id === by)
  const answers = [{ id: `m${n}`, pokemonId, playerId: by, nickname: player?.nickname ?? '?' }, ...game.answers]
  const left = speciesLeftFor(game.category, answers, POKEDEX, POKEDEX_BY_ID)
  const lap = game.players.every((p) => p.out || answers.some((a) => a.playerId === p.id))
  if (lap || left === 0) return clearRound({ ...game, answers }, by, !lap)
  return {
    ...game,
    answers,
    left,
    turnPlayerId: nextLiving(game, by),
    turnNo: game.turnNo + 1,
    deadlineAt: Date.now() + game.seconds * 1000,
  }
}

/**
 * The turn's player ran out of time: they lose a life (out at 0), "Also fit" shows what nobody said, and a new round
 * starts with them (or the next living player). `over` when that leaves one player.
 */
function timeOut(game: GameView): { game: GameView; end: TimeoutEnd; over: boolean } {
  const turn = game.turnPlayerId
  const players = game.players.map((p) => (p.id === turn ? { ...p, lives: Math.max(0, p.lives - 1), out: p.lives <= 1 } : p))
  const failed = players.find((p) => p.id === turn)
  const end: TimeoutEnd = {
    kind: 'timeout',
    key: roundEndKey(1, game.round),
    round: game.round,
    playerId: turn ?? '',
    nickname: failed?.nickname ?? 'Someone',
    lives: failed?.lives ?? 0,
    out: failed?.out ?? false,
    category: game.category,
    saidIds: game.answers.map((a) => a.pokemonId),
    seed: alsoFitSeed('mock', 1, game.round),
  }
  const withPlayers = { ...game, players }
  const over = players.filter((p) => !p.out).length <= 1
  const next = nextRound(withPlayers, failed?.out ? nextLiving(withPlayers, turn) : turn)
  return { game: { ...next, roundEnd: end }, end, over }
}

/** What the mock remembers across rounds for the game over table: answers given and the categories cleared. */
interface MockStats {
  answers: Record<string, number>
  cleared: { category: Category; tier: TierId; round: number }[]
}

/** The game over screen for a finished mock game. */
function overFrom(game: GameView, lobby: LobbyView, stats: MockStats, finalTimeout: TimeoutEnd | null, gone: string[] = []): GameOverView {
  const living = game.players.filter((p) => !p.out && !gone.includes(p.id))
  const winner = living.length === 1 ? living[0] : null
  const rows: ResultPlayer[] = game.players
    .map((p) => ({
      id: p.id,
      nickname: p.nickname,
      icon: p.icon,
      answers: stats.answers[p.id] ?? 0,
      livesLost: Math.max(0, game.startLives - p.lives),
      lives: p.lives,
      out: p.out,
      gone: gone.includes(p.id),
      isWinner: p.id === winner?.id,
      isMe: p.id === game.meId,
    }))
    .sort((a, b) => Number(b.isWinner) - Number(a.isWinner) || Number(a.gone) - Number(b.gone) || b.lives - a.lives || b.answers - a.answers)
  const rank = (t: TierId) => ['easy', 'medium', 'hard', 'expert'].indexOf(t)
  const hardest = [...stats.cleared].sort((a, b) => rank(b.tier) - rank(a.tier) || b.round - a.round)[0]
  return {
    code: game.code,
    meId: game.meId,
    isHost: lobby.hostId === game.meId,
    winner: winner ? { id: winner.id, nickname: winner.nickname, icon: winner.icon } : null,
    players: rows,
    hardest: hardest ? { category: hardest.category, tier: hardest.tier } : null,
    rounds: game.round,
    finalTimeout,
  }
}

/** ?mock=over: a finished game for `lobby`'s players (the winner is the first other player, or you with &winner=me). */
function overFor(lobby: LobbyView, q: URLSearchParams): GameOverView {
  const base = gameFor(lobby, new URLSearchParams({ round: '14' }))
  const meAt = base.players.findIndex((p) => p.id === lobby.meId)
  const winnerAt = q.get('winner') === 'me' ? meAt : base.players.findIndex((p) => p.id !== lobby.meId)
  // In a bigger room one player left during the game (still listed, as "Left"). With &end=gone the game ended that way.
  const endGone = q.get('end') === 'gone'
  const goneAt = endGone || base.players.length > 3 ? base.players.findIndex((_, i) => i !== winnerAt && i !== meAt) : -1
  const loserAt = endGone ? -1 : base.players.findIndex((_, i) => i !== winnerAt && i !== goneAt)
  const players = base.players.map((p, i) =>
    i === winnerAt ? { ...p, lives: Math.min(2, p.lives) } : i === goneAt ? { ...p, lives: 1 } : { ...p, lives: 0, out: true },
  )
  const game: GameView = { ...base, players, round: 14, tier: 'expert', category: CATEGORIES['3'], answers: [] }
  const stats: MockStats = {
    answers: Object.fromEntries(players.map((p, i) => [p.id, 3 + ((i * 7 + 5) % 11)])),
    cleared:
      q.get('hardest') === 'none'
        ? []
        : [
            { category: CATEGORIES['1'], tier: 'easy', round: 1 },
            { category: DECK.hard[0], tier: 'hard', round: 9 },
            { category: CATEGORIES['3'], tier: 'expert', round: 12 },
          ],
  }
  const final =
    loserAt < 0
      ? null
      : timeOut({ ...game, players: players.map((p, i) => (i === loserAt ? { ...p, lives: 1, out: false } : p)), turnPlayerId: players[loserAt].id }).end
  return overFrom(game, lobby, stats, final, goneAt < 0 ? [] : [players[goneAt].id])
}

/** The pretend PartyController. `route` seeds ?mock=lobby and ?mock=game with the address's room code. */
export function useMockParty(route: PartyRoute): PartyController & { inGame: boolean } {
  const q = new URLSearchParams(location.search)
  const count = Number(q.get('players') ?? 3)
  const busy = q.get('busy') === '1'
  const [error, setError] = useState<string | undefined>(q.get('error') ?? undefined)
  const [lobby, setLobby] = useState<LobbyView | null>(() =>
    q.get('mock') === 'lobby' || q.get('mock') === 'game' || q.get('mock') === 'over'
      ? roomFor(route.screen === 'room' ? route.code : 'KPZW', { id: 'me', nickname: 'Ash', icon: 1, online: true }, count, q.get('as') !== 'guest', q)
      : null,
  )
  const [game, setGame] = useState<GameView | null>(() => (q.get('mock') === 'game' && lobby ? gameFor(lobby, q) : null))
  const [over, setOver] = useState<GameOverView | null>(() => (q.get('mock') === 'over' && lobby ? overFor(lobby, q) : null))
  const update = (f: (l: LobbyView) => LobbyView) => setLobby((l) => (l ? f(l) : l))
  const counter = useRef(0)
  const stats = useRef<MockStats>({ answers: {}, cleared: [] })
  const lobbyRef = useRef(lobby)
  useEffect(() => {
    lobbyRef.current = lobby
  })

  /** Applies a change to the game, keeping the stats; a time-out that leaves one player ends the game. */
  const step = (f: (g: GameView) => GameView | { game: GameView; end: TimeoutEnd; over: boolean }) =>
    setGame((g) => {
      if (!g) return g
      const res = f(g)
      const next = 'over' in res ? res.game : res
      if (next === g) return g
      const said = next.round === g.round ? next.answers[0] : next.roundEnd?.kind === 'cleared' ? { playerId: g.turnPlayerId ?? '' } : null
      if (said && (next.round !== g.round || next.answers[0] !== g.answers[0])) {
        stats.current.answers[said.playerId] = (stats.current.answers[said.playerId] ?? 0) + 1
      }
      if (next.roundEnd?.kind === 'cleared' && next.roundEnd !== g.roundEnd) stats.current.cleared.push({ category: g.category, tier: g.tier, round: g.round })
      if ('over' in res && res.over && lobbyRef.current) {
        const final = overFrom(next, lobbyRef.current, stats.current, res.end)
        setTimeout(() => setOver(final), 0)
        return null
      }
      return next
    })

  // &moment=...: one end-of-round moment 300 ms after the screen opens (with &early=1 the countdown gets there first).
  useEffect(() => {
    const kind = q.get('moment')
    if (!kind || q.get('mock') !== 'game') return
    const fire = () =>
      step((g) => {
        if (kind === 'timeout' || kind === 'out') return timeOut(g)
        const by = g.turnPlayerId ?? g.meId
        const pick = unusedEntries(g.category, POKEDEX, usedSpecies(g.answers, POKEDEX_BY_ID))[0]
        const answered = pick ? { ...g, answers: [{ id: 'mx', pokemonId: pick.id, playerId: by, nickname: '' }, ...g.answers] } : g
        return clearRound(answered, by, false)
      })
    if (q.get('early') === '1' && (kind === 'timeout' || kind === 'out')) {
      // The turn's deadline lands at 300 ms; the "server" answers 250 ms after it.
      setGame((g) => (g ? { ...g, deadlineAt: Date.now() + 300 } : g))
      const t = setTimeout(fire, 550)
      return () => clearTimeout(t)
    }
    const t = setTimeout(fire, 300)
    return () => clearTimeout(t)
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The other players each answer after 3 s with something that fits (not with &freeze=1). A turn that runs out costs
  // a life once the server's grace has passed, and starts a new round, which the player who failed starts.
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
          step((g) => {
            if (g.turnPlayerId !== turn) return g
            const pick = unusedEntries(g.category, POKEDEX, usedSpecies(g.answers, POKEDEX_BY_ID))[0]
            return pick ? passTurn(g, turn, pick.id, ++counter.current) : g
          })
        }, Number(q.get('think') ?? 3000)),
      )
    }
    timers.push(
      setTimeout(
        () => step((g) => (g.turnPlayerId !== turn || g.deadlineAt !== deadline ? g : timeOut(g))),
        Math.max(0, deadline - Date.now()) + PARTY_CONFIG.graceMs,
      ),
    )
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, deadline, meId, freeze])

  return {
    lobby,
    game,
    over,
    inGame: game !== null || over !== null,
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
      stats.current = { answers: {}, cleared: [] }
      setGame(gameFor(lobby, q))
    },
    remove: (id) => update((l) => ({ ...l, players: l.players.filter((p) => p.id !== id) })),
    leave: () => {
      setGame(null)
      setOver(null)
      setLobby(null)
    },
    playAgain: () => {
      stats.current = { answers: {}, cleared: [] }
      setOver(null)
      setGame(null)
      update((l) => ({ ...l, status: 'lobby' }))
    },
    answer: async (pokemonId) => {
      await new Promise((r) => setTimeout(r, 150))
      const g = game
      const p = POKEDEX_BY_ID.get(pokemonId)
      if (!g || !p || g.turnPlayerId !== g.meId) return { ok: false, reason: "It's not your turn." }
      if (g.deadlineAt !== null && Date.now() > g.deadlineAt + PARTY_CONFIG.graceMs) return { ok: false, reason: 'Too late!' }
      const check = checkLocally(g.category, p, g.answers, POKEDEX_BY_ID)
      if (!check.ok) return { ok: false, reason: check.reason }
      step((cur) => passTurn(cur, cur.meId, pokemonId, ++counter.current))
      return { ok: true }
    },
  }
}
