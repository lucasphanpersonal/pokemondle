import { ballPaths } from '../lib/pokeballArt.ts'

/*
 * The turn timer: an original pixel-art fuse bomb, drawn in code like the Poké Ball (src/lib/pokeballArt.ts) so it can
 * animate. Its fuse burns down with the seconds, a spark rides the fuse's tip, and in the last 5 s it flashes white and
 * swells (FuseTimer.tsx does the drawing and the motion).
 *
 * The grid is 16 pixels wide and FUSE_H + BODY.length tall: the fuse and spark on top, then the body. Each letter is a
 * colour from the palette; `.` is transparent.
 */

/** The bomb: a gold cap on a round slate-blue body with a highlight, a shaded side and two eyes. 16 x 18. */
export const BODY = [
  '......kkkk......',
  '......kGgk......',
  '.....kkkkkk.....',
  '...kkBBBBBBkk...',
  '..kBBBBBBBBBBk..',
  '.kBBHHBBBBBBBbk.',
  '.kBHHHHBBBBBBBk.',
  'kBBHHHHBBBBBBBbk',
  'kBBBHHWkBBWkBBbk',
  'kBBBBBWkBBWkBbbk',
  'kBBBBBBBBBBBBbbk',
  'kBBBBBBBBBBBbbbk',
  'kBBBBBBBBBBbbbbk',
  '.kBBBBBBBBbbbbk.',
  '.kBBBBBBBbbbbbk.',
  '..kbBBBbbbbbbk..',
  '...kkbbbbbbkk...',
  '.....kkkkkk.....',
]

/** The fuse's cells from the cap upwards (x, rows above the body), curling a little to the right. */
export const FUSE: readonly (readonly [x: number, up: number])[] = [
  [7, 1],
  [7, 2],
  [8, 3],
  [8, 4],
  [9, 5],
  [9, 6],
]

/** Rows above the body: the whole fuse plus one row for the spark's top arm. */
export const FUSE_H = FUSE.length + 1
export const ART_W = 16
export const ART_H = FUSE_H + BODY.length

export const FUSE_PALETTE: Record<string, string> = {
  k: '#202830', // outline and pupils (--color-ds-ink)
  B: '#4a5a78', // body
  H: '#93a5c4', // highlight
  b: '#2e3a50', // shade
  G: '#e8c030', // cap
  g: '#a88820', // cap shade
  W: '#f8f8f8', // eyes
  F: '#c8a070', // fuse
  S: '#f8d030', // spark
  O: '#f87830', // spark core
}

/** The flash in the last 5 s: the body goes white, the outline and eyes stay so the shape still reads. */
export const FLASH_PALETTE: Record<string, string> = { ...FUSE_PALETTE, B: '#f8f8f8', H: '#ffffff', b: '#d8dee8', G: '#fff4c0', g: '#e8d890' }

/**
 * The timer's grid with `cells` of the fuse left (0 to FUSE.length). A lit fuse (`spark`) carries a spark on its tip:
 * frame 0 a plus, frame 1 an x, so it crackles when the frames alternate. A spent fuse (0 cells) shows no spark.
 */
export function fuseGrid(cells: number, spark: boolean, frame: 0 | 1 = 0): string[] {
  const rows = Array.from({ length: FUSE_H }, () => '.'.repeat(ART_W).split(''))
  const n = Math.max(0, Math.min(FUSE.length, Math.round(cells)))
  for (let i = 0; i < n; i++) {
    const [x, up] = FUSE[i]
    rows[FUSE_H - up][x] = 'F'
  }
  if (spark && n > 0) {
    const [x, up] = FUSE[n - 1]
    const y = FUSE_H - up
    const arms: [number, number][] = frame === 0 ? [[0, -1], [-1, 0], [1, 0]] : [[-1, -1], [1, -1], [-1, 0], [1, 0]]
    rows[y][x] = 'O'
    for (const [dx, dy] of arms) {
      const ax = x + dx
      const ay = y + dy
      if (ay >= 0 && ax >= 0 && ax < ART_W && rows[ay][ax] === '.') rows[ay][ax] = 'S'
    }
  }
  return [...rows.map((r) => r.join('')), ...BODY]
}

/** SVG paths for the timer (see ballPaths): one per colour, in grid pixels of an ART_W x ART_H viewBox. */
export const fusePaths = (cells: number, spark: boolean, frame: 0 | 1, flash: boolean) =>
  ballPaths(fuseGrid(cells, spark, frame), 0, ART_H, flash ? FLASH_PALETTE : FUSE_PALETTE)
