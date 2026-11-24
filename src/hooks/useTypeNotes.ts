import { useCallback, useEffect, useState } from 'react'
import type { GameMode } from '../lib/game'
import { loadJson, saveJson, storageKey } from '../lib/storage'
import { clearTypes, parseTypeNotes, ruledOutFor, toggleType, type TypeName, type TypeNotes } from '../lib/typeNotes'

const load = () => parseTypeNotes(loadJson('type-notes'))

/**
 * The type tracker's marks for the game on screen. Saved with the rest of the game state (`pokemondle:type-notes`),
 * one entry per mode, so a refresh keeps them and a new Daily or a new Endless round starts clean. Kept in sync
 * across open tabs, like the games themselves.
 */
export function useTypeNotes(mode: GameMode, gameKey: string) {
  const [notes, setNotes] = useState<TypeNotes>(load)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey('type-notes')) setNotes(load())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const update = useCallback((change: (notes: TypeNotes) => TypeNotes) => {
    setNotes((current) => {
      const next = change(current)
      saveJson('type-notes', next)
      return next
    })
  }, [])

  const toggle = useCallback((type: TypeName) => update((n) => toggleType(n, mode, gameKey, type)), [update, mode, gameKey])
  const clear = useCallback(() => update((n) => clearTypes(n, mode, gameKey)), [update, mode, gameKey])

  return { ruledOut: ruledOutFor(notes, mode, gameKey), toggle, clear }
}
