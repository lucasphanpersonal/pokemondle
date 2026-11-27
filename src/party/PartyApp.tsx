import { useCallback, useEffect, useRef, useState } from 'react'
import { PartyHeader } from './PartyHeader.tsx'
import { PartyHelpModal } from './PartyHelpModal.tsx'
import { useMockParty, mockEnabled } from './mock.ts'
import { hashFor, parseHash, type PartyRoute } from './route.ts'
import { LobbyScreen } from './screens/LobbyScreen.tsx'
import { StartScreen } from './screens/StartScreen.tsx'
import type { PartyController } from './types.ts'

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

/**
 * PLACEHOLDER for task 6 (the room connection): useParty replaces this, talking to the party Edge Function and Realtime.
 * Until then hosting and joining only say they are on the way.
 */
function usePlaceholderParty(_route: PartyRoute): PartyController {
  const [error, setError] = useState<string>()
  const soon = () => setError("Rooms aren't open yet. Party is still being built.")
  return {
    lobby: null,
    busy: false,
    error,
    host: soon,
    join: soon,
    changeSettings: () => {},
    start: () => {},
    remove: () => {},
    leave: () => {},
  }
}

// TEMPORARY (task 6 removes it with mock.ts): ?mock in the dev server swaps in a pretend room. Picked once, so the same
// hook runs on every render; production builds drop the mock (import.meta.env.DEV is false there).
const useParty: (route: PartyRoute) => PartyController =
  import.meta.env.DEV && mockEnabled() ? useMockParty : usePlaceholderParty

export function PartyApp() {
  const [route, navigate] = usePartyRoute()
  const [showHelp, setShowHelp] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shownTitle = useRef<string | null>(null)
  const party = useParty(route)
  const lobby = party.lobby
  const inLobby = lobby !== null && route.screen === 'room' && route.code === lobby.code
  const title = route.screen === 'room' ? `Room ${route.code} · Pokémondle Party` : 'Pokémondle Party'

  // On a screen change (not the first load), move focus to the new screen's heading so keyboard and screen-reader
  // users land on it, and name the room in the tab title.
  const screenKey = `${title}|${inLobby}`
  useEffect(() => {
    document.title = title
    if (shownTitle.current !== null && shownTitle.current !== screenKey) headingRef.current?.focus()
    shownTitle.current = screenKey
  }, [title, screenKey])

  // Once hosting or joining puts this browser in a room, the address follows it (so Back returns to the start screen).
  const lobbyCode = lobby?.code
  useEffect(() => {
    if (lobbyCode && !(route.screen === 'room' && route.code === lobbyCode)) navigate({ screen: 'room', code: lobbyCode })
    // Only when the room changes: reading the route here must not fight the player's own Back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyCode])

  return (
    <div className="flex min-h-dvh flex-col">
      <PartyHeader onHelp={() => setShowHelp(true)} />
      <main className={`mx-auto flex w-full flex-col gap-4 px-3 py-4 sm:px-5 sm:py-6 ${inLobby ? 'max-w-md md:max-w-3xl' : 'max-w-md'}`}>
        {inLobby ? (
          <LobbyScreen
            view={lobby}
            busy={party.busy}
            error={party.error}
            headingRef={headingRef}
            onChangeSettings={party.changeSettings}
            onStart={party.start}
            onRemove={party.remove}
            onLeave={() => {
              party.leave()
              navigate({ screen: 'start' })
            }}
          />
        ) : (
          <>
            {route.screen === 'start' && route.badCode !== undefined && (
              <div className="ds-box px-4 py-3 tx-10 leading-5" role="alert" data-testid="party-bad-code">
                <p>
                  “{route.badCode}” isn't a room code. Codes are 4 letters with no vowels, like KPZW. Check the invite link, or ask
                  the host for the code.
                </p>
              </div>
            )}
            <StartScreen
              // A new code from the address (another invite link) starts the form over with it.
              key={route.screen === 'room' ? route.code : 'start'}
              initialCode={route.screen === 'room' ? route.code : undefined}
              busy={party.busy}
              error={party.error}
              headingRef={headingRef}
              onHost={party.host}
              onJoin={party.join}
            />
          </>
        )}
      </main>
      {showHelp && <PartyHelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}
