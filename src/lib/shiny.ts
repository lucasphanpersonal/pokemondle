import { hashString } from './daily'
import { loadJson, saveJson } from './storage'

/** One caught Pokémon in this many is shiny on the result screen. */
export const SHINY_ODDS = 20

/** Shiny in-game sprite and shiny official artwork (the fallback for forms without a sprite). */
export const shinyIconUrl = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${id}.png`
export const shinySpriteUrl = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/shiny/${id}.png`

/**
 * Whether a caught Pokémon is shiny. Decided by a hash rather than rolled at the win, so it never changes
 * when the result screen is reopened or the page reloaded, and nothing new is saved with the game. The
 * per-device seed makes it a personal roll: on the same Daily, one player in about twenty gets a shiny,
 * not everyone on one day in twenty.
 */
export function isShiny(deviceSeed: string, gameKey: string, targetId: number): boolean {
  return hashString(`shiny:${deviceSeed}:${gameKey}:${targetId}`) % SHINY_ODDS === 0
}

/** This device's shiny seed, made on first use. Without storage it falls back to a fixed seed (still 1 in 20 over games). */
export function deviceShinySeed(): string {
  const saved = loadJson('shiny-seed')
  if (typeof saved === 'string' && saved.length > 0) return saved
  const seed = Math.random().toString(36).slice(2, 10)
  saveJson('shiny-seed', seed)
  return seed
}

/**
 * Whether this game's catch is shiny. In development builds, `pokemondle:force-shiny` = true in
 * localStorage forces it, so the shiny result screen can be checked (the visual audit uses it).
 */
export function gameIsShiny(gameKey: string, targetId: number): boolean {
  if (import.meta.env.DEV && loadJson('force-shiny') === true) return true
  return isShiny(deviceShinySeed(), gameKey, targetId)
}
