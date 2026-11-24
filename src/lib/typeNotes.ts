import type { GameMode } from './game'

/**
 * The type tracker: a notepad of the 18 types that the player taps to mark as ruled out.
 * It is only a memory aid. Nothing in the game reads it, and it never fills itself in from guesses.
 */
export const TYPES = [
  'Normal',
  'Fire',
  'Water',
  'Electric',
  'Grass',
  'Ice',
  'Fighting',
  'Poison',
  'Ground',
  'Flying',
  'Psychic',
  'Bug',
  'Rock',
  'Ghost',
  'Dragon',
  'Dark',
  'Steel',
  'Fairy',
] as const

export type TypeName = (typeof TYPES)[number]

/**
 * The classic handheld-era type colours, as button faces. `ink` is true where dark ink text reads better than white;
 * every pairing is at least 4.5:1 (the lowest is Psychic with ink, 4.79:1).
 */
export const TYPE_COLORS: Record<TypeName, { face: string; ink: boolean }> = {
  Normal: { face: '#a8a878', ink: true },
  Fire: { face: '#f08030', ink: true },
  Water: { face: '#6890f0', ink: true },
  Electric: { face: '#f8d030', ink: true },
  Grass: { face: '#78c850', ink: true },
  Ice: { face: '#98d8d8', ink: true },
  Fighting: { face: '#c03028', ink: false },
  Poison: { face: '#a040a0', ink: false },
  Ground: { face: '#e0c068', ink: true },
  Flying: { face: '#a890f0', ink: true },
  Psychic: { face: '#f85888', ink: true },
  Bug: { face: '#a8b820', ink: true },
  Rock: { face: '#b8a038', ink: true },
  Ghost: { face: '#705898', ink: false },
  Dragon: { face: '#7038f8', ink: false },
  Dark: { face: '#705848', ink: false },
  Steel: { face: '#b8b8d0', ink: true },
  Fairy: { face: '#ee99ac', ink: true },
}

/** The marks for one game: which game (its key) and the types ruled out in it. */
export interface TypeNotesEntry {
  key: string
  out: TypeName[]
}

/** Saved under `pokemondle:type-notes`: one entry per mode, so each mode keeps the marks for its own game. */
export type TypeNotes = Partial<Record<GameMode, TypeNotesEntry>>

const isTypeName = (v: unknown): v is TypeName => typeof v === 'string' && (TYPES as readonly string[]).includes(v)

/** Reads saved notes, dropping anything malformed (unknown types, duplicates, wrong shapes). */
export function parseTypeNotes(raw: unknown): TypeNotes {
  if (!raw || typeof raw !== 'object') return {}
  const notes: TypeNotes = {}
  for (const mode of ['daily', 'endless'] as const) {
    const entry = (raw as Record<string, unknown>)[mode]
    if (!entry || typeof entry !== 'object') continue
    const { key, out } = entry as Record<string, unknown>
    if (typeof key !== 'string' || !Array.isArray(out)) continue
    notes[mode] = { key, out: TYPES.filter((t) => out.filter(isTypeName).includes(t)) }
  }
  return notes
}

/** The types ruled out in this game. Marks saved for any other game (yesterday's Daily, the last Endless round) don't count. */
export function ruledOutFor(notes: TypeNotes, mode: GameMode, gameKey: string): TypeName[] {
  const entry = notes[mode]
  return entry && entry.key === gameKey ? entry.out : []
}

/** Marks or unmarks one type for this game, starting from a clean slate if the saved marks are for another game. */
export function toggleType(notes: TypeNotes, mode: GameMode, gameKey: string, type: TypeName): TypeNotes {
  const current = ruledOutFor(notes, mode, gameKey)
  const out = current.includes(type) ? current.filter((t) => t !== type) : TYPES.filter((t) => t === type || current.includes(t))
  return { ...notes, [mode]: { key: gameKey, out } }
}

/** Clears every mark for this game. */
export function clearTypes(notes: TypeNotes, mode: GameMode, gameKey: string): TypeNotes {
  return { ...notes, [mode]: { key: gameKey, out: [] } }
}
