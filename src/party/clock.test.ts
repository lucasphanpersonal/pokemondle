import { describe, expect, it } from 'vitest'
import { addSample, CLOCK_MAX_AGE_MS, estimateFrom, ServerClock } from './clock.ts'

describe('estimateFrom', () => {
  it('assumes the server stamped the reply halfway through the round trip', () => {
    // Sent at 1000, received at 1200, server says 5100: the server was at 5100 when we were at 1100.
    expect(estimateFrom({ sentAt: 1000, receivedAt: 1200, serverTime: 5100 })).toEqual({ offsetMs: 4000, rttMs: 200, at: 1200 })
  })

  it('handles a server behind us (negative offset)', () => {
    expect(estimateFrom({ sentAt: 10_000, receivedAt: 10_100, serverTime: 9_050 })?.offsetMs).toBe(-1000)
  })

  it('rejects impossible samples', () => {
    expect(estimateFrom({ sentAt: 2000, receivedAt: 1000, serverTime: 0 })).toBeNull()
    expect(estimateFrom({ sentAt: 0, receivedAt: 10, serverTime: Number.NaN })).toBeNull()
  })
})

describe('addSample', () => {
  const sample = (sentAt: number, rtt: number, offset: number) => ({ sentAt, receivedAt: sentAt + rtt, serverTime: sentAt + rtt / 2 + offset })

  it('keeps the sample with the smallest round trip', () => {
    let e = addSample(null, sample(0, 300, 1000))
    expect(e?.offsetMs).toBe(1000)
    e = addSample(e, sample(1000, 80, 1040)) // faster: wins
    expect(e).toMatchObject({ offsetMs: 1040, rttMs: 80 })
    e = addSample(e, sample(2000, 500, 900)) // slower: ignored
    expect(e).toMatchObject({ offsetMs: 1040, rttMs: 80 })
  })

  it('takes an equal round trip (newer is as good)', () => {
    let e = addSample(null, sample(0, 100, 10))
    e = addSample(e, sample(1000, 100, 20))
    expect(e?.offsetMs).toBe(20)
  })

  it('lets a slower sample replace one that has aged out', () => {
    let e = addSample(null, sample(0, 50, 100))
    e = addSample(e, sample(CLOCK_MAX_AGE_MS + 1000, 400, 130))
    expect(e).toMatchObject({ offsetMs: 130, rttMs: 400 })
  })

  it('ignores a bad sample', () => {
    const e = addSample(null, sample(0, 50, 100))
    expect(addSample(e, { sentAt: 5, receivedAt: 1, serverTime: 3 })).toBe(e)
  })
})

describe('ServerClock', () => {
  it('is offset 0 until a reply arrives, then maps local to server time', () => {
    const c = new ServerClock()
    expect(c.known).toBe(false)
    expect(c.offsetMs).toBe(0)
    c.add({ sentAt: 1000, receivedAt: 1100, serverTime: 6050 })
    expect(c.known).toBe(true)
    expect(c.offsetMs).toBe(5000)
    expect(c.serverNow(2000)).toBe(7000)
  })
})
