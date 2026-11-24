import { describe, expect, it } from 'vitest'
import { POKEDEX, findGuessedByName, iconSources, iconUrl, searchKey, searchPokemon, spriteUrl } from './pokedex'

describe('searchKey', () => {
  it('strips accents, case and punctuation', () => {
    expect(searchKey('Flabébé')).toBe('flabebe')
    expect(searchKey('Mr. Mime')).toBe('mr mime')
    expect(searchKey("Farfetch'd")).toBe('farfetchd')
    expect(searchKey('Nidoran♀')).toBe('nidoran f')
  })
})

describe('searchPokemon', () => {
  const names = (q: string) => searchPokemon(POKEDEX, q).map((p) => p.name)
  it('puts prefix matches first', () => {
    expect(names('pika')[0]).toBe('Pikachu')
  })
  it('puts an exact name before longer names that start with it', () => {
    expect(names('mew')[0]).toBe('Mew')
    expect(names('Pidgeot')[0]).toBe('Pidgeot')
    expect(names('porygon')[0]).toBe('Porygon')
    expect(names('10% zygarde')[0]).toBe('10% Zygarde')
  })
  it('finds forms by any word', () => {
    expect(names('alolan vul')).toContain('Alolan Vulpix')
    expect(names('vulpix')).toEqual(expect.arrayContaining(['Vulpix', 'Alolan Vulpix']))
  })
  it('ignores accents and punctuation in the query', () => {
    expect(names('flabebe')[0]).toBe('Flabébé')
    expect(names('mr. mime')[0]).toBe('Mr. Mime')
  })
  it('finds names typed without their punctuation or spaces', () => {
    expect(names('farfetchd')[0]).toBe("Farfetch'd")
    expect(names('farfetchd')).toContain("Galarian Farfetch'd")
    expect(names('hooh')[0]).toBe('Ho-Oh')
    expect(names('porygonz')[0]).toBe('Porygon-Z')
    expect(names('typenull')[0]).toBe('Type: Null')
    expect(names('nidoran f')[0]).toBe('Nidoran♀')
    expect(names('nidoranm')[0]).toBe('Nidoran♂')
    expect(names('mrmime')[0]).toBe('Mr. Mime')
    expect(names('ho oh')[0]).toBe('Ho-Oh')
  })
  it('returns nothing for an empty query and respects the limit', () => {
    expect(names('  ')).toEqual([])
    expect(searchPokemon(POKEDEX, 'a', 5)).toHaveLength(5)
  })
})

describe('findGuessedByName', () => {
  const pikachu = POKEDEX.find((p) => p.name === 'Pikachu')!
  const mime = POKEDEX.find((p) => p.name === 'Mr. Mime')!
  it('finds an already-guessed Pokémon typed in full', () => {
    expect(findGuessedByName(POKEDEX, [pikachu.id], 'pikachu')?.id).toBe(pikachu.id)
    expect(findGuessedByName(POKEDEX, [mime.id], 'mr mime')?.id).toBe(mime.id)
    expect(findGuessedByName(POKEDEX, [mime.id], 'mrmime')?.id).toBe(mime.id)
  })
  it('ignores partial names and Pokémon not yet guessed', () => {
    expect(findGuessedByName(POKEDEX, [pikachu.id], 'pika')).toBeUndefined()
    expect(findGuessedByName(POKEDEX, [], 'pikachu')).toBeUndefined()
    expect(findGuessedByName(POKEDEX, [pikachu.id], '  ')).toBeUndefined()
  })
})

describe('iconSources', () => {
  it('tries a form\'s own sprite and artwork before its base species\'', () => {
    const lowPower = POKEDEX.find((p) => p.name === 'Miraidon (Low-Power Mode)')!
    expect(iconSources(lowPower)).toEqual([
      iconUrl(lowPower.id),
      spriteUrl(lowPower.id),
      iconUrl(1008),
      spriteUrl(1008),
    ])
  })
  it('has no base fallback for a base species', () => {
    expect(iconSources({ id: 25, dexNumber: 25 })).toEqual([iconUrl(25), spriteUrl(25)])
  })
})
