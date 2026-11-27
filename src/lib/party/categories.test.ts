import { describe, expect, it } from 'vitest'
import { PARTY_CONFIG, PARTY_TIERS, requiredPool, secondsForRound, tierForRound } from '../../config/partyConfig.ts'
import rawPokemon from '../../data/pokemon.json'
import type { Pokemon } from '../../types/pokemon.ts'
import {
  alsoFit,
  categoryColumns,
  categoryKey,
  categoryParts,
  categorySentence,
  checkAnswer,
  dealDeck,
  drawCategory,
  fitsCategory,
  fittingEntries,
  partCatalog,
  partFits,
  partKey,
  poolOf,
  speciesLeft,
  unusedEntries,
} from './categories.ts'
import type { Category, Part } from './types.ts'

const dex = rawPokemon as Pokemon[]
const byName = (name: string): Pokemon => {
  const p = dex.find((q) => q.name === name)
  if (!p) throw new Error(`No ${name} in the dataset`)
  return p
}
const none: ReadonlySet<number> = new Set()

/** Small hand-made dataset for exact pool counts. */
const mk = (id: number, dexNumber: number, over: Partial<Pokemon>): Pokemon => ({
  id,
  dexNumber,
  name: `Mon${id}`,
  type1: 'Normal',
  type2: null,
  generation: 1,
  height: 1,
  weight: 10,
  color: 'Red',
  evolutionStage: 1,
  abilities: ['Run Away'],
  eggGroups: ['Field'],
  formCategory: 'base',
  ...over,
})
const tiny: Pokemon[] = [
  mk(1, 1, { type1: 'Fire', type2: 'Flying', color: 'Red' }),
  mk(2, 2, { type1: 'Fire', color: 'Red', evolutionStage: 2 }),
  mk(10001, 2, { name: 'Mega Mon2', type1: 'Fire', type2: 'Dragon', formCategory: 'mega', evolutionStage: 2 }),
  mk(3, 3, { type1: 'Water', type2: 'Fire', generation: 2 }),
]

describe('partFits (one test per part)', () => {
  const charizard = byName('Charizard') // Fire/Flying, Gen 1, Red, stage 3, Monster + Dragon, 90.5 kg, 1.7 m
  const cases: [string, Part, Pokemon, boolean][] = [
    ['type, first slot', { kind: 'type', value: 'Fire' }, charizard, true],
    ['type, second slot', { kind: 'type', value: 'Flying' }, charizard, true],
    ['type, absent', { kind: 'type', value: 'Water' }, charizard, false],
    ['pure type', { kind: 'pure', value: 'Fire' }, byName('Charmander'), true],
    ['pure type fails for a dual type', { kind: 'pure', value: 'Fire' }, charizard, false],
    ['pure type fails for the second slot', { kind: 'pure', value: 'Flying' }, charizard, false],
    ['pair, either order', { kind: 'pair', value: ['Flying', 'Fire'] }, charizard, true],
    ['pair needs both', { kind: 'pair', value: ['Fire', 'Water'] }, charizard, false],
    ['pair is not a single type', { kind: 'pair', value: ['Fire', 'Flying'] }, byName('Charmander'), false],
    ['gen', { kind: 'gen', value: 1 }, charizard, true],
    ['gen, wrong', { kind: 'gen', value: 2 }, charizard, false],
    ['colour', { kind: 'color', value: 'Red' }, charizard, true],
    ['colour, wrong', { kind: 'color', value: 'Blue' }, charizard, false],
    ['stage', { kind: 'stage', value: 3 }, charizard, true],
    ['stage, wrong', { kind: 'stage', value: 2 }, byName('Charmander'), false],
    ['form: mega', { kind: 'form', value: 'mega' }, byName('Mega Venusaur'), true],
    ['form: regional', { kind: 'form', value: 'regional' }, byName('Alolan Ninetales'), true],
    ['form: gmax', { kind: 'form', value: 'gmax' }, byName('Gigantamax Venusaur'), true],
    ['form: a base form is none of them', { kind: 'form', value: 'mega' }, charizard, false],
    ['egg group', { kind: 'eggGroup', value: 'Dragon' }, charizard, true],
    ['egg group, wrong', { kind: 'eggGroup', value: 'Fairy' }, charizard, false],
    ['ability', { kind: 'ability', value: 'Blaze' }, charizard, true],
    ['ability, wrong', { kind: 'ability', value: 'Levitate' }, charizard, false],
    ['size: heavy is over 100 kg', { kind: 'size', value: 'heavy' }, byName('Venusaur'), false], // exactly 100 kg
    ['size: heavy', { kind: 'size', value: 'heavy' }, byName('Mega Venusaur'), true],
    ['size: tall is over 2 m', { kind: 'size', value: 'tall' }, byName('Venusaur'), false], // exactly 2 m
    ['size: tall', { kind: 'size', value: 'tall' }, byName('Mega Venusaur'), true],
    ['size: tiny', { kind: 'size', value: 'tiny' }, byName('Pikachu'), true], // 0.4 m
    ['size: tiny is under 0.5 m, not at it', { kind: 'size', value: 'tiny' }, charizard, false],
  ]
  for (const [name, part, pokemon, expected] of cases) {
    it(name, () => expect(partFits(part, pokemon)).toBe(expected))
  }
})

