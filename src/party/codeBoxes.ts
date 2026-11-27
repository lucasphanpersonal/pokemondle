import { PARTY_CONFIG } from '../config/partyConfig.ts'

/**
 * The logic of the four room-code letter boxes on the start screen, kept apart from React so it can be tested. The boxes
 * are an array of PARTY_CONFIG.roomCodeLength strings, each one letter or '' for an empty box.
 */

const LENGTH = PARTY_CONFIG.roomCodeLength
const ALLOWED = new Set(PARTY_CONFIG.roomCodeAlphabet)

export const emptyBoxes = (): string[] => Array.from({ length: LENGTH }, () => '')

/** The letters in some text that can be in a room code, upper-cased, in order (vowels, L, digits and the rest dropped). */
export const codeLetters = (text: string): string[] => [...text.toUpperCase()].filter((c) => ALLOWED.has(c))

/** Boxes filled from a code ("KPZW"; letters that can't be in a code are left out). */
export const boxesFrom = (code = ''): string[] => {
  const letters = codeLetters(code)
  return emptyBoxes().map((_, i) => letters[i] ?? '')
}

/** True when the text has a letter a room code never holds (a vowel or L), so the boxes can say why it was ignored. */
export const hasRefusedLetter = (text: string): boolean =>
  [...text.toUpperCase()].some((c) => c >= 'A' && c <= 'Z' && !ALLOWED.has(c))

/** The whole code once every box is filled, else null. */
export const fullCode = (boxes: readonly string[]): string | null => (boxes.every((b) => b !== '') ? boxes.join('') : null)

export interface BoxesChange {
  boxes: string[]
  /** The box to focus next. */
  focus: number
}

/**
 * Pasted text: an invite link ("https://pokemondle.io/party/#KPZW") gives the code after its "#". Text holding a whole
 * code fills all four boxes from the first; a shorter piece fills from the box it was pasted into.
 */
export function pasteIntoBoxes(boxes: readonly string[], index: number, text: string): BoxesChange {
  const hash = text.lastIndexOf('#')
  const letters = codeLetters(hash >= 0 ? text.slice(hash + 1) : text)
  if (letters.length === 0) return { boxes: [...boxes], focus: index }
  const next = [...boxes]
  let i = letters.length >= LENGTH ? 0 : index
  for (const letter of letters) {
    if (i >= LENGTH) break
    next[i++] = letter
  }
  return { boxes: next, focus: Math.min(i, LENGTH - 1) }
}

/**
 * A box's input changed to `value` (its whole new text). One allowed letter fills the box and moves on to the next; a
 * letter that can't be in a code changes nothing; an emptied box stays empty; several letters at once (a phone
 * keyboard's suggestion, or a paste the paste event missed) count as a paste. Typing into a full box replaces its letter.
 */
export function typeIntoBox(boxes: readonly string[], index: number, value: string): BoxesChange {
  if (value === '') {
    const next = [...boxes]
    next[index] = ''
    return { boxes: next, focus: index }
  }
  let letters = codeLetters(value)
  const old = boxes[index]
  // The box held a letter and the caret sat beside it: the input now holds the old letter and the new one.
  if (old && letters.length === 2 && letters.includes(old)) {
    letters = [...letters]
    letters.splice(letters.indexOf(old), 1)
  }
  if (letters.length === 0) return { boxes: [...boxes], focus: index }
  if (letters.length > 1) return pasteIntoBoxes(boxes, index, letters.join(''))
  const next = [...boxes]
  next[index] = letters[0]
  return { boxes: next, focus: Math.min(index + 1, LENGTH - 1) }
}

/** Backspace: clears this box, or when it is already empty, goes back one box and clears that. */
export function backspaceBox(boxes: readonly string[], index: number): BoxesChange {
  const next = [...boxes]
  if (next[index]) {
    next[index] = ''
    return { boxes: next, focus: index }
  }
  const back = Math.max(0, index - 1)
  next[back] = ''
  return { boxes: next, focus: back }
}
