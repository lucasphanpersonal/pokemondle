import { useCallback, useEffect, useRef, useState } from 'react'
import { PartyHeader } from './PartyHeader.tsx'
import { PartyHelpModal } from './PartyHelpModal.tsx'
import { useMockParty, mockEnabled } from './mock.ts'
import { hashFor, parseHash, type PartyRoute } from './route.ts'
import { GameOverScreen } from './screens/GameOverScreen.tsx'
import { GameScreen } from './screens/GameScreen.tsx'
import { LobbyScreen } from './screens/LobbyScreen.tsx'
import { StartScreen } from './screens/StartScreen.tsx'
import type { PartyController } from './types.ts'
import { usePartyController } from './usePartyController.ts'

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

// ?mock in the dev server swaps in a pretend room (src/party/mock.ts). Picked once, so the same hook runs on every
// render; production builds drop the mock (import.meta.env.DEV is false there).
const useController: (route: PartyRoute) => PartyController & { inGame?: boolean } =
  import.meta.env.DEV && mockEnabled()
    ? useMockParty
    : (route) => usePartyController(route.screen === 'room' ? route.code : null)

export function PartyApp() {
  const [route, navigate] = usePartyRoute()
  const [showHelp, setShowHelp] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shownTitle = useRef<string | null>(null)
  const party = useController(route)
  const lobby = party.lobby
  const inLobby = lobby !== null && route.screen === 'room' && route.code === lobby.code
  const title = route.screen === 'room' ? `Room ${route.code} · Pokémondle Party` : 'Pokémondle Party'

  // On a screen change (not the first load), move focus to the new screen's heading so keyboard and screen-reader
  // users land on it, and name the room in the tab title.
  const screenKey = `${title}|${inLobby}|${!!party.game}|${!!party.over}`
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
      <main className={`mx-auto flex w-full flex-col gap-4 px-3 py-4 sm:px-5 sm:py-6 ${inLobby && party.game ? 'max-w-md md:max-w-3xl lg:max-w-5xl' : inLobby && party.over ? 'max-w-md sm:max-w-xl lg:max-w-4xl' : inLobby ? 'max-w-md md:max-w-3xl' : 'max-w-md'}`}>
        {inLobby && party.inGame && party.game ? (
          <GameScreen
            view={party.game}
            busy={party.busy}
            error={party.error}
            headingRef={headingRef}
            onAnswer={party.answer}
            onLeave={() => {
              party.leave()
              navigate({ screen: 'start' })
            }}
          />
        ) : inLobby && party.inGame && party.over ? (
          <GameOverScreen
            view={party.over}
            busy={party.busy}
            error={party.error}
            headingRef={headingRef}
            onPlayAgain={party.playAgain}
            onLeave={() => {
              party.leave()
              navigate({ screen: 'start' })
            }}
          />
        ) : inLobby && party.inGame ? (
          // The moment before a new game's first category (or the final results) arrives.
          <section className="ds-box flex flex-col gap-3 px-4 py-4 tx-10 leading-5 sm:px-5" aria-labelledby="party-game-title" data-screen="game">
            <h2 id="party-game-title" ref={headingRef} tabIndex={-1} className="tx-11 leading-5 outline-none">
              Room {lobby.code}
            </h2>
            <p>{lobby.status === 'over' ? 'Counting up the results…' : 'Dealing the next category…'}</p>
            <button type="button" onClick={() => { party.leave(); navigate({ screen: 'start' }) }} className="ds-button bevel-paper h-11 px-4 text-[10px] text-ds-ink">
              Leave
            </button>
          </section>
        ) : inLobby ? (
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
