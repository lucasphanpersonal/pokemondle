import { useCallback, useState } from 'react'
import { friendlyError } from './api.ts'
import type { PlayerRow, RoomRow } from './state.ts'
import type { LobbyPlayer, LobbyView, PartyController, PartySettings } from './types.ts'
import { PARTY_UNREACHABLE, useParty } from './useParty.ts'

/** Words for a start-screen or lobby problem that isn't a server refusal. */
export const UNAVAILABLE_TEXT = "Party isn't available right now."
export const LOST_SEAT_TEXT = 'You are no longer in this room.'

/** Maps the room rows to what the lobby shows: present players only, longest-joined first. */
export function toLobbyView(code: string, room: RoomRow, players: readonly PlayerRow[], meId: string): LobbyView {
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
    settings: { lives: room.lives, startTier: room.start_tier },
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

  const lobby = session && room ? toLobbyView(session.code, room, players, session.player_id) : null
  const error = actionError ?? (status === 'error' ? `${PARTY_UNREACHABLE}.` : party.lost ? LOST_SEAT_TEXT : undefined)

  return {
    lobby,
    busy: pending > 0 || status === 'connecting',
    error,
    inGame: !!lobby && lobby.status !== 'lobby' && me?.seat != null,
    host: (nickname) => guard(() => party.host(nickname)),
    join: (code, nickname) => guard(() => party.join(code, nickname)),
    changeSettings: (s: PartySettings) => guard(() => party.settings(s.lives, s.startTier)),
    start: () => guard(party.start),
    remove: (id) => guard(() => party.remove(id)),
    leave: () => {
      setActionError(undefined)
      void party.leave()
    },
  }
}
