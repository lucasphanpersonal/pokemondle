import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ResultMark } from './ResultMark'

export interface SideTab {
  id: string
  /** The tab's visible letters, stacked upright under a ◀ (TYPES, HINT, GEN4). */
  letters: string
  /** The tab's accessible name. */
  label: string
  title: string
  /** The panel's heading. */
  heading: string
  /** The close button's accessible name. */
  closeLabel: string
  /** Extra buttons in the panel's header, before the close button (the Type tracker's Clear). */
  actions?: ReactNode
  /** The panel's body. Rendered only while the panel is open. */
  body: ReactNode
}

/**
 * The side tabs: narrow tabs stacked on the screen's right edge (every screen size, vertically centred) that each slide
 * out a panel to their left: the Type tracker and the Gen hint. They live off to the side so they never crowd the game.
 * One panel is open at a time. The tabs stay put while a panel is open; the open one is pressed in (design rule 2), and
 * tapping it again, the panel's close button or Esc puts the panel away. A panel isn't a dialog: the page stays usable
 * behind it, so a player can keep guessing with it open.
 */
export function SideTabs({ tabs }: { tabs: readonly SideTab[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = tabs.find((t) => t.id === openId) ?? null
  // A tab can go away while its panel is open (the Gen hint in a single-Gen Endless game): forget it, so it can't
  // pop back open on its own later.
  if (openId && !open) setOpenId(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const closeRef = useRef<HTMLButtonElement>(null)
  // Focus follows the open/close, but not on first render (a tab must not steal focus from the guess box).
  const lastOpened = useRef<string | null>(null)
  const moved = useRef(false)
  useEffect(() => {
    if (!moved.current) return
    if (openId) closeRef.current?.focus()
    else if (lastOpened.current) tabRefs.current.get(lastOpened.current)?.focus()
  }, [openId])
  const toggle = (id: string | null) => {
    moved.current = true
    if (id) lastOpened.current = id
    setOpenId(id)
  }

  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => {
      // A dialog on top (Help, results) handles its own Esc.
      // Esc in the guess box closes its suggestion list, not the panel.
      const inField = e.target instanceof HTMLElement && e.target.closest('input, textarea')
      if (e.key === 'Escape' && !e.defaultPrevented && !inField && !document.querySelector('[data-modal]')) toggle(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openId])

  return (
    <div className="fixed top-1/2 right-0 z-40 flex -translate-y-1/2 items-center gap-[var(--tab-gap)]">
      {open && (
        <section
          id={`side-panel-${open.id}`}
          aria-labelledby={`side-panel-${open.id}-title`}
          className="ds-box pop-in max-h-[85dvh] w-[min(22rem,calc(100vw-var(--tab-w)-var(--tab-gap)-0.5rem))] overflow-y-auto p-3 max-[360px]:p-2.5"
        >
          <div className="mb-2 flex items-center gap-2 max-[360px]:gap-1.5">
            <h2 id={`side-panel-${open.id}-title`} className="min-w-0 flex-1 tx-10 leading-5 font-normal max-[360px]:tx-9">
              {open.heading}
            </h2>
            {open.actions}
            <button
              ref={closeRef}
              type="button"
              onClick={() => toggle(null)}
              aria-label={open.closeLabel}
              className="ds-button bevel-paper flex h-11 w-11 shrink-0 items-center justify-center text-ds-ink"
            >
              <ResultMark kind="mismatch" scale={2} className="" />
            </button>
          </div>
          {open.body}
        </section>
      )}
      <div className="flex flex-col gap-1.5">
        {tabs.map((tab) => {
          const isOpen = tab.id === openId
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el)
                else tabRefs.current.delete(tab.id)
              }}
              type="button"
              onClick={() => toggle(isOpen ? null : tab.id)}
              aria-label={tab.label}
              aria-expanded={isOpen}
              aria-controls={isOpen ? `side-panel-${tab.id}` : undefined}
              title={tab.title}
              // A narrow tab (--tab-w: 30 px, 28 px under 360 px) with the letters stacked, upright, keeping design rule 4's
              // 10 px from the tab's edges (6 px bevel + 4 px air). The page's right padding makes room for it
              // (.page-gutter in index.css), so the tabs never cover the board.
              className={`ds-button bevel-paper flex w-[var(--tab-w)] flex-col items-center justify-center gap-1.5 py-3 text-[9px] max-[360px]:text-[8px] leading-none text-ds-ink ${isOpen ? 'bevel-pressed' : ''}`}
            >
              <span aria-hidden="true">◀</span>
              {tab.letters.split('').map((letter, i) => (
                <span key={i} aria-hidden="true">
                  {letter}
                </span>
              ))}
            </button>
          )
        })}
      </div>
    </div>
  )
}
