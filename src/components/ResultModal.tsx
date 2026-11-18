import { useEffect, useState } from 'react'
import type { GuessFeedback } from '../lib/compare'
import type { GameMode } from '../lib/game'
import { iconUrl, spriteUrl } from '../lib/pokedex'
import { shinyIconUrl, shinySpriteUrl } from '../lib/shiny'
import type { Pokemon } from '../types/pokemon'
import { DailyStats } from './DailyStats'
import { DexEntryCard } from './DexEntryCard'
import { Modal } from './Modal'
import { PixelBulb } from './PixelBulb'
import { PixelSparkle } from './PixelSparkle'

interface ResultModalProps {
  mode: GameMode
  target: Pokemon
  feedback: GuessFeedback[]
  /** Daily puzzle date (YYYY-MM-DD), for the global stats; ignored in Endless. */
  puzzleDate: string
  /** Current and best Daily streaks on this device. */
  streak: number
  bestStreak: number
  /** The Gen hint was taken in this game. */
  hinted: boolean
  /** The player gave up (Daily or Endless): the answer is revealed instead of caught. */
  gaveUp?: boolean
  /** The rare (1 in 20) shiny catch: the shiny sprite, sparkles and a "Shiny!" badge. Wins only. */
  shiny?: boolean
  onClose: () => void
  /** Opens History (past Dailies, streaks and Endless stats), which lives here rather than on the play page. */
  onHistory: () => void
  onNewGame?: () => void
}

function untilLocalMidnight(): string {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const s = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

function Countdown() {
  const [text, setText] = useState(untilLocalMidnight)
  useEffect(() => {
    const id = window.setInterval(() => setText(untilLocalMidnight()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return <span className="tabular-nums">{text}</span>
}

/** Where each sparkle sits around the shiny sprite, and when it blinks (staggered so they take turns). */
const SPARKLES = [
  { pos: 'left-1 top-3', delay: '0s', size: 'h-4 w-4' },
  { pos: 'right-2 top-8', delay: '0.4s', size: 'h-3 w-3' },
  { pos: 'right-0 bottom-6', delay: '0.8s', size: 'h-4 w-4' },
  { pos: 'left-4 bottom-10', delay: '0.6s', size: 'h-3 w-3' },
]

/** End-of-game screen: the answer's artwork, guess count, streak, History, daily stats and New Pokémon. */
export function ResultModal({ mode, target, feedback, puzzleDate, streak, bestStreak, hinted, gaveUp, shiny = false, onClose, onHistory, onNewGame }: ResultModalProps) {
  const guessText = `${feedback.length} ${feedback.length === 1 ? 'guess' : 'guesses'}`
  const isShiny = shiny && !gaveUp
  // Sprite, then artwork for forms without one; a shiny tries its shiny pair first and falls back to the normal ones.
  const sources = isShiny
    ? [shinyIconUrl(target.id), shinySpriteUrl(target.id), iconUrl(target.id), spriteUrl(target.id)]
    : [iconUrl(target.id), spriteUrl(target.id)]
  return (
    <Modal title={gaveUp ? 'It got away!' : 'Gotcha!'} onClose={onClose}>
      <div className="flex flex-col items-center gap-4 text-center tx-10 leading-5">
        {/* The game's own pixel sprite, scaled up crisply; official artwork if a form has none. */}
        <div className="relative">
          <img
            key={`${target.id}:${isShiny}`}
            src={sources[0]}
            alt={isShiny ? `Shiny ${target.name}` : target.name}
            width={192}
            height={192}
            onError={(e) => {
              const img = e.currentTarget
              const next = sources[sources.indexOf(img.src) + 1]
              if (next) img.src = next
            }}
            className="h-40 w-40 drop-shadow-[0_4px_0_rgb(0_0_0/0.15)] [image-rendering:pixelated] sm:h-48 sm:w-48"
          />
          {isShiny &&
            SPARKLES.map((s) => (
              <PixelSparkle
                key={s.pos}
                className={`twinkle absolute ${s.pos} ${s.size} text-fb-partial drop-shadow-[1px_1px_0_var(--color-ds-frame)]`}
                style={{ animationDelay: s.delay }}
              />
            ))}
        </div>
        {isShiny && (
          <p className="inline-flex items-center gap-1.5 border-2 border-ds-frame bg-ds-paper px-2 py-1 tx-9">
            <PixelSparkle />
            Shiny! A 1 in 20 catch
          </p>
        )}
        {gaveUp ? (
          <p className="text-xs leading-6">
            It was <strong>{target.name}</strong>! You gave up after {guessText}.
          </p>
        ) : (
          <p className="text-xs leading-6">
            You caught {isShiny && 'a shiny '}<strong>{target.name}</strong> in {guessText}!
          </p>
        )}
        {hinted && (
          <p className="inline-flex items-center gap-1.5 border-2 border-ds-frame bg-ds-paper px-2 py-1 tx-9">
            <PixelBulb />
            Used the Gen hint
          </p>
        )}

        <DexEntryCard key={target.id} target={target} />

        {mode === 'daily' && (
          <p className="tx-10">
            Streak: <strong>{streak}</strong> {streak === 1 ? 'day' : 'days'} · Best: <strong>{bestStreak}</strong>
            {gaveUp && <span className="mt-1 block text-ds-frame">Giving up ends your streak.</span>}
          </p>
        )}

        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onHistory} className="ds-button bevel-paper px-4 text-[10px]">
            History
          </button>
          {onNewGame && (
            <button type="button" onClick={onNewGame} className="ds-button bevel-red px-4 text-[10px] text-ds-paper">
              New Pokémon
            </button>
          )}
        </div>

        {mode === 'daily' && <DailyStats date={puzzleDate} guesses={gaveUp ? null : feedback.length} />}

        {mode === 'daily' && (
          <p className="tx-9 text-ds-frame">
            Next daily Pokémon in <Countdown />
          </p>
        )}
      </div>
    </Modal>
  )
}
