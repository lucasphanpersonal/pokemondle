import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, type RefObject } from 'react'
import { ResultMark } from '../../components/ResultMark.tsx'
import { SearchBar } from '../../components/SearchBar.tsx'
import { SpriteImg } from '../../components/SpriteImg.tsx'
import type { GuessResult } from '../../lib/game.ts'
import { iconSources, POKEDEX, POKEDEX_BY_ID } from '../../lib/pokedex.ts'
import { playSound } from '../../lib/sound.ts'
import type { Pokemon } from '../../types/pokemon.ts'
import {
  checkLocally,
  livesText,
  nextTick,
  railPlayers,
  railScrollFor,
  tickKey,
  timerState,
  timeUpDue,
  turnKeyOf,
  turnText,
  WRONG_MS,
  type RailPlayer,
  type TickMemory,
} from '../game.ts'
import { initialMoments, momentEndsAt, momentReducer } from '../moments.ts'
import { playParty } from '../sounds.ts'
import type { AnswerResult, GameAnswer, GameView } from '../types.ts'
import { useNow } from '../useNow.ts'
import { CategoryCard } from './CategoryCard.tsx'
import { FuseTimer } from './FuseTimer.tsx'
import { ClearedPanel, TimeUpPanel } from './RoundMoments.tsx'

/**
 * The game screen: the player rail, the category card, the turn's text box and timer, the turn-gated search box and this
 * round's answers. Presentational: the room connection lives in the caller.
 *
 * Props:
 * - `view`: the game (GameView in ../types.ts).
 * - `onAnswer(pokemonId)`: on this player's turn, after the answer passed the local check; resolves with the server's
 *   verdict (a refusal's reason shows under the box).
 * - `onLeave()`: Leave the room.
 * - `onTimeUp()`: optional, called once per turn when its countdown reaches zero on screen (the screen also starts the
 *   time's up burst then; ending the turn on the server is the room connection's job).
 * - `headingRef`: PartyApp focuses the heading (the category card's "Round N") when the screen changes.
 *
 * Phones get one column: the rail (scrolling sideways), the category card right above the turn box and search box, then
 * the answers. From 768 px the answers sit beside the card. Only the timers, TurnEvents and a playing moment read the
 * 50 ms clock, so the rest of the screen redraws when the room changes, not 20 times a second.
 *
 * The end of a round (view.roundEnd, from the server's last_event, so every screen shows it) plays over the category
 * card: time's up (~2.5 s, the bomb bursts, then "Also fit") or round cleared (~1.5 s), then the new category slides in.
 * The panel covers the card's place, so the turn box and search box never move and the next player can type straight
 * away: a moment never blocks input. Below 1024 px the time's up panel is taller than a one-part card, so it is kept short
 * (RoundMoments) and also takes half of the gap below the card; in the usual case it then stays clear of the rail's
 * cards (it grows upwards only with a long nickname or long names). The local countdown reaching
 * zero starts the burst before the server's event arrives; a round end plays once per round (moments.ts).
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

/** Whether `turn`'s deadline has passed: a timeout at the deadline flips it, so nothing polls the clock for it. */
function useExpired(turn: string, deadlineAt: number | null): boolean {
  const [expiredFor, setExpiredFor] = useState<string | null>(null)
  useEffect(() => {
    if (deadlineAt === null) return
    const t = setTimeout(() => setExpiredFor(turn), Math.max(0, deadlineAt - Date.now()))
    return () => clearTimeout(t)
  }, [turn, deadlineAt])
  return expiredFor === turn
}

/**
 * The countdown's sounds and time's up, drawn as nothing: ticks once a second, twice a second in the last 5 (none on a
 * turn's first draw), and onTimeUp once per turn.
 */
function TurnEvents({ turn, deadlineAt, seconds, onTimeUp }: { turn: string; deadlineAt: number | null; seconds: number; onTimeUp?: () => void }) {
  const now = useNow(deadlineAt !== null)
  const timer = deadlineAt === null ? null : timerState(deadlineAt, seconds, now)
  const tick = timer ? tickKey(timer.remainingMs) : null
  const memory = useRef<TickMemory | null>(null)
  useEffect(() => {
    const next = nextTick(memory.current, turn, tick)
    memory.current = next.memory
    if (next.play) playParty(next.play)
  }, [turn, tick])

  const done = timer?.phase === 'done'
  const announced = useRef<string | null>(null)
  useEffect(() => {
    if (!timeUpDue(announced.current, turn, done)) return
    announced.current = turn
    onTimeUp?.()
  }, [turn, done, onTimeUp])
  return null
}

