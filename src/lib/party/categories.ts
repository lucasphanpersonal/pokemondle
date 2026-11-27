/**
 * Party mode's category engine: parts, answer pools, answer checks, labels and the seeded deck dealer.
 *
 * Pure TypeScript (no React, DOM or Node APIs) so the same file can run in the browser and in the Edge Function.
 * It imports only relative files (types, partyConfig, and the seeded RNG in ../daily). The dataset is always
 * passed in, so there is one place (the caller) to swap it.
 *
 * Species: a Pokémon entry's species is its `dexNumber` (forms share it). A category's pool counts distinct
 * species that have at least one entry fitting every part. One answer per species per round.
 */
import {
  PARTY_CONFIG,
  PARTY_TIERS,
  poolFloorFor,
  tierForRound,
  type TierConfig,
  type TierId,
} from '../../config/partyConfig.ts'
import type { Pokemon } from '../../types/pokemon.ts'
import { hashString, mulberry32 } from '../daily.ts'
import type { AnswerCheck, Category, DeckEntry, FormValue, Part, PartKind, SizeValue } from './types.ts'

/** Order parts are shown in: typing first, so the sentence reads "a Fire type, Stage 2". */
const KIND_ORDER: readonly PartKind[] = ['pair', 'pure', 'type', 'stage', 'gen', 'color', 'form', 'eggGroup', 'ability', 'size']

const FORM_LABEL: Record<FormValue, string> = { mega: 'Mega', regional: 'Regional', gmax: 'G-Max' }
const FORM_CATEGORY: Record<FormValue, Pokemon['formCategory']> = { mega: 'mega', regional: 'regional', gmax: 'gmax' }
const SIZE_LABEL: Record<SizeValue, string> = {
  heavy: `over ${PARTY_CONFIG.heavyOverKg} kg`,
  tall: `over ${PARTY_CONFIG.tallOverM} m`,
  tiny: `under ${PARTY_CONFIG.tinyUnderM} m`,
}

/** Columns a part checks: a two-type pair checks both type columns. */
const partColumns = (part: Part): number => (part.kind === 'pair' ? 2 : 1)

export const categoryColumns = (category: Category): number => category.reduce((n, p) => n + partColumns(p), 0)

/** Whether one entry fits one part. */
export function partFits(part: Part, p: Pokemon): boolean {
  switch (part.kind) {
    case 'type':
      return p.type1 === part.value || p.type2 === part.value
    case 'pure':
      return p.type1 === part.value && p.type2 === null
    case 'pair':
      return (
        (p.type1 === part.value[0] && p.type2 === part.value[1]) ||
        (p.type1 === part.value[1] && p.type2 === part.value[0])
      )
    case 'gen':
      return p.generation === part.value
    case 'color':
      return p.color === part.value
    case 'stage':
      return p.evolutionStage === part.value
    case 'form':
      return p.formCategory === FORM_CATEGORY[part.value]
    case 'eggGroup':
      return p.eggGroups.includes(part.value)
    case 'ability':
      return p.abilities.includes(part.value)
    case 'size':
      if (part.value === 'heavy') return p.weight > PARTY_CONFIG.heavyOverKg
      if (part.value === 'tall') return p.height > PARTY_CONFIG.tallOverM
      return p.height < PARTY_CONFIG.tinyUnderM
  }
}

/** Stable identity of a part ("type:Fire"; pairs are order-free). */
export function partKey(part: Part): string {
  return part.kind === 'pair' ? `pair:${[...part.value].sort().join('+')}` : `${part.kind}:${part.value}`
}

/** Plain code-unit comparison, so the order is the same in every runtime (localeCompare is not). */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Parts in display order. */
const sortParts = (parts: readonly Part[]): Part[] =>
  [...parts].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || compareText(partKey(a), partKey(b)))

/** Stable identity of a category (order-free), used to avoid repeats. */
export const categoryKey = (category: Category): string =>
  category
    .map(partKey)
    .sort()
    .join('|')

/** Whether one entry fits every part (ignoring which species were already used). */
export const fitsCategory = (category: Category, p: Pokemon): boolean =>
  category.length > 0 && category.every((part) => partFits(part, p))

// ---------------------------------------------------------------------------------------------------------------
// Labels

const article = (text: string): string => (/^[aeiou]/i.test(text) ? 'an' : 'a')

