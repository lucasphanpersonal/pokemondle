import { describe, expect, it } from 'vitest'
import { clearSession, decideRejoin, parseSession, readSession, SESSION_KEY, writeSession, type PartySession, type StorageLike } from './session.ts'

const SESSION: PartySession = {
  code: 'KPZW',
  room_id: '11111111-1111-4111-8111-111111111111',
  player_id: '22222222-2222-4222-8222-222222222222',
  token: 'a'.repeat(64),
}

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
    removeItem: (k) => void delete data[k],
  }
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
  removeItem: () => {
    throw new Error('blocked')
  },
}

describe('stored session', () => {
  it('round-trips through storage under the agreed key', () => {
    const s = fakeStorage()
    writeSession(SESSION, s)
    expect(Object.keys(s.data)).toEqual([SESSION_KEY])
    expect(SESSION_KEY).toBe('pokemondle:party')
    expect(readSession(s)).toEqual(SESSION)
    clearSession(s)
    expect(readSession(s)).toBeNull()
  })

  it('treats missing, corrupt or malformed data as no session', () => {
    expect(readSession(fakeStorage())).toBeNull()
    expect(readSession(fakeStorage({ [SESSION_KEY]: '{not json' }))).toBeNull()
    expect(readSession(fakeStorage({ [SESSION_KEY]: JSON.stringify({ ...SESSION, token: 'short' }) }))).toBeNull()
    expect(readSession(fakeStorage({ [SESSION_KEY]: JSON.stringify({ ...SESSION, code: 'AEIO' }) }))).toBeNull()
    expect(readSession(fakeStorage({ [SESSION_KEY]: JSON.stringify({ ...SESSION, room_id: 'x' }) }))).toBeNull()
    expect(parseSession(null)).toBeNull()
    expect(parseSession('x')).toBeNull()
  })

  it('normalises the code to upper case', () => {
    expect(parseSession({ ...SESSION, code: 'kpzw' })?.code).toBe('KPZW')
  })

  it('never throws when storage is blocked or missing', () => {
    expect(readSession(throwing)).toBeNull()
    expect(() => writeSession(SESSION, throwing)).not.toThrow()
    expect(() => clearSession(throwing)).not.toThrow()
    expect(readSession(null)).toBeNull()
    expect(() => writeSession(SESSION, null)).not.toThrow()
  })
})

describe('decideRejoin', () => {
  it('rejoins when the stored room is the one in the address', () => {
    expect(decideRejoin(SESSION, 'KPZW')).toBe('rejoin')
  })
  it('does nothing for another room, no room, or no stored seat', () => {
    expect(decideRejoin(SESSION, 'BCDF')).toBe('none')
    expect(decideRejoin(SESSION, null)).toBe('none')
    expect(decideRejoin(null, 'KPZW')).toBe('none')
  })
})
