import { describe, expect, it } from 'vitest'
import { backspaceBox, boxesFrom, codeLetters, emptyBoxes, fullCode, hasRefusedLetter, pasteIntoBoxes, typeIntoBox } from './codeBoxes.ts'
import { nicknameError, normaliseNickname } from './nickname.ts'
import { inviteLink } from './route.ts'
import { startBlockedReason } from './types.ts'

describe('room code letters', () => {
  it('keeps only the 20 code letters, upper-cased', () => {
    expect(codeLetters('kpzw')).toEqual(['K', 'P', 'Z', 'W'])
    expect(codeLetters('a1-Le b')).toEqual(['B'])
    expect(hasRefusedLetter('a')).toBe(true)
    expect(hasRefusedLetter('L')).toBe(true)
    expect(hasRefusedLetter('k1 -')).toBe(false)
  })

  it('fills boxes from a code, and reads the code back once all are filled', () => {
    expect(boxesFrom('KPZW')).toEqual(['K', 'P', 'Z', 'W'])
    expect(boxesFrom('kp')).toEqual(['K', 'P', '', ''])
    expect(boxesFrom()).toEqual(emptyBoxes())
    expect(fullCode(['K', 'P', 'Z', 'W'])).toBe('KPZW')
    expect(fullCode(['K', 'P', '', 'W'])).toBeNull()
  })
})

describe('typing into a box', () => {
  it('fills the box, upper-cases it and moves on', () => {
    expect(typeIntoBox(emptyBoxes(), 0, 'k')).toEqual({ boxes: ['K', '', '', ''], focus: 1 })
    expect(typeIntoBox(['K', 'P', 'Z', ''], 3, 'w')).toEqual({ boxes: ['K', 'P', 'Z', 'W'], focus: 3 })
  })

  it('ignores letters a code cannot hold', () => {
    expect(typeIntoBox(emptyBoxes(), 0, 'a')).toEqual({ boxes: emptyBoxes(), focus: 0 })
    expect(typeIntoBox(['K', '', '', ''], 1, '7')).toEqual({ boxes: ['K', '', '', ''], focus: 1 })
  })

  it('replaces the letter of a full box, wherever the caret was', () => {
    expect(typeIntoBox(['K', 'P', '', ''], 0, 'KB')).toEqual({ boxes: ['B', 'P', '', ''], focus: 1 })
    expect(typeIntoBox(['K', 'P', '', ''], 0, 'BK')).toEqual({ boxes: ['B', 'P', '', ''], focus: 1 })
    expect(typeIntoBox(['K', 'P', '', ''], 0, 'b')).toEqual({ boxes: ['B', 'P', '', ''], focus: 1 })
  })

  it('clears an emptied box and stays there', () => {
    expect(typeIntoBox(['K', 'P', '', ''], 1, '')).toEqual({ boxes: ['K', '', '', ''], focus: 1 })
  })

  it('treats several letters at once as a paste', () => {
    expect(typeIntoBox(emptyBoxes(), 2, 'kpzw')).toEqual({ boxes: ['K', 'P', 'Z', 'W'], focus: 3 })
  })
})

describe('pasting', () => {
  it('fills all four boxes from a whole code, whichever box it lands in', () => {
    expect(pasteIntoBoxes(emptyBoxes(), 2, ' kpzw ')).toEqual({ boxes: ['K', 'P', 'Z', 'W'], focus: 3 })
  })

  it('takes the code from an invite link', () => {
    expect(pasteIntoBoxes(emptyBoxes(), 0, 'https://pokemondle.io/party/#BCDF')).toEqual({ boxes: ['B', 'C', 'D', 'F'], focus: 3 })
  })

  it('fills from the current box for a part of a code', () => {
    expect(pasteIntoBoxes(['K', '', '', ''], 1, 'pz')).toEqual({ boxes: ['K', 'P', 'Z', ''], focus: 3 })
    expect(pasteIntoBoxes(['K', 'P', 'Z', ''], 3, 'wx')).toEqual({ boxes: ['K', 'P', 'Z', 'W'], focus: 3 })
  })

  it('changes nothing for text with no code letters', () => {
    expect(pasteIntoBoxes(['K', '', '', ''], 1, 'aeiou 123')).toEqual({ boxes: ['K', '', '', ''], focus: 1 })
  })
})

describe('backspace', () => {
  it('clears the box it is in', () => {
    expect(backspaceBox(['K', 'P', '', ''], 1)).toEqual({ boxes: ['K', '', '', ''], focus: 1 })
  })

  it('goes back and clears the previous box from an empty one', () => {
    expect(backspaceBox(['K', 'P', '', ''], 2)).toEqual({ boxes: ['K', '', '', ''], focus: 1 })
    expect(backspaceBox(emptyBoxes(), 0)).toEqual({ boxes: emptyBoxes(), focus: 0 })
  })
})

describe('nicknames', () => {
  it('trims and squeezes spaces like the server', () => {
    expect(normaliseNickname('  Ash   Ketchum ')).toBe('Ash Ketchum')
  })

  it('accepts 1 to 12 letters, digits and spaces', () => {
    expect(nicknameError('A')).toBeNull()
    expect(nicknameError('Ash 2')).toBeNull()
    expect(nicknameError('abcdefghijkl')).toBeNull()
    expect(nicknameError('  Red   Blue  ')).toBeNull()
  })

  it('explains what is wrong', () => {
    expect(nicknameError('')).toBe('Type a name first.')
    expect(nicknameError('   ')).toBe('Type a name first.')
    expect(nicknameError('abcdefghijklm')).toBe('Keep it to 12 characters.')
    expect(nicknameError('Pokémon')).toBe('Use only letters, digits and spaces.')
    expect(nicknameError('Ash!')).toBe('Use only letters, digits and spaces.')
  })
})

describe('lobby helpers', () => {
  const player = { id: 'a', nickname: 'Ash', icon: 1, online: true }
  it('blocks Start until 2 players are in the lobby', () => {
    expect(startBlockedReason({ status: 'lobby', players: [player] })).toBe('Waiting for 1 more player to join.')
    expect(startBlockedReason({ status: 'lobby', players: [player, { ...player, id: 'b' }] })).toBeNull()
    expect(startBlockedReason({ status: 'playing', players: [player, { ...player, id: 'b' }] })).not.toBeNull()
  })

  it('builds the invite link from the page address without its query', () => {
    expect(inviteLink('KPZW', { origin: 'https://pokemondle.io', pathname: '/party/' })).toBe('https://pokemondle.io/party/#KPZW')
  })
})