/** The chip text for a part: "Fire type", "Pure Fire", "Normal and Flying", "Gen 4", "Stage 2", "Over 100 kg". */
export function partLabel(part: Part): string {
  switch (part.kind) {
    case 'type':
      return `${part.value} type`
    case 'pure':
      return `Pure ${part.value}`
    case 'pair':
      return `${part.value[0]} and ${part.value[1]}`
    case 'gen':
      return `Gen ${part.value}`
    case 'color':
      return part.value
    case 'stage':
      return `Stage ${part.value}`
    case 'form':
      return FORM_LABEL[part.value]
    case 'eggGroup':
      return `${part.value} egg group`
    case 'ability':
      return part.value
    case 'size':
      return capitalise(SIZE_LABEL[part.value])
  }
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** The chips for a category's card, in display order: ["Fire type", "Stage 2"]. */
export const categoryParts = (category: Category): string[] => sortParts(category).map(partLabel)

/** How a part reads inside a sentence. */
function partPhrase(part: Part): string {
  switch (part.kind) {
    case 'pure':
      return `pure ${part.value} type`
    case 'pair':
      return `${part.value[0]} and ${part.value[1]} type`
    case 'size':
      return SIZE_LABEL[part.value]
    default:
      return partLabel(part)
  }
}

/** The category as a phrase for the turn prompt: "a Fire type, Stage 2", "a Blue Pokémon", "a Pokémon with Levitate". */
export function categorySentence(category: Category): string {
  const parts = sortParts(category)
  const ability = parts.find((p) => p.kind === 'ability')
  const rest = parts.filter((p) => p !== ability)
  const hasTyping = rest.some((p) => p.kind === 'type' || p.kind === 'pure' || p.kind === 'pair')
  let text = rest.map(partPhrase).join(', ')
  if (!hasTyping) text = text ? `${text} Pokémon` : 'Pokémon'
  if (ability) text += ` with ${ability.value}`
  return `${article(text)} ${text}`
}

// ---------------------------------------------------------------------------------------------------------------
// Answer check

/** Why an entry doesn't fit a part, as a short friendly sentence. */
function failReason(part: Part, name: string): string {
  switch (part.kind) {
    case 'type':
      return `${name} isn't ${article(part.value)} ${part.value} type`
    case 'pure':
      return `${name} isn't a pure ${part.value} type`
    case 'pair':
      return `${name} isn't ${part.value[0]} and ${part.value[1]}`
    case 'gen':
    case 'stage':
    case 'color':
      return `${name} isn't ${partLabel(part)}`
    case 'form':
      return `${name} isn't ${part.value === 'regional' ? 'a regional form' : `a ${FORM_LABEL[part.value]}`}`
    case 'eggGroup':
      return `${name} isn't in the ${part.value} egg group`
    case 'ability':
      return `${name} doesn't have ${part.value}`
    case 'size':
      return `${name} isn't ${SIZE_LABEL[part.value]}`
  }
}

/**
 * Whether `pokemon` is a valid answer: it must fit every part, and its species must not be in `usedSpecies`
 * (dex numbers said this round). The first part that fails is reported, in display order; "already said" comes last.
 */
export function checkAnswer(category: Category, pokemon: Pokemon, usedSpecies: ReadonlySet<number>): AnswerCheck {
  for (const part of sortParts(category)) {
    if (!partFits(part, pokemon)) return { ok: false, why: 'part', part, reason: failReason(part, pokemon.name) }
  }
  if (usedSpecies.has(pokemon.dexNumber)) {
    const reason =
      pokemon.formCategory === 'base'
        ? `${pokemon.name} was already said`
        : `${pokemon.name} is a form of a Pokémon that was already said`
    return { ok: false, why: 'used', reason }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------------------
// Pools

/** Per-dataset lookup tables: a bitmask of fitting entries per part, so pools of combined parts are quick to count. */
interface Index {
  words: number
  species: Int32Array
  masks: Map<string, Uint32Array>
  /** Scratch marks for counting distinct species. */
  stamp: Int32Array
  stampNo: number
  catalog: Part[]
}

const indexes = new WeakMap<readonly Pokemon[], Index>()

function indexOf(dataset: readonly Pokemon[]): Index {
  let ix = indexes.get(dataset)
  if (ix) return ix
  const species = Int32Array.from(dataset, (p) => p.dexNumber)
  ix = {
    words: Math.ceil(dataset.length / 32),
    species,
    masks: new Map(),
    stamp: new Int32Array(Math.max(0, ...species) + 1),
    stampNo: 0,
    catalog: [],
  }
  indexes.set(dataset, ix)
  ix.catalog = buildCatalog(dataset)
  return ix
}

function maskOf(part: Part, dataset: readonly Pokemon[], ix: Index): Uint32Array {
  const key = partKey(part)
  let mask = ix.masks.get(key)
  if (!mask) {
    mask = new Uint32Array(ix.words)
    for (let i = 0; i < dataset.length; i++) if (partFits(part, dataset[i])) mask[i >>> 5] |= 1 << (i & 31)
    ix.masks.set(key, mask)
  }
  return mask
}

/** Calls `visit` with the index of every entry that fits all of `category`. */
function forEachFit(category: Category, dataset: readonly Pokemon[], ix: Index, visit: (i: number) => void): void {
  const masks = category.map((part) => maskOf(part, dataset, ix))
  for (let w = 0; w < ix.words; w++) {
    let bits = masks.length ? masks[0][w] : 0
    for (let m = 1; m < masks.length && bits; m++) bits &= masks[m][w]
    while (bits) {
      const bit = 31 - Math.clz32(bits & -bits)
      visit((w << 5) + bit)
      bits &= bits - 1
    }
  }
}

/** How many distinct species have an entry fitting every part of the category. */
export function poolOf(category: Category, dataset: readonly Pokemon[]): number {
  const ix = indexOf(dataset)
  const mark = ++ix.stampNo
  let count = 0
  forEachFit(category, dataset, ix, (i) => {
    const s = ix.species[i]
    if (ix.stamp[s] !== mark) {
      ix.stamp[s] = mark
      count++
    }
  })
  return count
}

/** Every entry that fits the category, forms included, in dataset order. */
export function fittingEntries(category: Category, dataset: readonly Pokemon[]): Pokemon[] {
  const out: Pokemon[] = []
  forEachFit(category, dataset, indexOf(dataset), (i) => out.push(dataset[i]))
  return out
}

/** One entry per species that fits and isn't in `usedSpecies` (the first fitting entry, so base forms come first). */
export function unusedEntries(category: Category, dataset: readonly Pokemon[], usedSpecies: ReadonlySet<number>): Pokemon[] {
  const seen = new Set<number>()
  const out: Pokemon[] = []
  for (const p of fittingEntries(category, dataset)) {
    if (usedSpecies.has(p.dexNumber) || seen.has(p.dexNumber)) continue
    seen.add(p.dexNumber)
    out.push(p)
  }
  return out
}

/** "N left": species that still fit and haven't been said. */
export const speciesLeft = (category: Category, dataset: readonly Pokemon[], usedSpecies: ReadonlySet<number>): number =>
  unusedEntries(category, dataset, usedSpecies).length

/** A few answers nobody said, for "Also fit". The seed makes the pick repeatable. */
export function alsoFit(
  category: Category,
  dataset: readonly Pokemon[],
  usedSpecies: ReadonlySet<number>,
  seed: number | string,
  count: number = PARTY_CONFIG.alsoFitCount,
): Pokemon[] {
  const rest = unusedEntries(category, dataset, usedSpecies)
  const rng = mulberry32(hashString(`party-alsofit:${seed}`))
  shuffle(rest, rng)
  return rest.slice(0, count)
}

// ---------------------------------------------------------------------------------------------------------------
// Parts available in a dataset, and the dealer

function buildCatalog(dataset: readonly Pokemon[]): Part[] {
  const types = new Set<string>()
  const pairs = new Map<string, readonly [string, string]>()
  const forms = new Set<FormValue>()
  const lists = { gen: new Set<number>(), color: new Set<string>(), egg: new Set<string>(), ability: new Set<string>() }
  for (const p of dataset) {
    types.add(p.type1)
    if (p.type2) {
      types.add(p.type2)
      const pair = [p.type1, p.type2].sort() as [string, string]
      pairs.set(pair.join('+'), pair)
    }
    lists.gen.add(p.generation)
    lists.color.add(p.color)
    p.eggGroups.forEach((g) => lists.egg.add(g))
    p.abilities.forEach((a) => lists.ability.add(a))
    for (const f of Object.keys(FORM_CATEGORY) as FormValue[]) if (p.formCategory === FORM_CATEGORY[f]) forms.add(f)
  }
  const asc = <T extends string | number>(set: Set<T>): T[] => [...set].sort()
  const parts: Part[] = [
    ...asc(types).map((value): Part => ({ kind: 'type', value })),
    ...asc(types).map((value): Part => ({ kind: 'pure', value })),
    ...[...pairs.entries()].sort(([a], [b]) => compareText(a, b)).map(([, value]): Part => ({ kind: 'pair', value })),
    ...[...lists.gen].sort((a, b) => a - b).map((value): Part => ({ kind: 'gen', value })),
    ...asc(lists.color).map((value): Part => ({ kind: 'color', value })),
    ...([1, 2, 3] as const).map((value): Part => ({ kind: 'stage', value })),
    ...(Object.keys(FORM_CATEGORY) as FormValue[]).filter((v) => forms.has(v)).map((value): Part => ({ kind: 'form', value })),
    ...asc(lists.egg).map((value): Part => ({ kind: 'eggGroup', value })),
    ...asc(lists.ability).map((value): Part => ({ kind: 'ability', value })),
    ...(['heavy', 'tall', 'tiny'] as const).map((value): Part => ({ kind: 'size', value })),
  ]
  // Drop parts nobody fits, and abilities that are too rare to be a fair category (the index is registered already).
  return parts.filter((part) => {
    const n = poolOf([part], dataset)
    return part.kind === 'ability' ? n >= PARTY_CONFIG.abilityMinPool : n > 0
  })
}

/** Every part a dataset supports (abilities with too few species are left out). */
export const partCatalog = (dataset: readonly Pokemon[]): readonly Part[] => indexOf(dataset).catalog

/** Fisher-Yates, in place. */
function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

const pick = <T>(items: readonly T[], rng: () => number): T => items[Math.floor(rng() * items.length)]

/** Parts that may not be combined: the three typing parts all check the types, so only one is allowed. */
export const partFamily = (part: Part): string => (part.kind === 'type' || part.kind === 'pure' || part.kind === 'pair' ? 'typing' : part.kind)

export interface DealOptions {
  /** Start the deck at this tier's first round (the host's "starting tier"). Round numbers in the deck still count from 1. */
  startTier?: TierId
  /** Number of categories; defaults to the deck size in partyConfig. */
  size?: number
}

/** Draws one random category of `columns` columns, or null if the draw got stuck. */
export function drawCategory(byKind: Map<PartKind, Part[]>, columns: number, rng: () => number): Part[] | null {
  const parts: Part[] = []
  let used = 0
  let guard = 0
  while (used < columns) {
    const kinds = [...byKind.keys()].filter((k) => used + (k === 'pair' ? 2 : 1) <= columns)
    if (!kinds.length) return null
    const part = pick(byKind.get(pick(kinds, rng))!, rng)
    if (parts.some((q) => partFamily(q) === partFamily(part))) {
      if (++guard > 50) return null
      continue
    }
    parts.push(part)
    used += partColumns(part)
  }
  return sortParts(parts)
}

/**
 * Deals a game's categories. Deterministic for a seed, player count and dataset. Round i (from 1) belongs to the tier
 * `tierForRound(start + i - 1)`. Every category has at least max(2 x players, 6) species, except in the Expert tier
 * (floor only), fits its tier's pool range, never repeats in the deck, and shares no part with the one before it.
 * If a tier's limits can't be met after many tries the dealer relaxes them (first the upper pool limit, then the
 * no-shared-part rule); it throws only if even that finds nothing, which a dataset like the real one never does.
 */
export function dealDeck(
  seed: number | string,
  players: number,
  dataset: readonly Pokemon[],
  options: DealOptions = {},
): DeckEntry[] {
  const ix = indexOf(dataset)
  const rng = mulberry32(hashString(`party-deck:${seed}`))
  const size = options.size ?? PARTY_CONFIG.deckSize
  const startTier = PARTY_TIERS.find((t) => t.id === options.startTier) ?? PARTY_TIERS[0]
  const byKind = new Map<PartKind, Part[]>()
  for (const part of ix.catalog) byKind.set(part.kind, [...(byKind.get(part.kind) ?? []), part])

  const deck: DeckEntry[] = []
  const seen = new Set<string>()
  let previous = new Set<string>()
  for (let i = 0; i < size; i++) {
    const tier = tierForRound(startTier.fromRound + i)
    const deal = dealOne(tier, players, dataset, byKind, seen, previous, rng)
    if (!deal) throw new Error(`Could not deal a ${tier.id} category for ${players} players`)
    seen.add(categoryKey(deal.category))
    previous = new Set(deal.category.map(partKey))
    deck.push({ round: i + 1, tier: tier.id, ...deal })
  }
  return deck
}

function dealOne(
  tier: TierConfig,
  players: number,
  dataset: readonly Pokemon[],
  byKind: Map<PartKind, Part[]>,
  seen: ReadonlySet<string>,
  previous: ReadonlySet<string>,
  rng: () => number,
): { category: Category; pool: number } | null {
  const floor = poolFloorFor(tier, players)
  // Strictest first; each level loosens one rule.
  const levels = [
    { min: Math.max(floor, tier.minPool), max: tier.maxPool, backToBack: false },
    { min: floor, max: Infinity, backToBack: false },
    { min: floor, max: Infinity, backToBack: true },
  ]
  for (const level of levels) {
    for (let attempt = 0; attempt < PARTY_CONFIG.dealAttempts; attempt++) {
      const category = drawCategory(byKind, pick(tier.columns, rng), rng)
      if (!category || seen.has(categoryKey(category))) continue
      if (!level.backToBack && category.some((p) => previous.has(partKey(p)))) continue
      const pool = poolOf(category, dataset)
      if (pool >= level.min && pool <= level.max) return { category, pool }
    }
  }
  return null
}
