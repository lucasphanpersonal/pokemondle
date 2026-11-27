/**
 * Whether a side panel (Type tracker, Gen hint) is open. SideTabs sets it; the page reads it to make room for the
 * panel on wide screens instead of letting it cover the board.
 *
 * It is mirrored on <html> as data-side-panel, which index.css uses to widen the page's right gutter
 * (.page-gutter) from 1024 px up, and GuessGrid reads it to pick the layout that fits the narrower board.
 */
let open = false
const listeners = new Set<() => void>()

export function isSidePanelOpen(): boolean {
  return open
}

export function setSidePanelOpen(next: boolean): void {
  if (next === open) return
  open = next
  if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-side-panel', next)
  for (const l of listeners) l()
}

export function subscribeSidePanel(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}
