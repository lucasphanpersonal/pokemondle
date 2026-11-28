import { describe, expect, it } from 'vitest'
import { draftSettled, latestOnly, shownSettings, type SettingsDraft } from './optimistic.ts'

/** A send whose requests the test answers by hand, in order. */
function manual<T>() {
  const sent: T[] = []
  const answers: ((r: string) => void)[] = []
  const send = (v: T) => {
    sent.push(v)
    return new Promise<string>((resolve) => answers.push(resolve))
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))
  return { sent, send, answer: async (r: string) => (answers.shift()!(r), flush()), flush }
}

describe('shownSettings / draftSettled', () => {
  const room = { lives: 3, start_tier: 'easy' as const }
  const draft: SettingsDraft = { lives: 5, start_tier: 'hard' }

  it('shows the draft while there is one, else the room', () => {
    expect(shownSettings(room, draft)).toEqual(draft)
    expect(shownSettings(room, null)).toEqual({ lives: 3, start_tier: 'easy' })
  })

  it('a draft is settled once the room says the same', () => {
    expect(draftSettled(room, draft)).toBe(false)
    expect(draftSettled({ lives: 5, start_tier: 'hard' }, draft)).toBe(true)
    expect(draftSettled(null, draft)).toBe(false)
    expect(draftSettled(room, null)).toBe(false)
  })
})

describe('latestOnly', () => {
  const same = (a: number, b: number) => a === b

  it('sends one at a time, and only the latest of the taps made meanwhile', async () => {
    const m = manual<number>()
    const q = latestOnly<number, string>(same)
    const p1 = q.push(1, m.send)
    const p2 = q.push(2, m.send)
    const p3 = q.push(3, m.send)
    await m.flush()
    expect(m.sent).toEqual([1])
    expect(q.busy()).toBe(true)
    await m.answer('r1')
    expect(m.sent).toEqual([1, 3])
    await m.answer('r3')
    expect(q.busy()).toBe(false)
    // Every tap of the burst gets the last result.
    expect(await Promise.all([p1, p2, p3])).toEqual(['r3', 'r3', 'r3'])
  })

  it('skips a follow-up that equals what was just sent (tap 4, 5, back to 4)', async () => {
    const m = manual<number>()
    const q = latestOnly<number, string>(same)
    const p = q.push(4, m.send)
    void q.push(5, m.send)
    void q.push(4, m.send)
    await m.flush()
    await m.answer('r4')
    expect(m.sent).toEqual([4])
    expect(await p).toBe('r4')
  })

  it('idle resolves after the last request', async () => {
    const m = manual<number>()
    const q = latestOnly<number, string>(same)
    await q.idle()
    void q.push(1, m.send)
    let idle = false
    void q.idle().then(() => (idle = true))
    await m.flush()
    expect(idle).toBe(false)
    await m.answer('r1')
    expect(idle).toBe(true)
  })

  it('a new burst after an answer sends again, even the same value', async () => {
    const m = manual<number>()
    const q = latestOnly<number, string>(same)
    void q.push(1, m.send)
    await m.flush()
    await m.answer('a')
    void q.push(1, m.send)
    await m.flush()
    expect(m.sent).toEqual([1, 1])
  })

  it('a rejected request rejects the burst and leaves the queue usable', async () => {
    const send = async (v: number) => {
      if (v === 1) throw new Error('down')
      return `r${v}`
    }
    const q = latestOnly<number, string>(same)
    await expect(q.push(1, send)).rejects.toThrow('down')
    expect(q.busy()).toBe(false)
    expect(await q.push(2, send)).toBe('r2')
  })
})
