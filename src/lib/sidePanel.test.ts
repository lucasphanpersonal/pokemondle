import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSidePanelOpen, setSidePanelOpen, subscribeSidePanel } from './sidePanel'

afterEach(() => vi.unstubAllGlobals())

describe('sidePanel', () => {
  it('tracks the open state, mirrors it on <html> and tells subscribers', () => {
    const attrs = new Set<string>()
    vi.stubGlobal('document', {
      documentElement: { toggleAttribute: (name: string, on: boolean) => (on ? attrs.add(name) : attrs.delete(name)) },
    })
    const onChange = vi.fn()
    const unsubscribe = subscribeSidePanel(onChange)
    setSidePanelOpen(true)
    expect(isSidePanelOpen()).toBe(true)
    expect(attrs.has('data-side-panel')).toBe(true)
    setSidePanelOpen(true) // no change, no call
    setSidePanelOpen(false)
    expect(isSidePanelOpen()).toBe(false)
    expect(attrs.has('data-side-panel')).toBe(false)
    expect(onChange).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
