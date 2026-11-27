/**
 * Server clock offset. Every reply from the party server carries `server_time` (epoch ms). With the time we sent the
 * request and the time the reply arrived, the server's clock was about `serverTime - (sent + received) / 2` ahead of
 * ours. A reply that took longer is less certain (the true instant could be anywhere inside the round trip), so we keep
 * the sample with the smallest round trip. Samples age out so a drifting clock is re-measured.
 */
export interface ClockSample {
  /** Local epoch ms when the request was sent and when the reply arrived. */
  sentAt: number
  receivedAt: number
  /** The server's epoch ms in the reply. */
  serverTime: number
}

export interface ClockEstimate {
  /** serverNow - localNow, in ms. */
  offsetMs: number
  /** Round trip of the sample behind the offset. */
  rttMs: number
  /** Local epoch ms the sample was taken. */
  at: number
}

/** A best sample older than this is replaced by any newer one. */
export const CLOCK_MAX_AGE_MS = 5 * 60_000

export function estimateFrom(sample: ClockSample): ClockEstimate | null {
  const rtt = sample.receivedAt - sample.sentAt
  if (!Number.isFinite(rtt) || !Number.isFinite(sample.serverTime) || rtt < 0) return null
  return { offsetMs: sample.serverTime - (sample.sentAt + sample.receivedAt) / 2, rttMs: rtt, at: sample.receivedAt }
}

/** Folds a sample into the current estimate: the smaller round trip wins, unless the estimate has grown old. */
export function addSample(current: ClockEstimate | null, sample: ClockSample): ClockEstimate | null {
  const next = estimateFrom(sample)
  if (!next) return current
  if (!current) return next
  if (next.rttMs <= current.rttMs || next.at - current.at > CLOCK_MAX_AGE_MS) return next
  return current
}

/** Small holder for the current estimate (offset 0 until a sample arrives). */
export class ServerClock {
  private estimate: ClockEstimate | null = null
  add(sample: ClockSample): void {
    this.estimate = addSample(this.estimate, sample)
  }
  get offsetMs(): number {
    return this.estimate?.offsetMs ?? 0
  }
  get known(): boolean {
    return this.estimate !== null
  }
  /** The server's idea of now. */
  serverNow(localNow: number = Date.now()): number {
    return localNow + this.offsetMs
  }
}
