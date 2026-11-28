import type { TierId } from '../config/partyConfig.ts'
import type { RoomRow } from './state.ts'

/**
 * Showing the host's own lobby settings at once. A tap shows the new setting pressed immediately (a draft over the
 * room row) while the request goes out; taps made during a request are folded into one follow-up request with the
 * latest choice, so the requests never overtake each other and the room ends on what was tapped last. The draft goes
 * once the room row says the same (from the reply, or from Realtime), and is dropped if the server refuses.
 * Pure: no React, no network.
 */

export interface SettingsDraft {
  lives: number
  start_tier: TierId
}

/** What the lobby shows: the draft while there is one, otherwise the room's own settings. */
export function shownSettings(room: Pick<RoomRow, 'lives' | 'start_tier'>, draft: SettingsDraft | null): SettingsDraft {
  return draft ?? { lives: room.lives, start_tier: room.start_tier }
}

/** The room row already shows the draft, so the draft can go. */
export const draftSettled = (room: Pick<RoomRow, 'lives' | 'start_tier'> | null, draft: SettingsDraft | null): boolean =>
  !!room && !!draft && room.lives === draft.lives && room.start_tier === draft.start_tier

export interface LatestOnly<T, R> {
  /**
   * Asks for `value`, sent with `send` (the newest push's `send` is used); resolves with the result of the last request
   * of the burst it joins (which carries the latest value).
   */
  push(value: T, send: (value: T) => Promise<R>): Promise<R>
  /** Resolves once nothing is being sent (at once when idle). */
  idle(): Promise<void>
  /** True while a request is on its way. */
  busy(): boolean
}

/**
 * Sends one request at a time, always with the latest value: values pushed while a request is out replace each other,
 * and the newest goes next (unless it equals what was just sent). Every push of a burst settles with the burst's last
 * result (or its error, if a request rejects).
 */
export function latestOnly<T, R>(same: (a: T, b: T) => boolean): LatestOnly<T, R> {
  let running = false
  let wanted: { value: T; send: (value: T) => Promise<R> } | null = null
  let waiters: { resolve: (r: R) => void; reject: (e: unknown) => void }[] = []
  let idlers: (() => void)[] = []

  async function pump() {
    running = true
    let last: { value: T; result: R } | null = null
    let failure: { error: unknown } | null = null
    while (wanted) {
      const { value, send } = wanted
      wanted = null
      if (last && same(last.value, value)) continue
      try {
        last = { value, result: await send(value) }
      } catch (error) {
        failure = { error }
        wanted = null
      }
    }
    running = false
    const done = waiters
    waiters = []
    for (const w of done) {
      if (failure) w.reject(failure.error)
      else w.resolve(last!.result)
    }
    const idle = idlers
    idlers = []
    idle.forEach((f) => f())
  }

  return {
    push(value, send) {
      wanted = { value, send }
      const p = new Promise<R>((resolve, reject) => waiters.push({ resolve, reject }))
      if (!running) void pump()
      return p
    },
    idle: () => (running ? new Promise<void>((resolve) => idlers.push(resolve)) : Promise.resolve()),
    busy: () => running,
  }
}
