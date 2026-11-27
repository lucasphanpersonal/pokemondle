import { useEffect, useRef, useState } from 'react'
import { HINT_AFTER_GUESSES } from '../lib/game'
import { playSound } from '../lib/sound'
import { HINT_GUARD_MS } from './HintPrompt'
import { PixelBulb } from './PixelBulb'

export type HintState = 'locked' | 'ready' | 'taken' | 'over'

interface HintPanelProps {
  state: HintState
  /** The answer's Gen, shown once the hint is taken. */
  gen: number
  /** Guesses still to make before the hint unlocks (state 'locked'). */
  guessesLeft: number
  onTake: () => void
}

/**
 * The Gen hint's side panel (a side tab, SideTabs.tsx). Before the hint unlocks it says how many guesses are left; once
 * it has, a red Show hint button reveals the Gen right here; after that the panel (and the tab) show the Gen for the
 * rest of the game. Show hint ignores taps and keys for HINT_GUARD_MS after it appears, the same guard as the pop-up
 * offer, so a double tap on the tab can't spend the hint by accident.
 */
export function HintPanel({ state, gen, guessesLeft, onTake }: HintPanelProps) {
  // The guard runs from whenever Show hint appears: when the panel opens, or when the hint unlocks with it open.
  const [cleared, setCleared] = useState(false)
  const guarded = !cleared
  useEffect(() => {
    if (state !== 'ready') return
    const id = window.setTimeout(() => setCleared(true), HINT_GUARD_MS)
    return () => window.clearTimeout(id)
  }, [state])

  // Taking the hint removes the focused Show hint button, so focus moves to the answer (which reads it out).
  const took = useRef(false)
  const answerRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (state === 'taken' && took.current) answerRef.current?.focus()
  }, [state])

  if (state === 'taken') {
    return (
      <p ref={answerRef} tabIndex={-1} className="tx-10 leading-6 outline-none">
        This Pokémon is from <strong className="font-normal">Gen {gen}</strong>!
      </p>
    )
  }
  if (state === 'locked') {
    return (
      <p className="tx-9 leading-5">
        After {HINT_AFTER_GUESSES} guesses I can tell you which Gen this Pokémon is from.{' '}
        {guessesLeft === 1 ? '1 more guess to go.' : `${guessesLeft} more guesses to go.`}
      </p>
    )
  }
  if (state === 'over') {
    return <p className="tx-9 leading-5">This game is over, and it didn't use the hint.</p>
  }
  return (
    <>
      <p className="mb-3 tx-9 leading-5">Still searching? I can tell you which Gen this Pokémon is from.</p>
      <button
        type="button"
        onClick={() => {
          if (guarded) return
          playSound('select')
          took.current = true
          onTake()
        }}
        aria-disabled={guarded || undefined}
        className="ds-button bevel-red inline-flex h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap px-3 text-[10px] text-ds-paper"
      >
        <PixelBulb />
        Show hint
      </button>
    </>
  )
}
