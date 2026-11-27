import { useEffect, useRef, useState, type RefObject } from 'react'
import { ResultMark } from '../../components/ResultMark.tsx'
import { SearchBar } from '../../components/SearchBar.tsx'
import { SpriteImg } from '../../components/SpriteImg.tsx'
import type { GuessResult } from '../../lib/game.ts'
import { iconSources, POKEDEX, POKEDEX_BY_ID } from '../../lib/pokedex.ts'
import type { Pokemon } from '../../types/pokemon.ts'
import { checkLocally, livesText, railPlayers, railScrollFor, tickKey, timerState, turnText, WRONG_MS, type RailPlayer, type TimerState } from '../game.ts'
import { playParty } from '../sounds.ts'
import type { AnswerResult, GameAnswer, GameView } from '../types.ts'
import { CategoryCard } from './CategoryCard.tsx'
import { FuseTimer } from './FuseTimer.tsx'

/**
 * The game screen: the player rail, the category card, the turn's text box and timer, the turn-gated search box and this
 * round's answers. Presentational: the room connection lives in the caller.
 *
 * Props:
 * - `view`: the game (GameView in ../types.ts).
 * - `onAnswer(pokemonId)`: on this player's turn, after the answer passed the local check; resolves with the server's
 *   verdict (a refusal's reason shows under the box).
 * - `onLeave()`: Leave the room.
 * - `onTimeUp()`: optional, called once when this turn's countdown reaches zero on screen (task 11 hangs the burst on it;
 *   ending the turn on the server is the room connection's job).
 * - `headingRef`: PartyApp focuses the heading (the category card's "Round N") when the screen changes.
 *
 * Phones get one column: the rail (scrolling sideways), the category card right above the turn box and search box, then
 * the answers. From 768 px the answers sit beside the card.
 */
export interface GameScreenProps {
  view: GameView
  onAnswer: (pokemonId: number) => Promise<AnswerResult>
  onLeave: () => void
  onTimeUp?: () => void
  busy?: boolean
  error?: string
  headingRef?: RefObject<HTMLHeadingElement | null>
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/** The clock the timers read: ticks every 50 ms while a turn is running. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 50)
    return () => clearInterval(id)
  }, [running])
  return now
}

export function GameScreen({ view, onAnswer, onLeave, onTimeUp, busy, error, headingRef }: GameScreenProps) {
  const [reduceMotion] = useState(prefersReducedMotion)
  const now = useNow(view.deadlineAt !== null)
  const timer: TimerState | null = view.deadlineAt === null ? null : timerState(view.deadlineAt, view.seconds, now)
  const frame = (Math.floor(now / 150) % 2) as 0 | 1
  const turn = turnText(view)
  const rail = railPlayers(view)

  // Ticks: one a second, two a second in the last 5 (tickKey changes); none on the first draw of a turn.
  const lastTick = useRef<string | null | undefined>(undefined)
  const key = timer ? tickKey(timer.remainingMs) : null
  useEffect(() => {
    if (lastTick.current !== undefined && key !== null && key !== lastTick.current) playParty(key.startsWith('h') ? 'tock' : 'tick')
    lastTick.current = key
  }, [key])

  // Time's up, once per turn.
  const doneFor = useRef<number | null>(null)
  useEffect(() => {
    if (timer?.phase === 'done' && view.deadlineAt !== null && doneFor.current !== view.deadlineAt) {
      doneFor.current = view.deadlineAt
      onTimeUp?.()
    }
  })

  // A new answer at the top of the list chimes (not the ones already there when the screen opened).
  const topAnswer = view.answers[0]?.id
  const seenTop = useRef(topAnswer)
  useEffect(() => {
    if (topAnswer !== undefined && topAnswer !== seenTop.current) playParty('chime')
    seenTop.current = topAnswer
  }, [topAnswer])

  // A wrong answer: the box shakes and its reason shows for WRONG_MS. `n` restarts the shake for the same reason twice.
  // A new turn drops the last turn's reason (it belongs to the turn it was shown in).
  const turnId = `${view.round}|${view.turnPlayerId}|${view.deadlineAt}`
  const [wrongState, setWrong] = useState<{ reason: string; n: number; turn: string } | null>(null)
  const wrong = wrongState?.turn === turnId ? wrongState : null
  useEffect(() => {
    if (!wrongState) return
    const t = setTimeout(() => setWrong(null), WRONG_MS)
    return () => clearTimeout(t)
  }, [wrongState])
  const showWrong = (reason: string) => {
    playParty('buzz')
    setWrong((w) => ({ reason, n: (w?.n ?? 0) + 1, turn: turnId }))
  }
  const [sending, setSending] = useState(false)

  const live = turn.mine && timer !== null && timer.phase !== 'done'
  const onGuess = (pokemon: Pokemon): GuessResult => {
    if (!live || sending) return 'game-over'
    const check = checkLocally(view.category, pokemon, view.answers, POKEDEX_BY_ID)
    if (!check.ok) {
      showWrong(check.reason)
      return 'ok'
    }
    setSending(true)
    void onAnswer(pokemon.id).then((res) => {
      setSending(false)
      if (!res.ok) showWrong(res.reason)
    })
    return 'ok'
  }

  return (
    <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_18rem] md:items-start" data-screen="game">
      <PlayerRail players={rail} startLives={view.startLives} timer={timer} reduceMotion={reduceMotion} frame={frame} mineTurn={turn.mine} />

      <div className="flex min-w-0 flex-col gap-4">
        <CategoryCard category={view.category} tier={view.tier} round={view.round} left={view.left} headingRef={headingRef} />

        <div className="flex flex-col gap-1.5 sm:gap-2" data-testid="party-turn">
          <div className="flex items-stretch gap-1.5 sm:gap-2">
            {turn.mine && (
              <div className="ds-box flex shrink-0 items-center justify-center px-2 py-1" role="timer" aria-label={timer ? `${timer.seconds} seconds left` : undefined}>
                <FuseTimer timer={timer} scale={3} showSeconds reduceMotion={reduceMotion} frame={frame} />
              </div>
            )}
            <p
              className={`ds-box flex min-w-0 flex-1 items-center px-3 py-2 tx-10 leading-5 sm:px-4 ${turn.mine ? '' : 'text-ds-ink'}`}
              role="status"
              data-testid="party-prompt"
            >
              {turn.prompt}
            </p>
          </div>
          <div key={wrong?.n ?? 0} className={wrong && !reduceMotion ? 'party-shake' : undefined} data-testid="party-search">
            <SearchBar
              pokedex={POKEDEX}
              // Suggestions are never filtered: not to the category, not even to what was said (that would give answers away).
              guessedIds={NO_IDS}
              onGuess={onGuess}
              disabled={!live}
              doneText={turn.mine ? 'Time’s up!' : turn.waiting}
              focusWhenEnabled
            />
          </div>
          {/* The reason shows for WRONG_MS, then the line goes (the live region stays for the next one). */}
          <p className={`text-center tx-9 leading-4 text-ds-red-dark ${wrong ? '' : 'sr-only'}`} role="alert" data-testid="party-wrong">
            {wrong?.reason ?? ''}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <AnswersList answers={view.answers} meId={view.meId} />
        <div className="flex flex-col gap-1.5 sm:gap-2">
          {error && (
            <p role="alert" className="tx-9 leading-4 text-ds-red-dark" data-testid="party-game-error">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={onLeave}
            disabled={busy}
            className="ds-button bevel-paper h-11 w-full px-3 text-[10px] text-ds-ink disabled:opacity-40"
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  )
}

