import { useEffect, useMemo, useRef, useState } from 'react'
import { SpriteImg } from '../../components/SpriteImg.tsx'
import { iconSources, POKEDEX, POKEDEX_BY_ID } from '../../lib/pokedex.ts'
import { ballPaths, STAR_ART, STAR_PALETTE } from '../../lib/pokeballArt.ts'
import { ART_H, ART_W, BURST_FRAMES, BURST_H, BURST_W, burstPaths, fusePaths } from '../fuseArt.ts'
import { alsoFitIds, clearedFrame, clearedText, timeUpFrame, timeUpText, type TimeUpFrame } from '../moments.ts'
import { playParty } from '../sounds.ts'
import type { ClearedEnd, TimeoutEnd } from '../types.ts'
import { useNow } from '../useNow.ts'

/*
 * The end of a round, drawn: time's up (the fuse bomb flashes and bursts, the typed text, "Also fit") and round cleared
 * (the banner and the new tier). The timelines are pure (moments.ts); these components read the shared 50 ms clock
 * while they play and call onDone when their time is up. Each is a role="status" region: screen readers get the whole
 * sentence at once, sighted players the typed-out copy (whose hidden tail keeps the box its final size from the start).
 */

/** The shared clock, running until local time `at` (then it holds still). */
function useClockUntil(at: number): number {
  // Stopped for one `at` only: a later `at` (the server's event arrived late) starts it again.
  const [stoppedFor, setStoppedFor] = useState<number | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setStoppedFor(at), Math.max(0, at - Date.now()))
    return () => clearTimeout(t)
  }, [at])
  return useNow(stoppedFor !== at)
}

/** Pixels per art pixel for the burst: the bomb is 16 x 25 (48 x 75 px), the burst 24 x 24 (72 x 72 px). */
const SCALE = 3

