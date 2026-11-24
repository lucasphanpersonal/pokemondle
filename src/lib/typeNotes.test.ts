import { describe, expect, it } from 'vitest'
import { clearTypes, parseTypeNotes, ruledOutFor, toggleType, TYPE_LABELS, TYPES } from './typeNotes'
import POKEMON from '../data/pokemon.json'

describe('type tracker notes', () => {
  it('lists the 18 types, each with a colour, covering every type in the data', () => {
    expect(TYPES).toHaveLength(18)
    expect(Object.keys(TYPE_LABELS).sort()).toEqual([...TYPES].sort())
    // In-game labels: all caps, at most six letters (so they all fit the same size of text).
    for (const { label } of Object.values(TYPE_LABELS)) expect(label).toMatch(/^[A-Z]{3,6}$/)
    const inData = new Set<string>()
    for (const p of POKEMON as { type1: string; type2: string | null }[]) {
      inData.add(p.type1)
      if (p.type2) inData.add(p.type2)
    }
    expect([...inData].sort()).toEqual([...TYPES].sort())
  })

  it('toggles a type on and off for the game on screen, kept in type order', () => {
    let notes = toggleType({}, 'daily', '2026-11-24', 'Water')
    notes = toggleType(notes, 'daily', '2026-11-24', 'Fire')
    expect(ruledOutFor(notes, 'daily', '2026-11-24')).toEqual(['Fire', 'Water'])
    notes = toggleType(notes, 'daily', '2026-11-24', 'Fire')
    expect(ruledOutFor(notes, 'daily', '2026-11-24')).toEqual(['Water'])
  })

  it('starts each new game with no marks and keeps the modes apart', () => {
    let notes = toggleType({}, 'daily', '2026-11-23', 'Fire')
    notes = toggleType(notes, 'endless', 'e1', 'Ice')
    expect(ruledOutFor(notes, 'daily', '2026-11-24')).toEqual([])
    expect(ruledOutFor(notes, 'endless', 'e1')).toEqual(['Ice'])
    notes = toggleType(notes, 'daily', '2026-11-24', 'Bug')
    expect(ruledOutFor(notes, 'daily', '2026-11-24')).toEqual(['Bug'])
    expect(ruledOutFor(notes, 'endless', 'e2')).toEqual([])
  })

  it('clears the current game only', () => {
    let notes = toggleType({}, 'daily', 'd', 'Fire')
    notes = toggleType(notes, 'endless', 'e', 'Ice')
    notes = clearTypes(notes, 'daily', 'd')
    expect(ruledOutFor(notes, 'daily', 'd')).toEqual([])
    expect(ruledOutFor(notes, 'endless', 'e')).toEqual(['Ice'])
  })

  it('survives bad saved data', () => {
    expect(parseTypeNotes(null)).toEqual({})
    expect(parseTypeNotes('x')).toEqual({})
    expect(parseTypeNotes({ daily: { key: 1, out: [] }, endless: { key: 'e', out: 'Fire' } })).toEqual({})
    expect(parseTypeNotes({ daily: { key: 'd', out: ['Fire', 'Nope', 'Fire', 3, 'Bug'] } })).toEqual({ daily: { key: 'd', out: ['Fire', 'Bug'] } })
  })
})
