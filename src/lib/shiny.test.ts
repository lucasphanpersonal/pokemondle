import { describe, expect, it } from 'vitest'
import { isShiny, SHINY_ODDS, shinyIconUrl, shinySpriteUrl } from './shiny'

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
