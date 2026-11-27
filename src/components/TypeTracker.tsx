import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { TYPE_LABELS, TYPES, type TypeName } from '../lib/typeNotes'
import { ResultMark } from './ResultMark'

interface TypeTrackerProps {
  ruledOut: readonly TypeName[]
  onToggle: (type: TypeName) => void
  onClear: () => void
}

/**
 * One toggle per type, drawn like the type labels in the DS games: the type's colour, its all-caps name (ELECTR, FIGHT,
 * PSYCHC) in white with a dark drop shadow, the text as big as the label allows (.type-label in index.css). It sits on
 * the shared bevel. Ruling a type out presses it in (the inverse bevel), turns its face dark grey and strikes its name
 * through, so the state never rests on colour alone (design rule 8).
 */
function TypeButtons({ ruledOut, onToggle, className }: Pick<TypeTrackerProps, 'ruledOut' | 'onToggle'> & { className: string }) {
  return (
    <ul className={`grid gap-1.5 ${className}`}>
      {TYPES.map((type) => {
        const out = ruledOut.includes(type)
        const { face, label } = TYPE_LABELS[type]
        return (
          <li key={type} className="type-label-cell min-w-0">
            <button
              type="button"
              aria-pressed={out}
              // The full name for screen readers, keeping the visible short form in it (ELECTR, Electric).
              aria-label={label === type.toUpperCase() ? type : `${label}, ${type}`}
              onClick={() => onToggle(type)}
              // Ruled out: a dark grey face with a hint of the type's colour (white text over 5:1 on every type).
              style={{ '--face': out ? `color-mix(in srgb, ${face} 15%, #646a72)` : face } as CSSProperties}
              className={`ds-button type-label flex w-full items-center justify-center px-2.5 leading-none ${out ? 'bevel-pressed' : ''}`}
            >
              <span className={out ? 'type-struck' : undefined}>{label}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Clears this game's marks; greyed out while there are none. */
function ClearButton({ ruledOut, onClear }: Pick<TypeTrackerProps, 'ruledOut' | 'onClear'>) {
  return (
    <button
      type="button"
      onClick={onClear}
      disabled={ruledOut.length === 0}
      className="ds-button bevel-paper h-11 shrink-0 whitespace-nowrap px-3 text-[10px] disabled:cursor-not-allowed disabled:opacity-60"
    >
      Clear
    </button>
  )
}

const NOTE = 'Tap the types you have ruled out. These are just your notes: the game never reads them.'

/**
 * The tracker lives off to the side so it never crowds the game: a small "TYPES" tab on the right edge of the screen
 * (every screen size) slides out a panel with all 18 types in three columns. The panel isn't a dialog: the page stays
 * usable behind it, so a player can keep guessing with it open. The tab or the panel's close button (or Esc) puts it away.
 */
export function TypeTrackerDrawer({ ruledOut, onToggle, onClear }: TypeTrackerProps) {
  const [open, setOpen] = useState(false)
  const tabRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // Focus follows the open/close, but not on first render (the tab must not steal focus from the guess box).
  const moved = useRef(false)
  useEffect(() => {
    if (!moved.current) return
    ;(open ? closeRef : tabRef).current?.focus()
  }, [open])
  const toggle = (next: boolean) => {
    moved.current = true
    setOpen(next)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // A dialog on top (Help, results) handles its own Esc.
      // Esc in the guess box closes its suggestion list, not the tracker.
      const inField = e.target instanceof HTMLElement && e.target.closest('input, textarea')
      if (e.key === 'Escape' && !e.defaultPrevented && !inField && !document.querySelector('[data-modal]')) toggle(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="fixed top-1/2 right-0 z-40 -translate-y-1/2">
      {open ? (
        <section
          id="type-tracker"
          aria-labelledby="type-tracker-title"
          className="ds-box pop-in mr-2 max-h-[85dvh] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto p-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <h2 id="type-tracker-title" className="min-w-0 flex-1 tx-10 leading-5 font-normal">Type tracker</h2>
            <ClearButton ruledOut={ruledOut} onClear={onClear} />
            <button
              ref={closeRef}
              type="button"
              onClick={() => toggle(false)}
              aria-label="Close the type tracker"
              className="ds-button bevel-paper flex h-11 w-11 shrink-0 items-center justify-center text-ds-ink"
            >
              <ResultMark kind="mismatch" scale={2} className="" />
            </button>
          </div>
          <p className="mb-2 tx-9 leading-4">{NOTE}</p>
          <TypeButtons ruledOut={ruledOut} onToggle={onToggle} className="grid-cols-3" />
        </section>
      ) : (
        <button
          ref={tabRef}
          type="button"
          onClick={() => toggle(true)}
          aria-label="Types: open the type tracker"
          aria-expanded="false"
          title="Type tracker"
          // A narrow tab (--tab-w: 30 px, 28 px under 360 px) with the letters stacked, upright, keeping design rule 4's
          // 10 px from the tab's edges (6 px bevel + 4 px air). The page's right padding makes room for it
          // (.page-gutter in index.css), so the tab never covers the board.
          className="ds-button bevel-paper flex w-[var(--tab-w)] flex-col items-center justify-center gap-1.5 py-3 text-[9px] max-[360px]:text-[8px] leading-none text-ds-ink"
        >
          <span aria-hidden="true">◀</span>
          {'TYPES'.split('').map((letter, i) => (
            <span key={i} aria-hidden="true">
              {letter}
            </span>
          ))}
        </button>
      )}
    </div>
  )
}
