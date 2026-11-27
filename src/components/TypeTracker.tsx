import type { CSSProperties } from 'react'
import { TYPE_LABELS, TYPES, type TypeName } from '../lib/typeNotes'

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
export function TypeTrackerClear({ ruledOut, onClear }: Pick<TypeTrackerProps, 'ruledOut' | 'onClear'>) {
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

/** The Type tracker's panel body (the panel itself is a side tab, SideTabs.tsx): a note and the 18 types in three columns. */
export function TypeTrackerBody({ ruledOut, onToggle }: Pick<TypeTrackerProps, 'ruledOut' | 'onToggle'>) {
  return (
    <>
      <p className="mb-2 tx-9 leading-4">{NOTE}</p>
      <TypeButtons ruledOut={ruledOut} onToggle={onToggle} className="grid-cols-3" />
    </>
  )
}
