import { loadJson, saveJson } from '../lib/storage.ts'

/**
 * Nicknames: 1 to 12 characters, letters, digits and spaces (the rule the database checks on party_players.nickname).
 * Spaces at the ends are dropped and runs of spaces become one, as the server does.
 */
export const NICKNAME_MAX = 12

/** Trims a typed nickname and squeezes runs of spaces to one. */
export const normaliseNickname = (raw: string): string => raw.trim().replace(/\s+/g, ' ')

/** What is wrong with a typed nickname, in words for the player, or null if it is fine. */
export function nicknameError(raw: string): string | null {
  const name = normaliseNickname(raw)
  if (!name) return 'Type a name first.'
  if (!/^[A-Za-z0-9 ]+$/.test(name)) return 'Use only letters, digits and spaces.'
  if (name.length > NICKNAME_MAX) return `Keep it to ${NICKNAME_MAX} characters.`
  return null
}

/** The last nickname used on this browser (localStorage['pokemondle:party-name']), so the box is filled next time. */
const NAME_KEY = 'party-name'

export function loadNickname(): string {
  const saved = loadJson(NAME_KEY)
  return typeof saved === 'string' && nicknameError(saved) === null ? saved : ''
}

export const saveNickname = (name: string): void => saveJson(NAME_KEY, name)
