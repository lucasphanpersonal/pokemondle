import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../lib/sound'
import { PixelBulb } from './PixelBulb'

interface HintPromptProps {
  /** The answer's Gen, revealed if the player says yes. */
  gen: number
  guesses: number
  /** The player chose to see the Gen. */
  onTake: () => void
  /** The prompt is done with (declined, or the revealed Gen has been read). */
  onClose: () => void
}

/** Milliseconds per letter as the text types out, like the games' text speed. */
const LETTER_MS = 22

/**
 * Taps and keys are ignored for this long after the box opens and again after the choices appear, so
 * a tap or Enter meant for the board (or for skipping the text) can't land on a choice by accident.
 */
export const HINT_GUARD_MS = 500

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * The one-time Gen hint offer, drawn as an in-game text box centred on screen over a dimmed
 * background. The question types out letter by letter (a tap, Enter or Space finishes it), then a
 * Show hint / No thanks choice appears (No thanks on the right, focused). Show hint types out the
 * answer's Gen; advancing then closes the box. Escape or a tap on the dimmed background is "No thanks"
 * (or closes, once the Gen is shown). Input is ignored for HINT_GUARD_MS after opening and after the
 * choices appear.
 */
export function HintPrompt({ gen, guesses, onTake, onClose }: HintPromptProps) {
  const [revealed, setRevealed] = useState(false)
  const text = revealed
    ? `This Pokémon is from Gen ${gen}! It stays on the GEN tab at the side for the rest of this game.`
    : `${guesses} guesses and still searching? Here's a hint, if you want it: I can tell you which Gen this Pokémon is from.`
  const textId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const noRef = useRef<HTMLButtonElement>(null)
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? text.length : 0))
  const done = shown >= text.length
  const choices = done && !revealed

  // Tap guard: input is ignored for HINT_GUARD_MS at the start of the "open" phase (text typing)
  // and the "choices" phase. A phase leaves the guard once its timer has run.
  const phase = revealed ? 'revealed' : choices ? 'choices' : 'open'
  const [cleared, setCleared] = useState<string[]>([])
  const guarded = phase !== 'revealed' && !cleared.includes(phase)
  const guardedRef = useRef(guarded)
  useEffect(() => {
    if (phase === 'revealed') return
    const id = window.setTimeout(() => setCleared((c) => [...c, phase]), HINT_GUARD_MS)
    return () => window.clearTimeout(id)
  }, [phase])

  // Latest state for the key/tap handlers without re-binding them every letter.
  const advanceRef = useRef((_dismiss: boolean) => {})
  useEffect(() => {
    guardedRef.current = guarded
    advanceRef.current = (dismiss: boolean) => {
      if (guarded) return
      if (!done) setShown(text.length)
      else if (revealed || dismiss) {
        playSound('select')
        onClose()
      }
    }
  })

  useEffect(() => {
    if (done) return
    const id = window.setTimeout(() => setShown((n) => n + 1), LETTER_MS)
    return () => window.clearTimeout(id)
  }, [shown, done])

  // Once the question has typed out, focus "No thanks", so a stray Enter never spends the hint.
  useEffect(() => {
    if (done && !revealed) noRef.current?.focus()
    if (revealed) boxRef.current?.focus()
  }, [done, revealed])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    boxRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      // Leave shortcuts alone (Ctrl+A, Cmd+Z…).
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') {
        e.preventDefault()
        advanceRef.current(true)
        return
      }
      // Enter/Space on a choice button is that button's own click (swallowed while guarded).
      if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') {
        if (guardedRef.current && (e.key === 'Enter' || e.key === ' ')) e.preventDefault()
        return
      }
      if (['Enter', ' ', 'z', 'Z', 'a', 'A'].includes(e.key)) {
        e.preventDefault()
        // A held key (e.g. Enter still down from the guess) must not skip the message unread.
        if (!e.repeat) advanceRef.current(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (!document.querySelector('[data-modal]')) root?.removeAttribute('inert')
      previouslyFocused?.focus?.()
    }
  }, [])

  const choose = (take: boolean) => {
    if (guarded) return
    playSound('select')
    if (!take) {
      onClose()
      return
    }
    onTake()
    setRevealed(true)
    setShown(prefersReducedMotion() ? Number.MAX_SAFE_INTEGER : 0)
  }

  return createPortal(
    <div
      data-modal
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/50 p-3 sm:p-4"
      onClick={(e) => {
        // Taps inside the box finish or advance the text; taps outside also mean "No thanks".
        if (e.target === e.currentTarget) advanceRef.current(true)
        else if (!choices) advanceRef.current(false)
      }}
    >
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-label="Gen hint"
        aria-describedby={textId}
        tabIndex={-1}
        className={`ds-box pop-in relative w-full max-w-md px-5 pt-5 outline-none sm:px-6 sm:pt-6 ${choices ? 'cursor-default pb-5 sm:pb-6' : 'pb-8'}`}
      >
        <p id={textId} className="sr-only" aria-live="polite">
          {text} {choices ? '' : 'Press Enter or tap to continue.'}
        </p>
        {/* Typed-out copy for sighted players. The hidden tail keeps the box its final size from the first letter. */}
        <p aria-hidden="true" className="tx-10 leading-6 sm:text-xs sm:leading-7">
          {text.slice(0, shown)}
          <span className="invisible">{text.slice(shown)}</span>
        </p>
        {choices && (
          <div className="mt-4 flex justify-between gap-2">
            {/* Show hint on the left, No thanks on the right where "next" usually sits. They differ by label,
                face and the bulb icon, not colour alone. */}
            <button
              type="button"
              onClick={() => choose(true)}
              aria-disabled={guarded || undefined}
              className="ds-button bevel-red inline-flex h-11 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 whitespace-nowrap px-2 text-[9px] text-ds-paper sm:flex-none sm:basis-auto sm:px-4 sm:text-[10px]"
            >
              <PixelBulb />
              Show hint
            </button>
            <button
              ref={noRef}
              type="button"
              onClick={() => choose(false)}
              aria-disabled={guarded || undefined}
              className="ds-button bevel-paper h-11 min-w-0 flex-1 basis-0 whitespace-nowrap px-2 text-[9px] sm:flex-none sm:basis-auto sm:px-4 sm:text-[10px]"
            >
              No thanks
            </button>
          </div>
        )}
        {done && revealed && (
          <span aria-hidden="true" className="text-advance absolute right-4 bottom-2 text-xs text-ds-red sm:right-5">
            ▼
          </span>
        )}
      </div>
    </div>,
    document.body,
  )
}