/** The art column: the bomb flashing, a burst frame, or the smoke left once it's spent. */
function BurstArt({ art, reduceMotion, className = '' }: { art: TimeUpFrame['art']; reduceMotion: boolean; className?: string }) {
  let svg
  if (art.kind === 'flash' || reduceMotion) {
    // The spent bomb in its flash colours: the fuse is gone. Reduced motion shows only this still.
    const on = art.kind === 'flash' ? art.on : true
    const swell = art.kind === 'flash' && !reduceMotion ? art.swell : 1
    svg = (
      <svg
        viewBox={`0 0 ${ART_W} ${ART_H}`}
        width={ART_W * SCALE}
        height={ART_H * SCALE}
        shapeRendering="crispEdges"
        style={{ transform: swell === 1 ? undefined : `scale(${swell.toFixed(3)})`, transformOrigin: '50% 70%' }}
        className="block"
      >
        {fusePaths(0, false, 0, on).map((p, i) => (
          <path key={i} fill={p.color} d={p.d} />
        ))}
      </svg>
    )
  } else {
    const frame = art.kind === 'burst' ? art.frame : BURST_FRAMES - 1
    svg = (
      <svg viewBox={`0 0 ${BURST_W} ${BURST_H}`} width={BURST_W * SCALE} height={BURST_H * SCALE} shapeRendering="crispEdges" className="block">
        {burstPaths(frame).map((p, i) => (
          <path key={i} fill={p.color} d={p.d} />
        ))}
      </svg>
    )
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center ${className}`}
      style={{ width: BURST_W * SCALE, height: ART_H * SCALE }}
      aria-hidden="true"
      data-testid="party-burst"
      data-art={art.kind === 'burst' ? `burst-${art.frame}` : art.kind}
    >
      {svg}
    </div>
  )
}

/** Typed-out text: the letters so far, the rest kept invisible so the line wraps where it will end up. */
function Typed({ text, letters, className }: { text: string; letters: number; className: string }) {
  return (
    <p aria-hidden="true" className={className}>
      {text.slice(0, letters)}
      <span className="invisible">{text.slice(letters)}</span>
    </p>
  )
}

interface TimeUpPanelProps {
  /** The server's round end, or null while an early burst waits for it. */
  end: TimeoutEnd | null
  startedAt: number
  eventAt: number | null
  /** When the panel's time is up (onDone is called then); omitted, it stays (the game over screen). */
  endsAt?: number
  meId: string
  reduceMotion: boolean
  onDone?: () => void
  className?: string
}

/** Time's up: the bomb flashes and bursts with a pop, "Time's up! Brock lost a life." types out, then "Also fit:". */
export function TimeUpPanel({ end, startedAt, eventAt, endsAt, meId, reduceMotion, onDone, className = '' }: TimeUpPanelProps) {
  const text = end ? timeUpText(end, meId) : "Time's up!"
  const fits = useMemo(() => (end ? alsoFitIds(end, POKEDEX, POKEDEX_BY_ID) : []), [end])
  // The clock runs until the timeline has settled (or until the panel is done).
  const settleAt = Math.max(endsAt ?? 0, startedAt + 3000)
  const now = useClockUntil(settleAt)
  const frame = timeUpFrame({ startedAt, eventAt }, end ? text.length : 0, now, BURST_FRAMES, reduceMotion)

  const popped = useRef(false)
  useEffect(() => {
    if (frame.popped && !popped.current) {
      popped.current = true
      playParty('pop')
    }
  }, [frame.popped])

  const finished = endsAt !== undefined && now >= endsAt
  useEffect(() => {
    if (finished) onDone?.()
  }, [finished, onDone])

  const names = fits.map((id) => POKEDEX_BY_ID.get(id)?.name ?? `#${id}`)
  const spoken = end ? `${text}${names.length ? ` Also fit: ${names.join(', ')}.` : ''}` : text
  const showFits = end === null || fits.length > 0
  return (
    <div
      role="status"
      className={`ds-box flex flex-col justify-center px-3 py-3 sm:px-4 ${className}`}
      data-testid="party-moment"
      data-kind="timeout"
    >
      <p className="sr-only">{spoken}</p>
      {/* Phones: the bomb beside the text, "Also fit" across the box below. From 640 px "Also fit" sits under the text,
          beside the bomb, so the panel stays about as tall as the category card it covers. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <BurstArt art={frame.art} reduceMotion={reduceMotion} className={showFits ? 'sm:row-span-2' : ''} />
        <Typed text={text} letters={end ? frame.letters : reduceMotion || frame.popped ? text.length : 0} className="tx-11 leading-6" />
        {showFits && (
          <div
            aria-hidden="true"
            className={`col-span-2 flex flex-col gap-1 sm:col-span-1 sm:col-start-2 ${frame.alsoFit ? '' : 'invisible'}`}
            data-testid="party-also-fit"
          >
            <p className="tx-9 leading-4">Also fit:</p>
            <ul className="grid max-w-[24rem] grid-cols-3 gap-1.5 sm:gap-2">
              {(fits.length ? fits : [0, 0, 0]).map((id, i) => {
                const p = POKEDEX_BY_ID.get(id)
                return (
                  <li key={`${id}-${i}`} className="flex min-w-0 flex-col items-center gap-0.5 text-center">
                    <SpriteImg sources={iconSources(p ?? { id, dexNumber: id })} crop={24} alt="" width={40} height={40} className="h-10 w-10 shrink-0" />
                    <span className="w-full tx-8 leading-4 break-words hyphens-auto" lang="en">{p?.name ?? ''}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

const STAR = ballPaths(STAR_ART, 0, STAR_ART.length, STAR_PALETTE)
function Star() {
  return (
    <svg viewBox="0 0 9 9" width={27} height={27} shapeRendering="crispEdges" aria-hidden="true" className="block shrink-0">
      {STAR.map((p, i) => (
        <path key={i} fill={p.color} d={p.d} />
      ))}
    </svg>
  )
}

interface ClearedPanelProps {
  end: ClearedEnd
  startedAt: number
  endsAt: number
  reduceMotion: boolean
  onDone?: () => void
  className?: string
}

/** Round cleared: a fanfare, "Round cleared!" types out, and the new tier when it changed ("Now: Hard"). */
export function ClearedPanel({ end, startedAt, endsAt, reduceMotion, onDone, className = '' }: ClearedPanelProps) {
  const { title, detail } = clearedText(end)
  const now = useClockUntil(endsAt + 100)
  const frame = clearedFrame(startedAt, title.length, now, reduceMotion)

  useEffect(() => {
    playParty('fanfare')
  }, [])
  const finished = now >= endsAt
  useEffect(() => {
    if (finished) onDone?.()
  }, [finished, onDone])

  return (
    <div
      role="status"
      className={`ds-box flex items-center justify-center gap-3 px-3 py-3 sm:px-4 ${className}`}
      data-testid="party-moment"
      data-kind="cleared"
    >
      <p className="sr-only">
        {title}
        {detail ? ` ${detail}` : ''}
      </p>
      <Star />
      <div className="flex min-w-0 flex-col gap-1 text-center">
        <Typed text={title} letters={frame.letters} className="tx-12 leading-6" />
        {detail && (
          <p aria-hidden="true" className={`tx-10 leading-5 ${frame.detail ? '' : 'invisible'}`} data-testid="party-tier-change">
            {detail}
          </p>
        )}
      </div>
      <Star />
    </div>
  )
}