const NO_IDS: number[] = []

// ---------------------------------------------------------------------------------------------------------------

interface PlayerRailProps {
  players: RailPlayer[]
  startLives: number
  timer: TimerState | null
  reduceMotion: boolean
  frame: 0 | 1
  /** On this browser's turn the big timer sits by the search box, so the rail's active tile carries only the icon. */
  mineTurn: boolean
}

/** The players in turn order. The active one is pressed in and carries the timer; out players are greyed with ✕ OUT. */
function PlayerRail({ players, startLives, timer, reduceMotion, frame, mineTurn }: PlayerRailProps) {
  const railRef = useRef<HTMLOListElement>(null)
  const active = players.find((p) => p.isTurn)?.id
  // Keep the player whose turn it is in view: the rail scrolls sideways on phones.
  useEffect(() => {
    const rail = railRef.current
    const tile = rail?.querySelector<HTMLElement>(`[data-player="${CSS.escape(active ?? '')}"]`)
    if (!rail || !tile || rail.scrollWidth <= rail.clientWidth) return
    rail.scrollTo({ left: railScrollFor(tile.offsetLeft, tile.offsetWidth, rail.clientWidth, rail.scrollWidth), behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [active, reduceMotion])

  return (
    <section className="ds-box min-w-0 px-2 py-2 md:col-span-2" aria-label="Players">
      <ol ref={railRef} className="party-rail flex gap-1.5 overflow-x-auto pb-1 [justify-content:safe_center] sm:gap-2" data-testid="party-rail">
        {players.map((p) => (
          <RailTile key={p.id} player={p} startLives={startLives} timer={p.isTurn ? timer : null} reduceMotion={reduceMotion} frame={frame} iconOnly={mineTurn} />
        ))}
      </ol>
    </section>
  )
}

function RailTile({
  player: p,
  startLives,
  timer,
  reduceMotion,
  frame,
  iconOnly,
}: {
  player: RailPlayer
  startLives: number
  timer: TimerState | null
  reduceMotion: boolean
  frame: 0 | 1
  iconOnly: boolean
}) {
  const status = p.out ? 'out' : p.isTurn ? 'turn' : p.online ? 'waiting' : 'away'
  return (
    <li
      data-player={p.id}
      data-status={status}
      aria-current={p.isTurn ? 'true' : undefined}
      className={`bevel relative flex w-[6.5rem] shrink-0 flex-col items-center gap-1 px-2.5 pt-2.5 pb-2.5 text-center tx-9 leading-4 ${
        p.isTurn ? 'bevel-pressed' : ''
      } ${p.out ? 'party-out' : ''}`}
    >
      <SpriteImg
        sources={iconSources({ id: p.icon, dexNumber: p.icon })}
        crop={24}
        alt=""
        width={40}
        height={40}
        className={`h-10 w-10 shrink-0 ${p.out ? 'grayscale' : ''}`}
      />
      <p className="w-full leading-4 [overflow-wrap:anywhere]">
        {p.nickname}
        {p.isMe && <span className="sr-only"> (you)</span>}
      </p>
      {p.isMe && <p className="tx-8 leading-4 text-ds-frame" aria-hidden="true">You</p>}
      <Lives lives={p.lives} lost={p.lost} label={livesText(p.lives, startLives, p.out)} />
      <div className="mt-auto flex min-h-6 items-center justify-center gap-1 tx-8 leading-4">
        {p.out ? (
          <>
            <ResultMark kind="mismatch" scale={2} className="" />
            <span>OUT</span>
          </>
        ) : p.isTurn ? (
          iconOnly || !timer ? (
            <>
              <FuseTimer timer={null} scale={1} reduceMotion />
              <span>Turn</span>
            </>
          ) : (
            <span className="flex items-center gap-1" role="timer" aria-label={`${timer.seconds} seconds left`}>
              <FuseTimer timer={timer} scale={1} reduceMotion={reduceMotion} frame={frame} />
              <span className={`tx-10 ${timer.phase !== 'calm' ? 'text-ds-red-dark' : ''}`} aria-hidden="true">
                {timer.seconds}
              </span>
            </span>
          )
        ) : !p.online ? (
          <span className="text-ds-frame">Away</span>
        ) : null}
      </div>
    </li>
  )
}

/** The heart: 7 x 6 pixel art at 2 px a pixel. A lost life is the outline only. */
const HEART = ['.kk.kk.', 'kRRkRRk', 'kRRRRRk', '.kRRRk.', '..kRk..', '...k...']
function Heart({ full }: { full: boolean }) {
  return (
    <svg width={14} height={12} viewBox="0 0 7 6" shapeRendering="crispEdges" aria-hidden="true" className="shrink-0">
      {HEART.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={c === 'k' ? '#202830' : full ? '#e04848' : '#f8f8f8'} />,
        ),
      )}
    </svg>
  )
}

function Lives({ lives, lost, label }: { lives: number; lost: number; label: string }) {
  return (
    <p className="flex flex-wrap justify-center gap-0.5" data-testid="party-lives" data-lives={lives}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lives }, (_, i) => (
        <Heart key={`f${i}`} full />
      ))}
      {Array.from({ length: lost }, (_, i) => (
        <Heart key={`e${i}`} full={false} />
      ))}
    </p>
  )
}

// ---------------------------------------------------------------------------------------------------------------

/** This round's answers, newest on top: sprite, name and who said it. */
function AnswersList({ answers, meId }: { answers: GameAnswer[]; meId: string }) {
  return (
    <section className="ds-box px-4 py-4 tx-10 leading-5 sm:px-5" aria-labelledby="party-answers-title">
      <h3 id="party-answers-title" className="mb-3 tx-11 leading-5">
        This round
      </h3>
      {answers.length === 0 ? (
        <p className="text-ds-frame">No answers yet.</p>
      ) : (
        <ol className="flex flex-col gap-1.5 sm:gap-2" data-testid="party-answers" aria-live="polite">
          {answers.map((a) => {
            const p = POKEDEX_BY_ID.get(a.pokemonId)
            return (
              <li key={a.id} className="flex min-h-11 items-center gap-1.5 sm:gap-2">
                <SpriteImg sources={iconSources(p ?? { id: a.pokemonId, dexNumber: a.pokemonId })} crop={24} alt="" width={40} height={40} className="h-10 w-10 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="leading-5 break-words">{p?.name ?? `#${a.pokemonId}`}</p>
                  <p className="tx-8 leading-4 text-ds-frame">
                    {a.playerId === meId ? 'You' : a.nickname}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
