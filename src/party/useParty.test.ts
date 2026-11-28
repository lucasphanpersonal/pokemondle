import { describe, expect, it } from 'vitest'
import { CONNECT_TIMEOUT_MS, shownStatus } from './useParty.ts'

describe('shownStatus', () => {
  it('hides a stale error from the last room on the start screen', () => {
    expect(shownStatus('error', null, false)).toBe('ready')
    expect(shownStatus('connecting', null, false)).toBe('ready')
  })

  it('shows the error on the start screen when hosting or joining could not connect (Realtime blocked)', () => {
    expect(shownStatus('error', null, true)).toBe('error')
  })

  it('shows the status as it is inside a room, and unavailable everywhere', () => {
    expect(shownStatus('error', 'KPZW', false)).toBe('error')
    expect(shownStatus('connecting', 'KPZW', false)).toBe('connecting')
    expect(shownStatus('unavailable', null, false)).toBe('unavailable')
  })

  it('gives a room a few seconds to connect before saying the server is unreachable', () => {
    expect(CONNECT_TIMEOUT_MS).toBeGreaterThanOrEqual(5000)
    expect(CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(15000)
  })
})
