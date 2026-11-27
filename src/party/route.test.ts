import { describe, expect, it } from 'vitest'
import { PARTY_CONFIG } from '../config/partyConfig.ts'
import { hashFor, normaliseCode, parseHash } from './route.ts'

describe('room codes', () => {
  it('uses 20 letters with no vowels and no L', () => {
    const letters = PARTY_CONFIG.roomCodeAlphabet
    expect(letters).toHaveLength(20)
    expect(new Set(letters).size).toBe(20)
    expect(letters).not.toMatch(/[AEIOUL]/)
  })

  it('normalises case and spaces', () => {
    expect(normaliseCode('kpzw')).toBe('KPZW')
    expect(normaliseCode(' KpZw ')).toBe('KPZW')
  })

  it('refuses vowels, L, digits and wrong lengths', () => {
    for (const bad of ['AEIO', 'KPLW', 'KPZ1', 'KPZ', 'KPZWX', '', 'KP W']) expect(normaliseCode(bad)).toBeNull()
  })
})

describe('parseHash', () => {
  it('reads an empty hash as the start screen', () => {
    expect(parseHash('')).toEqual({ screen: 'start' })
    expect(parseHash('#')).toEqual({ screen: 'start' })
  })

  it('reads a code as its room', () => {
    expect(parseHash('#KPZW')).toEqual({ screen: 'room', code: 'KPZW' })
    expect(parseHash('#kpzw')).toEqual({ screen: 'room', code: 'KPZW' })
    expect(parseHash('#/KPZW')).toEqual({ screen: 'room', code: 'KPZW' })
    expect(parseHash('#%20kpzw')).toEqual({ screen: 'room', code: 'KPZW' })
  })

  it('falls back to the start screen with the bad code', () => {
    expect(parseHash('#AEIO')).toEqual({ screen: 'start', badCode: 'AEIO' })
    expect(parseHash('#%E0%A4%A')).toEqual({ screen: 'start', badCode: '%E0%A4%A' })
    expect(parseHash('#' + 'X'.repeat(40))).toEqual({ screen: 'start', badCode: 'X'.repeat(12) })
  })

  it('round-trips through hashFor', () => {
    expect(hashFor({ screen: 'room', code: 'KPZW' })).toBe('#KPZW')
    expect(hashFor({ screen: 'start' })).toBe('')
    expect(parseHash(hashFor({ screen: 'room', code: 'BCDF' }))).toEqual({ screen: 'room', code: 'BCDF' })
  })
})
