import { useState, type CSSProperties } from 'react'
import { loadJson, saveJson } from '../lib/storage'
import { TYPE_LABELS, TYPES, type TypeName } from '../lib/typeNotes'
import { Modal } from './Modal'

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
              aria-label={type}
              onClick={() => onToggle(type)}
              // Ruled out: a dark grey face with a hint of the type's colour (white text over 5:1 on every type).
              style={{ '--face': out ? `color-mix(in srgb, ${face} 15%, #646a72)` : face } as CSSProperties}
              className={`ds-button type-label flex w-full items-center justify-center px-2.5 leading-none ${out ? 'bevel-pressed line-through decoration-2' : ''}`}
            >
              {label}
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
 * Desktop (1024 px and up): the tracker sits between the guess box and the board as its own box, all 18 types in two
 * rows of nine. It can be folded away to a single row; that choice is remembered on this device.
 */
export function TypeTrackerPanel(props: TypeTrackerProps) {
  const [open, setOpen] = useState(() => loadJson('type-tracker-open') !== false)
  const toggleOpen = () => {
    setOpen(!open)
    saveJson('type-tracker-open', !open)
  }
  return (
    <section className="ds-box p-2 sm:p-3" aria-labelledby="type-tracker-title">
      <div className="mx-1 flex items-center gap-3">
        <h2 id="type-tracker-title" className="min-w-0 flex-1 tx-10 leading-5 font-normal">Type tracker</h2>
        {open && <ClearButton ruledOut={props.ruledOut} onClear={props.onClear} />}
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-controls={open ? 'type-tracker-grid' : undefined}
          className="ds-button bevel-paper h-11 shrink-0 whitespace-nowrap px-3 text-[10px]"
        >
          {open ? 'Hide ▲' : 'Show ▼'}
        </button>
      </div>
      {open && (
        <div id="type-tracker-grid" className="mt-2">
          <p className="mx-1 mb-2 tx-9 leading-4">{NOTE}</p>
          <TypeButtons ruledOut={props.ruledOut} onToggle={props.onToggle} className="grid-cols-9" />
        </div>
      )}
    </section>
  )
}

/** The button that opens the tracker on phones and tablets (under 1024 px), in the board's heading. */
export function TypeTrackerButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label="Type tracker"
      className="ds-button bevel-paper inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[9px] sm:text-[10px]"
    >
      Types
      <span aria-hidden="true">▲</span>
    </button>
  )
}

/** Phones and tablets: the tracker pops out as a sheet from the bottom of the screen (a dialog box on tablets). */
export function TypeTrackerModal({ onClose, ...props }: TypeTrackerProps & { onClose: () => void }) {
  return (
    <Modal title="Type tracker" onClose={onClose}>
      <p className="mb-3 tx-9 leading-4">{NOTE}</p>
      <TypeButtons ruledOut={props.ruledOut} onToggle={props.onToggle} className="grid-cols-3" />
      <div className="mt-3 flex justify-end">
        <ClearButton ruledOut={props.ruledOut} onClear={props.onClear} />
      </div>
    </Modal>
  )
}
