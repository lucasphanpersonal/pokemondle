import { ART_H, ART_W, FUSE, fusePaths } from '../fuseArt.ts'
import { fuseCells, timerState } from '../game.ts'
import { useNow } from '../useNow.ts'

interface FuseTimerProps {
  /** The turn's deadline in local epoch ms, or null for the plain icon (the rail's marker on your own turn). */
  deadlineAt: number | null
  /** The turn's whole length, so the fuse burns from full to nothing. */
  seconds: number
  /** Pixels per art pixel: 3 for the big timer beside the text box, 1 for the rail. */
  scale: number
  /** Show the seconds as a number (never motion or colour alone, design rule 8): under the drawing, or beside it. */
  showSeconds?: 'below' | 'beside'
  /** No flashing, swelling or crackling spark (prefers-reduced-motion). The fuse still burns down and the number counts. */
  reduceMotion: boolean
  className?: string
}

/**
 * The turn timer: an original pixel-art fuse bomb drawn in code (fuseArt.ts). The fuse burns down with the seconds and a
 * spark crackles on its tip; in the last 5 s the bomb flashes white twice a second and swells (to 1.25x), unless reduced
 * motion is on. It reads its own 50 ms clock (useNow), so only the timer redraws while the countdown runs. With
 * `showSeconds` it is a role="timer" announcing the seconds left; the drawing itself is decoration.
 */
export function FuseTimer({ deadlineAt, seconds, scale, showSeconds, reduceMotion, className = '' }: FuseTimerProps) {
  const now = useNow(deadlineAt !== null)
  const timer = deadlineAt === null ? null : timerState(deadlineAt, seconds, now)
  const frame = (Math.floor(now / 150) % 2) as 0 | 1
  const cells = timer ? fuseCells(timer.fuse, FUSE.length) : FUSE.length
  const lit = !!timer && timer.phase !== 'done'
  const flash = !reduceMotion && !!timer?.flash
  const swell = !reduceMotion && timer ? timer.swell : 1
  const hurry = timer !== null && timer.phase !== 'calm'
  const big = scale >= 3
  return (
    <span
      className={`inline-flex shrink-0 items-center ${showSeconds === 'beside' ? 'flex-row gap-1' : 'flex-col'} ${className}`}
      data-testid="party-timer"
      data-phase={timer?.phase ?? 'idle'}
      role={showSeconds && timer ? 'timer' : undefined}
      aria-label={showSeconds && timer ? `${timer.seconds} seconds left` : undefined}
    >
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
        {fusePaths(cells, lit, reduceMotion ? 0 : frame, flash).map((p, i) => (
          <path key={i} fill={p.color} d={p.d} />
        ))}
      </svg>
      {showSeconds && timer && (
        <span
          className={`leading-none ${big ? 'mt-1 tx-16' : 'tx-10'} ${hurry ? 'text-ds-red-dark' : ''}`}
          aria-hidden="true"
          data-testid="party-timer-seconds"
        >
          {timer.seconds}
        </span>
      )}
    </span>
  )
}
