import { PARTY_CONFIG } from '../config/partyConfig.ts'

/**
 * The Party page's only routing: the room code in the address hash. pokemondle.io/party/ is the start screen and
 * pokemondle.io/party/#KPZW is room KPZW, so a copied invite link opens straight into that room.
 */
export type PartyRoute =
  | {
      screen: 'start'
      /** The hash held something that isn't a room code (shown back to the player in a friendly note). */
      badCode?: string
    }
  | { screen: 'room'; code: string }

const CODE_PATTERN = new RegExp(`^[${PARTY_CONFIG.roomCodeAlphabet}]{${PARTY_CONFIG.roomCodeLength}}$`)

/** Upper-cases and trims a typed or linked code; null if it isn't a valid room code. */
export function normaliseCode(raw: string): string | null {
  const code = raw.trim().toUpperCase()
  return CODE_PATTERN.test(code) ? code : null
}

/** Reads a route from location.hash ("#kpzw", "#/KPZW" and "#KPZW" all mean room KPZW). */
export function parseHash(hash: string): PartyRoute {
  let raw = hash.replace(/^#\/?/, '')
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // A malformed escape: keep it as typed, it fails the code check below.
  }
  raw = raw.trim()
  if (!raw) return { screen: 'start' }
  const code = normaliseCode(raw)
  return code ? { screen: 'room', code } : { screen: 'start', badCode: raw.slice(0, 12) }
}

/** The hash a route is written as ("" for the start screen). */
export function hashFor(route: PartyRoute): string {
  return route.screen === 'room' ? `#${route.code}` : ''
}
