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
  type SettingsReply,
} from './api.ts'
import { asRpcClient, fetchLobby, fetchSnapshot, loadClient, subscribeToRoom, type Subscription } from './client.ts'
import { ServerClock } from './clock.ts'
import { createResync, type Resync } from './resync.ts'
import { draftSettled, latestOnly, type SettingsDraft } from './optimistic.ts'
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
/**
 * How long a room may take to connect (supabase-js loaded, Realtime subscribed, first snapshot read). Past it the page
 * says it can't reach the party server instead of waiting quietly: Realtime blocked (a firewall, or a security header
 * without the wss:// address) fails this way while the function calls still work.
 */
export const CONNECT_TIMEOUT_MS = 10_000

/**
 * The status the page shows. Outside a room a stale error from the last room isn't shown, except when hosting or
 * joining just failed to connect (`connectFailed`): the start screen must say so.
 */
export function shownStatus(status: PartyStatus, routeCode: string | null, connectFailed: boolean): PartyStatus {
  return routeCode === null && status !== 'unavailable' && !connectFailed ? 'ready' : status
}

/** A settings draft whose reply carried no room row waits this long for Realtime at most. */
export const DRAFT_KEEP_MS = 5000

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
  /** True when a room just hosted or joined could not connect: the seat was given up and the start screen says why. */
  const [connectFailed, setConnectFailed] = useState(false)
  /** The seat came from Host or Join in this page (not a rejoin): if it can't connect, it is given up. */
  const freshRef = useRef(false)
  const [retryTick, setRetryTick] = useState(0)
  const rpcRef = useRef<PartyRpc | null>(null)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })
  /** The host's last lobby tap and the room it is for, shown pressed until the server confirms it (optimistic.ts). */
  const [settingsDraft, setSettingsDraft] = useState<{ roomId: string; draft: SettingsDraft; sending: boolean } | null>(null)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(draftTimer.current), [])

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
  const active = session && (routeCode === null || session.code === routeCode) ? session : null

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

  // A room that never connected: a seat from Host or Join is given up (it would only be a ghost in the lobby, kept
  // alive by the heartbeat) and the start screen says the server can't be reached; a rejoined seat keeps trying.
  const failConnect = useCallback(() => {
    const s = sessionRef.current
    if (!freshRef.current || !s) {
      setStatus('error')
      return
    }
    freshRef.current = false
    clearSession()
    setSession(null)
    dispatch({ type: 'reset', roomId: null })
    setConnectFailed(true)
    setStatus('error')
    if (api) void api.leave(s)
  }, [api, setSession])

  // 2. With a seat in the room: subscribe, load the snapshot (again on every resubscribe, once more a moment later, and
  // the players every few seconds in the lobby: resync.ts) and send heartbeats.
  const roomId = active?.room_id ?? null
  const playerId = active?.player_id ?? null
  const token = active?.token ?? null
  useEffect(() => {
    if (!env || !roomId || !playerId || !token) return
    let cancelled = false
    let connected = false
    let sub: Subscription | null = null
    let resync: Resync | null = null
    let heartbeat: ReturnType<typeof setInterval> | undefined
    if (stateRef.current.roomId !== roomId) dispatch({ type: 'reset', roomId })
    const connectTimer = setTimeout(() => {
      if (!cancelled && !connected) failConnect()
    }, CONNECT_TIMEOUT_MS)

    void (async () => {
      let client
      try {
        client = await loadClient(env)
      } catch {
        if (!cancelled) failConnect()
        return
      }
      if (cancelled) return
      const rpc = createPartyRpc(asRpcClient(client), { onClockSample: (s) => clock.add(s) })
      rpcRef.current = rpc

      // Counts the Realtime changes seen, so a read can tell whether one arrived while it was out.
      let changes = 0
      // Read the room as it is now. Events that arrive during the read might be missing from it, so read again
      // (up to 3 reads); events after that are applied live.
      const refresh = async () => {
        for (let i = 0; i < 3; i++) {
          const seen = changes
          const snap = await fetchSnapshot(client, roomId)
          if (cancelled) return
          if (changes === seen || i === 2) {
            dispatch({ type: 'snapshot', roomId, ...snap })
            return
          }
        }
      }
      // In the lobby: the room row and players only. A change during the read means Realtime is delivering; the next
      // poll checks again. A room that has left the lobby (a start Realtime missed) gets a full snapshot.
      const pollLobby = async () => {
        const seen = changes
        const { room: r, players } = await fetchLobby(client, roomId)
        if (cancelled || changes !== seen) return
        const cur = stateRef.current.room
        if (r && (r.status !== 'lobby' || (cur && r.game_no !== cur.game_no))) await refresh()
        else dispatch({ type: 'lobby', roomId, room: r, players })
      }
      const quietly = (read: () => Promise<void>) => () => void read().catch(() => {})
      resync = createResync({
        refresh: quietly(refresh),
        pollLobby: quietly(pollLobby),
        inLobby: () => stateRef.current.room?.status === 'lobby',
      })

      sub = subscribeToRoom(
        client,
        roomId,
        (table, event, row) => {
          changes++
          dispatch({ type: 'change', table, event, row })
        },
        (s) => {
          if (cancelled) return
          if (s === 'SUBSCRIBED') {
            resync?.subscribed()
            refresh().then(
              () => {
                if (cancelled) return
                connected = true
                freshRef.current = false
                clearTimeout(connectTimer)
                setStatus('ready')
              },
              () => !cancelled && setStatus('error'),
            )
          } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
            setStatus('connecting')
          }
        },
        () => !cancelled && resync?.changesReady(),
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
      clearTimeout(connectTimer)
      sub?.close()
      resync?.close()
      clearInterval(heartbeat)
      rpcRef.current = null
    }
  }, [env, roomId, playerId, token, retryTick, clock, loseSeat, failConnect])

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
        }, TIMEOUT_RETRY_MS + Math.random() * 50)
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

  const adopt = useCallback(
    (res: ApiResult<JoinedReply>) => {
      if (!res.ok) return res
      const next: PartySession = { code: res.code, room_id: res.room_id, player_id: res.player_id, token: res.token }
      writeSession(next)
      setLost(false)
      setConnectFailed(false)
      freshRef.current = true
      setStatus('connecting')
      setSession(next)
      return res
    },
    [setSession],
  )

  const host = useCallback(
    async (nickname: string, options: HostOptions = {}) => {
      if (!api) return unavailable()
      const old = sessionRef.current
      const res = await api.create({ nickname, ...options })
      // Free the seat we are replacing only once the new one exists (a failed create must not cost the old seat).
      if (res.ok && old) void api.leave(old)
      return adopt(res)
    },
    [api, adopt, unavailable],
  )

  const join = useCallback(
    async (code: string, nickname: string) => {
      if (!api) return unavailable()
      const old = sessionRef.current
      const res = await api.join({ code, nickname })
      // Joining the same room again makes a new player, so the old one would be a ghost: leave it too.
      if (res.ok && old) void api.leave(old)
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
    setConnectFailed(false)
    dispatch({ type: 'reset', roomId: null })
    if (api && s) await api.leave(s) // the seat is already gone locally; this frees it on the server
  }, [api, setSession])

  // Lobby settings: shown at once as a draft; one request at a time, always with the latest tap.
  const [settingsQueue] = useState(() =>
    latestOnly<SettingsDraft, ApiResult<SettingsReply>>((x, y) => x.lives === y.lives && x.start_tier === y.start_tier),
  )
  const settings = useCallback(
    async (lives: number, startTier: TierId): Promise<ApiResult<SettingsReply>> => {
      const forRoom = sessionRef.current?.room_id
      if (!forRoom) return authed((a, s) => a.settings(s, { lives, start_tier: startTier }))
      const draft: SettingsDraft = { lives, start_tier: startTier }
      setSettingsDraft({ roomId: forRoom, draft, sending: true })
      const res = await settingsQueue.push(draft, (d) => authed((a, s) => a.settings(s, d)))
      const mine = (d: typeof settingsDraft) => d?.roomId === forRoom && d.draft === draft
      if (!res.ok) {
        // Refused: show the room as it is (unless a newer tap took over meanwhile).
        setSettingsDraft((d) => (mine(d) ? null : d))
      } else if (res.room) {
        // The reply's room row shows the change now (Realtime's copy of it changes nothing), so the draft can go.
        dispatch({ type: 'reply', room: res.room })
        setSettingsDraft((d) => (mine(d) ? null : d))
      } else {
        // No row in the reply: keep showing the draft until Realtime brings the room (render drops it once they agree).
        setSettingsDraft((d) => (mine(d) ? { ...d!, sending: false } : d))
        clearTimeout(draftTimer.current)
        draftTimer.current = setTimeout(() => setSettingsDraft((d) => (mine(d) ? null : d)), DRAFT_KEEP_MS)
      }
      return res
    },
    [authed, settingsQueue],
  )
  // Start only once the last settings change has landed, so the game uses what the host sees.
  const start = useCallback(async () => {
    await settingsQueue.idle()
    return authed((a, s) => a.start(s))
  }, [authed, settingsQueue])
  const remove = useCallback((targetId: string) => authed((a, s) => a.remove(s, targetId)), [authed])
  const answer = useCallback(
    async (pokemonId: number): Promise<ApiResult<AnswerReply>> => {
      const res = await authed((a, s) => a.answer(s, pokemonId))
      // Show the passed turn and the answer itself now, not when Realtime brings the same rows (about 0.2-0.4 s later).
      if (res.ok && (res.room || res.answer)) dispatch({ type: 'reply', room: res.room, answers: res.answer ? [res.answer] : [] })
      return res
    },
    [authed],
  )
  /** Sends the room back to the lobby; the host then calls start again. */
  const playAgain = useCallback(() => authed((a, s) => a.playAgain(s)), [authed])

  const retry = useCallback(() => {
    setStatus('connecting')
    setRetryTick((n) => n + 1)
  }, [])

  const draftHere = settingsDraft?.roomId === roomId ? settingsDraft : null
  const shownDraft =
    draftHere && (draftHere.sending || !draftSettled(state.room, draftHere.draft)) ? draftHere.draft : null

  const me = selectMe(state, playerId)
  const shown = shownStatus(status, routeCode, connectFailed)
  return {
    status: shown,
    /** Set when status is 'error'. */
    errorText: shown === 'error' ? PARTY_UNREACHABLE : null,
    /** The seat for the room in the address (null before joining). */
    session: active,
    lost,
    state,
    room,
    /** The host's lobby settings tap that the room doesn't show yet (show it instead of the room's), or null. */
    settingsDraft: shownDraft,
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