describe('poolOf', () => {
  it('counts species, not entries (forms share a species)', () => {
    expect(poolOf([{ kind: 'type', value: 'Fire' }], tiny)).toBe(3) // Mon1, Mon2 (+ its Mega), Mon3
    expect(fittingEntries([{ kind: 'type', value: 'Fire' }], tiny)).toHaveLength(4)
  })
  it('lets a form bring its species in when the base form misses', () => {
    expect(poolOf([{ kind: 'type', value: 'Dragon' }], tiny)).toBe(1)
  })
  it('needs one entry to fit every part, not one entry per part', () => {
    // Mon2 is Fire (base) and Dragon (its Mega) but no single entry is both.
    expect(poolOf([{ kind: 'type', value: 'Fire' }, { kind: 'type', value: 'Dragon' }], tiny)).toBe(1) // Mega Mon2 has both
    expect(poolOf([{ kind: 'pure', value: 'Fire' }, { kind: 'form', value: 'mega' }], tiny)).toBe(0)
  })
  it('matches the doc on the real dataset', () => {
    expect(poolOf([{ kind: 'type', value: 'Water' }], dex)).toBe(159)
    expect(poolOf([{ kind: 'stage', value: 2 }], dex)).toBe(364)
    expect(poolOf([{ kind: 'gen', value: 2 }], dex)).toBe(100)
  })
  it('lists unused species once each and counts what is left', () => {
    const fire: Category = [{ kind: 'type', value: 'Fire' }]
    const used = new Set([2])
    expect(unusedEntries(fire, tiny, used).map((p) => p.id)).toEqual([1, 3])
    expect(speciesLeft(fire, tiny, used)).toBe(2)
    expect(speciesLeft(fire, tiny, none)).toBe(3)
  })
  it('picks "Also fit" answers repeatably and never a used one', () => {
    const fire: Category = [{ kind: 'type', value: 'Fire' }]
    const used = new Set([byName('Charmander').dexNumber])
    const a = alsoFit(fire, dex, used, 'room-1')
    expect(a).toHaveLength(PARTY_CONFIG.alsoFitCount)
    expect(alsoFit(fire, dex, used, 'room-1')).toEqual(a)
    for (const p of a) expect(checkAnswer(fire, p, used).ok).toBe(true)
  })
})

