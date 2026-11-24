import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import ballArt from '../../scripts/icons/pokeball.txt?raw'
import { isArtworkUrl } from '../lib/pokedex'
import { ballPaths, parseBallArt } from '../lib/pokeballArt'
import { pixelArtwork } from '../lib/pixelate'

/** The 16x16 pixel Poké Ball in greys: the "no picture" stand-in, like an empty Pokédex slot. */
const GREY_BALL: Record<string, string> = {
  k: '#3a4a5c', // outline and band (--color-ds-frame)
  R: '#a8b4c0',
  r: '#8a98a8',
  L: '#d0d8e0',
  W: '#e8ecf0',
  w: '#c0c8d0',
}

/**
 * The placeholder as an image, so it takes any sprite slot's size and classes unchanged. The ball sits
 * in a 20x20 frame (2px of air each side, like the in-game sprites' margins) and every grid pixel is
 * a whole number of screen pixels at the usual 40px size.
 */
export const PLACEHOLDER_SPRITE = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 20 20" shape-rendering="crispEdges">${ballPaths(
    parseBallArt(ballArt).grid16,
    0,
    16,
    GREY_BALL,
  )
    .map((p) => `<path fill="${p.color}" d="${p.d}"/>`)
    .join('')}</svg>`,
)}`

interface SpriteImgProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  /** Pictures to try in order (see iconSources). If none loads, the grey Poké Ball shows. */
  sources: string[]
}

/** A blank 1x1 image: holds the slot while artwork is being pixel-filtered (a few milliseconds). */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * A Pokémon picture that never shows the browser's broken-image icon: a source that fails to load
 * moves on to the next, and the last resort is a grey pixel Poké Ball. Official artwork (for forms
 * with no sprite) goes through the pixel filter first, so it matches the sprites around it.
 */
export function SpriteImg({ sources, className = '', ...rest }: SpriteImgProps) {
  // Failures are counted per list, so a slot that is reused for another Pokémon starts over.
  const key = sources.join(' ')
  const [failed, setFailed] = useState({ key, count: 0 })
  const count = failed.key === key ? failed.count : 0
  const next = () => setFailed((f) => (f.key === key && f.count === count ? { key, count: count + 1 } : f))
  const wanted = sources[count]
  const artwork = wanted !== undefined && isArtworkUrl(wanted)
  const [pixel, setPixel] = useState<{ url: string; data: string } | null>(null)

  useEffect(() => {
    if (!artwork) return
    let alive = true
    pixelArtwork(wanted).then(
      (data) => alive && setPixel({ url: wanted, data }),
      () => alive && next(),
    )
    return () => {
      alive = false
    }
    // next only changes with key and count, which wanted already follows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artwork, wanted])

  const src = wanted === undefined ? PLACEHOLDER_SPRITE : artwork ? (pixel?.url === wanted ? pixel.data : BLANK) : wanted
  return (
    <img
      {...rest}
      src={src}
      onError={() => {
        if (!artwork && count < sources.length) next()
      }}
      className={`[image-rendering:pixelated] ${className}`}
    />
  )
}
