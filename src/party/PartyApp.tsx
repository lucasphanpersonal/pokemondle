import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { friendlyError } from './api.ts'
import { PartyHeader } from './PartyHeader.tsx'
import { PartyHelpModal } from './PartyHelpModal.tsx'
import { hashFor, normaliseCode, parseHash, type PartyRoute } from './route.ts'
import { PARTY_UNREACHABLE, useParty, type PartyHandle } from './useParty.ts'

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
  const party = useParty(route.screen === 'room' ? route.code : null)
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
          <RoomScreen
            code={route.code}
            party={party}
            headingRef={headingRef}
            onLeave={() => {
              void party.leave()
              navigate({ screen: 'start' })
            }}
          />
        ) : (
          <StartScreen
            badCode={route.badCode}
            party={party}
            headingRef={headingRef}
            onEnter={(code) => navigate({ screen: 'room', code })}
          />
        )}
      </main>
      {showHelp && <PartyHelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}

interface ScreenProps {
  headingRef: RefObject<HTMLHeadingElement | null>
  party: PartyHandle
}

const inputClass = 'ds-box h-11 w-full bg-ds-paper px-3 tx-10 text-ds-ink'
const buttonClass = 'ds-button bevel-paper h-11 px-4 text-[10px] text-ds-ink'
const redButtonClass = 'ds-button bevel-red h-11 px-4 text-[10px] text-white'

/** Shown when the build has no server address or key, or the server can't be reached. */
function Notice({ party }: { party: PartyHandle }) {
  if (party.status === 'unavailable')
    return (
      <p className="text-ds-frame" data-testid="party-unavailable" role="status">
        Party isn't available right now.
      </p>
    )
  if (party.status === 'error')
    return (
      <div role="alert" data-testid="party-error" className="flex flex-col gap-2">
        <p>{PARTY_UNREACHABLE}.</p>
        <button type="button" onClick={party.retry} className={buttonClass}>
          Try again
        </button>
      </div>
    )
  return null
}

/**
 * Start screen. Minimal working version until the designed start screen and lobby (task 9) replace it: a nickname,
 * Host a room, and a room code to join.
 */
function StartScreen({ badCode, party, headingRef, onEnter }: ScreenProps & { badCode?: string; onEnter: (code: string) => void }) {
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const off = party.status === 'unavailable'

  async function submit(e: FormEvent, mode: 'host' | 'join') {
    e.preventDefault()
    setProblem(null)
    const wanted = mode === 'join' ? normaliseCode(code) : null
    if (mode === 'join' && !wanted) return setProblem('Room codes are 4 letters with no vowels, like KPZW.')
    setBusy(true)
    const res = wanted ? await party.join(wanted, nickname) : await party.host(nickname)
    setBusy(false)
    if (res.ok) onEnter(res.code)
    else setProblem(friendlyError(res.error))
  }

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
      <section className="ds-box flex flex-col gap-3 px-4 py-4 tx-10 leading-5 sm:px-5" aria-labelledby="party-start-title" data-screen="start">
        <h2 id="party-start-title" ref={headingRef} tabIndex={-1} className="tx-11 leading-5 outline-none">
          Party
        </h2>
        <p>Take turns naming a Pokémon that fits the category before your timer runs out. The last player with lives wins.</p>
        <Notice party={party} />
        {!off && (
          <form className="flex flex-col gap-3" onSubmit={(e) => submit(e, 'host')}>
            <label className="flex flex-col gap-2">
              Nickname
              <input className={inputClass} value={nickname} maxLength={12} autoComplete="off" onChange={(e) => setNickname(e.target.value)} />
            </label>
            <button type="submit" disabled={busy || !nickname.trim()} className={redButtonClass}>
              Host a room
            </button>
            <label className="flex flex-col gap-2">
              Room code
              <input className={inputClass} value={code} maxLength={4} autoCapitalize="characters" autoComplete="off" onChange={(e) => setCode(e.target.value)} />
            </label>
            <button type="button" disabled={busy || !nickname.trim() || !code.trim()} onClick={(e) => submit(e, 'join')} className={buttonClass}>
              Join
            </button>
          </form>
        )}
        {problem && (
          <p role="alert" data-testid="party-problem">
            {problem}
          </p>
        )}
      </section>
    </>
  )
}

/**
 * Room screen. Minimal working version until the lobby (task 9) and game (task 10) screens replace it: a join form if
 * this browser has no seat in the room, then a plain player list with Start for the host.
 */
function RoomScreen({ code, party, headingRef, onLeave }: ScreenProps & { code: string; onLeave: () => void }) {
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const { room, players, me } = party
  const seated = party.session !== null

  async function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setProblem(null)
    const res = await task()
    setBusy(false)
    if (!res.ok) setProblem(friendlyError(res.error ?? ''))
  }

  return (
    <section className="ds-box flex flex-col gap-3 px-4 py-4 tx-10 leading-5 sm:px-5" aria-labelledby="party-room-title" data-screen="room">
      <h2 id="party-room-title" ref={headingRef} tabIndex={-1} className="text-center tx-10 leading-5 outline-none">
        Room <span className="sr-only">{code.split('').join(' ')}</span>
      </h2>
      <p className="text-center tx-14 leading-5" aria-hidden="true" data-testid="party-room-code">
        {code}
      </p>
      <Notice party={party} />
      {party.lost && <p role="alert">You are no longer in this room.</p>}
      {party.status === 'connecting' && <p role="status">Connecting…</p>}
      {party.status === 'ready' && !seated && (
        <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), void run(() => party.join(code, nickname)))}>
          <label className="flex flex-col gap-2">
            Nickname
            <input className={inputClass} value={nickname} maxLength={12} autoComplete="off" onChange={(e) => setNickname(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !nickname.trim()} className={redButtonClass}>
            Join room
          </button>
        </form>
      )}
      {seated && room && (
        <>
          <ul className="flex flex-col gap-1" data-testid="party-players">
            {players.map((p) => (
              <li key={p.id}>
                {p.nickname}
                {p.id === room.host_id ? ' (host)' : ''}
                {p.id === me?.id ? ' (you)' : ''}
                {room.status !== 'lobby' ? `, ${p.lives} lives` : ''}
              </li>
            ))}
          </ul>
          {room.status === 'lobby' && party.isHost && (
            <button type="button" disabled={busy || players.length < 2} onClick={() => void run(party.start)} className={redButtonClass}>
              Start
            </button>
          )}
          {room.status === 'lobby' && !party.isHost && <p className="text-ds-frame">Waiting for the host to start.</p>}
          {room.status !== 'lobby' && <p className="text-ds-frame">The game screen is on the way.</p>}
        </>
      )}
      {problem && (
        <p role="alert" data-testid="party-problem">
          {problem}
        </p>
      )}
      <button type="button" onClick={onLeave} className={buttonClass}>
        Leave
      </button>
    </section>
  )
}