describe('checkAnswer and its reasons', () => {
  const stage2Fire: Category = [
    { kind: 'type', value: 'Fire' },
    { kind: 'stage', value: 2 },
  ]
  const reasonFor = (category: Category, name: string, used: ReadonlySet<number> = none) => {
    const result = checkAnswer(category, byName(name), used)
    if (result.ok) throw new Error('expected a refusal')
    return result.reason
  }

  it('accepts a fitting, unused entry', () => {
    expect(checkAnswer(stage2Fire, byName('Charmeleon'), none)).toEqual({ ok: true })
  })
  it('says which part failed', () => {
    const result = checkAnswer(stage2Fire, byName('Charmander'), none)
    expect(result).toMatchObject({ ok: false, why: 'part', part: { kind: 'stage', value: 2 } })
    expect(reasonFor(stage2Fire, 'Charmander')).toBe("Charmander isn't Stage 2")
  })
  it('names the first failing part in display order', () => {
    expect(reasonFor(stage2Fire, 'Squirtle')).toBe("Squirtle isn't a Fire type")
  })
  it('refuses a species already said, even through a form', () => {
    const vulpix = byName('Vulpix')
    const fire: Category = [{ kind: 'type', value: 'Fire' }]
    expect(reasonFor(fire, 'Vulpix', new Set([vulpix.dexNumber]))).toBe('Vulpix was already said')
    expect(checkAnswer([{ kind: 'type', value: 'Ice' }], byName('Alolan Vulpix'), none).ok).toBe(true)
    expect(reasonFor([{ kind: 'type', value: 'Ice' }], 'Alolan Vulpix', new Set([vulpix.dexNumber]))).toBe(
      'Alolan Vulpix is a form of a Pokémon that was already said',
    )
  })
  it('lets a form answer by its own data', () => {
    expect(checkAnswer([{ kind: 'type', value: 'Ice' }], byName('Alolan Ninetales'), none).ok).toBe(true)
    expect(checkAnswer([{ kind: 'type', value: 'Ice' }], byName('Ninetales'), none).ok).toBe(false)
  })
  it('has a friendly reason for every kind of part', () => {
    const reasons: [Part, string][] = [
      [{ kind: 'type', value: 'Water' }, "Charmander isn't a Water type"],
      [{ kind: 'type', value: 'Electric' }, "Charmander isn't an Electric type"],
      [{ kind: 'pure', value: 'Water' }, "Charmander isn't a pure Water type"],
      [{ kind: 'pair', value: ['Bug', 'Flying'] }, "Charmander isn't Bug and Flying"],
      [{ kind: 'gen', value: 4 }, "Charmander isn't Gen 4"],
      [{ kind: 'color', value: 'Blue' }, "Charmander isn't Blue"],
      [{ kind: 'stage', value: 3 }, "Charmander isn't Stage 3"],
      [{ kind: 'form', value: 'mega' }, "Charmander isn't a Mega"],
      [{ kind: 'form', value: 'regional' }, "Charmander isn't a regional form"],
      [{ kind: 'form', value: 'gmax' }, "Charmander isn't a G-Max"],
      [{ kind: 'eggGroup', value: 'Fairy' }, "Charmander isn't in the Fairy egg group"],
      [{ kind: 'ability', value: 'Levitate' }, "Charmander doesn't have Levitate"],
      [{ kind: 'size', value: 'heavy' }, "Charmander isn't over 100 kg"],
      [{ kind: 'size', value: 'tall' }, "Charmander isn't over 2 m"],
      [{ kind: 'size', value: 'tiny' }, "Charmander isn't under 0.5 m"],
    ]
    for (const [part, text] of reasons) expect(reasonFor([part], 'Charmander')).toBe(text)
  })
})

describe('labels', () => {
  it('makes chips in display order', () => {
    const category: Category = [
      { kind: 'stage', value: 2 },
      { kind: 'type', value: 'Fire' },
    ]
    expect(categoryParts(category)).toEqual(['Fire type', 'Stage 2'])
    expect(categorySentence(category)).toBe('a Fire type, Stage 2')
  })
  it('reads naturally for each shape', () => {
    expect(categorySentence([{ kind: 'type', value: 'Ice' }])).toBe('an Ice type')
    expect(categorySentence([{ kind: 'pure', value: 'Fire' }])).toBe('a pure Fire type')
    expect(categorySentence([{ kind: 'pair', value: ['Bug', 'Flying'] }])).toBe('a Bug and Flying type')
    expect(categorySentence([{ kind: 'gen', value: 4 }])).toBe('a Gen 4 Pokémon')
    expect(categorySentence([{ kind: 'color', value: 'Pink' }])).toBe('a Pink Pokémon')
    expect(categorySentence([{ kind: 'form', value: 'mega' }])).toBe('a Mega Pokémon')
    expect(categorySentence([{ kind: 'eggGroup', value: 'Dragon' }])).toBe('a Dragon egg group Pokémon')
    expect(categorySentence([{ kind: 'ability', value: 'Levitate' }])).toBe('a Pokémon with Levitate')
    expect(categorySentence([{ kind: 'size', value: 'heavy' }])).toBe('an over 100 kg Pokémon')
    expect(
      categorySentence([
        { kind: 'ability', value: 'Levitate' },
        { kind: 'type', value: 'Ghost' },
        { kind: 'gen', value: 3 },
      ]),
    ).toBe('a Ghost type, Gen 3 with Levitate')
  })
  it('gives each part chip text', () => {
    expect(categoryParts([{ kind: 'size', value: 'tiny' }])).toEqual(['Under 0.5 m'])
    expect(categoryParts([{ kind: 'form', value: 'gmax' }])).toEqual(['G-Max'])
    expect(categoryParts([{ kind: 'eggGroup', value: 'Water 1' }])).toEqual(['Water 1 egg group'])
  })
})

describe('edge cases', () => {
  it('an empty category fits nothing and has an empty pool', () => {
    expect(fitsCategory([], byName('Charmander'))).toBe(false)
    expect(poolOf([], dex)).toBe(0)
  })
  it('drawCategory gives up (null) instead of spinning when no category fits together', () => {
    const rng = () => 0.5
    expect(drawCategory(new Map(), 2, rng)).toBeNull()
    // Only typing parts exist, and two columns would need two different families.
    const typesOnly = new Map<Part['kind'], Part[]>([['type', [{ kind: 'type', value: 'Fire' }]]])
    expect(drawCategory(typesOnly, 2, rng)).toBeNull()
    expect(drawCategory(typesOnly, 1, rng)).toEqual([{ kind: 'type', value: 'Fire' }])
  })
})

