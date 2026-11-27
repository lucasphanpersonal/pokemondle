import { ART_H, ART_W, FUSE, fusePaths } from '../fuseArt.ts'
import { fuseCells, type TimerState } from '../game.ts'

interface FuseTimerProps {
  /** The countdown now (timerState in game.ts), or null for the plain icon (no turn running, or the rail's marker). */
  timer: TimerState | null
  /** Pixels per art pixel: 3 for the big timer beside the search box, 1 for the rail. */
  scale: number
  /** Show the seconds as a number under the drawing (never colour or motion alone, design rule 8). */
  showSeconds?: boolean
  /** No flashing, swelling or crackling spark (prefers-reduced-motion). The fuse still burns down and the number counts. */
  reduceMotion: boolean
  /**
   * The spark's frame (0 or 1): GameScreen flips it with its clock so the spark crackles. Task 11 hooks the time's-up
   * burst onto `timer.phase === 'done'` (the drawing then shows a spent fuse).
   */
  frame?: 0 | 1
  className?: string
}

/**
 * The turn timer: an original pixel-art fuse bomb drawn in code (fuseArt.ts). The fuse burns down with the seconds and a
 * spark rides its tip; in the last 5 s the bomb flashes white twice a second and swells (to 1.25x), unless reduced
 * motion is on. The seconds also show as a number. The drawing is decoration: the number (or the label the caller
 * gives) carries the meaning for screen readers.
 */
export function FuseTimer({ timer, scale, showSeconds = false, reduceMotion, frame = 0, className = '' }: FuseTimerProps) {
  const cells = timer ? fuseCells(timer.fuse, FUSE.length) : FUSE.length
  const lit = !!timer && timer.phase !== 'done'
  const flash = !reduceMotion && !!timer?.flash
  const swell = !reduceMotion && timer ? timer.swell : 1
  const hurry = timer?.phase === 'hurry' || timer?.phase === 'done'
  return (
    <span className={`inline-flex shrink-0 flex-col items-center ${className}`} data-testid="party-timer" data-phase={timer?.phase ?? 'idle'}>
      <svg
        viewBox={`0 0 ${ART_W} ${ART_H}`}
        width={ART_W * scale}
        height={ART_H * scale}
        shapeRendering="crispEdges"
        aria-hidden="true"
        // Swells from its base, so it grows upwards and doesn't push the number down.
        style={{ transform: swell === 1 ? undefined : `scale(${swell.toFixed(3)})`, transformOrigin: '50% 90%' }}
        className="block"
      >
        {fusePaths(cells, lit, reduceMotion ? 0 : frame, flash).map((p) => (
          <path key={p.color} fill={p.color} d={p.d} />
        ))}
      </svg>
      {showSeconds && timer && (
        <span
          className={`mt-1 leading-none ${scale >= 3 ? 'tx-16' : 'tx-10'} ${hurry ? 'text-ds-red-dark' : ''}`}
          data-testid="party-timer-seconds"
        >
          {timer.seconds}
        </span>
      )}
    </span>
  )
}