export function GameScreen({ view, onAnswer, onLeave, onTimeUp, busy, error, headingRef }: GameScreenProps) {
  const [reduceMotion] = useState(prefersReducedMotion)
  const turn = turnText(view)
  const turnKey = turnKeyOf(view)

  // The end of a round: the server's event, joined to an early burst when this screen's countdown got there first.
  const [moments, dispatchMoment] = useReducer(momentReducer, view.roundEnd, initialMoments)
  const roundEnd = view.roundEnd
  const round = view.round
  useEffect(() => {
    dispatchMoment({ type: 'event', end: roundEnd, round, now: Date.now() })
  }, [roundEnd, round])
  const turnRound = view.round
  const turnPlayer = view.turnPlayerId
  const handleTimeUp = useCallback(() => {
    dispatchMoment({ type: 'early', round: turnRound, playerId: turnPlayer, now: Date.now() })
    onTimeUp?.()
  }, [turnRound, turnPlayer, onTimeUp])
  const moment = moments.moment
  const momentDone = useCallback((id: number) => dispatchMoment({ type: 'done', id }), [])
  // After a moment the card slides in (the last moment's id as its key); never on the screen's first draw.
  const slideFor = moments.nextId - 1
  const rail = useMemo(
    () => railPlayers({ players: view.players, turnPlayerId: view.turnPlayerId, meId: view.meId, startLives: view.startLives }),
    [view.players, view.turnPlayerId, view.meId, view.startLives],
  )
  const expired = useExpired(turnKey, view.deadlineAt)

  // A new answer at the top of the list chimes (not the ones already there when the screen opened).
  const topAnswer = view.answers[0]?.id
  const seenTop = useRef(topAnswer)
  useEffect(() => {
    if (topAnswer !== undefined && topAnswer !== seenTop.current) playParty('chime')
    seenTop.current = topAnswer
  }, [topAnswer])

  // A wrong answer: the reason shows for WRONG_MS, and only during the turn it was given in.
  const [wrongState, setWrong] = useState<{ reason: string; n: number; turn: string } | null>(null)
  const wrong = wrongState?.turn === turnKey ? wrongState : null
  useEffect(() => {
    if (!wrongState) return
    const t = setTimeout(() => setWrong(null), WRONG_MS)
    return () => clearTimeout(t)
  }, [wrongState])
  const showWrong = (reason: string, forTurn: string) => {
    playParty('buzz')
    setWrong((w) => ({ reason, n: (w?.n ?? 0) + 1, turn: forTurn }))
  }

  // The box shakes on each wrong answer: the class is taken off and put back on the wrapper, so the animation restarts
  // without remounting the search box (which would lose what the player is typing).
  const shakeRef = useRef<HTMLDivElement>(null)
  const shakeN = wrongState?.n
  useEffect(() => {
    const el = shakeRef.current
    if (!el || shakeN === undefined || reduceMotion) return
    el.classList.remove('party-shake')
    void el.offsetWidth
    el.classList.add('party-shake')
  }, [shakeN, reduceMotion])

  // After an answer is sent the box stays locked for the rest of the turn (a valid one moves the turn on), unless the
  // server refuses it.
  const [sentFor, setSentFor] = useState<string | null>(null)
  const live = turn.mine && view.deadlineAt !== null && !expired && sentFor !== turnKey

  const onGuess = (pokemon: Pokemon): GuessResult => {
    if (!live) return 'game-over'
    const check = checkLocally(view.category, pokemon, view.answers, POKEDEX_BY_ID)
    if (!check.ok) {
      showWrong(check.reason, turnKey)
      return 'ok'
    }
    playSound('select')
    const forTurn = turnKey
    setSentFor(forTurn)
    void onAnswer(pokemon.id).then((res) => {
      if (res.ok) return
      setSentFor((s) => (s === forTurn ? null : s))
      showWrong(res.reason, forTurn)
    })
    return 'ok'
  }

  return (
    <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_18rem] md:items-start" data-screen="game">
      <TurnEvents turn={turnKey} deadlineAt={view.deadlineAt} seconds={view.seconds} onTimeUp={handleTimeUp} />
      <PlayerRail
        players={rail}
        startLives={view.startLives}
        deadlineAt={view.deadlineAt}
        seconds={view.seconds}
        reduceMotion={reduceMotion}
        mineTurn={turn.mine}
      />

      <div className="flex min-w-0 flex-col gap-4">
        <div className="relative overflow-x-clip" data-testid="party-card-slot">
          <div
            key={`card-${slideFor}`}
            className={moment ? 'invisible' : slideFor > 0 && !reduceMotion ? 'party-slide-in' : ''}
            data-moment={moment ? moment.kind : undefined}
          >
            <CategoryCard category={view.category} tier={view.tier} round={view.round} left={view.left} headingRef={headingRef} />
          </div>
          {moment?.kind === 'timeout' && (moment.end === null || moment.end.kind === 'timeout') && (
            <TimeUpPanel
              key={`moment-${moment.id}`}
              end={moment.end}
              startedAt={moment.startedAt}
              eventAt={moment.eventAt}
              endsAt={momentEndsAt(moment)}
              meId={view.meId}
              reduceMotion={reduceMotion}
              onDone={() => momentDone(moment.id)}
              className="absolute inset-x-0 -bottom-2 z-20 min-h-full lg:bottom-0"
            />
          )}
          {moment?.kind === 'cleared' && moment.end?.kind === 'cleared' && (
            <ClearedPanel
              key={`moment-${moment.id}`}
              end={moment.end}
              startedAt={moment.startedAt}
              endsAt={momentEndsAt(moment)}
              reduceMotion={reduceMotion}
              onDone={() => momentDone(moment.id)}
              className="absolute inset-x-0 bottom-0 z-20 min-h-full"
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5 sm:gap-2" data-testid="party-turn">
          <div className="flex items-stretch gap-1.5 sm:gap-2">
            {turn.mine && (
              <div className="ds-box flex shrink-0 items-center justify-center px-2 py-1">
                <FuseTimer deadlineAt={view.deadlineAt} seconds={view.seconds} scale={3} showSeconds="below" reduceMotion={reduceMotion} />
              </div>
            )}
            <p className="ds-box flex min-w-0 flex-1 items-center px-3 py-2 tx-10 leading-5 sm:px-4" role="status" data-testid="party-prompt">
              {turn.prompt}
            </p>
          </div>
          {/* Above the content after it: the shake leaves a transform (a new stacking context), and the suggestions must stay on top. */}
          <div ref={shakeRef} className="relative z-30" data-testid="party-search">
            <SearchBar
              pokedex={POKEDEX}
              // Suggestions are never filtered: not to the category, not even to what was said (that would give answers away).
              guessedIds={NO_IDS}
              onGuess={onGuess}
              disabled={!live}
              doneText={turn.mine ? (expired ? 'Time’s up!' : 'Sending…') : turn.waiting}
              focusWhenEnabled
              pickSound={false}
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
  deadlineAt: number | null
  seconds: number
  reduceMotion: boolean
  /** On this browser's turn the big timer sits by the search box, so the rail's active tile carries only the icon. */
  mineTurn: boolean
}

/** The players in turn order. The active one is pressed in and carries the timer; out players are greyed with ✕ OUT. */
const PlayerRail = memo(function PlayerRail({ players, startLives, deadlineAt, seconds, reduceMotion, mineTurn }: PlayerRailProps) {
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
          <RailTile
            key={p.id}
            player={p}
            startLives={startLives}
            deadlineAt={p.isTurn && !mineTurn ? deadlineAt : null}
            seconds={seconds}
            reduceMotion={reduceMotion}
          />
        ))}
      </ol>
    </section>
  )
})

function RailTile({
  player: p,
  startLives,
  deadlineAt,
  seconds,
  reduceMotion,
}: {
  player: RailPlayer
  startLives: number
  /** The live countdown on someone else's turn; null shows the timer as a plain icon (your own turn). */
  deadlineAt: number | null
  seconds: number
  reduceMotion: boolean
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
          deadlineAt === null ? (
            <>
              <FuseTimer deadlineAt={null} seconds={seconds} scale={1} reduceMotion />
              <span>Turn</span>
            </>
          ) : (
            <FuseTimer deadlineAt={deadlineAt} seconds={seconds} scale={1} showSeconds="beside" reduceMotion={reduceMotion} />
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
