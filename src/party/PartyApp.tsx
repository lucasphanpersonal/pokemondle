import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { PartyHeader } from './PartyHeader.tsx'
import { PartyHelpModal } from './PartyHelpModal.tsx'
import { hashFor, parseHash, type PartyRoute } from './route.ts'

/** The address for a route: this page's own path plus the room hash (none on the start screen). */
const urlFor = (route: PartyRoute) => location.pathname + location.search + hashFor(route)

/**
 * The route follows the address: /party/ is the start screen, /party/#KPZW is room KPZW. Typing a new hash, a
 * pasted invite link and the browser's Back and Forward all arrive as hashchange / popstate.
 */
function usePartyRoute() {
  const [route, setRoute] = useState<PartyRoute>(() => parseHash(location.hash))

  useEffect(() => {
    const sync = () => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  // Keep the address tidy without adding history: #kpzw becomes #KPZW, and a code that isn't one is cleared
  // (the start screen says what happened).
  useEffect(() => {
    if (location.hash !== hashFor(route)) history.replaceState(history.state, '', urlFor(route))
  }, [route])

  /** Opens a room or goes back to the start screen as a new history entry, so Back returns where you were. */
  const navigate = useCallback((next: PartyRoute) => {
    history.pushState(null, '', urlFor(next))
    setRoute(next)
  }, [])

  return [route, navigate] as const
}

export function PartyApp() {
  const [route, navigate] = usePartyRoute()
  const [showHelp, setShowHelp] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shownTitle = useRef<string | null>(null)
  const title = route.screen === 'room' ? `Room ${route.code} · Pokémondle Party` : 'Pokémondle Party'

  // On a screen change (not the first load), move focus to the new screen's heading so keyboard and screen-reader
  // users land on it, and name the room in the tab title.
  useEffect(() => {
    document.title = title
    if (shownTitle.current !== null && shownTitle.current !== title) headingRef.current?.focus()
    shownTitle.current = title
  }, [title])

  return (
    <div className="flex min-h-dvh flex-col">
      <PartyHeader onHelp={() => setShowHelp(true)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-3 py-4 sm:px-5 sm:py-6">
        {route.screen === 'room' ? (
          <RoomScreen code={route.code} headingRef={headingRef} onLeave={() => navigate({ screen: 'start' })} />
        ) : (
          <StartScreen badCode={route.badCode} headingRef={headingRef} />
        )}
      </main>
      {showHelp && <PartyHelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}

interface ScreenProps {
  headingRef: RefObject<HTMLHeadingElement | null>
}

/**
 * Start screen. PLACEHOLDER for task 9 (start screen and lobby): the nickname box, red Host a room, white Join and
 * the four letter boxes go here. Joining should call navigate({ screen: 'room', code }) via PartyApp.
 */
function StartScreen({ badCode, headingRef }: ScreenProps & { badCode?: string }) {
  return (
    <>
      {badCode !== undefined && (
        <div className="ds-box px-4 py-3 tx-10 leading-5" role="alert" data-testid="party-bad-code">
          <p>
            “{badCode}” isn't a room code. Codes are 4 letters with no vowels, like KPZW. Check the invite link, or ask the
            host for the code.
          </p>
        </div>
      )}
      <section className="ds-box px-4 py-4 tx-10 leading-5 sm:px-5" aria-labelledby="party-start-title" data-screen="start">
        <h2 id="party-start-title" ref={headingRef} tabIndex={-1} className="mb-3 tx-11 leading-5 outline-none">
          Party
        </h2>
        <p>Take turns naming a Pokémon that fits the category before your timer runs out. The last player with lives wins.</p>
        <p className="mt-2 text-ds-frame">Hosting and joining a room are on the way. For now, open an invite link to see its room.</p>
      </section>
    </>
  )
}

/**
 * Room screen. PLACEHOLDER for tasks 9 and 10: the lobby (task 9) and the game (task 10) render here once useParty
 * (task 6) connects to the room. This PR never contacts Supabase.
 */
function RoomScreen({ code, headingRef, onLeave }: ScreenProps & { code: string; onLeave: () => void }) {
  return (
    <section className="ds-box flex flex-col items-center gap-3 px-4 py-4 text-center tx-10 leading-5 sm:px-5" aria-labelledby="party-room-title" data-screen="room">
      <h2 id="party-room-title" ref={headingRef} tabIndex={-1} className="tx-10 leading-5 outline-none">
        Room <span className="sr-only">{code.split('').join(' ')}</span>
      </h2>
      <p className="tx-14 leading-5" aria-hidden="true" data-testid="party-room-code">
        {code}
      </p>
      <p className="text-ds-frame">Joining rooms is on the way. This page will connect to the room here.</p>
      <button type="button" onClick={onLeave} className="ds-button bevel-paper h-11 px-4 text-[10px] text-ds-ink">
        Leave
      </button>
    </section>
  )
}
