import ballArt from '../../scripts/icons/pokeball.txt?raw'
import { ballPaths, parseBallArt } from '../lib/pokeballArt'

const BALL = ballPaths(parseBallArt(ballArt).grid16)

/** The tab icon's 16x16 pixel Poké Ball, drawn at 1:1 (or a whole-number scale), for the board's guess count. */
export function PixelBall({ scale = 1, className = '' }: { scale?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16 * scale}
      height={16 * scale}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
    >
      {BALL.map((p) => (
        <path key={p.color} fill={p.color} d={p.d} />
      ))}
    </svg>
  )
}