describe('part catalog', () => {
  it('offers every kind and leaves out rare abilities', () => {
    const catalog = partCatalog(dex)
    const kinds = new Set(catalog.map((p) => p.kind))
    for (const kind of ['type', 'pure', 'pair', 'gen', 'color', 'stage', 'form', 'eggGroup', 'ability', 'size']) {
      expect(kinds.has(kind as Part['kind'])).toBe(true)
    }
    for (const part of catalog.filter((p) => p.kind === 'ability')) {
      expect(poolOf([part], dex)).toBeGreaterThanOrEqual(PARTY_CONFIG.abilityMinPool)
    }
    expect(new Set(catalog.map(partKey)).size).toBe(catalog.length)
  })
})

describe('tiers and config', () => {
  it('maps rounds to tiers and seconds', () => {
    expect([1, 3, 4, 6, 7, 10, 11, 40].map((r) => tierForRound(r).id)).toEqual([
      'easy', 'easy', 'medium', 'medium', 'hard', 'hard', 'expert', 'expert',
    ])
    expect([1, 4, 7, 11].map(secondsForRound)).toEqual([20, 17, 14, 12])
  })
  it('requires twice the players, never under 6, and only the floor in Expert', () => {
    const [easy, , hard, expert] = PARTY_TIERS
    expect(requiredPool(easy, 8)).toBe(60)
    expect(requiredPool(hard, 8)).toBe(16)
    expect(requiredPool(hard, 2)).toBe(10)
    expect(requiredPool(expert, 8)).toBe(6)
  })
})

describe('dealDeck', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    expect(dealDeck('abc', 4, dex)).toEqual(dealDeck('abc', 4, dex))
    expect(dealDeck('abc', 4, dex)).not.toEqual(dealDeck('abd', 4, dex))
  })
  it('deals the configured deck by tier', () => {
    const deck = dealDeck('tiers', 3, dex)
    expect(deck).toHaveLength(PARTY_CONFIG.deckSize)
    deck.forEach((entry, i) => {
      expect(entry.round).toBe(i + 1)
      expect(entry.tier).toBe(tierForRound(i + 1).id)
      expect(tierForRound(i + 1).columns).toContain(categoryColumns(entry.category))
      expect(entry.pool).toBe(poolOf(entry.category, dex))
    })
    expect(deck.slice(0, 3).every((e) => e.category.length === 1)).toBe(true)
    expect(deck[10].category).toHaveLength(3) // round 11: Expert, three single-column parts
  })
  it('can start at a later tier', () => {
    const deck = dealDeck('hard-start', 4, dex, { startTier: 'hard', size: 5 })
    expect(deck.map((e) => e.tier)).toEqual(['hard', 'hard', 'hard', 'hard', 'expert'])
    expect(deck[0].round).toBe(1)
  })
  it('never puts two parts of a typing in one category', () => {
    for (let i = 0; i < 50; i++) {
      for (const { category } of dealDeck(`typing-${i}`, 2, dex)) {
        expect(category.filter((p) => p.kind === 'type' || p.kind === 'pure' || p.kind === 'pair').length).toBeLessThanOrEqual(1)
      }
    }
  })

  it('1,000 seeded decks for 8 players always keep the pool rule, with no repeats and no back-to-back part', () => {
    for (let n = 0; n < 1000; n++) {
      const deck = dealDeck(`game-${n}`, 8, dex)
      expect(deck).toHaveLength(PARTY_CONFIG.deckSize)
      const seen = new Set<string>()
      deck.forEach((entry, i) => {
        const tier = PARTY_TIERS.find((t) => t.id === entry.tier)!
        expect(entry.pool, `deck ${n} round ${i + 1}`).toBeGreaterThanOrEqual(tier.id === 'expert' ? 6 : 16)
        expect(entry.pool, `deck ${n} round ${i + 1}`).toBeGreaterThanOrEqual(requiredPool(tier, 8))
        expect(entry.pool).toBeLessThanOrEqual(tier.maxPool)
        const key = categoryKey(entry.category)
        expect(seen.has(key), `deck ${n} repeats ${key}`).toBe(false)
        seen.add(key)
        if (i > 0) {
          const before = new Set(deck[i - 1].category.map(partKey))
          expect(entry.category.some((p) => before.has(partKey(p))), `deck ${n} round ${i + 1} reuses a part`).toBe(false)
        }
      })
    }
  }, 60_000) // 1,000 deals: slow on shared CI runners, so not on the 5 s default
})
