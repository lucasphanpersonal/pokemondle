import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { TierId } from '../config/partyConfig.ts'
import {
  createPartyApi,
  createPartyRpc,
  readPartyEnv,
  type ApiResult,
  type AnswerReply,
  type JoinedReply,
  type PartyRpc,
} from './api.ts'
import { asRpcClient, fetchSnapshot, loadClient, subscribeToRoom, type Subscription } from './client.ts'
import { ServerClock } from './clock.ts'
import { clearSession, decideRejoin, readSession, writeSession, type PartySession } from './session.ts'
import {
  deadlineLocalMs,
  initialPartyState,
  partyReducer,
  selectAnswersThisRound,
  selectCurrentCategory,
  selectIsHost,
  selectLivingPlayers,
  selectMe,
  selectMyTurn,
  selectPresentPlayers,
  selectTurnPlayer,
} from './state.ts'

/**
 * Connects the Party page to its room: rejoins from localStorage, loads a snapshot with supabase-js (a dynamic import),
 * follows the room over Realtime, sends a heartbeat every 4 s, estimates the server clock and, when the turn timer
 * reaches zero, asks the database to end the turn. All the room rules live on the server; this only mirrors them.
 */

export type PartyStatus = 'unavailable' | 'connecting' | 'ready' | 'error'

export const PARTY_UNREACHABLE = "Can't reach the party server right now"
export const HEARTBEAT_MS = 4000
/** party_timeout at zero lands inside the server's 300 ms grace, so ask again a moment later. */
export const TIMEOUT_RETRY_MS = 400

export interface HostOptions {
  lives?: number
  start_tier?: TierId
}

