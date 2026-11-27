import { playNotes, type Note } from '../lib/sound.ts'

/*
 * The game screen's effects, synthesised like the rest of src/lib/sound.ts (square and triangle notes, nothing shipped)
 * and played at the player's volume setting. They live here so Daily and Endless don't carry them.
 */

export type PartySound = 'tick' | 'tock' | 'chime' | 'buzz'

const hz = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12)
const n = (semi: number, at: number, dur: number, wave: OscillatorType = 'square', vol = 0.1): Note => ({ f: hz(semi), at, dur, wave, vol })

/** The notes of each effect. */
export function partyNotes(name: PartySound): Note[] {
  switch (name) {
    case 'tick':
      // One a second: a short, dry clock tick.
      return [n(14, 0, 0.03, 'triangle', 0.16)]
    case 'tock':
      // Twice a second in the last 5: higher and a little louder, so the hurry is heard.
      return [n(21, 0, 0.035, 'square', 0.08)]
    case 'chime':
      // A valid answer: two bright rising notes.
      return [n(19, 0, 0.07), n(26, 0.07, 0.16, 'triangle', 0.16)]
    case 'buzz':
      // A wrong answer: a low, rough double buzz.
      return [n(-22, 0, 0.1, 'square', 0.1), n(-23, 0.12, 0.16, 'square', 0.1)]
  }
}

export const playParty = (name: PartySound): void => playNotes(partyNotes(name))
