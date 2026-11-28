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

// ---------------------------------------------------------------------------------------------------------------
// The burst: time's up. The bomb flashes (FLASH_PALETTE), then BURST_FRAMES frames of a pixel explosion drawn here in
// code: a white-hot core, rings of yellow, orange and red with a ragged eight-point edge and an ink outline, then
// debris and grey smoke that thins out. All of it is generated from a few numbers, so there is nothing to ship.

export const BURST_W = 24
export const BURST_H = 24
export const BURST_FRAMES = 6

export const BURST_PALETTE: Record<string, string> = {
  k: '#202830', // outline
  W: '#f8f8f8', // white-hot core
  S: '#f8d030', // yellow
  O: '#f87830', // orange
  R: '#d83820', // red
  M: '#8890a0', // smoke
  m: '#c8ccd4', // thin smoke
}

/**
 * One frame (0 to BURST_FRAMES - 1) of the burst, BURST_W x BURST_H, in the BURST_PALETTE letters.
 * Frames 0 to 2 grow the fireball, 3 breaks it into a ring with flying debris, 4 and 5 are six puffs of smoke drifting
 * out (5, the lighter one, is also what stays once the burst is spent).
 */
export function burstGrid(frame: number): string[] {
  const cx = (BURST_W - 1) / 2
  const cy = (BURST_H - 1) / 2
  const f = Math.max(0, Math.min(BURST_FRAMES - 1, Math.floor(frame)))
  // Radii of each colour band per frame (a pixel within r of the centre, the edge pushed out on eight points).
  const bands: [string, number][][] = [
    [['W', 3.5], ['S', 5.5]],
    [['W', 3], ['S', 5.5], ['O', 7.5]],
    [['W', 2], ['S', 4.5], ['O', 7], ['R', 8.8]],
    [['S', 3], ['O', 6], ['R', 8.5]],
    [],
    [],
  ]
  const hole = f === 3 ? 1.5 : f === 4 ? 4 : f === 5 ? 6.5 : -1
  const rows = Array.from({ length: BURST_H }, () => '.'.repeat(BURST_W).split(''))
  for (let y = 0; y < BURST_H; y++) {
    for (let x = 0; x < BURST_W; x++) {
      const dx = x - cx
      const dy = y - cy
      const d = Math.hypot(dx, dy)
      const spike = 1 + 0.22 * Math.cos(8 * Math.atan2(dy, dx) + f * 0.6)
      const r = d / spike
      if (r <= hole) continue
      const band = bands[f].find(([, br]) => r <= br)
      if (!band) continue
      rows[y][x] = band[0]
    }
  }
  // Smoke: six round puffs around the centre, grey with a light top-left, drifting out and shrinking.
  if (f >= 4) {
    const [reach, size, body] = f === 4 ? [6, 3.3, 'M'] : [8, 2.6, 'm']
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6
      const px = cx + Math.cos(a) * reach
      const py = cy + Math.sin(a) * reach
      for (let y = 0; y < BURST_H; y++) {
        for (let x = 0; x < BURST_W; x++) {
          const dx = x - px
          const dy = y - py
          if (Math.hypot(dx, dy) > size) continue
          rows[y][x] = body === 'M' && dx + dy < -size * 0.6 ? 'm' : body
        }
      }
    }
  }
  // An ink outline around every frame, so the burst reads on the white box like the rest of the pixel art.
  {
    const filled = rows.map((r) => r.map((c) => c !== '.' && c !== 'k'))
    for (let y = 0; y < BURST_H; y++) {
      for (let x = 0; x < BURST_W; x++) {
        if (filled[y][x]) continue
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => filled[y + oy]?.[x + ox])
        if (near) rows[y][x] = 'k'
      }
    }
  }
  // Debris: single bright pixels thrown past the edge.
  if (f >= 2 && f <= 4) {
    const reach = [0, 0, 10.5, 11.5, 11.5][f]
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4
      const x = Math.round(cx + Math.cos(a) * reach)
      const y = Math.round(cy + Math.sin(a) * reach)
      if (x >= 0 && y >= 0 && x < BURST_W && y < BURST_H) rows[y][x] = f === 4 ? 'O' : 'S'
    }
  }
  return rows.map((r) => r.join(''))
}

/** SVG paths for a burst frame, in grid pixels of a BURST_W x BURST_H viewBox. */
export const burstPaths = (frame: number) => ballPaths(burstGrid(frame), 0, BURST_H, BURST_PALETTE)
