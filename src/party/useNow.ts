import { useSyncExternalStore } from 'react'

/*
 * One shared 50 ms clock for the game screen's countdowns. Only the components that draw or sound the countdown read it
 * (FuseTimer, TurnEvents), so the rest of the screen doesn't re-render 20 times a second.
 */

const TICK_MS = 50
let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    // Fresh on the first reader, so a countdown never starts from a stale time.
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      listeners.forEach((l) => l())
    }, TICK_MS)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) clearInterval(timer)
  }
}

const idle = () => () => {}
const read = () => now

/** Date.now(), updated every 50 ms while `running`. Not running, it holds still and nothing re-renders. */
export const useNow = (running: boolean): number => useSyncExternalStore(running ? subscribe : idle, read)
