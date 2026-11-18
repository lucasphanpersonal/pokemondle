import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deviceShinySeed,
  FALLBACK_SHINY_SEED,
  isShiny,
  resetShinySeedCache,
  SHINY_ODDS,
  shinyIconUrl,
  shinySpriteUrl,
} from './shiny'

describe('isShiny', () => {
  it('is stable for the same device, game and answer', () => {
    expect(isShiny('abc', '2026-11-18', 25)).toBe(isShiny('abc', '2026-11-18', 25))
  })

  it('comes up about once in SHINY_ODDS games', () => {
    let hits = 0
    const n = 20000
    for (let i = 0; i < n; i++) if (isShiny('seed', `game-${i}`, 25)) hits++
    expect(hits / n).toBeGreaterThan(0.8 / SHINY_ODDS)
    expect(hits / n).toBeLessThan(1.2 / SHINY_ODDS)
  })

  it('differs between devices on the same Daily', () => {
    let hits = 0
    for (let i = 0; i < 2000; i++) if (isShiny(`device-${i}`, '2026-11-18', 25)) hits++
    expect(hits).toBeGreaterThan(0)
    expect(hits).toBeLessThan(2000)
  })
})

describe('shiny sprite urls', () => {
  it('point at the shiny sprite and artwork', () => {
    expect(shinyIconUrl(6)).toMatch(/\/pokemon\/shiny\/6\.png$/)
    expect(shinySpriteUrl(6)).toMatch(/official-artwork\/shiny\/6\.png$/)
  })
})

describe('deviceShinySeed', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetShinySeedCache()
  })

  it('makes one seed and keeps it', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    })
    const first = deviceShinySeed()
    resetShinySeedCache()
    expect(deviceShinySeed()).toBe(first)
    expect(first).not.toBe(FALLBACK_SHINY_SEED)
  })

  it('uses the fixed fallback, every time, when storage throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
      },
    })
    expect(deviceShinySeed()).toBe(FALLBACK_SHINY_SEED)
    resetShinySeedCache()
    expect(deviceShinySeed()).toBe(FALLBACK_SHINY_SEED)
  })
})
