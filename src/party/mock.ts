/*
 * TEMPORARY, development only: a pretend room connection so the start screen and lobby can be seen and screenshotted
 * before the real one (useParty, task 6) exists. PartyApp only uses it when import.meta.env.DEV is true and the address
 * has ?mock, so production builds drop it. Task 6: delete this file and its one use in PartyApp.tsx.
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
 */
import { useState } from 'react'
import { PARTY_CONFIG } from '../config/partyConfig.ts'
import type { PartyRoute } from './route.ts'
import type { LobbyPlayer, LobbyView, PartyController, PartySettings, PartyStatus } from './types.ts'

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

/** The pretend PartyController. `route` seeds ?mock=lobby with the address's room code. */
export function useMockParty(route: PartyRoute): PartyController {
  const q = new URLSearchParams(location.search)
  const count = Number(q.get('players') ?? 3)
  const busy = q.get('busy') === '1'
  const [error, setError] = useState<string | undefined>(q.get('error') ?? undefined)
  const [lobby, setLobby] = useState<LobbyView | null>(() =>
    q.get('mock') === 'lobby'
      ? roomFor(route.screen === 'room' ? route.code : 'KPZW', { id: 'me', nickname: 'Ash', icon: 1, online: true }, count, q.get('as') !== 'guest', q)
      : null,
  )
  const update = (f: (l: LobbyView) => LobbyView) => setLobby((l) => (l ? f(l) : l))

  return {
    lobby,
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
    start: () => setError('Mock room: the game screen comes with task 10.'),
    remove: (id) => update((l) => ({ ...l, players: l.players.filter((p) => p.id !== id) })),
    leave: () => setLobby(null),
  }
}
