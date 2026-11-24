import { ENABLED_FORM_CATEGORIES } from '../config/gameConfig'
import rawPokemon from '../data/pokemon.json'
import type { Pokemon } from '../types/pokemon'

const allPokemon = rawPokemon as Pokemon[]

/** Every Pokémon allowed in the game, after applying the form filter. */
export const POKEDEX: Pokemon[] = allPokemon.filter(
  (p) => ENABLED_FORM_CATEGORIES[p.formCategory],
)

/** Lookup by PokéAPI id. */
export const POKEDEX_BY_ID: Map<number, Pokemon> = new Map(POKEDEX.map((p) => [p.id, p]))

/** Official artwork (large). */
export const spriteUrl = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`

/** Small in-game sprite, used in the search list and the guess grid. */
export const iconUrl = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`

/**
 * Where to look for a Pokémon's picture, best first: its own in-game sprite, its own artwork, then
 * (for a form) the base species' sprite and artwork. A few forms have no sprite at all (Koraidon's
 * builds, Miraidon's modes, Mega Zygarde), and some have no artwork either. SpriteImg walks this list.
 */
export const iconSources = (p: Pick<Pokemon, 'id' | 'dexNumber'>): string[] =>
  p.id === p.dexNumber
    ? [iconUrl(p.id), spriteUrl(p.id)]
    : [iconUrl(p.id), spriteUrl(p.id), iconUrl(p.dexNumber), spriteUrl(p.dexNumber)]

/** Official artwork is smooth, high-resolution art; SpriteImg runs it through the pixel filter (src/lib/pixelate.ts). */
export const isArtworkUrl = (url: string) => url.includes('/official-artwork/')

/**
 * Lowercase, accent-free, punctuation-free form of a name for search, so
 * "flabebe" finds "Flabébé" and "mr mime" finds "Mr. Mime". Apostrophes go without a gap
 * ("farfetchd") and ♀/♂ become f/m ("nidoran f").
 */
export function searchKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u2640/g, ' f')
    .replace(/\u2642/g, ' m')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
}

/** The search key with its spaces taken out too, so "hooh", "porygonz" and "typenull" match "Ho-Oh", "Porygon-Z" and "Type: Null". */
const squash = (key: string) => key.replace(/ /g, '')

interface SearchEntry {
  key: string
  /** The squashed key from the start of each word: "type null" gives ["typenull", "null"]. */
  fromWords: string[]
}
const entry = (name: string): SearchEntry => {
  const key = searchKey(name)
  const words = key.split(' ')
  return { key, fromWords: words.map((_, i) => words.slice(i).join('')) }
}

/** Search key for every enabled Pokémon, computed once instead of on every keystroke. */
const SEARCH_KEYS: Map<Pokemon, SearchEntry> = new Map(POKEDEX.map((p) => [p, entry(p.name)]))

/**
 * The already-guessed Pokémon whose name is exactly the query (ignoring case, accents, punctuation and spaces), if any.
 */
export function findGuessedByName(pokedex: readonly Pokemon[], guessedIds: readonly number[], query: string): Pokemon | undefined {
  const q = squash(searchKey(query))
  if (!q) return undefined
  const guessed = new Set(guessedIds)
  return pokedex.find((p) => guessed.has(p.id) && squash(searchKey(p.name)) === q)
}

/**
 * Pokémon whose name matches the query: an exact name first (so "Mew" + Enter guesses Mew, not
 * Mewtwo), then names starting with it, then names with a word starting with it, then any other
 * match. Ties keep Pokédex order.
 */
export function searchPokemon(pool: readonly Pokemon[], query: string, limit = 8): Pokemon[] {
  const q = squash(searchKey(query))
  if (!q) return []
  const exact: Pokemon[] = []
  const starts: Pokemon[] = []
  const wordStarts: Pokemon[] = []
  const contains: Pokemon[] = []
  for (const p of pool) {
    // Matched with spaces taken out of both sides, so "farfetchd", "hooh" and "mrmime" all work.
    const { fromWords } = SEARCH_KEYS.get(p) ?? entry(p.name)
    if (fromWords[0] === q) exact.push(p)
    else if (fromWords[0].startsWith(q)) starts.push(p)
    else if (fromWords.some((w) => w.startsWith(q))) wordStarts.push(p)
    else if (fromWords[0].includes(q)) contains.push(p)
  }
  return [...exact, ...starts, ...wordStarts, ...contains].slice(0, limit)
}
