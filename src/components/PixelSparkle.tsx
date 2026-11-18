import type { CSSProperties } from 'react'

/**
 * Small pixel-art four-point sparkle: the shiny mark on the result screen.
 * Drawn as SVG because the pixel font has no sparkle glyph and an emoji would break the pixel look.
 */
export function PixelSparkle({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 9 9"
      width="9"
      height="9"
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
      style={style}
    >
      <path d="M4 0h1v2H4zM3 2h3v1H3zM0 4h2v1H0zM2 3h5v3H2zM7 4h2v1H7zM3 6h3v1H3zM4 7h1v2H4z" />
    </svg>
  )
}