export function useParty(routeCode: string | null) {
  const env = useMemo(() => readPartyEnv(), [])
  const [clock] = useState(() => new ServerClock())
  const api = useMemo(
    () => (env ? createPartyApi({ url: env.url, onClockSample: (s) => clock.add(s) }) : null),
    [env, clock],
  )

  const [session, setSessionState] = useState<PartySession | null>(null)
  const sessionRef = useRef<PartySession | null>(null)
  const [state, dispatch] = useReducer(partyReducer, null, () => initialPartyState())
  const [status, setStatus] = useState<PartyStatus>(() =>
    !env ? 'unavailable' : decideRejoin(readSession(), routeCode) === 'rejoin' ? 'connecting' : 'ready',
  )
  /** True once the server stopped recognising our token (removed, or the room is gone): the seat is lost. */
  const [lost, setLost] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const rpcRef = useRef<PartyRpc | null>(null)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  const setSession = useCallback((next: PartySession | null) => {
    sessionRef.current = next
    setSessionState(next)
  }, [])

  const loseSeat = useCallback(() => {
    clearSession()
    setSession(null)
    setLost(true)
  }, [setSession])

  // The seat that matches the room in the address (a seat for another room is kept but not used).
  const active = session && routeCode !== null && session.code === routeCode ? session : null

  // 1. On load (or when the address changes to a room we hold a stored seat for), rejoin with the stored token.
  useEffect(() => {
    if (!api) return
    if (routeCode === null || sessionRef.current?.code === routeCode) return
    const stored = readSession()
    if (decideRejoin(stored, routeCode) !== 'rejoin' || !stored) return
    let cancelled = false
    void api.rejoin({ player_id: stored.player_id, token: stored.token }).then((res) => {
      if (cancelled) return
      if (res.ok) {
        // Room and player come from the server; the token is still the stored one.
        setSession({ code: res.code, room_id: res.room_id, player_id: res.player_id, token: stored.token })
      } else if (res.status === 401 || res.error === 'bad_token') {
        clearSession()
        setStatus('ready')
      } else {
        setStatus('error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [api, routeCode, retryTick, setSession])

  // 2. With a seat in the room: subscribe, load the snapshot (again on every resubscribe) and send heartbeats.
  const roomId = active?.room_id ?? null
  const playerId = active?.player_id ?? null
  const token = active?.token ?? null
  useEffect(() => {
    if (!env || !roomId || !playerId || !token) return
    let cancelled = false
    let sub: Subscription | null = null
    let heartbeat: ReturnType<typeof setInterval> | undefined
    if (stateRef.current.roomId !== roomId) dispatch({ type: 'reset', roomId })

    void (async () => {
      let client
      try {
        client = await loadClient(env)
      } catch {
        if (!cancelled) setStatus('error')
        return
      }
      if (cancelled) return
      const rpc = createPartyRpc(asRpcClient(client), { onClockSample: (s) => clock.add(s) })
      rpcRef.current = rpc

      let dirty = false
      // Read the room as it is now. Events that arrive during the read might be missing from it, so read again
      // (up to 3 reads); events after that are applied live.
      const refresh = async () => {
        for (let i = 0; i < 3; i++) {
          dirty = false
          const snap = await fetchSnapshot(client, roomId)
          if (cancelled) return
          if (!dirty || i === 2) {
            dispatch({ type: 'snapshot', roomId, ...snap })
            return
          }
        }
      }

      sub = subscribeToRoom(
        client,
        roomId,
        (table, event, row) => {
          dirty = true
          dispatch({ type: 'change', table, event, row })
        },
        (s) => {
          if (cancelled) return
          if (s === 'SUBSCRIBED') {
            refresh().then(
              () => !cancelled && setStatus('ready'),
              () => !cancelled && setStatus('error'),
            )
          } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
            setStatus('connecting')
          }
        },
      )

      const beat = () =>
        void rpc.heartbeat(playerId, token).then((r) => {
          if (!cancelled && !r.ok && r.error === 'bad_token') loseSeat()
        })
      beat()
      heartbeat = setInterval(beat, HEARTBEAT_MS)
    })()

    return () => {
      cancelled = true
      sub?.close()
      clearInterval(heartbeat)
      rpcRef.current = null
    }
  }, [env, roomId, playerId, token, retryTick, clock, loseSeat])

  // 3. When the visible countdown reaches zero, ask the database to end the turn (every client does; it acts once).
  const room = state.room
  const turnNo = room?.turn_no ?? null
  const deadlineIso = room?.deadline ?? null
  const playing = room?.status === 'playing'
  useEffect(() => {
    if (!roomId || !playing || turnNo === null) return
    const at = deadlineLocalMs(stateRef.current.room, clock.offsetMs)
    if (at === null) return
    let retry: ReturnType<typeof setTimeout> | undefined
    const ask = () => void rpcRef.current?.timeout(roomId, turnNo)
    const first = setTimeout(
      () => {
        ask()
        // Retry once if this turn is still running (the first call usually lands inside the 300 ms grace).
        retry = setTimeout(() => {
          const r = stateRef.current.room
          if (r?.status === 'playing' && r.turn_no === turnNo) ask()
        }, TIMEOUT_RETRY_MS)
      },
      Math.max(0, at - Date.now()),
    )
    return () => {
      clearTimeout(first)
      clearTimeout(retry)
    }
  }, [roomId, playing, turnNo, deadlineIso, clock])

  // ------------------------------------------------------------------------------------------ actions ----

  const unavailable = useCallback(async (): Promise<ApiResult<never>> => ({ ok: false, error: 'network', status: 0 }), [])

  /** Best-effort leave of a seat we are replacing. */
  const dropOldSeat = useCallback(() => {
    const old = sessionRef.current
    if (old && api) void api.leave(old)
  }, [api])

  const adopt = useCallback(
    (res: ApiResult<JoinedReply>) => {
      if (!res.ok) return res
      const next: PartySession = { code: res.code, room_id: res.room_id, player_id: res.player_id, token: res.token }
      writeSession(next)
      setLost(false)
      setStatus('connecting')
      setSession(next)
      return res
    },
    [setSession],
  )

  const host = useCallback(
    async (nickname: string, options: HostOptions = {}) => {
      if (!api) return unavailable()
      dropOldSeat()
      return adopt(await api.create({ nickname, ...options }))
    },
    [api, adopt, dropOldSeat, unavailable],
  )

  const join = useCallback(
    async (code: string, nickname: string) => {
      if (!api) return unavailable()
      const old = sessionRef.current
      const res = await api.join({ code, nickname })
      if (res.ok && old && old.room_id !== res.room_id) void api.leave(old)
      return adopt(res)
    },
    [api, adopt, unavailable],
  )

  /** Runs an action with this player's credentials; a refused token means the seat is gone. */
  const authed = useCallback(
    async <T,>(run: (a: NonNullable<typeof api>, s: PartySession) => Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      const s = sessionRef.current
      if (!api || !s) return { ok: false, error: api ? 'bad_token' : 'network', status: api ? 401 : 0 }
      const res = await run(api, s)
      if (!res.ok && res.error === 'bad_token') loseSeat()
      return res
    },
    [api, loseSeat],
  )

  const leave = useCallback(async () => {
    const s = sessionRef.current
    clearSession()
    setSession(null)
    setLost(false)
    dispatch({ type: 'reset', roomId: null })
    if (api && s) await api.leave(s) // the seat is already gone locally; this frees it on the server
  }, [api, setSession])

  const start = useCallback(() => authed((a, s) => a.start(s)), [authed])
  const settings = useCallback(
    (lives: number, startTier: TierId) => authed((a, s) => a.settings(s, { lives, start_tier: startTier })),
    [authed],
  )
  const remove = useCallback((targetId: string) => authed((a, s) => a.remove(s, targetId)), [authed])
  const answer = useCallback(
    (pokemonId: number): Promise<ApiResult<AnswerReply>> => authed((a, s) => a.answer(s, pokemonId)),
    [authed],
  )
  /** Sends the room back to the lobby; the host then calls start again. */
  const playAgain = useCallback(() => authed((a, s) => a.playAgain(s)), [authed])

  const retry = useCallback(() => {
    setStatus('connecting')
    setRetryTick((n) => n + 1)
  }, [])

  const me = selectMe(state, playerId)
  // Outside a room there is nothing to connect to, so a stale error from the last room isn't shown.
  const shown: PartyStatus = routeCode === null && status !== 'unavailable' ? 'ready' : status
  return {
    status: shown,
    /** Set when status is 'error'. */
    errorText: shown === 'error' ? PARTY_UNREACHABLE : null,
    /** The seat for the room in the address (null before joining). */
    session: active,
    lost,
    state,
    room,
    me,
    isHost: selectIsHost(state, playerId),
    myTurn: selectMyTurn(state, playerId),
    turnPlayer: selectTurnPlayer(state),
    players: selectPresentPlayers(state),
    livingPlayers: selectLivingPlayers(state),
    category: selectCurrentCategory(state),
    answers: selectAnswersThisRound(state),
    /** The turn deadline in this browser's clock (epoch ms), or null. */
    deadlineAt: deadlineLocalMs(room, clock.offsetMs),
    clockOffsetMs: clock.offsetMs,
    host,
    join,
    leave,
    start,
    settings,
    remove,
    answer,
    playAgain,
    retry,
  }
}

export type PartyHandle = ReturnType<typeof useParty>
